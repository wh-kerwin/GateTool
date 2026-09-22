import { EventEmitter } from 'node:events';
import { config } from '../config.js';
import { gateRest } from '../gate/rest.js';
import { GateWsClient } from '../gate/ws.js';
import { logger, toNumber } from '../lib/util.js';

const STALE_MS = 15000;
const FALLBACK_POLL_MS = 30000;

class MarketService extends EventEmitter {
  constructor() {
    super();
    this.cache = new Map();
    this.wsClient = null;
    this.wsConnected = false;
    this.fallbackTimer = null;
  }

  async init() {
    await this.refreshFromRest();
    this.wsClient = new GateWsClient({
      onTicker: (t) => this.upsert(t),
      onStatus: ({ connected }) => {
        this.wsConnected = Boolean(connected);
        this.emit('status', { websocket: this.wsConnected });
      },
    });
    this.wsClient.start();
    this.fallbackTimer = setInterval(() => this.refreshFromRest(true), FALLBACK_POLL_MS);
    this.fallbackTimer.unref?.();
  }

  async refreshFromRest(onlyStale = false) {
    for (const symbol of config.symbols) {
      const cached = this.cache.get(symbol);
      if (onlyStale && cached && Date.now() - new Date(cached.timestamp).getTime() < STALE_MS) continue;
      try {
        const ticker = await gateRest.getTicker(symbol);
        this.upsert(ticker);
      } catch (err) {
        logger.warn(`刷新 ${symbol} 行情失败`, String(err?.message || err));
      }
    }
  }

  upsert(ticker) {
    if (!ticker?.symbol || ticker.last == null) return;
    this.cache.set(ticker.symbol, ticker);
    this.emit('ticker', ticker);
  }

  /** 无服务器环境下的按需取价：只走 REST，不启动 WebSocket */
  async ensureFresh(maxAgeMs = 10000) {
    const stale = config.symbols.filter((s) => {
      const t = this.cache.get(s);
      return !t || Date.now() - new Date(t.timestamp).getTime() > maxAgeMs;
    });
    if (!stale.length) return;
    await Promise.all(
      stale.map((s) =>
        gateRest
          .getTicker(s)
          .then((t) => this.upsert(t))
          .catch((err) => logger.warn(`按需刷新 ${s} 失败`, String(err?.message || err))),
      ),
    );
  }

  getTicker(symbol) {
    const t = this.cache.get(symbol);
    if (!t) return null;
    return { ...t, ageMs: Date.now() - new Date(t.timestamp).getTime() };
  }

  getTickers() {
    return config.symbols.map((s) => this.getTicker(s)).filter(Boolean);
  }

  getStatus() {
    return {
      websocket: this.wsConnected,
      market: config.market,
      symbols: config.symbols,
      updatedAt: new Date().toISOString(),
    };
  }

  /** 创建预测时的行情快照：最新价 + 当前 1m K 线的 OHLC */
  async captureSnapshot(symbol) {
    const ticker = await gateRest.getTicker(symbol);
    let ohlc = { open: null, high: null, low: null, volume: null };
    try {
      const candles = await gateRest.getCandles({ symbol, interval: '1m', limit: 1 });
      const last = candles.at(-1);
      if (last) ohlc = { open: last.o, high: last.h, low: last.l, volume: last.v };
    } catch {
      /* 快照降级：只记录价格 */
    }
    return {
      symbol,
      price: ticker.last,
      volume: ohlc.volume ?? ticker.volume24h,
      open: ohlc.open,
      high: ohlc.high,
      low: ohlc.low,
      source: `${config.market}:rest`,
      timestamp: ticker.timestamp,
    };
  }

  /** 获取验证窗口内的 High / Low / Close */
  async getVerificationWindow(symbol, fromIso, toIso) {
    const fromSec = Math.floor(new Date(fromIso).getTime() / 1000);
    const toSec = Math.floor(new Date(toIso).getTime() / 1000);
    let high = null;
    let low = null;
    let candleClose = null;
    let candleCount = 0;

    try {
      const candles = await gateRest.getCandles({ symbol, interval: '1m', from: fromSec, to: toSec });
      for (const c of candles) {
        candleCount += 1;
        high = high == null ? c.h : Math.max(high, c.h);
        low = low == null ? c.l : Math.min(low, c.l);
        candleClose = c.c;
      }
    } catch (err) {
      logger.warn(`获取 ${symbol} 验证窗口 K 线失败`, String(err?.message || err));
    }

    let close = null;
    let source = 'candle';
    const live = this.cache.get(symbol);
    if (live?.last != null && Date.now() - new Date(live.timestamp).getTime() < 60000) {
      close = live.last;
      source = 'websocket';
    } else {
      try {
        close = (await gateRest.getTicker(symbol)).last;
        source = 'rest';
      } catch {
        close = candleClose;
      }
    }
    if (close == null) close = candleClose;
    if (close == null) throw new Error(`${symbol} 验证行情不可用`);

    return {
      close,
      high: toNumber(high, close),
      low: toNumber(low, close),
      source: `${source}${candleCount ? '+candle' : ''}`,
      candleCount,
      windowFrom: new Date(fromSec * 1000).toISOString(),
      windowTo: new Date(toSec * 1000).toISOString(),
    };
  }

  async getCandles(symbol, interval = '1m', limit = 120) {
    return gateRest.getCandles({ symbol, interval, limit });
  }

  stop() {
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
    this.wsClient?.stop();
  }
}

export const marketService = new MarketService();

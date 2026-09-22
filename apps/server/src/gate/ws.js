import WebSocket from 'ws';
import { config } from '../config.js';
import { logger, sleep, toNumber } from '../lib/util.js';

const MAX_BACKOFF_MS = 30000;

/** Gate 公共行情 WebSocket 客户端：订阅 ticker，带自动重连与心跳 */
export class GateWsClient {
  constructor({ url, market, symbols, onTicker, onStatus } = {}) {
    this.url = url || config.wsUrl;
    this.market = market || config.market;
    this.symbols = symbols || config.symbols;
    this.onTicker = onTicker || (() => {});
    this.onStatus = onStatus || (() => {});
    this.ws = null;
    this.attempt = 0;
    this.stopped = false;
    this.timers = [];
  }

  get channel() {
    return this.market === 'futures' ? 'futures.tickers' : 'spot.tickers';
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* noop */
      }
      this.ws = null;
    }
    this.onStatus({ connected: false, reason: 'stopped' });
  }

  connect() {
    if (this.stopped) return;
    let ws;
    try {
      ws = new WebSocket(this.url, { handshakeTimeout: 15000 });
    } catch (err) {
      this.scheduleReconnect(String(err?.message || err));
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      this.attempt = 0;
      this.onStatus({ connected: true });
      logger.info(`Gate WS 已连接 ${this.url}`);
      this.subscribe();
    });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg?.error) {
        logger.warn('Gate WS 返回错误', JSON.stringify(msg.error));
        return;
      }
      if (msg?.event === 'update' && Array.isArray(msg.result)) {
        for (const item of msg.result) this.onTicker(this.normalize(item));
      }
    });

    ws.on('pong', () => this.onStatus({ connected: true }));

    ws.on('close', (code, reason) => {
      this.onStatus({ connected: false, reason: `closed ${code} ${reason || ''}`.trim() });
      this.scheduleReconnect('connection closed');
    });

    ws.on('error', (err) => {
      logger.warn('Gate WS 异常', String(err?.message || err));
    });
  }

  subscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        time: Math.floor(Date.now() / 1000),
        channel: this.channel,
        event: 'subscribe',
        payload: this.symbols,
      }),
    );
    if (!this.timers.length) {
      this.timers.push(
        setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            try {
              this.ws.ping();
              this.ws.send(
                JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: `${this.market}.ping` }),
              );
            } catch {
              /* noop */
            }
          }
        }, 20000),
      );
    }
  }

  async scheduleReconnect(reason) {
    if (this.stopped) return;
    this.attempt = Math.min(this.attempt + 1, 8);
    const delay = Math.min(1000 * 2 ** (this.attempt - 1), MAX_BACKOFF_MS);
    logger.warn(`Gate WS 断开（${reason}），${Math.round(delay / 1000)}s 后重连`);
    await sleep(delay);
    this.connect();
  }

  normalize(raw) {
    const symbol = this.market === 'futures' ? raw.contract : raw.currency_pair;
    if (!symbol) return null;
    return {
      symbol,
      last: toNumber(raw.last),
      changePercent: toNumber(raw.change_percentage),
      high24h: toNumber(raw.high_24h),
      low24h: toNumber(raw.low_24h),
      volume24h: toNumber(this.market === 'futures' ? raw.volume_24h_base : raw.base_volume),
      markPrice: toNumber(raw.mark_price),
      source: 'websocket',
      timestamp: new Date().toISOString(),
    };
  }
}

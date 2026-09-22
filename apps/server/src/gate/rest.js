import { config, runtime } from '../config.js';
import { logger, sleep, toNumber } from '../lib/util.js';

/** Gate 公共行情 REST 客户端（只读，不需要 API Key） */
export class GateRestClient {
  constructor({ restBase, market, timeoutMs } = {}) {
    this.restBase = restBase || config.restBase;
    this.market = market || null;
    this.timeoutMs = timeoutMs || config.requestTimeoutMs;
  }

  async get(pathname, params = {}) {
    const url = new URL(this.restBase + pathname);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`Gate API ${res.status} ${res.statusText}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
        if (attempt < 3) await sleep(300 * attempt);
      }
    }
    logger.warn(`Gate REST 请求失败 ${url.pathname}`, String(lastErr?.message || lastErr));
    throw lastErr;
  }

  async getTicker(symbol) {
    const market = this.market || runtime.market;
    const raw =
      market === 'futures'
        ? (await this.get('/futures/usdt/tickers', { contract: symbol }))?.[0]
        : (await this.get('/spot/tickers', { currency_pair: symbol }))?.[0];
    if (!raw) throw new Error(`未获取到 ${symbol} 行情`);
    return this.normalizeTicker(raw, symbol);
  }

  async getTickers(symbols = []) {
    const results = await Promise.all(
      symbols.map((s) => this.getTicker(s).catch((e) => ({ symbol: s, error: String(e.message || e) }))),
    );
    return results;
  }

  normalizeTicker(raw, fallbackSymbol) {
    const isFutures = (this.market || runtime.market) === 'futures';
    const symbol = isFutures ? raw.contract : raw.currency_pair;
    return {
      symbol: symbol || fallbackSymbol,
      last: toNumber(raw.last),
      changePercent: toNumber(raw.change_percentage),
      high24h: toNumber(raw.high_24h),
      low24h: toNumber(raw.low_24h),
      volume24h: toNumber(isFutures ? raw.volume_24h_base : raw.base_volume),
      quoteVolume24h: toNumber(isFutures ? raw.volume_24h_quote : raw.quote_volume),
      markPrice: toNumber(raw.mark_price),
      fundingRate: toNumber(raw.funding_rate),
      source: 'rest',
      timestamp: new Date().toISOString(),
    };
  }

  async getCandles({ symbol, interval = '1m', from, to, limit }) {
    const params = { interval };
    // 注意：Gate 不允许 limit 与 from/to 同时出现
    if (from != null && to != null) {
      let f = Math.floor(Number(from));
      let t = Math.floor(Number(to));
      if (!(t > f)) t = f + 60;
      const maxSpan = 1000 * 60;
      if (t - f > maxSpan) f = t - maxSpan;
      params.from = f;
      params.to = t;
    } else if (limit) {
      params.limit = Math.min(1000, Math.max(1, Math.floor(Number(limit))));
    }
    const rows =
      (this.market || runtime.market) === 'futures'
        ? await this.get('/futures/usdt/candlesticks', { contract: symbol, ...params })
        : await this.get('/spot/candlesticks', { currency_pair: symbol, ...params });
    return (Array.isArray(rows) ? rows : []).map(this.normalizeCandle).sort((a, b) => a.t - b.t);
  }

  normalizeCandle(r) {
    return {
      t: Number(r.t),
      o: toNumber(r.o, 0),
      h: toNumber(r.h, 0),
      l: toNumber(r.l, 0),
      c: toNumber(r.c, 0),
      v: toNumber(r.v, 0),
    };
  }
}

export const gateRest = new GateRestClient();

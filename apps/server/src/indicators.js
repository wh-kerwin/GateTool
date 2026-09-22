/** 技术指标：全部为纯函数，输入升序 K 线数组 [{t,o,h,l,c,v}] */
const last = (arr) => (arr.length ? arr[arr.length - 1] : null);

export function emaSeries(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  let prev = null;
  for (const v of values) {
    prev = prev == null ? v : v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function ema(values, period) {
  return last(emaSeries(values, period));
}

export function rsiSeries(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function rsi(closes, period = 14) {
  return last(rsiSeries(closes, period));
}

export function atrSeries(candles, period = 14) {
  const trs = candles.map((c, i) => {
    if (i === 0) return c.h - c.l;
    const prevClose = candles[i - 1].c;
    return Math.max(c.h - c.l, Math.abs(c.h - prevClose), Math.abs(c.l - prevClose));
  });
  const out = new Array(candles.length).fill(null);
  if (candles.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += trs[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < candles.length; i += 1) {
    prev = (prev * (period - 1) + trs[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function atr(candles, period = 14) {
  return last(atrSeries(candles, period));
}

export function boll(closes, period = 20, mult = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = mid + mult * sd;
  const lower = mid - mult * sd;
  const price = closes[closes.length - 1];
  return {
    mid,
    upper,
    lower,
    sd,
    percentB: upper === lower ? 0.5 : (price - lower) / (upper - lower),
    bandwidth: mid ? ((upper - lower) / mid) * 100 : 0,
  };
}

/**
 * Parabolic SAR（Wilder）
 * 返回与 candles 等长的数组：{ sar, trend, ep, af }，trend = 1 多头 / -1 空头
 */
export function sarSeries(candles, { step = 0.02, maxStep = 0.2 } = {}) {
  const out = new Array(candles.length).fill(null);
  if (candles.length < 3) return out;

  let trend = candles[1].c >= candles[0].c ? 1 : -1;
  let ep = trend === 1 ? candles[1].h : candles[1].l;
  let sar = trend === 1 ? Math.min(candles[0].l, candles[1].l) : Math.max(candles[0].h, candles[1].h);
  let af = step;
  out[1] = { sar, trend, ep, af };

  for (let i = 2; i < candles.length; i += 1) {
    const { h, l } = candles[i];
    sar = sar + af * (ep - sar);
    if (trend === 1) sar = Math.min(sar, candles[i - 1].l, candles[i - 2].l);
    else sar = Math.max(sar, candles[i - 1].h, candles[i - 2].h);

    let reversed = false;
    if (trend === 1 && l < sar) {
      trend = -1;
      sar = ep;
      ep = l;
      af = step;
      reversed = true;
    } else if (trend === -1 && h > sar) {
      trend = 1;
      sar = ep;
      ep = h;
      af = step;
      reversed = true;
    }

    if (!reversed) {
      if (trend === 1 && h > ep) {
        ep = h;
        af = Math.min(af + step, maxStep);
      } else if (trend === -1 && l < ep) {
        ep = l;
        af = Math.min(af + step, maxStep);
      }
    }
    out[i] = { sar, trend, ep, af, reversed };
  }
  return out;
}

export function sar(candles, options) {
  const series = sarSeries(candles, options);
  for (let i = series.length - 1; i >= 0; i -= 1) if (series[i]) return series[i];
  return null;
}

export function donchian(candles, period = 20) {
  if (candles.length < period) return null;
  const slice = candles.slice(-period);
  return {
    high: Math.max(...slice.map((c) => c.h)),
    low: Math.min(...slice.map((c) => c.l)),
  };
}

export function volumeMa(volumes, period = 20) {
  if (volumes.length < period) return null;
  return volumes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

export function roc(closes, period = 12) {
  if (closes.length <= period) return 0;
  const now = closes[closes.length - 1];
  const before = closes[closes.length - 1 - period];
  return before === 0 ? 0 : ((now - before) / before) * 100;
}

/** 汇总多周期指标快照 */
export function summarize(candles, { atrPeriod = 14, rsiPeriod = 14, bollPeriod = 20, sarStep = 0.02, sarMaxStep = 0.2 } = {}) {
  const closes = candles.map((c) => c.c);
  const volumes = candles.map((c) => c.v);
  const price = last(closes);
  const atrValue = atr(candles, atrPeriod) || 0;
  const dc = donchian(candles, 20);
  const sarValue = sar(candles, { step: sarStep, maxStep: sarMaxStep });
  const bollValue = boll(closes, bollPeriod);
  return {
    price,
    ema7: ema(closes, 7),
    ema25: ema(closes, 25),
    ema99: ema(closes, 99),
    rsi: rsi(closes, rsiPeriod),
    atr: atrValue,
    atrPct: price ? (atrValue / price) * 100 : 0,
    boll: bollValue,
    sar: sarValue,
    sarDistancePct: sarValue && price ? ((price - sarValue.sar) / price) * 100 : null,
    donchian: dc,
    volumeMa20: volumeMa(volumes, 20),
    volume: last(volumes),
    roc12: roc(closes, 12),
  };
}

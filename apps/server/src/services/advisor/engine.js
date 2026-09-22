import { config } from '../../config.js';
import { db, nowIso } from '../../db.js';
import { gateRest } from '../../gate/rest.js';
import { marketService } from '../market.js';
import { summarize } from '../../indicators.js';
import { HttpError, logger, newId } from '../../lib/util.js';
import { analyzeWithLlm, predictWithLlm } from './llm.js';
import { DEFAULT_STRATEGY_ID, getStrategy } from './strategy.js';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/** 支持的推荐周期与验证周期 */
export const VALID_TIMEFRAMES = ['15m', '30m', '1h', '4h'];
export const VALID_HORIZONS = ['15m', '30m', '1h', '4h', '8h'];

/** 主周期 → 确认周期（高一级用于趋势确认） */
const CONFIRM_TIMEFRAME = { '15m': '1h', '30m': '1h', '1h': '4h', '4h': '1d' };

/** 方向性因子：value ∈ [-1,1]，正数偏多 */
function buildFactors(primary, confirm, fundingRate) {
  const factors = [];
  const p = primary.price;

  // TREND：均线排列 + 多周期一致性
  let trend = 0;
  const bull = primary.ema7 > primary.ema25 && primary.ema25 > primary.ema99 && p > primary.ema25;
  const bear = primary.ema7 < primary.ema25 && primary.ema25 < primary.ema99 && p < primary.ema25;
  if (bull) trend = 1;
  else if (bear) trend = -1;
  if (confirm) {
    const cBull = confirm.ema7 > confirm.ema25 && confirm.price > confirm.ema25;
    const cBear = confirm.ema7 < confirm.ema25 && confirm.price < confirm.ema25;
    if (trend > 0 && cBull) trend = 1;
    else if (trend < 0 && cBear) trend = -1;
    else if (trend !== 0) trend *= 0.6;
  }
  factors.push({
    code: 'TREND',
    value: clamp(trend, -1, 1),
    desc: trend > 0 ? '主周期与确认周期均线多头排列' : trend < 0 ? '主周期与确认周期均线空头排列' : '均线无明确排列',
  });

  // MOMENTUM：RSI + ROC
  let momentum = 0;
  if (primary.rsi != null) {
    if (primary.rsi < 35) momentum += 0.6;
    else if (primary.rsi < 45) momentum += 0.3;
    else if (primary.rsi > 65) momentum -= 0.6;
    else if (primary.rsi > 55) momentum -= 0.3;
  }
  momentum += Math.sign(primary.roc12) * Math.min(0.3, Math.abs(primary.roc12) / 10);
  factors.push({
    code: 'MOMENTUM',
    value: clamp(momentum, -1, 1),
    desc: `RSI=${primary.rsi?.toFixed(1)} ROC12=${primary.roc12?.toFixed(2)}%`,
  });

  // BREAKOUT：唐奇安通道突破
  let breakout = 0;
  if (primary.donchian) {
    if (p >= primary.donchian.high * 0.999) breakout = 1;
    else if (p <= primary.donchian.low * 1.001) breakout = -1;
  }
  factors.push({
    code: 'BREAKOUT',
    value: breakout,
    desc: breakout > 0 ? '突破近 20 根高点' : breakout < 0 ? '跌破近 20 根低点' : '未突破通道边界',
  });

  // BOLL：%B 位置（贴近下轨偏多反弹、上轨偏空回落）
  let bollValue = 0;
  if (primary.boll) {
    const percentB = primary.boll.percentB ?? 0.5;
    if (percentB <= 0.05) bollValue = 0.8;
    else if (percentB >= 0.95) bollValue = -0.8;
    else bollValue = (0.5 - percentB) * 1.2;
  }
  factors.push({
    code: 'BOLL',
    value: clamp(bollValue, -1, 1),
    desc: primary.boll
      ? `%B=${(primary.boll.percentB * 100).toFixed(0)}% 带宽=${primary.boll.bandwidth.toFixed(2)}%`
      : '布林数据不足',
  });

  // SAR：抛物线转向（价格与 SAR 相对位置 + 趋势方向）
  let sarValue = 0;
  if (primary.sar) {
    const above = p > primary.sar.sar;
    const up = primary.sar.trend === 1;
    if (up && above) sarValue = 1;
    else if (!up && !above) sarValue = -1;
    else sarValue = 0; // 反转过渡区，视为中性
    if (primary.sar.reversed) sarValue *= 0.6;
  }
  factors.push({
    code: 'SAR',
    value: clamp(sarValue, -1, 1),
    desc: primary.sar
      ? `SAR=${primary.sar.sar.toFixed(2)}（${primary.sar.trend === 1 ? '多头' : '空头'}${primary.sar.reversed ? '，刚反转' : ''}）`
      : 'SAR 数据不足',
  });

  // FUNDING：资金费率拥挤度（合约）
  let funding = 0;
  if (fundingRate != null) {
    const fr = Number(fundingRate);
    if (fr >= 0.0005) funding = -0.6;
    else if (fr <= -0.0005) funding = 0.6;
    else funding = -fr * 400;
  }
  factors.push({
    code: 'FUNDING',
    value: clamp(funding, -1, 1),
    desc: fundingRate == null ? '无资金费率（现货）' : `资金费率 ${(Number(fundingRate) * 100).toFixed(4)}%`,
  });

  return factors;
}

/** 质量因子：不决定方向，只影响置信度 */
function buildQuality(primary) {
  const parts = [];
  let volatility = 0.5;
  const atrPct = primary.atrPct || 0;
  if (atrPct >= 0.2 && atrPct <= 1.2) volatility = 1;
  else if (atrPct > 2) volatility = 0.2;
  else if (atrPct < 0.15) volatility = 0.4;
  parts.push({ code: 'VOLATILITY', value: volatility, desc: `ATR%=${atrPct.toFixed(2)}` });

  let volume = 0.4;
  if (primary.volumeMa20) {
    const ratio = primary.volume / primary.volumeMa20;
    volume = ratio >= 1.2 ? 1 : ratio >= 1 ? 0.7 : 0.4;
    parts.push({ code: 'VOLUME', value: volume, desc: `量比 ${ratio.toFixed(2)}` });
  } else {
    parts.push({ code: 'VOLUME', value: volume, desc: '量能数据不足' });
  }
  return parts;
}

/** 由综合得分（norm）与质量分推导方向、置信度与分数 */
export function finalizeDirection(norm, quality, params) {
  const confidence = clamp(Math.abs(norm) * (0.8 + 0.2 * quality), 0, 1);
  const score = Math.round(confidence * 100);
  let direction = 'NO_TRADE';
  if (norm >= params.dirThreshold) direction = 'LONG';
  else if (norm <= -params.dirThreshold) direction = 'SHORT';
  if (score < params.minScore) direction = 'NO_TRADE';
  return {
    norm: Number(norm.toFixed(4)),
    quality: Number(Number(quality).toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
    score,
    direction,
  };
}

export function scoreSignal({ factors, qualityParts, params }) {
  const weights = params.weights;
  const qualityWeights = params.qualityWeights || {};
  let net = 0;
  let weightSum = 0;
  for (const f of factors) {
    const w = weights[f.code] ?? 0;
    net += w * f.value;
    weightSum += w;
  }
  const norm = weightSum ? net / weightSum : 0;

  let q = 0;
  let qSum = 0;
  for (const part of qualityParts) {
    const w = qualityWeights[part.code] ?? 0;
    q += w * part.value;
    qSum += w;
  }
  const quality = qSum ? q / qSum : 0.5;
  return finalizeDirection(norm, quality, params);
}

export function sizePosition({ price, atrPct, params }) {
  const stopPct = Math.max(params.slAtrMult * atrPct, params.minStopPct);
  const leverage = Math.round(clamp(params.targetVolPct / (atrPct || 0.01), 1, params.maxLeverage));
  const rawMargin = leverage ? (params.riskPercent / (stopPct * leverage)) * 100 : params.minPositionPercent;
  const positionPercent = Number(clamp(rawMargin, params.minPositionPercent, params.maxPositionPercent).toFixed(2));
  const actualRisk = Number(((positionPercent * leverage * stopPct) / 100).toFixed(3));
  return { stopPct: Number(stopPct.toFixed(4)), leverage, positionPercent, actualRisk };
}

export async function analyzeSymbol(symbol, strategyId = DEFAULT_STRATEGY_ID, options = {}) {
  const strategy = await getStrategy(strategyId);
  if (!strategy) throw new Error('策略不存在');
  if (options.timeframe && !VALID_TIMEFRAMES.includes(options.timeframe)) {
    throw new HttpError(400, `timeframe 仅支持 ${VALID_TIMEFRAMES.join(' / ')}`);
  }
  if (options.horizon && !VALID_HORIZONS.includes(options.horizon)) {
    throw new HttpError(400, `horizon 仅支持 ${VALID_HORIZONS.join(' / ')}`);
  }
  const timeframe = options.timeframe || strategy.params.timeframe;
  const p = {
    ...strategy.params,
    timeframe,
    horizon: options.horizon || strategy.params.horizon,
    confirmTimeframe: CONFIRM_TIMEFRAME[timeframe] || strategy.params.confirmTimeframe,
  };

  const [primaryCandles, confirmCandles] = await Promise.all([
    gateRest.getCandles({ symbol, interval: p.timeframe, limit: 200 }),
    gateRest.getCandles({ symbol, interval: p.confirmTimeframe, limit: 200 }),
  ]);
  if (!primaryCandles.length) throw new HttpError(503, `未能获取 ${symbol} ${p.timeframe} K 线`);

  const indicatorOptions = {
    bollPeriod: p.bollPeriod || 20,
    sarStep: p.sarStep || 0.02,
    sarMaxStep: p.sarMaxStep || 0.2,
  };
  const primary = summarize(primaryCandles, indicatorOptions);
  const confirm = confirmCandles.length ? summarize(confirmCandles, indicatorOptions) : null;

  const cached = marketService.getTicker(symbol);
  const ticker = cached?.last ? cached : await gateRest.getTicker(symbol);
  const price = ticker?.last || primary.price;

  const factors = buildFactors({ ...primary, price }, confirm ? { ...confirm } : null, ticker?.fundingRate ?? null);
  const qualityParts = buildQuality(primary);
  let scored = scoreSignal({ factors, qualityParts, params: p });
  const ruleDirection = scored.direction;

  // 决策模式：rule = 纯规则；hybrid = 规则 + LLM 权重调整；llm = LLM 主导
  const useLlm = options.useLlm ?? p.useLlm ?? config.llm.enabled;
  const mode = options.mode || p.mode || (useLlm ? 'hybrid' : 'rule');

  let llm = { available: false, reason: mode === 'rule' ? '规则模式未调用 LLM' : 'LLM 未启用' };
  let llmPrediction = null;
  let llmFallback = false;

  if (mode === 'llm') {
    llmPrediction = await predictWithLlm({
      symbol,
      price,
      timeframe: p.timeframe,
      candles: primaryCandles,
      indicators: primary,
      fundingRate: ticker?.fundingRate ?? null,
      maxLeverage: p.maxLeverage,
      horizons: ['30m', '1h'],
    });
    llm = llmPrediction;
    if (llmPrediction.available) {
      scored = {
        ...scored,
        direction: llmPrediction.direction,
        confidence: llmPrediction.confidence,
        score: Math.round((llmPrediction.confidence ?? 0) * 100),
      };
      scored.llmAdjusted = true;
    } else if (p.llmFallback !== false) {
      // LLM 不可用则回退规则结果，并明确标记
      llmFallback = true;
    } else {
      scored = { ...scored, direction: 'NO_TRADE' };
    }
  } else if (mode === 'hybrid' && useLlm) {
    llm = await analyzeWithLlm({
      symbol,
      price,
      timeframe: p.timeframe,
      indicators: {
        ema7: primary.ema7,
        ema25: primary.ema25,
        ema99: primary.ema99,
        rsi14: primary.rsi,
        atrPct: primary.atrPct,
        boll: primary.boll,
        sar: primary.sar,
        sarDistancePct: primary.sarDistancePct,
        donchian: primary.donchian,
        roc12: primary.roc12,
        fundingRate: ticker?.fundingRate ?? null,
      },
      factors: factors.map((f) => ({ ...f, weight: p.weights[f.code] ?? 0 })),
      rule: { direction: scored.direction, score: scored.score, norm: scored.norm },
    });
    if (llm.available && llm.bias !== 'NEUTRAL') {
      const w = Number.isFinite(Number(p.llmWeight)) ? Number(p.llmWeight) : config.llm.weight;
      const biasValue = (llm.bias === 'LONG' ? 1 : -1) * (llm.confidence ?? 0.5);
      const adjusted = scored.norm * (1 - w) + biasValue * w;
      scored = finalizeDirection(adjusted, scored.quality, p);
      scored.llmAdjusted = true;
      scored.llmWeight = w;
    }
  }
  const sizing = sizePosition({ price, atrPct: primary.atrPct, params: p });

  const dirSign = scored.direction === 'LONG' ? 1 : scored.direction === 'SHORT' ? -1 : 0;
  const atrAbs = (primary.atrPct / 100) * price;

  let stopLoss = dirSign ? price * (1 - (dirSign * sizing.stopPct) / 100) : null;
  let takeProfit = dirSign ? price * (1 + (dirSign * sizing.stopPct * p.rr) / 100) : null;
  let positionPercent = dirSign ? sizing.positionPercent : null;
  let leverage = dirSign ? sizing.leverage : null;

  // LLM 主导模式：使用 LLM 给出的止损止盈 / 倍数 / 仓位，但用确定性风险护栏截断
  if (dirSign && llmPrediction?.available) {
    if (llmPrediction.stopLoss) stopLoss = llmPrediction.stopLoss;
    if (llmPrediction.takeProfit) takeProfit = llmPrediction.takeProfit;
    leverage = Math.round(clamp(Number(llmPrediction.leverage) || leverage, 1, p.maxLeverage));
    const stopPctLlm = Math.abs((price - stopLoss) / price) * 100;
    const maxMargin = (p.riskPercent / (stopPctLlm * leverage)) * 100;
    const raw = Number(llmPrediction.positionPercent ?? positionPercent);
    positionPercent = Number(
      clamp(raw, p.minPositionPercent, Math.min(p.maxPositionPercent, maxMargin)).toFixed(2),
    );
  }

  const finalStopPct = dirSign && stopLoss ? Math.abs((price - stopLoss) / price) * 100 : sizing.stopPct;
  const actualRisk =
    dirSign && positionPercent && leverage
      ? Number(((positionPercent * leverage * finalStopPct) / 100).toFixed(3))
      : null;

  return {
    symbol,
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    mode,
    timeframe: p.timeframe,
    horizon: p.horizon,
    direction: scored.direction,
    referencePrice: price,
    entryZone:
      llmPrediction?.available && llmPrediction.entryZone
        ? llmPrediction.entryZone
        : { low: price - atrAbs * 0.25, high: price + atrAbs * 0.25 },
    stopLoss,
    takeProfit,
    positionPercent,
    leverage,
    riskPercent: p.riskPercent,
    actualRiskPercent: actualRisk,
    rr: p.rr,
    stopPct: Number(finalStopPct.toFixed(4)),
    confidence: scored.confidence,
    score: scored.score,
    norm: scored.norm,
    ruleDirection,
    llmAdjusted: Boolean(scored.llmAdjusted),
    llmFallback,
    forecasts: llmPrediction?.forecasts || null,
    factors: factors.map((f) => ({ ...f, weight: p.weights[f.code] ?? 0 })),
    qualityParts,
    llm,
    riskNotes: buildRiskNotes({
      primary,
      sizing,
      params: p,
      llm,
      extra: llmPrediction?.warnings || [],
      fallback: llmFallback,
    }),
    indicators: {
      price,
      ema7: primary.ema7,
      ema25: primary.ema25,
      ema99: primary.ema99,
      rsi14: primary.rsi,
      atr14: primary.atr,
      atrPct: primary.atrPct,
      boll: primary.boll,
      sar: primary.sar,
      sarDistancePct: primary.sarDistancePct,
      donchian: primary.donchian,
      volumeMa20: primary.volumeMa20,
      roc12: primary.roc12,
      fundingRate: ticker?.fundingRate ?? null,
      confirmTrend: confirm ? (confirm.price > confirm.ema25 ? 'UP' : 'DOWN') : null,
    },
    params: p,
  };
}

function buildRiskNotes({ primary, sizing, params, llm, extra = [], fallback = false }) {
  const notes = [];
  if (fallback) notes.push('LLM 不可用，本次结果已回退到规则引擎');
  for (const w of extra) notes.push(`LLM 参数修正：${w}`);
  if (primary.atrPct > 2) notes.push(`ATR%=${primary.atrPct.toFixed(2)} 波动偏高，仓位已按风险预算压缩`);
  if (primary.boll && primary.boll.bandwidth < 2) notes.push('布林带宽收敛，存在假突破风险');
  if (primary.sar?.reversed) notes.push('SAR 刚刚反转，方向尚不稳定');
  if (sizing.leverage >= params.maxLeverage) notes.push(`已达倍数上限 ${params.maxLeverage}x`);
  if (sizing.actualRisk < params.riskPercent * 0.6) {
    notes.push(`实际风险 ${sizing.actualRisk}% 低于目标 ${params.riskPercent}%（受仓位上限约束）`);
  }
  for (const r of llm?.risks || []) notes.push(`LLM 风险提示：${r}`);
  return notes;
}

export function rowToRecommendation(row) {
  if (!row) return null;
  const parse = (v) => {
    if (!v) return null;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  };
  return {
    id: row.id,
    symbol: row.symbol,
    strategyId: row.strategy_id,
    strategyVersion: row.strategy_version,
    direction: row.direction,
    timeframe: row.timeframe,
    horizon: row.horizon,
    referencePrice: row.reference_price,
    entryLow: row.entry_low,
    entryHigh: row.entry_high,
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    positionPercent: row.position_percent,
    leverage: row.leverage,
    riskPercent: row.risk_percent,
    actualRiskPercent: row.actual_risk_percent,
    rr: row.rr,
    confidence: row.confidence,
    score: row.score,
    reasons: parse(row.reasons),
    indicators: parse(row.indicators),
    params: parse(row.params),
    status: row.status,
    resultType: row.result_type,
    resultPrice: row.result_price,
    resultPercent: row.result_percent,
    pnlPercent: row.pnl_percent,
    mfePercent: row.mfe_percent,
    maePercent: row.mae_percent,
    rMultiple: row.r_multiple,
    verifiedDetail: parse(row.verified_detail),
    retryCount: row.retry_count,
    lastError: row.last_error,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    verifiedAt: row.verified_at,
    updatedAt: row.updated_at,
  };
}

export async function generateRecommendation({
  symbol,
  strategyId = DEFAULT_STRATEGY_ID,
  auto = false,
  useLlm,
  timeframe,
  horizon,
  mode,
} = {}) {
  if (!config.symbols.includes(symbol)) throw new HttpError(400, `symbol 仅支持 ${config.symbols.join(' / ')}`);
  const analysis = await analyzeSymbol(symbol, strategyId, { useLlm, timeframe, horizon, mode });
  const id = newId('rec');
  const ts = nowIso();
  const created = new Date();
  const horizonMinutes = { '15m': 15, '30m': 30, '1h': 60, '4h': 240, '8h': 480 }[analysis.horizon] || 240;
  const expires = new Date(created.getTime() + horizonMinutes * 60000);
  const status = analysis.direction === 'NO_TRADE' ? 'SKIPPED' : 'OPEN';

  await db.run(
    `INSERT INTO recommendations (
      id, symbol, strategy_id, strategy_version, direction, timeframe, horizon,
      reference_price, entry_low, entry_high, stop_loss, take_profit, position_percent,
      leverage, risk_percent, actual_risk_percent, rr, confidence, score,
      reasons, indicators, params, status, retry_count, created_at, expires_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
    id,
    analysis.symbol,
    analysis.strategyId,
    analysis.strategyVersion,
    analysis.direction,
    analysis.timeframe,
    analysis.horizon,
    analysis.referencePrice,
    analysis.entryZone.low,
    analysis.entryZone.high,
    analysis.stopLoss,
    analysis.takeProfit,
    analysis.positionPercent,
    analysis.leverage,
    analysis.riskPercent,
    analysis.actualRiskPercent,
    analysis.rr,
    analysis.confidence,
    analysis.score,
    JSON.stringify({
      factors: analysis.factors,
      quality: analysis.qualityParts,
      stopPct: analysis.stopPct,
      norm: analysis.norm,
      mode: analysis.mode,
      ruleDirection: analysis.ruleDirection,
      llm: analysis.llm,
      forecasts: analysis.forecasts,
      llmFallback: analysis.llmFallback,
      riskNotes: analysis.riskNotes,
    }),
    JSON.stringify(analysis.indicators),
    JSON.stringify(analysis.params),
    status,
    ts,
    expires.toISOString(),
    ts,
  );

  await addEvent(id, 'CREATED', { auto, direction: analysis.direction, score: analysis.score });
  logger.info(
    `生成推荐 ${analysis.symbol} ${analysis.direction} score=${analysis.score} 仓位=${analysis.positionPercent}% 倍数=${analysis.leverage}x`,
  );
  return getRecommendation(id);
}

export async function addEvent(recommendationId, type, payload = {}) {
  await db.run(
    `INSERT INTO recommendation_events (id, recommendation_id, type, payload, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    newId('evt'),
    recommendationId,
    type,
    JSON.stringify(payload),
    nowIso(),
  );
}

export async function getRecommendation(id) {
  return rowToRecommendation(await db.get('SELECT * FROM recommendations WHERE id = ?', id));
}

export async function listRecommendations(filters = {}) {
  const where = [];
  const args = [];
  if (filters.symbol) (where.push('symbol = ?'), args.push(filters.symbol));
  if (filters.direction) (where.push('direction = ?'), args.push(filters.direction));
  if (filters.status) {
    const list = String(filters.status).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (list.length) (where.push(`status IN (${list.map(() => '?').join(',')})`), args.push(...list));
  }
  if (filters.startDate) (where.push('created_at >= ?'), args.push(filters.startDate));
  if (filters.endDate) (where.push('created_at <= ?'), args.push(filters.endDate));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(filters.pageSize) || 20));
  const countRow = await db.get(`SELECT COUNT(*) AS c FROM recommendations ${whereSql}`, ...args);
  const total = Number(countRow?.c ?? 0);
  const rows = await db.all(
    `SELECT * FROM recommendations ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ...args,
    pageSize,
    (page - 1) * pageSize,
  );
  return { items: rows.map(rowToRecommendation), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function listEvents(recommendationId) {
  const rows = await db.all(
    'SELECT * FROM recommendation_events WHERE recommendation_id = ? ORDER BY created_at ASC',
    recommendationId,
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    payload: r.payload ? JSON.parse(r.payload) : null,
    createdAt: r.created_at,
  }));
}

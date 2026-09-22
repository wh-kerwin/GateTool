import { config } from '../../config.js';
import { logger } from '../../lib/util.js';

const SYSTEM_PROMPT = [
  '你是加密货币量化分析助手，服务于一个"预测记录 + 自动验证"系统。',
  '只依据提供的技术指标与规则引擎输出做判断，输出严格 JSON，不要输出分析过程。',
  '不得编造未提供的数据；不提供投资建议，只给出方向倾向与风险提示。',
].join('');

export function llmStatus() {
  const l = config.llm;
  return {
    enabled: l.enabled,
    configured: Boolean(l.apiKey),
    baseUrl: l.baseUrl,
    model: l.model,
    weight: l.weight,
    timeoutMs: l.timeoutMs,
  };
}

const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);

async function chat(messages, attempt = 1) {
  const l = config.llm;
  try {
    const res = await fetch(`${l.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${l.apiKey}`,
      },
      body: JSON.stringify({
        model: l.model,
        messages,
        temperature: l.temperature,
        max_tokens: l.maxTokens,
      }),
      signal: AbortSignal.timeout(l.timeoutMs),
    });
    if (!res.ok) throw new Error(`LLM ${res.status} ${res.statusText}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || '';
  } catch (err) {
    // 首次调用常见冷启动超时，重试一次后仍失败再降级
    if (attempt < 2) {
      logger.warn(`LLM 第 ${attempt} 次调用失败，重试`, String(err?.message || err));
      await new Promise((r) => setTimeout(r, 500));
      return chat(messages, attempt + 1);
    }
    throw err;
  }
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function buildPrompt({ symbol, price, timeframe, indicators, factors, rule }) {
  const payload = {
    symbol,
    timeframe,
    price,
    indicators: {
      ema7: round(indicators.ema7),
      ema25: round(indicators.ema25),
      ema99: round(indicators.ema99),
      rsi14: round(indicators.rsi14),
      atrPct: round(indicators.atrPct, 3),
      bollUpper: round(indicators.boll?.upper),
      bollMid: round(indicators.boll?.mid),
      bollLower: round(indicators.boll?.lower),
      bollPercentB: round(indicators.boll?.percentB, 3),
      bollBandwidth: round(indicators.boll?.bandwidth, 3),
      sar: round(indicators.sar?.sar),
      sarTrend: indicators.sar?.trend === 1 ? 'UP' : 'DOWN',
      sarDistancePct: round(indicators.sarDistancePct, 3),
      donchianHigh: round(indicators.donchian?.high),
      donchianLow: round(indicators.donchian?.low),
      roc12: round(indicators.roc12, 3),
      fundingRate: indicators.fundingRate,
    },
    ruleFactors: factors.map((f) => ({ code: f.code, value: round(f.value, 3), weight: f.weight })),
    ruleResult: { direction: rule.direction, score: rule.score, norm: round(rule.norm, 3) },
  };
  return [
    '以下是规则引擎的指标快照与评分结果，请给出你的独立倾向判断：',
    JSON.stringify(payload),
    '输出 JSON：{"bias":"LONG|SHORT|NEUTRAL","confidence":0-1,"rationale":"不超过80字","risks":["风险点"]}',
  ].join('\n');
}

const round = (v, digits = 2) => (Number.isFinite(v) ? Number(Number(v).toFixed(digits)) : null);

/** 生成推荐时的 LLM 辅助判断（失败不影响主流程） */
export async function analyzeWithLlm(context) {
  if (!config.llm.enabled) return { available: false, reason: 'LLM 未启用（LLM_ENABLED=false）' };
  if (!config.llm.apiKey) return { available: false, reason: '未配置 LLM_API_KEY' };
  try {
    const content = await chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildPrompt(context) },
    ]);
    const json = extractJson(content);
    if (!json) return { available: false, reason: 'LLM 返回内容无法解析为 JSON', raw: content.slice(0, 300) };
    const bias = String(json.bias || '').toUpperCase();
    return {
      available: true,
      bias: bias === 'LONG' || bias === 'SHORT' ? bias : 'NEUTRAL',
      confidence: clamp01(Number(json.confidence)),
      rationale: String(json.rationale || '').slice(0, 300),
      risks: Array.isArray(json.risks) ? json.risks.slice(0, 5).map((r) => String(r).slice(0, 120)) : [],
      model: config.llm.model,
    };
  } catch (err) {
    logger.warn('LLM 分析失败，按规则结果继续', String(err?.message || err));
    return { available: false, reason: String(err?.message || err) };
  }
}

const DIR_SET = ['LONG', 'SHORT', 'RANGE'];
const BIAS_SET = ['UP', 'DOWN', 'FLAT'];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * LLM 主导模式：直接根据 K 线与指标给出方向、止损止盈、倍数、仓位与 30m/1h 趋势预测。
 * 所有数值都会做合法性校验与截断，非法值降级为按 ATR 计算的默认值。
 */
export async function predictWithLlm(context) {
  const unavailable = (reason) => ({ available: false, reason });
  if (!config.llm.enabled) return unavailable('LLM 未启用（LLM_ENABLED=false）');
  if (!config.llm.apiKey) return unavailable('未配置 LLM_API_KEY');

  const { symbol, price, timeframe, candles = [], indicators = {}, fundingRate, maxLeverage = 10, horizons = ['30m', '1h'] } = context;

  const series = candles.slice(-30).map((c) => ({
    t: c.t,
    o: round(c.o),
    h: round(c.h),
    l: round(c.l),
    c: round(c.c),
    v: Math.round(c.v),
  }));

  const prompt = [
    `标的信息：${symbol}，当前价 ${round(price)}，K线周期 ${timeframe}，合约资金费率 ${fundingRate ?? 'N/A'}`,
    `技术指标：${JSON.stringify({
      ema7: round(indicators.ema7),
      ema25: round(indicators.ema25),
      ema99: round(indicators.ema99),
      rsi14: round(indicators.rsi14),
      atr14: round(indicators.atr),
      atrPct: round(indicators.atrPct, 3),
      bollUpper: round(indicators.boll?.upper),
      bollMid: round(indicators.boll?.mid),
      bollLower: round(indicators.boll?.lower),
      bollPercentB: round(indicators.boll?.percentB, 3),
      bollBandwidth: round(indicators.boll?.bandwidth, 3),
      sar: round(indicators.sar?.sar),
      sarTrend: indicators.sar?.trend === 1 ? 'UP' : 'DOWN',
      donchianHigh: round(indicators.donchian?.high),
      donchianLow: round(indicators.donchian?.low),
      volumeMa20: Math.round(indicators.volumeMa20 || 0),
      roc12: round(indicators.roc12, 3),
    })}`,
    `最近 ${series.length} 根 K 线（t,o,h,l,c,v）：${JSON.stringify(series)}`,
    `请直接给出交易方向与参数，并预测 ${horizons.join('、')} 后的涨跌方向。`,
    '严格输出 JSON：',
    '{"direction":"LONG|SHORT|RANGE","confidence":0-1,"entryZone":{"low":数字,"high":数字},',
    '"stopLoss":数字,"takeProfit":数字,"leverage":整数(1-' + maxLeverage + '),"positionPercent":数字(保证金占净值%),',
    '"forecasts":{"30m":{"bias":"UP|DOWN|FLAT","changePercent":数字},"1h":{"bias":"UP|DOWN|FLAT","changePercent":数字}},',
    '"rationale":"不超过100字","risks":["风险点"]}',
  ].join('\n');

  try {
    const content = await chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ]);
    const json = extractJson(content);
    if (!json) return { ...unavailable('LLM 返回内容无法解析为 JSON'), raw: content.slice(0, 300) };

    const warnings = [];
    let direction = DIR_SET.includes(String(json.direction || '').toUpperCase())
      ? String(json.direction).toUpperCase()
      : null;
    if (!direction) {
      warnings.push('方向非法，已降级为 RANGE');
      direction = 'RANGE';
    }

    let leverage = Math.round(num(json.leverage) ?? 1);
    if (!Number.isFinite(leverage) || leverage < 1 || leverage > maxLeverage) {
      leverage = Math.min(maxLeverage, Math.max(1, leverage || 1));
      warnings.push(`倍数超出范围，已截断为 ${leverage}x`);
    }

    const entryLow = num(json.entryZone?.low);
    const entryHigh = num(json.entryZone?.high);

    let stopLoss = num(json.stopLoss);
    let takeProfit = num(json.takeProfit);
    if (direction === 'LONG' && stopLoss && stopLoss >= price) {
      stopLoss = null;
      warnings.push('做多止损价不合理，已按 ATR 重算');
    }
    if (direction === 'SHORT' && stopLoss && stopLoss <= price) {
      stopLoss = null;
      warnings.push('做空止损价不合理，已按 ATR 重算');
    }
    if (direction === 'LONG' && takeProfit && takeProfit <= price) takeProfit = null;
    if (direction === 'SHORT' && takeProfit && takeProfit >= price) takeProfit = null;
    if (!stopLoss || !takeProfit) warnings.push('止盈/止损缺失或不合理，缺失项按 ATR 兜底');

    const forecasts = {};
    for (const h of horizons) {
      const f = json.forecasts?.[h];
      const bias = BIAS_SET.includes(String(f?.bias || '').toUpperCase()) ? String(f.bias).toUpperCase() : null;
      if (!bias) continue;
      forecasts[h] = { bias, changePercent: num(f.changePercent) ?? null };
    }
    if (!Object.keys(forecasts).length) warnings.push('未提供有效的周期预测');

    return {
      available: true,
      model: config.llm.model,
      direction,
      confidence: clamp01(Number(json.confidence)),
      entryZone: entryLow && entryHigh ? { low: Math.min(entryLow, entryHigh), high: Math.max(entryLow, entryHigh) } : null,
      stopLoss,
      takeProfit,
      leverage,
      positionPercent: num(json.positionPercent),
      forecasts,
      rationale: String(json.rationale || '').slice(0, 400),
      risks: Array.isArray(json.risks) ? json.risks.slice(0, 5).map((r) => String(r).slice(0, 120)) : [],
      warnings,
    };
  } catch (err) {
    logger.warn('LLM 主导分析失败', String(err?.message || err));
    return unavailable(String(err?.message || err));
  }
}

/** 验证完成后的 LLM 复盘解读（只解释结果，不修改判定） */
export async function reviewWithLlm(rec) {
  if (!config.llm.enabled || !config.llm.apiKey) return { available: false, reason: 'LLM 未启用或未配置 Key' };
  const detail = rec.verifiedDetail || {};
  const prompt = [
    '以下是一次交易建议及其真实验证结果，请给出客观复盘（不超过 150 字），不要修改判定结果：',
    JSON.stringify({
      symbol: rec.symbol,
      direction: rec.direction,
      createdAt: rec.createdAt,
      expiresAt: rec.expiresAt,
      entry: rec.referencePrice,
      stopLoss: rec.stopLoss,
      takeProfit: rec.takeProfit,
      positionPercent: rec.positionPercent,
      leverage: rec.leverage,
      resultType: rec.resultType,
      status: rec.status,
      resultPercent: rec.resultPercent,
      pnlPercent: rec.pnlPercent,
      mfePercent: rec.mfePercent,
      maePercent: rec.maePercent,
      rMultiple: rec.rMultiple,
      exitPrice: detail.exitPrice,
      factors: (rec.reasons?.factors || []).map((f) => `${f.code}:${f.value}`),
    }),
    '输出 JSON：{"review":"复盘文本","lessons":["要点"]}',
  ].join('\n');
  try {
    const content = await chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ]);
    const json = extractJson(content);
    if (!json) return { available: false, reason: '返回无法解析', raw: content.slice(0, 300) };
    return {
      available: true,
      review: String(json.review || '').slice(0, 600),
      lessons: Array.isArray(json.lessons) ? json.lessons.slice(0, 5).map(String) : [],
      model: config.llm.model,
    };
  } catch (err) {
    logger.warn('LLM 复盘失败', String(err?.message || err));
    return { available: false, reason: String(err?.message || err) };
  }
}

import { config } from '../../config.js';
import { db, nowIso } from '../../db.js';
import { newId } from '../../lib/util.js';

export const DEFAULT_STRATEGY_ID = 'stg_trend_v1';

export const DEFAULT_PARAMS = {
  timeframe: '1h',
  confirmTimeframe: '4h',
  horizon: '4h',
  minScore: 55,
  dirThreshold: 0.15,
  riskPercent: 1.0,
  targetVolPct: 1.5,
  minStopPct: 0.5,
  slAtrMult: 1.5,
  rr: 2.0,
  maxLeverage: 10,
  minPositionPercent: 1,
  maxPositionPercent: 25,
  timeoutAsSuccess: true,
  adaptMinSample: 10,
  adaptCooldownHours: 24,
  autoRollback: true,
  bollPeriod: 20,
  bollMult: 2,
  sarStep: 0.02,
  sarMaxStep: 0.2,
  useLlm: false,
  llmWeight: 0.2,
  // 决策模式：rule = 纯规则因子；hybrid = 规则 + LLM 权重调整；llm = LLM 主导（由 LLM 直接给方向与参数）
  mode: 'llm',
  llmFallback: true,
  weights: {
    TREND: 0.25,
    MOMENTUM: 0.2,
    BOLL: 0.15,
    SAR: 0.15,
    BREAKOUT: 0.15,
    FUNDING: 0.1,
  },
  qualityWeights: { VOLUME: 0.5, VOLATILITY: 0.5 },
};

const DIRECTIONAL_FACTORS = Object.keys(DEFAULT_PARAMS.weights);

function rowToStrategy(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    params: JSON.parse(row.params),
    previous: row.previous ? JSON.parse(row.previous) : null,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function seedStrategies() {
  const exists = db.prepare('SELECT id FROM strategies WHERE id = ?').get(DEFAULT_STRATEGY_ID);
  if (!exists) {
    const ts = nowIso();
    db.prepare(
      `INSERT INTO strategies (id, name, version, params, previous, is_active, created_at, updated_at)
       VALUES (?, ?, 1, ?, NULL, 1, ?, ?)`,
    ).run(
      DEFAULT_STRATEGY_ID,
      '趋势跟随 V1',
      JSON.stringify({ ...DEFAULT_PARAMS, useLlm: config.llm.enabled }),
      ts,
      ts,
    );
    return;
  }
  // 升级已存在策略：补齐新增参数与因子权重（历史版本引用旧快照，不受影响）
  const current = getStrategy(DEFAULT_STRATEGY_ID);
  const patch = {};
  for (const [k, v] of Object.entries(DEFAULT_PARAMS)) {
    if (k === 'weights' || k === 'qualityWeights' || k === 'useLlm') continue;
    if (current.params[k] === undefined) patch[k] = v;
  }
  // 全局开启 LLM 时，同步打开策略层开关（前端与接口仍可逐次覆盖）
  if (config.llm.enabled && current.params.useLlm === false) patch.useLlm = true;
  const weights = { ...current.params.weights };
  for (const [k, v] of Object.entries(DEFAULT_PARAMS.weights)) if (weights[k] === undefined) weights[k] = v;
  const qualityWeights = { ...current.params.qualityWeights };
  for (const [k, v] of Object.entries(DEFAULT_PARAMS.qualityWeights)) if (qualityWeights[k] === undefined) qualityWeights[k] = v;
  const weightsChanged =
    Object.keys(weights).length !== Object.keys(current.params.weights).length ||
    Object.keys(qualityWeights).length !== Object.keys(current.params.qualityWeights).length;
  if (Object.keys(patch).length || weightsChanged) {
    updateStrategy(DEFAULT_STRATEGY_ID, { ...patch, weights, qualityWeights }, { bumpVersion: false });
  }
}

export function getStrategy(id = DEFAULT_STRATEGY_ID) {
  return rowToStrategy(db.prepare('SELECT * FROM strategies WHERE id = ?').get(id));
}

export function listStrategies() {
  return db.prepare('SELECT * FROM strategies ORDER BY updated_at DESC').all().map(rowToStrategy);
}

/** 更新参数：合并后写入新版本，保留上一版本用于回滚 */
export function updateStrategy(id, patch = {}, { bumpVersion = true, adaptedAt = null } = {}) {
  const current = getStrategy(id);
  if (!current) throw new Error('策略不存在');
  const merged = {
    ...current.params,
    ...patch,
    weights: { ...current.params.weights, ...(patch.weights || {}) },
    qualityWeights: { ...current.params.qualityWeights, ...(patch.qualityWeights || {}) },
  };
  merged.weights = normalizeWeights(merged.weights);
  if (adaptedAt) merged.adaptedAt = adaptedAt;
  const version = bumpVersion ? current.version + 1 : current.version;
  const ts = nowIso();
  db.prepare(
    `UPDATE strategies SET version = ?, params = ?, previous = ?, updated_at = ? WHERE id = ?`,
  ).run(version, JSON.stringify(merged), JSON.stringify(current.params), ts, id);
  return getStrategy(id);
}

export function normalizeWeights(weights) {
  const entries = Object.entries(weights).filter(([, v]) => Number.isFinite(v) && v > 0);
  const sum = entries.reduce((a, [, v]) => a + v, 0) || 1;
  return Object.fromEntries(entries.map(([k, v]) => [k, Number((v / sum).toFixed(4))]));
}

export function versionStats(strategyId, version, limit = 100) {
  return db
    .prepare(
      `SELECT status, r_multiple FROM recommendations
       WHERE strategy_id = ? AND strategy_version = ? AND status IN ('SUCCESS','FAIL')
       ORDER BY verified_at DESC LIMIT ?`,
    )
    .all(strategyId, version, limit);
}

export function overallStats(strategyId, limit = 100) {
  const rows = db
    .prepare(
      `SELECT status, r_multiple FROM recommendations
       WHERE strategy_id = ? AND status IN ('SUCCESS','FAIL')
       ORDER BY verified_at DESC LIMIT ?`,
    )
    .all(strategyId, limit);
  const total = rows.length;
  const wins = rows.filter((r) => r.status === 'SUCCESS').length;
  return {
    total,
    wins,
    losses: total - wins,
    winRate: total ? wins / total : null,
    avgR: total ? rows.reduce((a, r) => a + (r.r_multiple || 0), 0) / total : null,
  };
}

/** 记录因子级表现：仅统计"该因子主导且方向与信号一致"的样本 */
export function recordFactorOutcome(strategyId, direction, factors, { win, r }) {
  const upsert = db.prepare(
    `INSERT INTO factor_stats (id, strategy_id, factor, direction, samples, wins, losses, r_sum, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT (strategy_id, factor, direction) DO UPDATE SET
       samples = samples + 1,
       wins = wins + excluded.wins,
       losses = losses + excluded.losses,
       r_sum = r_sum + excluded.r_sum,
       updated_at = excluded.updated_at`,
  );
  const ts = nowIso();
  for (const f of factors) {
    if (!DIRECTIONAL_FACTORS.includes(f.code)) continue;
    const aligned = direction === 'LONG' ? f.value > 0 : f.value < 0;
    if (!aligned || Math.abs(f.value) < 0.3) continue;
    upsert.run(newId('fst'), strategyId, f.code, direction, win ? 1 : 0, win ? 0 : 1, r || 0, ts);
  }
}

export function getFactorStats(strategyId) {
  return db.prepare('SELECT * FROM factor_stats WHERE strategy_id = ?').all(strategyId);
}

/**
 * 权重自适应：因子胜率相对整体胜率的比值作为乘子（限制在 [0.5, 1.8]），归一化后生成新版本。
 * 返回 { changed, from, to, reason }
 */
export function adaptWeights(id = DEFAULT_STRATEGY_ID, { force = false } = {}) {
  const strategy = getStrategy(id);
  if (!strategy) throw new Error('策略不存在');
  const p = strategy.params;
  const overall = overallStats(id);
  const stats = getFactorStats(id);
  const byFactor = new Map(stats.map((s) => [s.factor, s]));

  if (!force) {
    if (!overall.total || overall.total < p.adaptMinSample) {
      return { changed: false, reason: `样本不足（${overall.total}/${p.adaptMinSample}）` };
    }
    if (p.adaptedAt) {
      const hours = (Date.now() - new Date(p.adaptedAt).getTime()) / 3600000;
      if (hours < p.adaptCooldownHours) {
        return { changed: false, reason: `处于冷却期（${hours.toFixed(1)}h / ${p.adaptCooldownHours}h）` };
      }
    }
  }

  const from = { ...p.weights };
  const to = {};
  const details = [];
  for (const [factor, w] of Object.entries(from)) {
    const s = byFactor.get(factor);
    if (!s || s.samples < p.adaptMinSample) {
      to[factor] = w;
      details.push({ factor, samples: s?.samples || 0, mult: 1, applied: false });
      continue;
    }
    const winRate = s.wins / (s.wins + s.losses);
    const base = overall.winRate && overall.winRate > 0 ? winRate / overall.winRate : 1;
    const mult = Math.min(1.8, Math.max(0.5, base));
    to[factor] = Number((w * mult).toFixed(4));
    details.push({ factor, samples: s.samples, winRate: Number(winRate.toFixed(3)), mult: Number(mult.toFixed(3)), applied: true });
  }

  const normalized = normalizeWeights(to);
  const changedEnough = Object.keys(from).some(
    (k) => Math.abs((normalized[k] || 0) - from[k]) >= 0.01,
  );
  if (!changedEnough) return { changed: false, reason: '权重变化低于阈值（<0.01）', details };

  const previousVersion = strategy.version;
  updateStrategy(id, { weights: normalized }, { bumpVersion: true, adaptedAt: new Date().toISOString() });

  const rollback = p.autoRollback ? maybeRollback(id, previousVersion) : null;
  return { changed: true, from, to: normalized, details, rollback, version: getStrategy(id).version };
}

/** 若新版本表现不如上一版本，且样本达标，则回滚权重 */
export function maybeRollback(id, previousVersion) {
  const current = getStrategy(id);
  const cur = versionStats(id, current.version, 30);
  const prev = versionStats(id, previousVersion, 30);
  const rate = (rows) => (rows.length ? rows.filter((r) => r.status === 'SUCCESS').length / rows.length : null);
  const curRate = rate(cur);
  const prevRate = rate(prev);
  if (cur.length >= 10 && prev.length >= 10 && curRate != null && prevRate != null && curRate < prevRate) {
    const prevStrategy = db.prepare('SELECT previous FROM strategies WHERE id = ?').get(id);
    const lastWeights = prevStrategy?.previous ? JSON.parse(prevStrategy.previous).weights : DEFAULT_PARAMS.weights;
    updateStrategy(id, { weights: lastWeights }, { bumpVersion: true });
    return { rolledBack: true, fromVersion: current.version, curRate, prevRate };
  }
  return { rolledBack: false, curRate, prevRate };
}

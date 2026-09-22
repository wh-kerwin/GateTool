import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { HttpError, logger, newId } from '../lib/util.js';
import {
  VALID_HORIZONS,
  VALID_TIMEFRAMES,
  addEvent,
  analyzeSymbol,
  generateRecommendation,
  getRecommendation,
  listEvents,
  listRecommendations,
} from '../services/advisor/engine.js';
import { llmStatus, reviewWithLlm } from '../services/advisor/llm.js';
import {
  DEFAULT_PARAMS,
  DEFAULT_STRATEGY_ID,
  adaptWeights,
  getStrategy,
  listStrategies,
  overallStats,
  updateStrategy,
} from '../services/advisor/strategy.js';
import { maybeAdapt, runSignalVerifications, verifyRecommendation } from '../services/advisor/verify.js';

export const signalsRouter = Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

signalsRouter.get(
  '/config',
  asyncHandler(async (req, res) => {
    const strategy = await getStrategy();
    res.json({
      defaultStrategyId: DEFAULT_STRATEGY_ID,
      defaultParams: DEFAULT_PARAMS,
      strategy,
      timeframes: VALID_TIMEFRAMES,
      horizons: VALID_HORIZONS,
      modes: ['rule', 'hybrid', 'llm'],
      resultTypes: ['TAKE_PROFIT', 'STOP_LOSS', 'BOTH_SAME_BAR', 'TIMEOUT_WIN', 'TIMEOUT_LOSS', 'EXPIRED'],
      disclaimer: '工具仅输出策略建议与验证结果，不执行任何下单，不构成投资建议。',
    });
  }),
);

signalsRouter.get('/llm/status', (req, res) => {
  res.json(llmStatus());
});

/** 只分析不入库 */
signalsRouter.post(
  '/analyze',
  asyncHandler(async (req, res) => {
    const { symbol, strategyId, useLlm, timeframe, horizon, mode } = req.body || {};
    if (!symbol) throw new HttpError(400, 'symbol 必填');
    res.json(
      await analyzeSymbol(String(symbol).toUpperCase(), strategyId || DEFAULT_STRATEGY_ID, {
        useLlm,
        timeframe,
        horizon,
        mode,
      }),
    );
  }),
);

signalsRouter.post(
  '/generate',
  asyncHandler(async (req, res) => {
    const { symbol, strategyId, useLlm, timeframe, horizon, mode } = req.body || {};
    if (!symbol) throw new HttpError(400, 'symbol 必填');
    const rec = await generateRecommendation({
      symbol: String(symbol).toUpperCase(),
      strategyId: strategyId || DEFAULT_STRATEGY_ID,
      useLlm,
      timeframe,
      horizon,
      mode,
    });
    res.status(201).json({ recommendation: rec });
  }),
);

signalsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listRecommendations(req.query));
  }),
);

signalsRouter.get(
  '/statistics',
  asyncHandler(async (req, res) => {
    const limit = Math.min(200, Number(req.query.limit) || 100);
    const overall = await overallStats(DEFAULT_STRATEGY_ID, limit);
    const group = async (col) => {
      const rows = await db.all(
        `SELECT ${col} AS key, COUNT(*) AS total,
                SUM(CASE WHEN status='SUCCESS' THEN 1 ELSE 0 END) AS wins,
                SUM(CASE WHEN status='FAIL' THEN 1 ELSE 0 END) AS losses,
                AVG(r_multiple) AS avgR, AVG(pnl_percent) AS avgPnl
         FROM recommendations
         WHERE status IN ('SUCCESS','FAIL')
         GROUP BY ${col}`,
      );
      return rows.map((r) => ({
        ...r,
        winRate: r.total ? Number(((Number(r.wins) / Number(r.total)) * 100).toFixed(2)) : null,
        avgR: r.avgR == null ? null : Number(r.avgR.toFixed(3)),
        avgPnl: r.avgPnl == null ? null : Number(r.avgPnl.toFixed(3)),
      }));
    };
    const openRow = await db.get("SELECT COUNT(*) AS c FROM recommendations WHERE status='OPEN'");

    res.json({
      overall,
      bySymbol: await group('symbol'),
      byDirection: await group('direction'),
      byVersion: await group('strategy_version'),
      open: Number(openRow?.c ?? 0),
      generatedAt: new Date().toISOString(),
    });
  }),
);

signalsRouter.get(
  '/strategies',
  asyncHandler(async (req, res) => {
    res.json({ items: await listStrategies() });
  }),
);

signalsRouter.put(
  '/strategies/:id',
  asyncHandler(async (req, res) => {
    const patch = req.body?.params || req.body || {};
    const updated = await updateStrategy(req.params.id, patch);
    logger.info(`策略参数更新 ${req.params.id} → v${updated.version}`, JSON.stringify(Object.keys(patch)));
    res.json({ strategy: updated });
  }),
);

signalsRouter.post(
  '/strategies/:id/adapt',
  asyncHandler(async (req, res) => {
    const result = await adaptWeights(req.params.id, { force: Boolean(req.body?.force) });
    res.json(result);
  }),
);

signalsRouter.post(
  '/verify-run',
  asyncHandler(async (req, res) => {
    const summary = await runSignalVerifications();
    res.json({ summary, adapt: await maybeAdapt(DEFAULT_STRATEGY_ID) });
  }),
);

signalsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const rec = await getRecommendation(req.params.id);
    if (!rec) throw new HttpError(404, '推荐不存在');
    const rows = await db.all(
      'SELECT * FROM signal_feedbacks WHERE recommendation_id = ? ORDER BY created_at DESC',
      req.params.id,
    );
    const feedback = rows.map((r) => ({
      id: r.id,
      adopted: r.adopted == null ? null : Boolean(r.adopted),
      rating: r.rating,
      comment: r.comment,
      createdAt: r.created_at,
    }));
    res.json({ recommendation: rec, events: await listEvents(req.params.id), feedback });
  }),
);

/** 手动触发 LLM 复盘解读（只解释结果，不修改判定） */
signalsRouter.post(
  '/:id/review',
  asyncHandler(async (req, res) => {
    const rec = await getRecommendation(req.params.id);
    if (!rec) throw new HttpError(404, '推荐不存在');
    const review = await reviewWithLlm(rec);
    res.json(review);
  }),
);

signalsRouter.post(
  '/:id/feedback',
  asyncHandler(async (req, res) => {
    const rec = await getRecommendation(req.params.id);
    if (!rec) throw new HttpError(404, '推荐不存在');
    const { adopted, rating, comment } = req.body || {};
    await db.run(
      `INSERT INTO signal_feedbacks (id, recommendation_id, adopted, rating, comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
      newId('fbk'),
      req.params.id,
      adopted == null ? null : adopted ? 1 : 0,
      rating ?? null,
      comment ?? null,
      nowIso(),
    );
    await addEvent(req.params.id, 'FEEDBACK', { adopted, rating });
    res.status(201).json({ ok: true });
  }),
);

signalsRouter.post(
  '/:id/verify',
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM recommendations WHERE id = ?', req.params.id);
    if (!row) throw new HttpError(404, '推荐不存在');
    if (row.status !== 'OPEN') throw new HttpError(409, '该推荐已结束');
    const updated = await verifyRecommendation(row);
    if (!updated) throw new HttpError(409, '未到期且未触发止损/止盈');
    res.json({ recommendation: updated, adapt: await maybeAdapt(DEFAULT_STRATEGY_ID) });
  }),
);

signalsRouter.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err?.message || '服务器内部错误', details: err?.details });
});

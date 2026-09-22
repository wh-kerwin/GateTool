import { Router } from 'express';
import { config, DIRECTIONS, TIMEFRAMES, TIMEFRAME_MINUTES } from '../config.js';
import { marketService } from '../services/market.js';
import { DEFAULT_STRATEGY_ID } from '../services/advisor/strategy.js';
import { maybeAdapt, runSignalVerifications } from '../services/advisor/verify.js';
import {
  cancelPrediction,
  createPrediction,
  getMarketSnapshot,
  getPrediction,
  getVerificationSnapshot,
  listPending,
  listPredictions,
} from '../services/prediction.js';
import { getStatistics } from '../services/statistics.js';
import { runDueVerifications, verifyPrediction } from '../services/verification.js';
import { HttpError, logger } from '../lib/util.js';

export const apiRouter = Router();

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

apiRouter.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), status: marketService.getStatus() });
});

apiRouter.get('/config', (req, res) => {
  res.json({
    market: config.market,
    symbols: config.symbols,
    timeframes: TIMEFRAMES,
    directions: DIRECTIONS,
    timeframeMinutes: TIMEFRAME_MINUTES,
    verifyIntervalMs: config.verifyIntervalMs,
    disclaimer: '本工具仅用于记录与验证个人市场判断，不构成投资建议，不提供任何交易功能。',
  });
});

apiRouter.get(
  '/market/tickers',
  asyncHandler(async (req, res) => {
    // 无服务器环境下按需用 REST 补齐行情
    await marketService.ensureFresh();
    res.json({ items: marketService.getTickers(), status: marketService.getStatus() });
  }),
);

/** Cron 入口：Vercel Cron 或外部定时器调用，执行一次预测 + 推荐验证 */
const runAllVerifications = async (req, res) => {
  const predictions = await runDueVerifications();
  const signals = await runSignalVerifications();
  const adapt = await maybeAdapt(DEFAULT_STRATEGY_ID);
  res.json({ predictions, signals, adapt, at: new Date().toISOString() });
};

apiRouter.get('/cron/verify', asyncHandler(runAllVerifications));
apiRouter.post('/cron/verify', asyncHandler(runAllVerifications));

apiRouter.get(
  '/market/candles',
  asyncHandler(async (req, res) => {
    const { symbol, interval = '1m', limit = '120' } = req.query;
    if (!symbol || !config.symbols.includes(String(symbol).toUpperCase())) {
      throw new HttpError(400, 'symbol 非法');
    }
    const candles = await marketService.getCandles(
      String(symbol).toUpperCase(),
      String(interval),
      Math.min(1000, Number(limit) || 120),
    );
    res.json({ symbol: String(symbol).toUpperCase(), interval: String(interval), items: candles });
  }),
);

apiRouter.get(
  '/predictions',
  asyncHandler(async (req, res) => {
    res.json(await listPredictions(req.query));
  }),
);

apiRouter.get(
  '/predictions/pending',
  asyncHandler(async (req, res) => {
    res.json({ items: await listPending(Math.min(200, Number(req.query.limit) || 50)) });
  }),
);

apiRouter.post(
  '/predictions',
  asyncHandler(async (req, res) => {
    const result = await createPrediction(req.body || {});
    res.status(201).json(result);
  }),
);

apiRouter.get(
  '/predictions/:id',
  asyncHandler(async (req, res) => {
    const prediction = await getPrediction(req.params.id);
    if (!prediction) throw new HttpError(404, '预测不存在');
    res.json({
      prediction,
      marketSnapshot: await getMarketSnapshot(prediction.id),
      verificationSnapshot: await getVerificationSnapshot(prediction.id),
    });
  }),
);

apiRouter.post(
  '/predictions/:id/cancel',
  asyncHandler(async (req, res) => {
    res.json({ prediction: await cancelPrediction(req.params.id, req.body?.note || '用户作废') });
  }),
);

apiRouter.post(
  '/predictions/:id/verify',
  asyncHandler(async (req, res) => {
    const row = await getPrediction(req.params.id);
    if (!row) throw new HttpError(404, '预测不存在');
    if (row.status !== 'PENDING') throw new HttpError(409, '该预测已结束，无法重复验证');
    const updated = await verifyPrediction(row);
    res.json({ prediction: updated });
  }),
);

apiRouter.get(
  '/statistics',
  asyncHandler(async (req, res) => {
    res.json(await getStatistics(req.query));
  }),
);

apiRouter.post(
  '/verifications/run',
  asyncHandler(async (req, res) => {
    const summary = await runDueVerifications();
    res.json(summary);
  }),
);

// eslint-disable-next-line no-unused-vars
apiRouter.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) logger.error('API 异常', String(err?.message || err));
  res.status(status).json({
    error: err?.message || '服务器内部错误',
    details: err?.details || undefined,
  });
});

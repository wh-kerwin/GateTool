import { Router } from 'express';
import { config, DIRECTIONS, TIMEFRAMES, TIMEFRAME_MINUTES } from '../config.js';
import { marketService } from '../services/market.js';
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

apiRouter.get('/market/tickers', (req, res) => {
  res.json({ items: marketService.getTickers(), status: marketService.getStatus() });
});

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

apiRouter.get('/predictions', (req, res) => {
  res.json(listPredictions(req.query));
});

apiRouter.get('/predictions/pending', (req, res) => {
  res.json({ items: listPending(Math.min(200, Number(req.query.limit) || 50)) });
});

apiRouter.post(
  '/predictions',
  asyncHandler(async (req, res) => {
    const result = await createPrediction(req.body || {});
    res.status(201).json(result);
  }),
);

apiRouter.get('/predictions/:id', (req, res) => {
  const prediction = getPrediction(req.params.id);
  if (!prediction) throw new HttpError(404, '预测不存在');
  res.json({
    prediction,
    marketSnapshot: getMarketSnapshot(prediction.id),
    verificationSnapshot: getVerificationSnapshot(prediction.id),
  });
});

apiRouter.post('/predictions/:id/cancel', (req, res) => {
  res.json({ prediction: cancelPrediction(req.params.id, req.body?.note || '用户作废') });
});

apiRouter.post(
  '/predictions/:id/verify',
  asyncHandler(async (req, res) => {
    const row = getPrediction(req.params.id);
    if (!row) throw new HttpError(404, '预测不存在');
    if (row.status !== 'PENDING') throw new HttpError(409, '该预测已结束，无法重复验证');
    const updated = await verifyPrediction(row);
    res.json({ prediction: updated });
  }),
);

apiRouter.get('/statistics', (req, res) => {
  res.json(getStatistics(req.query));
});

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

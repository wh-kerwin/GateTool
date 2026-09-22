import { config, DIRECTIONS, TIMEFRAMES, TIMEFRAME_MINUTES } from '../config.js';
import { db, nowIso, toPrediction } from '../db.js';
import { HttpError, newId } from '../lib/util.js';
import { marketService } from './market.js';

const SORT_COLUMNS = {
  predictionTime: 'prediction_time',
  verificationTime: 'verification_time',
  createdAt: 'created_at',
};

export async function listPredictions(filters = {}) {
  const where = [];
  const args = [];
  const push = (sql, value) => {
    where.push(sql);
    args.push(value);
  };

  if (filters.symbol) push('symbol = ?', filters.symbol);
  if (filters.direction) push('direction = ?', filters.direction);
  if (filters.timeframe) push('timeframe = ?', filters.timeframe);
  if (filters.status) {
    const statuses = String(filters.status)
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (statuses.length) push(`status IN (${statuses.map(() => '?').join(',')})`, ...statuses);
  }
  if (filters.startDate) push('prediction_time >= ?', filters.startDate);
  if (filters.endDate) push('prediction_time <= ?', filters.endDate);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(filters.pageSize) || 20));

  const countRow = await db.get(`SELECT COUNT(*) AS c FROM predictions ${whereSql}`, ...args);
  const total = Number(countRow?.c ?? 0);
  const orderBy = SORT_COLUMNS[filters.sortBy] || 'prediction_time';
  const direction = String(filters.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const rows = await db.all(
    `SELECT * FROM predictions ${whereSql}
       ORDER BY ${orderBy} ${direction}
       LIMIT ? OFFSET ?`,
    ...args,
    pageSize,
    (page - 1) * pageSize,
  );

  return {
    items: rows.map(toPrediction),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getPrediction(id) {
  const row = await db.get('SELECT * FROM predictions WHERE id = ?', id);
  return toPrediction(row);
}

export async function getMarketSnapshot(predictionId) {
  return await db.get('SELECT * FROM market_snapshots WHERE prediction_id = ?', predictionId) || null;
}

export async function getVerificationSnapshot(predictionId) {
  return await db.get('SELECT * FROM verification_snapshots WHERE prediction_id = ?', predictionId) || null;
}

function validateInput(input = {}) {
  const errors = [];
  const symbol = String(input.symbol || '').toUpperCase();
  const direction = String(input.direction || '').toUpperCase();
  const timeframe = String(input.timeframe || '').toLowerCase();

  if (!config.symbols.includes(symbol)) errors.push(`symbol 仅支持 ${config.symbols.join(' / ')}`);
  if (!DIRECTIONS.includes(direction)) errors.push(`direction 仅支持 ${DIRECTIONS.join(' / ')}`);
  if (!TIMEFRAMES.includes(timeframe)) errors.push(`timeframe 仅支持 ${TIMEFRAMES.join(' / ')}`);

  let rangePercent = null;
  if (direction === 'RANGE') {
    rangePercent = Number(input.rangePercent ?? 1);
    if (!Number.isFinite(rangePercent) || rangePercent <= 0 || rangePercent > 10) {
      errors.push('direction=RANGE 时 rangePercent 必须为 0 < x <= 10');
    }
  } else if (input.rangePercent !== undefined && input.rangePercent !== null) {
    rangePercent = Number(input.rangePercent);
  }

  let targetPrice = null;
  if (input.targetPrice !== undefined && input.targetPrice !== null && input.targetPrice !== '') {
    targetPrice = Number(input.targetPrice);
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) errors.push('targetPrice 必须为正数');
  }

  const reason = input.reason ? String(input.reason).slice(0, 500) : null;
  if (errors.length) throw new HttpError(400, '参数校验失败', errors);
  return { symbol, direction, timeframe, rangePercent, targetPrice, reason };
}

export async function createPrediction(input = {}, userId = config.defaultUserId) {
  const v = validateInput(input);
  const snapshot = await marketService.captureSnapshot(v.symbol);
  if (!snapshot || snapshot.price == null) {
    throw new HttpError(503, '行情获取失败，无法创建预测，请稍后重试');
  }

  const now = new Date();
  const verificationTime = new Date(now.getTime() + TIMEFRAME_MINUTES[v.timeframe] * 60000);
  const id = newId('prd');
  const ts = nowIso();

  await db.run(
    `INSERT INTO predictions (
      id, user_id, symbol, direction, entry_price, target_price, range_percent, timeframe,
      prediction_time, verification_time, reason, status, retry_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)`,
    id,
    userId,
    v.symbol,
    v.direction,
    snapshot.price,
    v.targetPrice,
    v.rangePercent,
    v.timeframe,
    now.toISOString(),
    verificationTime.toISOString(),
    v.reason,
    ts,
    ts,
  );

  await db.run(
    `INSERT INTO market_snapshots (id, prediction_id, symbol, price, volume, open, high, low, source, timestamp, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId('snp'),
    id,
    snapshot.symbol,
    snapshot.price,
    snapshot.volume,
    snapshot.open,
    snapshot.high,
    snapshot.low,
    snapshot.source,
    snapshot.timestamp,
    ts,
  );

  const prediction = await getPrediction(id);
  return { prediction, snapshot, conflicts: await findConflicts(prediction) };
}

/** 同标的、同窗口内方向冲突的待验证预测（仅提示，不阻断） */
async function findConflicts(prediction) {
  const rows = await db.all(
    `SELECT * FROM predictions
       WHERE status = 'PENDING'
         AND id != ?
         AND symbol = ?
         AND direction != ?
         AND verification_time > ?
         AND prediction_time < ?`,
    prediction.id,
    prediction.symbol,
    prediction.direction,
    prediction.predictionTime,
    prediction.verificationTime,
  );
  return rows.map(toPrediction);
}

export async function cancelPrediction(id, note = '用户作废') {
  const existing = await getPrediction(id);
  if (!existing) throw new HttpError(404, '预测不存在');
  if (existing.status !== 'PENDING') throw new HttpError(409, '仅待验证的预测可以作废');
  await db.run(
    `UPDATE predictions SET status = 'EXPIRED', cancel_note = ?, updated_at = ? WHERE id = ?`,
    note,
    nowIso(),
    id,
  );
  return getPrediction(id);
}

export async function listPending(limit = 50) {
  const rows = await db.all(
    `SELECT * FROM predictions WHERE status = 'PENDING'
       ORDER BY verification_time ASC LIMIT ?`,
    limit,
  );
  return rows.map(toPrediction);
}

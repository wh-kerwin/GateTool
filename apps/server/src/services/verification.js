import { EventEmitter } from 'node:events';
import { config } from '../config.js';
import { db, nowIso, toPrediction } from '../db.js';
import { logger, newId } from '../lib/util.js';
import { marketService } from './market.js';

export const verificationEvents = new EventEmitter();

/** 确定性判定规则（不引入任何 LLM / 随机因素） */
export function evaluate({ direction, entryPrice, close, rangePercent }) {
  const pct = ((close - entryPrice) / entryPrice) * 100;
  let status;
  let note = null;

  if (direction === 'LONG') {
    status = pct > 0 ? 'SUCCESS' : 'FAIL';
    if (pct === 0) note = 'FLAT';
  } else if (direction === 'SHORT') {
    status = pct < 0 ? 'SUCCESS' : 'FAIL';
    if (pct === 0) note = 'FLAT';
  } else {
    const band = Number(rangePercent) > 0 ? Number(rangePercent) : 1;
    status = Math.abs(pct) <= band ? 'SUCCESS' : 'FAIL';
    note = `range ±${band}%`;
  }

  return { status, resultPercent: Number(pct.toFixed(4)), note };
}

const locks = new Set();

export async function verifyPrediction(row) {
  const prediction = toPrediction(row);
  if (locks.has(prediction.id)) return null;
  locks.add(prediction.id);
  try {
    const window = await marketService.getVerificationWindow(
      prediction.symbol,
      prediction.predictionTime,
      prediction.verificationTime,
    );
    const { status, resultPercent, note } = evaluate({
      direction: prediction.direction,
      entryPrice: prediction.entryPrice,
      close: window.close,
      rangePercent: prediction.rangePercent,
    });
    const ts = nowIso();

    db.prepare(
      `UPDATE predictions
       SET status = ?, result_price = ?, result_percent = ?, high_price = ?, low_price = ?,
           verified_at = ?, last_error = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(status, window.close, resultPercent, window.high, window.low, ts, ts, prediction.id);

    db.prepare(
      `INSERT INTO verification_snapshots (id, prediction_id, symbol, close, high, low, source, window_from, window_to, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId('vsn'),
      prediction.id,
      prediction.symbol,
      window.close,
      window.high,
      window.low,
      window.source,
      window.windowFrom,
      window.windowTo,
      ts,
    );

    const updated = getPredictionById(prediction.id);
    logger.info(
      `验证完成 ${updated.symbol} ${updated.direction} ${updated.timeframe} → ${status} (${resultPercent}%)`,
    );
    verificationEvents.emit('verified', updated);
    return updated;
  } finally {
    locks.delete(prediction.id);
  }
}

function getPredictionById(id) {
  return toPrediction(db.prepare('SELECT * FROM predictions WHERE id = ?').get(id));
}

function duePredictions(limit = 100) {
  return db
    .prepare(
      `SELECT * FROM predictions
       WHERE status = 'PENDING' AND verification_time <= ?
       ORDER BY verification_time ASC
       LIMIT ?`,
    )
    .all(new Date().toISOString(), limit);
}

export async function runDueVerifications() {
  const rows = duePredictions();
  if (!rows.length) return { scanned: 0, verified: 0, expired: 0, failed: 0 };
  const summary = { scanned: rows.length, verified: 0, expired: 0, failed: 0 };

  for (const row of rows) {
    try {
      const result = await verifyPrediction(row);
      if (result) summary.verified += 1;
    } catch (err) {
      const retry = Number(row.retry_count || 0) + 1;
      summary.failed += 1;
      if (retry >= config.maxVerifyRetry) {
        db.prepare(
          `UPDATE predictions SET status = 'EXPIRED', retry_count = ?, last_error = ?, updated_at = ?
           WHERE id = ?`,
        ).run(retry, String(err?.message || err), nowIso(), row.id);
        summary.expired += 1;
        logger.error(`预测 ${row.id} 验证失败已达上限，标记 EXPIRED`, String(err?.message || err));
      } else {
        db.prepare(
          `UPDATE predictions SET retry_count = ?, last_error = ?, updated_at = ? WHERE id = ?`,
        ).run(retry, String(err?.message || err), nowIso(), row.id);
        logger.warn(`预测 ${row.id} 验证失败（第 ${retry} 次）`, String(err?.message || err));
      }
    }
  }

  if (summary.verified || summary.expired) {
    logger.info(
      `验证扫描：扫描 ${summary.scanned} / 成功 ${summary.verified} / 失败重试 ${summary.failed} / 作废 ${summary.expired}`,
    );
  }
  return summary;
}

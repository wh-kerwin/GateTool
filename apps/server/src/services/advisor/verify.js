import { EventEmitter } from 'node:events';
import { config } from '../../config.js';
import { db, nowIso } from '../../db.js';
import { gateRest } from '../../gate/rest.js';
import { logger } from '../../lib/util.js';
import { addEvent, getRecommendation } from './engine.js';
import { reviewWithLlm } from './llm.js';
import { adaptWeights, recordFactorOutcome } from './strategy.js';

export const signalEvents = new EventEmitter();
const locks = new Set();

/** 用 1m K 线逐根回放验证：先触 SL / 先触 TP / 到期 */
export async function verifyRecommendation(row) {
  if (locks.has(row.id)) return null;
  locks.add(row.id);
  try {
    const dirSign = row.direction === 'LONG' ? 1 : -1;
    const entry = row.reference_price;
    const sl = row.stop_loss;
    const tp = row.take_profit;
    const leverage = row.leverage || 1;
    const stopPct = Math.abs((entry - sl) / entry) * 100;

    const nowMs = Date.now();
    const fromSec = Math.floor(new Date(row.created_at).getTime() / 1000);
    const expiryMs = new Date(row.expires_at).getTime();
    const toSec = Math.floor(Math.min(nowMs, expiryMs) / 1000);

    const candles = await gateRest.getCandles({ symbol: row.symbol, interval: '1m', from: fromSec, to: toSec });
    if (!candles.length) throw new Error('验证窗口内无 K 线数据');

    let resultType = null;
    let exitPrice = null;
    let mfe = 0;
    let mae = 0;
    let touchedAt = null;

    for (const c of candles) {
      const favorable = dirSign > 0 ? (c.h - entry) / entry : (entry - c.l) / entry;
      const adverse = dirSign > 0 ? (entry - c.l) / entry : (c.h - entry) / entry;
      if (favorable > mfe) mfe = favorable;
      if (adverse > mae) mae = adverse;

      if (resultType) continue;
      const slHit = dirSign > 0 ? c.l <= sl : c.h >= sl;
      const tpHit = dirSign > 0 ? c.h >= tp : c.l <= tp;
      if (slHit && tpHit) {
        resultType = 'BOTH_SAME_BAR';
        exitPrice = sl;
        touchedAt = c.t;
      } else if (slHit) {
        resultType = 'STOP_LOSS';
        exitPrice = sl;
        touchedAt = c.t;
      } else if (tpHit) {
        resultType = 'TAKE_PROFIT';
        exitPrice = tp;
        touchedAt = c.t;
      }
    }

    const expired = nowMs >= expiryMs;
    if (!resultType) {
      if (!expired) return null; // 未到期且未触发，继续等待
      exitPrice = candles[candles.length - 1].c;
      const pct = ((exitPrice - entry) / entry) * 100 * dirSign;
      resultType = pct > 0 ? 'TIMEOUT_WIN' : 'TIMEOUT_LOSS';
      touchedAt = candles[candles.length - 1].t;
    }

    const resultPercent = ((exitPrice - entry) / entry) * 100 * dirSign;
    const pnlPercent = resultPercent * leverage;
    const rMultiple = stopPct ? pnlPercent / stopPct : null;

    const params = row.params ? JSON.parse(row.params) : {};
    const timeoutAsSuccess = params.timeoutAsSuccess !== false;
    const win = resultType === 'TAKE_PROFIT' || (resultType === 'TIMEOUT_WIN' && timeoutAsSuccess);
    const status = win ? 'SUCCESS' : 'FAIL';
    const ts = nowIso();

    const detail = { exitPrice, touchedAt, candles: candles.length, stopPct: Number(stopPct.toFixed(4)), leverage };
    if (config.llm.enabled) {
      const review = await reviewWithLlm({
        symbol: row.symbol,
        direction: row.direction,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        referencePrice: entry,
        stopLoss: sl,
        takeProfit: tp,
        positionPercent: row.position_percent,
        leverage: row.leverage,
        resultType,
        status,
        resultPercent: Number(resultPercent.toFixed(4)),
        pnlPercent: Number(pnlPercent.toFixed(4)),
        mfePercent: Number((mfe * 100).toFixed(4)),
        maePercent: Number((mae * 100).toFixed(4)),
        rMultiple,
        verifiedDetail: detail,
        reasons: row.reasons ? JSON.parse(row.reasons) : null,
      });
      if (review.available) detail.llmReview = review;
    }

    db.prepare(
      `UPDATE recommendations
       SET status = ?, result_type = ?, result_price = ?, result_percent = ?, pnl_percent = ?,
           mfe_percent = ?, mae_percent = ?, r_multiple = ?, verified_detail = ?, verified_at = ?,
           last_error = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(
      status,
      resultType,
      exitPrice,
      Number(resultPercent.toFixed(4)),
      Number(pnlPercent.toFixed(4)),
      Number((mfe * 100).toFixed(4)),
      Number((mae * 100).toFixed(4)),
      rMultiple == null ? null : Number(rMultiple.toFixed(3)),
      JSON.stringify(detail),
      ts,
      ts,
      row.id,
    );

    addEvent(row.id, 'VERIFIED', { resultType, status, resultPercent, pnlPercent, rMultiple });

    const reasons = row.reasons ? JSON.parse(row.reasons) : null;
    if (reasons?.factors) {
      recordFactorOutcome(row.strategy_id, row.direction, reasons.factors, { win, r: rMultiple || 0 });
    }

    logger.info(
      `推荐验证 ${row.symbol} ${row.direction} → ${resultType}(${status}) 收益 ${resultPercent.toFixed(2)}% R=${rMultiple?.toFixed(2)}`,
    );
    const updated = getRecommendation(row.id);
    signalEvents.emit('verified', updated);
    return updated;
  } finally {
    locks.delete(row.id);
  }
}

function openRecommendations(limit = 50) {
  return db
    .prepare(`SELECT * FROM recommendations WHERE status = 'OPEN' ORDER BY expires_at ASC LIMIT ?`)
    .all(limit);
}

export async function runSignalVerifications() {
  const rows = openRecommendations();
  const summary = { scanned: rows.length, verified: 0, failed: 0, expired: 0 };
  for (const row of rows) {
    try {
      const result = await verifyRecommendation(row);
      if (result) summary.verified += 1;
    } catch (err) {
      const retry = Number(row.retry_count || 0) + 1;
      summary.failed += 1;
      if (retry >= config.maxVerifyRetry) {
        db.prepare(`UPDATE recommendations SET status = 'EXPIRED', retry_count = ?, last_error = ?, updated_at = ? WHERE id = ?`)
          .run(retry, String(err?.message || err), nowIso(), row.id);
        summary.expired += 1;
        addEvent(row.id, 'EXPIRED', { reason: String(err?.message || err) });
      } else {
        db.prepare(`UPDATE recommendations SET retry_count = ?, last_error = ?, updated_at = ? WHERE id = ?`)
          .run(retry, String(err?.message || err), nowIso(), row.id);
      }
    }
  }
  if (summary.verified || summary.expired) {
    logger.info(`推荐验证扫描：扫描 ${summary.scanned} / 完成 ${summary.verified} / 失败 ${summary.failed} / 作废 ${summary.expired}`);
  }
  return summary;
}

/** 验证完成后按冷却期与样本量触发权重自适应 */
export function maybeAdapt(strategyId) {
  try {
    const result = adaptWeights(strategyId);
    if (result.changed) {
      logger.info(
        `策略权重自适应完成 v${result.version} ${Object.keys(result.to)
          .map((k) => `${k}:${result.from[k]}→${result.to[k]}`)
          .join(' ')}`,
      );
    }
    return result;
  } catch (err) {
    logger.warn('策略自适应失败', String(err?.message || err));
    return { changed: false, reason: String(err?.message || err) };
  }
}

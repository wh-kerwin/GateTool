import { db } from '../db.js';

function buildWhere(filters = {}) {
  const where = ['1 = 1'];
  const args = [];
  if (filters.symbol) {
    where.push('symbol = ?');
    args.push(filters.symbol);
  }
  if (filters.timeframe) {
    where.push('timeframe = ?');
    args.push(filters.timeframe);
  }
  if (filters.direction) {
    where.push('direction = ?');
    args.push(filters.direction);
  }
  if (filters.startDate) {
    where.push('prediction_time >= ?');
    args.push(filters.startDate);
  }
  if (filters.endDate) {
    where.push('prediction_time <= ?');
    args.push(filters.endDate);
  }
  return { sql: where.join(' AND '), args };
}

const rate = (success, decided) => (decided > 0 ? Number(((success / decided) * 100).toFixed(2)) : null);

export function getStatistics(filters = {}) {
  const { sql, args } = buildWhere(filters);

  const agg = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success,
         SUM(CASE WHEN status = 'FAIL' THEN 1 ELSE 0 END) AS fail,
         SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END) AS expired,
         AVG(CASE WHEN result_percent IS NOT NULL THEN result_percent END) AS avgResultPercent
       FROM predictions WHERE ${sql}`,
    )
    .get(...args);

  const verified = (agg.success || 0) + (agg.fail || 0);

  const groupRows = (extraSelect, groupBy) =>
    db
      .prepare(
        `SELECT ${extraSelect},
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success,
                SUM(CASE WHEN status = 'FAIL' THEN 1 ELSE 0 END) AS fail
         FROM predictions WHERE ${sql}
         GROUP BY ${groupBy}`,
      )
      .all(...args)
      .map((r) => {
        const decided = (r.success || 0) + (r.fail || 0);
        return {
          ...r,
          decided,
          accuracy: rate(r.success || 0, decided),
          enoughSample: decided >= 10,
        };
      });

  return {
    total: agg.total || 0,
    pending: agg.pending || 0,
    success: agg.success || 0,
    fail: agg.fail || 0,
    expired: agg.expired || 0,
    verified,
    accuracy: rate(agg.success || 0, verified),
    avgResultPercent:
      agg.avgResultPercent == null ? null : Number(Number(agg.avgResultPercent).toFixed(4)),
    breakdown: {
      bySymbol: groupRows('symbol', 'symbol'),
      byTimeframe: groupRows('timeframe', 'timeframe'),
      byDirection: groupRows('direction', 'direction'),
      bySymbolTimeframe: groupRows("symbol || ' / ' || timeframe AS key", 'symbol, timeframe'),
    },
    generatedAt: new Date().toISOString(),
  };
}

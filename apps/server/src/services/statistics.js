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

export async function getStatistics(filters = {}) {
  const { sql, args } = buildWhere(filters);

  const agg = (await db.get(
    `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success,
         SUM(CASE WHEN status = 'FAIL' THEN 1 ELSE 0 END) AS fail,
         SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END) AS expired,
         AVG(CASE WHEN result_percent IS NOT NULL THEN result_percent END) AS avgResultPercent
       FROM predictions WHERE ${sql}`,
    ...args,
  )) || {};

  const verified = Number(agg.success || 0) + Number(agg.fail || 0);

  const groupRows = async (extraSelect, groupBy) => {
    const rows = await db.all(
      `SELECT ${extraSelect},
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success,
                SUM(CASE WHEN status = 'FAIL' THEN 1 ELSE 0 END) AS fail
         FROM predictions WHERE ${sql}
         GROUP BY ${groupBy}`,
      ...args,
    );
    return rows.map((r) => {
      const decided = Number(r.success || 0) + Number(r.fail || 0);
      return {
        ...r,
        decided,
        accuracy: rate(Number(r.success || 0), decided),
        enoughSample: decided >= 10,
      };
    });
  };

  return {
    total: Number(agg.total || 0),
    pending: Number(agg.pending || 0),
    success: Number(agg.success || 0),
    fail: Number(agg.fail || 0),
    expired: Number(agg.expired || 0),
    verified,
    accuracy: rate(Number(agg.success || 0), verified),
    avgResultPercent:
      agg.avgResultPercent == null ? null : Number(Number(agg.avgResultPercent).toFixed(4)),
    breakdown: {
      bySymbol: await groupRows('symbol', 'symbol'),
      byTimeframe: await groupRows('timeframe', 'timeframe'),
      byDirection: await groupRows('direction', 'direction'),
      bySymbolTimeframe: await groupRows("symbol || ' / ' || timeframe AS key", 'symbol, timeframe'),
    },
    generatedAt: new Date().toISOString(),
  };
}

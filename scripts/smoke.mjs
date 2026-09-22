/**
 * 冒烟测试：验证行情接入、预测创建、自动验证引擎与统计接口。
 * 用法：先启动后端（npm run dev:server 或 npm start），再执行 npm run smoke
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.SMOKE_BASE || 'http://localhost:8787/api';
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = path.join(rootDir, 'data', 'gate-tracker.db');

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
  if (!cond) failed += 1;
};

async function json(pathname, options) {
  const res = await fetch(`${BASE}${pathname}`, options);
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

const post = (p, body) =>
  json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function main() {
  const health = await json('/health');
  ok('健康检查', health.status === 200 && health.body.ok === true);

  const cfg = await json('/config');
  ok('配置接口返回 BTC/ETH', cfg.status === 200 && cfg.body.symbols?.length >= 2, JSON.stringify(cfg.body.symbols));

  const tickers = await json('/market/tickers');
  const btc = tickers.body.items?.find((t) => t.symbol === 'BTC_USDT');
  ok('行情接口返回 BTC 价格', Boolean(btc && btc.last > 0), btc ? `last=${btc.last}` : '');

  const created1 = await post('/predictions', {
    symbol: 'BTC_USDT',
    direction: 'LONG',
    timeframe: '15m',
    reason: 'smoke test long',
  });
  ok('创建 BTC 看涨预测', created1.status === 201 && created1.body.prediction?.status === 'PENDING',
    `entry=${created1.body.prediction?.entryPrice}`);

  const created2 = await post('/predictions', {
    symbol: 'ETH_USDT',
    direction: 'RANGE',
    timeframe: '30m',
    rangePercent: 1,
  });
  ok('创建 ETH 震荡预测', created2.status === 201);

  const bad = await post('/predictions', { symbol: 'DOGE_USDT', direction: 'LONG', timeframe: '15m' });
  ok('非法标的被拒绝', bad.status === 400);

  const list = await json('/predictions?pageSize=5');
  ok('列表接口可用', list.status === 200 && list.body.total >= 2, `total=${list.body.total}`);

  // 把验证时间提前到过去，触发一次自动验证
  if (fs.existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath);
    const startedAt = new Date(Date.now() - 16 * 60000).toISOString();
    const dueAt = new Date(Date.now() - 60000).toISOString();
    db.prepare('UPDATE predictions SET prediction_time = ?, verification_time = ? WHERE id IN (?, ?)').run(
      startedAt,
      dueAt,
      created1.body.prediction.id,
      created2.body.prediction.id,
    );
    db.close();
  } else {
    console.log('WARN  未找到数据库文件，跳过验证时间改写');
  }

  const run = await post('/verifications/run', {});
  ok('执行验证扫描', run.status === 200, JSON.stringify(run.body));

  const d1 = await json(`/predictions/${created1.body.prediction.id}`);
  const d2 = await json(`/predictions/${created2.body.prediction.id}`);
  ok('BTC 预测已出结果', ['SUCCESS', 'FAIL'].includes(d1.body.prediction?.status),
    `status=${d1.body.prediction?.status} pct=${d1.body.prediction?.resultPercent}`);
  ok('ETH 震荡预测已出结果', ['SUCCESS', 'FAIL'].includes(d2.body.prediction?.status),
    `status=${d2.body.prediction?.status} pct=${d2.body.prediction?.resultPercent}`);
  ok('验证快照已落库', Boolean(d1.body.verificationSnapshot?.close));
  ok(
    '验证窗口 High/Low 来自 K 线',
    Boolean(d1.body.prediction?.highPrice) && d1.body.prediction.highPrice !== d1.body.prediction.lowPrice,
    `high=${d1.body.prediction?.highPrice} low=${d1.body.prediction?.lowPrice}`,
  );

  const stats = await json('/statistics');
  ok('统计接口可用', stats.status === 200 && typeof stats.body.accuracy !== 'undefined',
    `accuracy=${stats.body.accuracy}`);

  console.log(failed === 0 ? '\n全部冒烟用例通过' : `\n${failed} 个用例失败`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('冒烟测试异常', err);
  process.exit(1);
});

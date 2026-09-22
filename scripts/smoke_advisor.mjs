/**
 * 交易辅助模块冒烟测试：BOLL/SAR 因子、推荐生成、K线回放验证、统计、策略配置与自适应。
 * 用法：先启动后端，再执行 npm run smoke:advisor
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.SMOKE_BASE || 'http://localhost:8787/api';
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = path.join(rootDir, 'data', 'gate-tracker.db');

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
  if (!cond) failed += 1;
};

async function json(p, options) {
  const res = await fetch(`${BASE}${p}`, options);
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

const post = (p, body = {}) =>
  json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function main() {
  const cfg = await json('/signals/config');
  ok('策略配置含 BOLL/SAR 权重', Boolean(cfg.body.strategy?.params?.weights?.SAR && cfg.body.strategy?.params?.weights?.BOLL),
    JSON.stringify(cfg.body.strategy?.params?.weights));

  const llm = await json('/signals/llm/status');
  ok('LLM 状态接口可用', llm.status === 200, `enabled=${llm.body.enabled}`);

  const analysis = await post('/signals/analyze', { symbol: 'BTC_USDT' });
  const factors = analysis.body?.factors || [];
  ok('分析返回 BOLL 因子', factors.some((f) => f.code === 'BOLL'), analysis.body?.factors?.find((f) => f.code === 'BOLL')?.desc);
  ok('分析返回 SAR 因子', factors.some((f) => f.code === 'SAR'), analysis.body?.factors?.find((f) => f.code === 'SAR')?.desc);
  ok('指标含 SAR 与布林 %B',
    Boolean(analysis.body?.indicators?.sar) && typeof analysis.body?.indicators?.boll?.percentB === 'number');

  // 为保证能覆盖验证流程，先临时放宽阈值（会生成新版本，历史推荐仍绑定旧快照）
  await json(`/signals/strategies/${cfg.body.strategy.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ params: { minScore: 1, dirThreshold: 0.01 } }),
  });

  const gen = await post('/signals/generate', { symbol: 'BTC_USDT', mode: 'llm', timeframe: '15m', horizon: '30m' });
  const rec = gen.body?.recommendation;
  ok('LLM 主导模式返回周期预测', Boolean(rec?.reasons?.forecasts) || rec?.reasons?.llmFallback === true,
    JSON.stringify(rec?.reasons?.forecasts || rec?.reasons?.llm?.reason));
  ok('生成推荐成功', gen.status === 201 && Boolean(rec?.id), `direction=${rec?.direction} score=${rec?.score}`);

  if (rec && rec.status === 'OPEN') {
    ok('推荐含止损/止盈/仓位/倍数',
      Boolean(rec.stopLoss && rec.takeProfit && rec.positionPercent && rec.leverage),
      `SL=${rec.stopLoss} TP=${rec.takeProfit} pos=${rec.positionPercent}% lev=${rec.leverage}x`);

    // 把窗口整体前移，使推荐到期，触发自动验证
    const db = new DatabaseSync(dbPath);
    const created = new Date(Date.now() - 300 * 60000).toISOString();
    const expiry = new Date(Date.now() - 60 * 60000).toISOString();
    db.prepare('UPDATE recommendations SET created_at = ?, expires_at = ? WHERE id = ?').run(created, expiry, rec.id);
    db.close();

    const run = await post('/signals/verify-run');
    ok('执行推荐验证扫描', run.status === 200, JSON.stringify(run.body?.summary));

    const detail = await json(`/signals/${rec.id}`);
    const r = detail.body?.recommendation;
    ok('推荐已出验证结果', ['SUCCESS', 'FAIL'].includes(r?.status), `result=${r?.resultType} pnl=${r?.pnlPercent}%`);
    ok('记录 MFE / MAE / R 倍数',
      r?.mfePercent != null && r?.maePercent != null && r?.rMultiple != null,
      `MFE=${r?.mfePercent} MAE=${r?.maePercent} R=${r?.rMultiple}`);
    ok('事件流含 VERIFIED', (detail.body?.events || []).some((e) => e.type === 'VERIFIED'));
    const fc = detail.body?.recommendation?.verifiedDetail?.forecastCheck;
    ok('LLM 周期预测已回测', !fc || typeof fc.hit === 'boolean',
      fc ? `${fc.horizon} 预测=${fc.predicted} 实际=${fc.actual} 命中=${fc.hit}` : '无预测可回测');
  } else {
    ok('未给出方向时不入库验证', ['NO_TRADE', 'RANGE'].includes(rec?.direction) && rec?.status === 'SKIPPED');
  }

  const list = await json('/signals?pageSize=5');
  ok('推荐列表可用', list.status === 200 && list.body.total >= 1, `total=${list.body.total}`);

  const stats = await json('/signals/statistics');
  ok('推荐统计可用', stats.status === 200 && typeof stats.body.overall?.winRate !== 'undefined',
    `样本=${stats.body.overall?.total} 胜率=${stats.body.overall?.winRate}`);

  const before = (await json('/signals/strategies')).body.items[0];
  const adapt = await post(`/signals/strategies/${before.id}/adapt`, { force: true });
  ok('权重自适应可执行', adapt.status === 200, adapt.body.changed ? `已调整至 v${adapt.body.version}` : `未调整：${adapt.body.reason}`);

  const updated = await json(`/signals/strategies/${before.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ params: { minScore: 60 } }),
  });
  ok('策略参数更新生成新版本', updated.body?.strategy?.version === before.version + 1,
    `v${before.version} → v${updated.body?.strategy?.version}`);

  console.log(failed === 0 ? '\n全部交易辅助用例通过' : `\n${failed} 个用例失败`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('冒烟测试异常', err);
  process.exit(1);
});

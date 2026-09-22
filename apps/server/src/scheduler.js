import { config } from './config.js';
import { logger } from './lib/util.js';
import { DEFAULT_STRATEGY_ID } from './services/advisor/strategy.js';
import { maybeAdapt, runSignalVerifications } from './services/advisor/verify.js';
import { runDueVerifications } from './services/verification.js';

let timer = null;

async function tick() {
  try {
    await runDueVerifications();
  } catch (err) {
    logger.error('预测验证调度异常', String(err?.message || err));
  }
  try {
    const summary = await runSignalVerifications();
    if (summary.verified) maybeAdapt(DEFAULT_STRATEGY_ID);
  } catch (err) {
    logger.error('推荐验证调度异常', String(err?.message || err));
  }
}

export function startScheduler() {
  logger.info(`自动验证调度启动，间隔 ${Math.round(config.verifyIntervalMs / 1000)}s（预测 + 推荐）`);
  tick();
  timer = setInterval(tick, config.verifyIntervalMs);
  timer.unref?.();
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}

/**
 * Vercel Serverless Function：所有 /api/* 请求经 vercel.json 重写到这里。
 * 无状态：不启动 WebSocket 与常驻调度器，行情按需走 Gate REST，验证由 Cron 触发。
 * 环境变量最少只需 DATABASE_URL（用 Vercel Postgres 时会自动注入）；其余配置存数据库 /api/settings。
 */
import { ensureSchema } from '../apps/server/src/db.js';
import { loadSettings } from '../apps/server/src/services/settings.js';
import app from '../apps/server/src/app.js';

export default async function handler(req, res) {
  await ensureSchema();
  await loadSettings();
  return app(req, res);
}

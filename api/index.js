/**
 * Vercel Serverless Function：所有 /api/* 请求经 vercel.json 重写到这里。
 * 无状态：不启动 WebSocket 与常驻调度器，行情按需走 Gate REST，验证由 Cron 触发。
 */
import { ensureSchema } from '../apps/server/src/db.js';
import app from '../apps/server/src/app.js';

export default async function handler(req, res) {
  await ensureSchema();
  return app(req, res);
}

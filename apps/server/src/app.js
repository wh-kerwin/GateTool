import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { projectRoot } from './config.js';
import { apiRouter } from './routes/api.js';
import { signalsRouter } from './routes/signals.js';

/** 统一的 Express 应用：本地由 index.js 监听，Vercel 由 serverless 函数直接调用 */
export function createApp() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', apiRouter);
  app.use('/api/signals', signalsRouter);

  const webDist = path.join(projectRoot, 'apps', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api|\/ws).*/, (req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }
  return app;
}

export default createApp();

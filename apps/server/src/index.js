import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { config, projectRoot } from './config.js';
import { ensureSchema } from './db.js';
import { logger } from './lib/util.js';
import app from './app.js';
import { marketService } from './services/market.js';
import { signalEvents } from './services/advisor/verify.js';
import { loadSettings } from './services/settings.js';
import { seedStrategies } from './services/advisor/strategy.js';
import { verificationEvents } from './services/verification.js';
import { startScheduler } from './scheduler.js';

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

wss.on('connection', (socket) => {
  socket.send(
    JSON.stringify({ type: 'snapshot', tickers: marketService.getTickers(), status: marketService.getStatus() }),
  );
});

marketService.on('ticker', (ticker) => broadcast({ type: 'ticker', ticker }));
marketService.on('status', (status) => broadcast({ type: 'status', status }));
verificationEvents.on('verified', (prediction) => broadcast({ type: 'verified', prediction }));
signalEvents.on('verified', (recommendation) => broadcast({ type: 'signal_verified', recommendation }));

async function main() {
  await ensureSchema();
  await loadSettings();
  await seedStrategies();
  await marketService.init();
  const stop = startScheduler();

  server.listen(config.port, () => {
    logger.info(`Gate Prediction Tracker 后端已启动 http://localhost:${config.port}`);
    logger.info(
      `市场=${config.market} 标的=${config.symbols.join(',')} 数据库=${path.relative(projectRoot, config.dbPath)}`,
    );
  });

  const shutdown = () => {
    logger.info('正在停止服务...');
    stop();
    marketService.stop();
    wss.close();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('启动失败', String(err?.stack || err));
  process.exit(1);
});

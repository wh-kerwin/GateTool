import { randomUUID } from 'node:crypto';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;

function write(level, args) {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString();
  const line = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(`[${ts}] [${level.toUpperCase()}] ${line}\n`);
}

export const logger = {
  debug: (...a) => write('debug', a),
  info: (...a) => write('info', a),
  warn: (...a) => write('warn', a),
  error: (...a) => write('error', a),
};

export const newId = (prefix = 'id') => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const toNumber = (v, fallback = null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

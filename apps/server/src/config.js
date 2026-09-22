import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, '../../..');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    value = value.replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(projectRoot, '.env'));

const market = (process.env.GATE_MARKET || 'futures').toLowerCase();

// Gate 现货与合约使用不同的 WebSocket 端点，REST 共用同一域名
const DEFAULT_WS_URL = {
  futures: 'wss://fx-ws.gateio.ws/v4/ws/usdt',
  spot: 'wss://api.gateio.ws/ws/v4/',
};

/**
 * 运行时配置：优先取数据库设置（settings 表），其次环境变量，最后默认值。
 * 目的：Vercel 免费版环境变量数量有限，尽量做到「0~1 个环境变量即可运行」。
 */
export const runtime = {
  market,
  symbols: (process.env.SYMBOLS || 'BTC_USDT,ETH_USDT')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
  restBase: (process.env.GATE_REST_BASE || 'https://api.gateio.ws/api/v4').replace(/\/$/, ''),
  wsUrl: process.env.GATE_WS_URL || DEFAULT_WS_URL[market === 'spot' ? 'spot' : 'futures'],
  llm: {
    enabled: String(process.env.LLM_ENABLED || 'false').toLowerCase() === 'true',
    baseUrl: (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    temperature: Number(process.env.LLM_TEMPERATURE || 0.2),
    maxTokens: Number(process.env.LLM_MAX_TOKENS || 500),
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 20000),
    weight: Number(process.env.LLM_WEIGHT || 0.2),
  },
};

/** 用数据库设置覆盖运行时配置（只覆盖传入的字段） */
export function applyRuntime(patch = {}) {
  if (patch.market) runtime.market = patch.market === 'spot' ? 'spot' : 'futures';
  if (Array.isArray(patch.symbols) && patch.symbols.length) runtime.symbols = patch.symbols;
  if (patch.restBase) runtime.restBase = patch.restBase;
  if (patch.wsUrl) runtime.wsUrl = patch.wsUrl;
  if (patch.llm) Object.assign(runtime.llm, patch.llm);
  return runtime;
}

/** 支持用单个环境变量 APP_CONFIG（JSON）一次性配置，减少变量数量 */
if (process.env.APP_CONFIG) {
  try {
    applyRuntime(JSON.parse(process.env.APP_CONFIG));
  } catch {
    console.warn('APP_CONFIG 解析失败，忽略');
  }
}
export const config = {
  port: Number(process.env.PORT || 8787),
  dbPath: path.resolve(projectRoot, process.env.DB_PATH || './data/gate-tracker.db'),
  verifyIntervalMs: Number(process.env.VERIFY_INTERVAL_MS || 60000),
  defaultUserId: 'local',
  defaultUsername: process.env.DEFAULT_USERNAME || 'local',
  requestTimeoutMs: Number(process.env.GATE_TIMEOUT_MS || 10000),
  maxVerifyRetry: Number(process.env.MAX_VERIFY_RETRY || 5),
  get market() {
    return runtime.market;
  },
  get symbols() {
    return runtime.symbols;
  },
  get restBase() {
    return runtime.restBase;
  },
  get wsUrl() {
    return runtime.wsUrl;
  },
  get llm() {
    return runtime.llm;
  },
};

export const TIMEFRAME_MINUTES = {
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '4h': 240,
};

export const TIMEFRAMES = Object.keys(TIMEFRAME_MINUTES);
export const DIRECTIONS = ['LONG', 'SHORT', 'RANGE'];

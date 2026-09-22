import { applyRuntime, runtime } from '../config.js';
import { db, nowIso } from '../db.js';

/**
 * 运行设置：持久化在数据库（app_settings 表），避免依赖大量环境变量。
 * 优先级：数据库设置 > 环境变量 / APP_CONFIG > 内置默认值
 */
const KEY = 'app';
const KEY_MASK = '••••••';

let cache = null;

export async function loadSettings() {
  if (cache) return cache;
  const row = await db.get('SELECT value FROM app_settings WHERE key = ?', KEY);
  let stored = {};
  if (row?.value) {
    try {
      stored = JSON.parse(row.value);
    } catch {
      stored = {};
    }
  } else {
    // 首次运行：把当前生效配置（环境变量 / 默认值）落库，之后即可不再依赖环境变量
    stored = {
      market: runtime.market,
      symbols: runtime.symbols,
      restBase: runtime.restBase,
      wsUrl: runtime.wsUrl,
      llm: { ...runtime.llm },
    };
    await db.run(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO NOTHING`,
      KEY,
      JSON.stringify(stored),
      nowIso(),
    );
  }
  cache = stored;
  applyRuntime(stored);
  return cache;
}

export function getRuntime() {
  return runtime;
}

export async function getSettings() {
  await loadSettings();
  const llm = runtime.llm || {};
  return {
    market: runtime.market,
    symbols: runtime.symbols,
    restBase: runtime.restBase,
    wsUrl: runtime.wsUrl,
    llm: {
      ...llm,
      apiKey: llm.apiKey ? KEY_MASK : '',
      apiKeyConfigured: Boolean(llm.apiKey),
    },
    source: Object.keys(cache || {}).length ? 'database' : 'env/default',
  };
}

export async function updateSettings(patch = {}) {
  const current = await loadSettings();
  const merged = { ...current };

  for (const key of ['market', 'symbols', 'restBase', 'wsUrl']) {
    if (patch[key] !== undefined) merged[key] = patch[key];
  }
  if (patch.llm) {
    const next = { ...(current.llm || {}), ...patch.llm };
    // 前端回传的是掩码，表示「不修改」
    if (next.apiKey === KEY_MASK || next.apiKey === '') delete next.apiKey;
    merged.llm = next;
  }

  await db.run(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    KEY,
    JSON.stringify(merged),
    nowIso(),
  );
  cache = merged;
  applyRuntime(merged);
  return getSettings();
}

export const getLlmConfig = () => runtime.llm;

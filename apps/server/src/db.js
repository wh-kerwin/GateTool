import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * 数据访问层：本地/自托管使用 Node 内置 SQLite；Vercel 等无服务器环境配置 DATABASE_URL 使用 Postgres。
 * 两种驱动对外暴露同一套异步方法：get / all / run / exec
 */

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  email       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS predictions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  symbol            TEXT NOT NULL,
  direction         TEXT NOT NULL CHECK (direction IN ('LONG','SHORT','RANGE')),
  entry_price       REAL NOT NULL,
  target_price      REAL,
  range_percent     REAL,
  timeframe         TEXT NOT NULL CHECK (timeframe IN ('15m','30m','1h','4h')),
  prediction_time   TEXT NOT NULL,
  verification_time TEXT NOT NULL,
  reason            TEXT,
  status            TEXT NOT NULL CHECK (status IN ('PENDING','SUCCESS','FAIL','EXPIRED')),
  result_price      REAL,
  result_percent    REAL,
  high_price        REAL,
  low_price         REAL,
  verified_at       TEXT,
  retry_count       INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  cancel_note       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_predictions_status_time
  ON predictions (status, verification_time);

CREATE TABLE IF NOT EXISTS market_snapshots (
  id            TEXT PRIMARY KEY,
  prediction_id TEXT NOT NULL,
  symbol        TEXT NOT NULL,
  price         REAL NOT NULL,
  volume        REAL,
  open          REAL,
  high          REAL,
  low           REAL,
  source        TEXT,
  timestamp     TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_snapshots (
  id            TEXT PRIMARY KEY,
  prediction_id TEXT NOT NULL,
  symbol        TEXT NOT NULL,
  close         REAL NOT NULL,
  high          REAL,
  low           REAL,
  source        TEXT,
  window_from   TEXT,
  window_to     TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS strategies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  params      TEXT NOT NULL,
  previous    TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recommendations (
  id                 TEXT PRIMARY KEY,
  symbol             TEXT NOT NULL,
  strategy_id        TEXT NOT NULL,
  strategy_version   INTEGER NOT NULL,
  direction          TEXT NOT NULL,
  timeframe          TEXT NOT NULL,
  horizon            TEXT NOT NULL,
  reference_price    REAL NOT NULL,
  entry_low          REAL,
  entry_high         REAL,
  stop_loss          REAL,
  take_profit        REAL,
  position_percent   REAL,
  leverage           INTEGER,
  risk_percent       REAL,
  actual_risk_percent REAL,
  rr                 REAL,
  confidence         REAL,
  score              REAL,
  reasons            TEXT,
  indicators         TEXT,
  params             TEXT,
  status             TEXT NOT NULL,
  result_type        TEXT,
  result_price       REAL,
  result_percent     REAL,
  pnl_percent        REAL,
  mfe_percent        REAL,
  mae_percent        REAL,
  r_multiple         REAL,
  verified_detail    TEXT,
  retry_count        INTEGER NOT NULL DEFAULT 0,
  last_error         TEXT,
  created_at         TEXT NOT NULL,
  expires_at         TEXT NOT NULL,
  verified_at        TEXT,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recommendations_status_time
  ON recommendations (status, expires_at);

CREATE TABLE IF NOT EXISTS recommendation_events (
  id                TEXT PRIMARY KEY,
  recommendation_id TEXT NOT NULL,
  type              TEXT NOT NULL,
  payload           TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS signal_feedbacks (
  id                TEXT PRIMARY KEY,
  recommendation_id TEXT NOT NULL,
  adopted           INTEGER,
  rating            INTEGER,
  comment           TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS factor_stats (
  id          TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  factor      TEXT NOT NULL,
  direction   TEXT NOT NULL,
  samples     INTEGER NOT NULL DEFAULT 0,
  wins        INTEGER NOT NULL DEFAULT 0,
  losses      INTEGER NOT NULL DEFAULT 0,
  r_sum       REAL NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  UNIQUE (strategy_id, factor, direction)
);
`;

function splitStatements(sql) {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--'));
}

const NUMERIC_OIDS = new Set([20, 21, 23, 26, 700, 701, 1700]);

function createPostgresDriver(connectionString) {
  let poolPromise = null;
  const getPool = async () => {
    if (!poolPromise) {
      poolPromise = (async () => {
        const { Pool } = await import('pg');
        return new Pool({
          connectionString,
          ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: false },
          max: 3,
          idleTimeoutMillis: 10000,
          connectionTimeoutMillis: 10000,
        });
      })();
    }
    return poolPromise;
  };

  const convert = (sql) => {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  };

  const normalizeRows = (result) => {
    const fields = result.fields || [];
    const isNumeric = fields.map((f) => NUMERIC_OIDS.has(f.dataTypeID));
    if (!isNumeric.some(Boolean)) return result.rows;
    return result.rows.map((row) => {
      const out = { ...row };
      fields.forEach((f, i) => {
        if (!isNumeric[i]) return;
        const v = out[f.name];
        if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) out[f.name] = Number(v);
      });
      return out;
    });
  };

  return {
    name: 'postgres',
    async get(sql, args = []) {
      const pool = await getPool();
      const res = await pool.query(convert(sql), args);
      return normalizeRows(res)[0];
    },
    async all(sql, args = []) {
      const pool = await getPool();
      const res = await pool.query(convert(sql), args);
      return normalizeRows(res);
    },
    async run(sql, args = []) {
      const pool = await getPool();
      const res = await pool.query(convert(sql), args);
      return { changes: res.rowCount || 0, lastInsertRowid: res.rows?.[0]?.id ?? null };
    },
    async exec(sql) {
      const pool = await getPool();
      for (const statement of splitStatements(sql)) await pool.query(statement);
    },
  };
}

async function createSqliteDriver(file) {
  const { DatabaseSync } = await import('node:sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA journal_mode = WAL;');
  const stmt = (sql) => sqlite.prepare(sql);
  return {
    name: 'sqlite',
    async get(sql, args = []) {
      return stmt(sql).get(...args);
    },
    async all(sql, args = []) {
      return stmt(sql).all(...args);
    },
    async run(sql, args = []) {
      const r = stmt(sql).run(...args);
      return { changes: Number(r.changes ?? 0), lastInsertRowid: r.lastInsertRowid ?? null };
    },
    async exec(sql) {
      for (const statement of splitStatements(sql)) sqlite.exec(statement);
    },
  };
}

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

export const dbDriver = connectionString
  ? createPostgresDriver(connectionString)
  : await createSqliteDriver(path.resolve(config.dbPath));

export const driverName = dbDriver.name;

export const db = {
  get: (sql, ...args) => dbDriver.get(sql, args),
  all: (sql, ...args) => dbDriver.all(sql, args),
  run: (sql, ...args) => dbDriver.run(sql, args),
  exec: (sql) => dbDriver.exec(sql),
};

export function nowIso() {
  return new Date().toISOString();
}

let schemaReady = null;

/** 幂等建表 + 初始化默认用户（无服务器环境下每个实例首次调用时执行） */
export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.exec(SCHEMA_SQL);
      const ts = nowIso();
      const sql =
        driverName === 'postgres'
          ? `INSERT INTO users (id, username, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (id) DO NOTHING`
          : `INSERT OR IGNORE INTO users (id, username, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`;
      await db.run(sql, config.defaultUserId, config.defaultUsername, null, ts, ts);
    })();
  }
  return schemaReady;
}

export function toPrediction(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    symbol: row.symbol,
    direction: row.direction,
    entryPrice: row.entry_price,
    targetPrice: row.target_price,
    rangePercent: row.range_percent,
    timeframe: row.timeframe,
    predictionTime: row.prediction_time,
    verificationTime: row.verification_time,
    reason: row.reason,
    status: row.status,
    resultPrice: row.result_price,
    resultPercent: row.result_percent,
    highPrice: row.high_price,
    lowPrice: row.low_price,
    verifiedAt: row.verified_at,
    retryCount: Number(row.retry_count ?? 0),
    lastError: row.last_error,
    cancelNote: row.cancel_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

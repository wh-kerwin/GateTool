import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  email       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS predictions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
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
  prediction_id TEXT NOT NULL REFERENCES predictions(id),
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
  prediction_id TEXT NOT NULL REFERENCES predictions(id),
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
  id               TEXT PRIMARY KEY,
  recommendation_id TEXT NOT NULL,
  type             TEXT NOT NULL,
  payload          TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS signal_feedbacks (
  id               TEXT PRIMARY KEY,
  recommendation_id TEXT NOT NULL,
  adopted          INTEGER,
  rating           INTEGER,
  comment          TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS factor_stats (
  id              TEXT PRIMARY KEY,
  strategy_id     TEXT NOT NULL,
  factor          TEXT NOT NULL,
  direction       TEXT NOT NULL,
  samples         INTEGER NOT NULL DEFAULT 0,
  wins            INTEGER NOT NULL DEFAULT 0,
  losses          INTEGER NOT NULL DEFAULT 0,
  r_sum           REAL NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL,
  UNIQUE (strategy_id, factor, direction)
);
`);

const now = () => new Date().toISOString();

db.prepare(
  `INSERT OR IGNORE INTO users (id, username, email, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?)`,
).run(config.defaultUserId, config.defaultUsername, null, now(), now());

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
    retryCount: row.retry_count,
    lastError: row.last_error,
    cancelNote: row.cancel_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function nowIso() {
  return now();
}

import dayjs from 'dayjs';
import type { Direction, PredictionStatus } from '../types';

export const directionLabel: Record<Direction, string> = {
  LONG: '↑ 看涨',
  SHORT: '↓ 看跌',
  RANGE: '→ 震荡',
};

export const directionTag: Record<Direction, 'green' | 'red' | 'blue'> = {
  LONG: 'green',
  SHORT: 'red',
  RANGE: 'blue',
};

export const statusLabel: Record<PredictionStatus, string> = {
  PENDING: '等待验证',
  SUCCESS: '✓ 正确',
  FAIL: '✕ 错误',
  EXPIRED: '已作废',
};

export const statusColor: Record<PredictionStatus, string> = {
  PENDING: 'blue',
  SUCCESS: 'green',
  FAIL: 'red',
  EXPIRED: 'gray',
};

export const formatTime = (iso?: string | null) => (iso ? dayjs(iso).format('MM-DD HH:mm:ss') : '-');

export const formatFullTime = (iso?: string | null) => (iso ? dayjs(iso).format('YYYY-MM-DD HH:mm:ss') : '-');

export const formatPrice = (v?: number | null) =>
  v == null ? '-' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatPercent = (v?: number | null) => (v == null ? '-' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);

export const percentClass = (v?: number | null) =>
  v == null || v === 0 ? 'gpt-flat' : v > 0 ? 'gpt-up' : 'gpt-down';

export function remaining(targetIso: string, now: number = Date.now()) {
  const ms = new Date(targetIso).getTime() - now;
  if (ms <= 0) return { text: '即将验证', done: true, ms: 0 };
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const text = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s` : `${m}m ${String(s).padStart(2, '0')}s`;
  return { text, done: false, ms };
}

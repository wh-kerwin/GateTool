export type Direction = 'LONG' | 'SHORT' | 'RANGE';
export type Timeframe = '15m' | '30m' | '1h' | '4h';
export type PredictionStatus = 'PENDING' | 'SUCCESS' | 'FAIL' | 'EXPIRED';

export interface Ticker {
  symbol: string;
  last: number;
  changePercent: number;
  high24h?: number;
  low24h?: number;
  volume24h?: number;
  markPrice?: number;
  source?: string;
  timestamp?: string;
  ageMs?: number;
}

export interface Prediction {
  id: string;
  symbol: string;
  direction: Direction;
  entryPrice: number;
  targetPrice?: number | null;
  rangePercent?: number | null;
  timeframe: Timeframe;
  predictionTime: string;
  verificationTime: string;
  reason?: string | null;
  status: PredictionStatus;
  resultPrice?: number | null;
  resultPercent?: number | null;
  highPrice?: number | null;
  lowPrice?: number | null;
  verifiedAt?: string | null;
  retryCount?: number;
  lastError?: string | null;
  cancelNote?: string | null;
}

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface BreakdownItem {
  key?: string;
  symbol?: string;
  timeframe?: string;
  direction?: string;
  total: number;
  success: number;
  fail: number;
  decided: number;
  accuracy: number | null;
  enoughSample: boolean;
}

export interface Statistics {
  total: number;
  pending: number;
  success: number;
  fail: number;
  expired: number;
  verified: number;
  accuracy: number | null;
  avgResultPercent: number | null;
  breakdown: {
    bySymbol: BreakdownItem[];
    byTimeframe: BreakdownItem[];
    byDirection: BreakdownItem[];
    bySymbolTimeframe: BreakdownItem[];
  };
}

export type SignalDirection = 'LONG' | 'SHORT' | 'NO_TRADE';
export type SignalStatus = 'OPEN' | 'SUCCESS' | 'FAIL' | 'SKIPPED' | 'EXPIRED';

export interface Factor {
  code: string;
  value: number;
  desc: string;
  weight?: number;
}

export interface LlmOpinion {
  available: boolean;
  bias?: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence?: number;
  rationale?: string;
  risks?: string[];
  reason?: string;
  model?: string;
}

export interface Recommendation {
  id: string;
  symbol: string;
  strategyId: string;
  strategyVersion: number;
  direction: SignalDirection;
  timeframe: string;
  horizon: string;
  referencePrice: number;
  entryLow?: number;
  entryHigh?: number;
  stopLoss?: number;
  takeProfit?: number;
  positionPercent?: number;
  leverage?: number;
  riskPercent?: number;
  actualRiskPercent?: number;
  rr?: number;
  confidence?: number;
  score?: number;
  reasons?: { factors?: Factor[]; quality?: Factor[]; llm?: LlmOpinion; riskNotes?: string[] };
  indicators?: Record<string, any>;
  params?: Record<string, any>;
  status: SignalStatus;
  resultType?: string;
  resultPercent?: number;
  pnlPercent?: number;
  mfePercent?: number;
  maePercent?: number;
  rMultiple?: number;
  verifiedDetail?: Record<string, any>;
  createdAt: string;
  expiresAt: string;
  verifiedAt?: string | null;
}

export interface StrategyConfig {
  id: string;
  name: string;
  version: number;
  params: Record<string, any> & { weights: Record<string, number>; qualityWeights: Record<string, number> };
  updatedAt: string;
}

export interface SignalEvent {
  id: string;
  type: string;
  payload?: any;
  createdAt: string;
}

export interface AppConfig {
  market: string;
  symbols: string[];
  timeframes: Timeframe[];
  directions: Direction[];
  timeframeMinutes: Record<string, number>;
  verifyIntervalMs: number;
  disclaimer: string;
}

import axios from 'axios';
import type { AppConfig, Candle, Prediction, Recommendation, Statistics, StrategyConfig, Ticker } from '../types';

export const http = axios.create({ baseURL: '/api', timeout: 20000 });

function unwrap<T>(p: Promise<{ data: T }>): Promise<T> {
  return p.then((res) => res.data);
}

export const api = {
  config: () => unwrap<AppConfig>(http.get('/config')),
  health: () => unwrap<any>(http.get('/health')),
  tickers: () => unwrap<{ items: Ticker[]; status: any }>(http.get('/market/tickers')),
  candles: (symbol: string, interval = '1m', limit = 120) =>
    unwrap<{ items: Candle[] }>(http.get('/market/candles', { params: { symbol, interval, limit } })),
  createPrediction: (payload: Partial<Prediction>) =>
    unwrap<{ prediction: Prediction; conflicts: Prediction[] }>(http.post('/predictions', payload)),
  predictions: (params: Record<string, any>) =>
    unwrap<{ items: Prediction[]; total: number; page: number; pageSize: number; totalPages: number }>(
      http.get('/predictions', { params }),
    ),
  pending: (limit = 50) => unwrap<{ items: Prediction[] }>(http.get('/predictions/pending', { params: { limit } })),
  detail: (id: string) =>
    unwrap<{ prediction: Prediction; marketSnapshot: any; verificationSnapshot: any }>(
      http.get(`/predictions/${id}`),
    ),
  cancel: (id: string, note?: string) =>
    unwrap<{ prediction: Prediction }>(http.post(`/predictions/${id}/cancel`, { note })),
  statistics: (params: Record<string, any> = {}) => unwrap<Statistics>(http.get('/statistics', { params })),
};

export const signalsApi = {
  config: () => unwrap<any>(http.get('/signals/config')),
  llmStatus: () => unwrap<any>(http.get('/signals/llm/status')),
  analyze: (symbol: string, useLlm?: boolean, timeframe?: string, horizon?: string) =>
    unwrap<any>(http.post('/signals/analyze', { symbol, useLlm, timeframe, horizon })),
  generate: (symbol: string, useLlm?: boolean, timeframe?: string, horizon?: string) =>
    unwrap<{ recommendation: Recommendation }>(http.post('/signals/generate', { symbol, useLlm, timeframe, horizon })),
  list: (params: Record<string, any> = {}) =>
    unwrap<{ items: Recommendation[]; total: number }>(http.get('/signals', { params })),
  detail: (id: string) =>
    unwrap<{ recommendation: Recommendation; events: any[]; feedback: any[] }>(http.get(`/signals/${id}`)),
  feedback: (id: string, payload: { adopted?: boolean; rating?: number; comment?: string }) =>
    unwrap<any>(http.post(`/signals/${id}/feedback`, payload)),
  review: (id: string) => unwrap<any>(http.post(`/signals/${id}/review`)),
  verify: (id: string) => unwrap<any>(http.post(`/signals/${id}/verify`)),
  verifyRun: () => unwrap<any>(http.post('/signals/verify-run')),
  statistics: () => unwrap<any>(http.get('/signals/statistics')),
  strategies: () => unwrap<{ items: StrategyConfig[] }>(http.get('/signals/strategies')),
  updateStrategy: (id: string, params: Record<string, any>) =>
    unwrap<{ strategy: StrategyConfig }>(http.put(`/signals/strategies/${id}`, { params })),
  adapt: (id: string, force = false) => unwrap<any>(http.post(`/signals/strategies/${id}/adapt`, { force })),
};

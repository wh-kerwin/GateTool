import { defineStore } from 'pinia';
import { api } from '../api';
import type { AppConfig, Ticker } from '../types';

export const useAppStore = defineStore('app', {
  state: () => ({
    config: null as AppConfig | null,
    tickers: {} as Record<string, Ticker>,
    wsConnected: false,
    ws: null as WebSocket | null,
    retryTimer: null as number | null,
  }),
  getters: {
    symbols: (state) => state.config?.symbols ?? ['BTC_USDT', 'ETH_USDT'],
  },
  actions: {
    async loadConfig() {
      if (!this.config) this.config = await api.config();
      return this.config;
    },
    async loadTickers() {
      const res = await api.tickers();
      for (const t of res.items) this.tickers[t.symbol] = t;
      this.wsConnected = Boolean(res.status?.websocket);
    },
    connect() {
      if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'ticker' && msg.ticker?.symbol) {
            this.tickers[msg.ticker.symbol] = msg.ticker;
          } else if (msg.type === 'snapshot') {
            for (const t of msg.tickers || []) this.tickers[t.symbol] = t;
            this.wsConnected = Boolean(msg.status?.websocket);
          } else if (msg.type === 'status') {
            this.wsConnected = Boolean(msg.status?.websocket);
          }
        } catch {
          /* 忽略非法消息 */
        }
      };
      ws.onclose = () => {
        this.wsConnected = false;
        this.ws = null;
        if (this.retryTimer) window.clearTimeout(this.retryTimer);
        this.retryTimer = window.setTimeout(() => this.connect(), 3000);
      };
      ws.onerror = () => ws.close();
    },
    close() {
      if (this.retryTimer) window.clearTimeout(this.retryTimer);
      this.ws?.close();
      this.ws = null;
    },
  },
});

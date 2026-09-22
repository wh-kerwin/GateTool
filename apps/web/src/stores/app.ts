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
      // Vercel 等无服务器环境：浏览器直连 Gate WebSocket（后端无法常驻 WS）
      const direct = String(import.meta.env.VITE_GATE_WS_URL || '');
      if (direct) {
        this.connectGate(direct);
        return;
      }
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
    /** 直连 Gate WebSocket（与后端 gate/ws.js 相同的订阅协议） */
    connectGate(url: string) {
      const market = String(import.meta.env.VITE_GATE_MARKET || 'futures');
      const channel = market === 'spot' ? 'spot.tickers' : 'futures.tickers';
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            time: Math.floor(Date.now() / 1000),
            channel,
            event: 'subscribe',
            payload: this.symbols,
          }),
        );
        this.wsConnected = true;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg?.event !== 'update' || !Array.isArray(msg.result)) return;
          for (const it of msg.result) {
            const symbol = market === 'spot' ? it.currency_pair : it.contract;
            if (!symbol) continue;
            this.tickers[symbol] = {
              symbol,
              last: Number(it.last),
              changePercent: Number(it.change_percentage),
              high24h: Number(it.high_24h),
              low24h: Number(it.low_24h),
              volume24h: Number(market === 'spot' ? it.base_volume : it.volume_24h_base),
              markPrice: it.mark_price ? Number(it.mark_price) : undefined,
              source: 'websocket',
              timestamp: new Date().toISOString(),
            };
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

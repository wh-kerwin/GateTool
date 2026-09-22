<template>
  <div class="gpt-card price-card">
    <div class="gpt-symbol">{{ displaySymbol }}</div>
    <div class="gpt-price gpt-mono" :class="cls">{{ formatPrice(ticker?.last) }}</div>
    <div class="change" :class="cls">24h {{ formatPercent(ticker?.changePercent) }}</div>
    <div class="meta">
      高 <span class="gpt-mono">{{ formatPrice(ticker?.high24h) }}</span>
      / 低 <span class="gpt-mono">{{ formatPrice(ticker?.low24h) }}</span>
    </div>
    <div class="meta">
      {{ ticker?.source === 'websocket' ? 'WebSocket' : 'REST' }} ·
      {{ ticker?.timestamp ? formatTime(ticker.timestamp) : '-' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Ticker } from '../types';
import { formatPercent, formatPrice, formatTime, percentClass } from '../utils/format';

const props = defineProps<{ ticker?: Ticker | null }>();

const displaySymbol = computed(() => (props.ticker?.symbol || '').replace('_', '/'));
const cls = computed(() => percentClass(props.ticker?.changePercent));
</script>

<style scoped>
.price-card {
  min-width: 220px;
}

.change {
  font-size: 13px;
  margin-top: 2px;
}

.meta {
  font-size: 12px;
  color: #86909c;
  margin-top: 4px;
}
</style>

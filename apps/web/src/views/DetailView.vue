<template>
  <div class="gpt-page">
    <div class="gpt-card">
      <a-page-header :title="`${prediction?.symbol?.replace('_', '/') || ''} 预测详情`" @back="router.back()" />
      <a-descriptions v-if="prediction" :column="3" bordered>
        <a-descriptions-item label="预测时间">{{ formatFullTime(prediction.predictionTime) }}</a-descriptions-item>
        <a-descriptions-item label="验证时间">{{ formatFullTime(prediction.verificationTime) }}</a-descriptions-item>
        <a-descriptions-item label="验证周期">{{ prediction.timeframe }}</a-descriptions-item>
        <a-descriptions-item label="预测方向">
          <a-tag :color="directionTag[prediction.direction]">{{ directionLabel[prediction.direction] }}</a-tag>
          <span v-if="prediction.rangePercent"> ±{{ prediction.rangePercent }}%</span>
        </a-descriptions-item>
        <a-descriptions-item label="入场价">
          <span class="gpt-mono">{{ formatPrice(prediction.entryPrice) }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="目标价">
          <span class="gpt-mono">{{ prediction.targetPrice ? formatPrice(prediction.targetPrice) : '-' }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="结果价">
          <span class="gpt-mono">{{ formatPrice(prediction.resultPrice) }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="实际涨跌">
          <span class="gpt-mono" :class="percentClass(prediction.resultPercent)">
            {{ formatPercent(prediction.resultPercent) }}
          </span>
        </a-descriptions-item>
        <a-descriptions-item label="状态">
          <a-tag :color="statusColor[prediction.status]">{{ statusLabel[prediction.status] }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="窗口最高">
          <span class="gpt-mono">{{ formatPrice(prediction.highPrice) }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="窗口最低">
          <span class="gpt-mono">{{ formatPrice(prediction.lowPrice) }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="验证时间(实际)">{{ formatFullTime(prediction.verifiedAt) }}</a-descriptions-item>
        <a-descriptions-item label="预测理由" :span="3">{{ prediction.reason || '-' }}</a-descriptions-item>
        <a-descriptions-item v-if="prediction.lastError" label="错误信息" :span="3">
          {{ prediction.lastError }}
        </a-descriptions-item>
      </a-descriptions>
    </div>

    <div class="gpt-card">
      <div class="gpt-title">验证窗口价格走势</div>
      <PredictionChart :candles="candles" :entry-price="prediction?.entryPrice" :target-price="prediction?.targetPrice" />
    </div>

    <div class="gpt-card" v-if="marketSnapshot || verificationSnapshot">
      <div class="gpt-title">行情快照</div>
      <a-descriptions :column="3" bordered size="small">
        <a-descriptions-item label="创建时价格">
          <span class="gpt-mono">{{ formatPrice(marketSnapshot?.price) }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="创建时 OHLC">
          <span class="gpt-mono">
            {{ formatPrice(marketSnapshot?.open) }} / {{ formatPrice(marketSnapshot?.high) }} /
            {{ formatPrice(marketSnapshot?.low) }}
          </span>
        </a-descriptions-item>
        <a-descriptions-item label="创建时成交量">
          <span class="gpt-mono">{{ marketSnapshot?.volume ?? '-' }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="验证数据 close">
          <span class="gpt-mono">{{ formatPrice(verificationSnapshot?.close) }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="验证窗口">
          {{ formatFullTime(verificationSnapshot?.window_from) }} ~ {{ formatFullTime(verificationSnapshot?.window_to) }}
        </a-descriptions-item>
        <a-descriptions-item label="数据来源">{{ verificationSnapshot?.source || '-' }}</a-descriptions-item>
      </a-descriptions>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PredictionChart from '../components/PredictionChart.vue';
import { api } from '../api';
import { useAppStore } from '../stores/app';
import type { Candle, Prediction } from '../types';
import {
  directionLabel,
  directionTag,
  formatFullTime,
  formatPercent,
  formatPrice,
  percentClass,
  statusColor,
  statusLabel,
} from '../utils/format';

const route = useRoute();
const router = useRouter();
const store = useAppStore();

const prediction = ref<Prediction | null>(null);
const marketSnapshot = ref<any>(null);
const verificationSnapshot = ref<any>(null);
const candles = ref<Candle[]>([]);

onMounted(async () => {
  const id = String(route.params.id);
  const detail = await api.detail(id);
  prediction.value = detail.prediction;
  marketSnapshot.value = detail.marketSnapshot;
  verificationSnapshot.value = detail.verificationSnapshot;

  await store.loadConfig();
  const minutes = store.config?.timeframeMinutes?.[detail.prediction.timeframe] ?? 30;
  const res = await api.candles(detail.prediction.symbol, '1m', Math.min(1000, minutes + 20));
  const from = new Date(detail.prediction.predictionTime).getTime() / 1000 - 60;
  const to = new Date(detail.prediction.verificationTime).getTime() / 1000 + 120;
  candles.value = res.items.filter((c) => c.t >= from && c.t <= to);
});
</script>

<template>
  <div class="gpt-page">
    <div class="price-row">
      <PriceCard v-for="s in symbols" :key="s" :ticker="store.tickers[s]" />
    </div>

    <div class="gpt-card">
      <div class="gpt-title">我的预测</div>
      <a-row :gutter="16">
        <a-col :span="6"><a-statistic title="今日预测" :value="todayCount" /></a-col>
        <a-col :span="6"><a-statistic title="已验证" :value="stats?.verified ?? 0" /></a-col>
        <a-col :span="6"><a-statistic title="正确" :value="stats?.success ?? 0" /></a-col>
        <a-col :span="6">
          <a-statistic title="准确率" :value="stats?.accuracy == null ? '-' : `${stats.accuracy}%`" />
        </a-col>
      </a-row>
      <div style="margin-top: 12px">
        <a-button type="primary" @click="router.push({ name: 'create' })">创建预测</a-button>
      </div>
    </div>

    <div class="gpt-card">
      <div class="gpt-title">待验证预测</div>
      <a-table :data="pending" :columns="pendingColumns" :pagination="false" size="small">
        <template #symbol="{ record }">
          <span class="gpt-mono">{{ (record as Prediction).symbol.replace('_', '/') }}</span>
        </template>
        <template #direction="{ record }">
          <a-tag :color="directionTag[(record as Prediction).direction]">
            {{ directionLabel[(record as Prediction).direction] }}
          </a-tag>
        </template>
        <template #remaining="{ record }">
          <span class="gpt-mono">{{ remaining((record as Prediction).verificationTime, nowTs).text }}</span>
        </template>
      </a-table>
      <a-empty v-if="!pending.length" description="暂无待验证预测" />
    </div>

    <div class="gpt-card">
      <div class="gpt-title">最近验证结果</div>
      <PredictionTable :items="recent" @cancel="cancel" />
      <a-empty v-if="!recent.length" description="还没有已验证的预测" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Message } from '@arco-design/web-vue';
import PriceCard from '../components/PriceCard.vue';
import PredictionTable from '../components/PredictionTable.vue';
import { api } from '../api';
import { useAppStore } from '../stores/app';
import type { Prediction, Statistics } from '../types';
import { directionLabel, directionTag, formatTime, remaining } from '../utils/format';

const store = useAppStore();
const router = useRouter();

const stats = ref<Statistics | null>(null);
const pending = ref<Prediction[]>([]);
const recent = ref<Prediction[]>([]);
const todayCount = ref(0);
const nowTs = ref(Date.now());

const symbols = computed(() => store.symbols);

const pendingColumns = [
  { title: '标的', dataIndex: 'symbol', slotName: 'symbol', width: 120 },
  { title: '方向', dataIndex: 'direction', slotName: 'direction', width: 110 },
  { title: '周期', dataIndex: 'timeframe', width: 80 },
  {
    title: '入场价',
    dataIndex: 'entryPrice',
    width: 120,
    render: ({ record }: any) => Number(record.entryPrice).toLocaleString('en-US', { minimumFractionDigits: 2 }),
  },
  { title: '创建', dataIndex: 'predictionTime', width: 160, render: ({ record }: any) => formatTime(record.predictionTime) },
  { title: '验证', dataIndex: 'verificationTime', width: 160, render: ({ record }: any) => formatTime(record.verificationTime) },
  { title: '剩余', dataIndex: 'remaining', slotName: 'remaining', width: 140 },
];

async function load() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [s, p, r, t] = await Promise.all([
    api.statistics(),
    api.pending(20),
    api.predictions({ status: 'SUCCESS,FAIL', pageSize: 5, sortBy: 'predictionTime' }),
    api.predictions({ startDate: start.toISOString(), pageSize: 1 }),
  ]);
  stats.value = s;
  pending.value = p.items;
  recent.value = r.items;
  todayCount.value = t.total;
}

async function cancel(id: string) {
  await api.cancel(id);
  Message.success('预测已作废');
  load();
}

let timer: number | undefined;

onMounted(() => {
  load();
  window.setInterval(() => {
    nowTs.value = Date.now();
  }, 1000);
  timer = window.setInterval(load, 30000);
});

onBeforeUnmount(() => timer && window.clearInterval(timer));
</script>

<style scoped>
.price-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
</style>

<template>
  <div class="gpt-page">
    <div class="gpt-card">
      <div class="gpt-title">预测历史</div>
      <a-form :model="filters" layout="inline" style="margin-bottom: 12px">
        <a-form-item label="标的">
          <a-select v-model="filters.symbol" allow-clear placeholder="全部" style="width: 140px">
            <a-option v-for="s in symbols" :key="s" :value="s">{{ s.replace('_', '/') }}</a-option>
          </a-select>
        </a-form-item>
        <a-form-item label="方向">
          <a-select v-model="filters.direction" allow-clear placeholder="全部" style="width: 120px">
            <a-option value="LONG">看涨</a-option>
            <a-option value="SHORT">看跌</a-option>
            <a-option value="RANGE">震荡</a-option>
          </a-select>
        </a-form-item>
        <a-form-item label="周期">
          <a-select v-model="filters.timeframe" allow-clear placeholder="全部" style="width: 110px">
            <a-option v-for="t in timeframes" :key="t" :value="t">{{ t }}</a-option>
          </a-select>
        </a-form-item>
        <a-form-item label="状态">
          <a-select v-model="filters.status" allow-clear placeholder="全部" style="width: 130px">
            <a-option value="PENDING">等待验证</a-option>
            <a-option value="SUCCESS">正确</a-option>
            <a-option value="FAIL">错误</a-option>
            <a-option value="EXPIRED">已作废</a-option>
          </a-select>
        </a-form-item>
        <a-form-item label="时间范围">
          <a-range-picker v-model="range" show-time style="width: 340px" />
        </a-form-item>
        <a-form-item>
          <a-space>
            <a-button type="primary" @click="load">查询</a-button>
            <a-button @click="reset">重置</a-button>
          </a-space>
        </a-form-item>
      </a-form>

      <PredictionTable :items="items" @cancel="cancel" />
      <div style="margin-top: 12px; display: flex; justify-content: flex-end">
        <a-pagination
          :total="total"
          :current="page"
          :page-size="pageSize"
          show-total
          @change="onPage"
          @page-size-change="onPageSize"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Message } from '@arco-design/web-vue';
import PredictionTable from '../components/PredictionTable.vue';
import { api } from '../api';
import { useAppStore } from '../stores/app';
import type { Prediction } from '../types';

const store = useAppStore();
const items = ref<Prediction[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const range = ref<string[]>([]);

const filters = ref<Record<string, any>>({ symbol: '', direction: '', timeframe: '', status: '' });

const symbols = computed(() => store.symbols);
const timeframes = computed(() => store.config?.timeframes ?? ['15m', '30m', '1h', '4h']);

async function load() {
  const params: Record<string, any> = {
    page: page.value,
    pageSize: pageSize.value,
    sortBy: 'predictionTime',
    order: 'desc',
  };
  for (const [k, v] of Object.entries(filters.value)) if (v) params[k] = v;
  if (range.value?.length === 2) {
    params.startDate = new Date(range.value[0]).toISOString();
    params.endDate = new Date(range.value[1]).toISOString();
  }
  const res = await api.predictions(params);
  items.value = res.items;
  total.value = res.total;
  page.value = res.page;
}

async function cancel(id: string) {
  await api.cancel(id);
  Message.success('预测已作废');
  load();
}

function onPage(p: number) {
  page.value = p;
  load();
}

function onPageSize(size: number) {
  pageSize.value = size;
  page.value = 1;
  load();
}

function reset() {
  filters.value = { symbol: '', direction: '', timeframe: '', status: '' };
  range.value = [];
  page.value = 1;
  load();
}

onMounted(async () => {
  await store.loadConfig();
  load();
});
</script>

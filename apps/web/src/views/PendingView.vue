<template>
  <div class="gpt-page">
    <div class="gpt-card">
      <div class="gpt-title">待验证预测</div>
      <a-table :data="items" :columns="columns" :pagination="false" size="small" :loading="loading">
        <template #symbol="{ record }">
          <span class="gpt-mono">{{ (record as Prediction).symbol.replace('_', '/') }}</span>
        </template>
        <template #direction="{ record }">
          <a-tag :color="directionTag[(record as Prediction).direction]">
            {{ directionLabel[(record as Prediction).direction] }}
          </a-tag>
        </template>
        <template #entryPrice="{ record }">
          <span class="gpt-mono">{{ formatPrice((record as Prediction).entryPrice) }}</span>
        </template>
        <template #remaining="{ record }">
          <a-tag :color="remaining((record as Prediction).verificationTime, nowTs).done ? 'orange' : 'blue'">
            {{ remaining((record as Prediction).verificationTime, nowTs).text }}
          </a-tag>
        </template>
        <template #actions="{ record }">
          <a-link @click="open(record as Prediction)">详情</a-link>
          <a-popconfirm content="确认作废该预测？" @ok="cancel((record as Prediction).id)">
            <a-link status="danger">作废</a-link>
          </a-popconfirm>
        </template>
      </a-table>
      <a-empty v-if="!items.length && !loading" description="暂无待验证预测" />
      <div style="margin-top: 12px">
        <a-space>
          <a-button @click="load" :loading="loading">刷新</a-button>
          <a-button type="outline" @click="runVerify">立即执行验证扫描</a-button>
        </a-space>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Message } from '@arco-design/web-vue';
import { api } from '../api';
import type { Prediction } from '../types';
import { directionLabel, directionTag, formatPrice, formatTime, remaining } from '../utils/format';

const router = useRouter();
const items = ref<Prediction[]>([]);
const loading = ref(false);
const nowTs = ref(Date.now());

const columns = [
  { title: '标的', dataIndex: 'symbol', slotName: 'symbol', width: 120 },
  { title: '方向', dataIndex: 'direction', slotName: 'direction', width: 110 },
  { title: '周期', dataIndex: 'timeframe', width: 80 },
  { title: '入场价', dataIndex: 'entryPrice', slotName: 'entryPrice', width: 120 },
  { title: '创建时间', dataIndex: 'predictionTime', width: 170, render: ({ record }: any) => formatTime(record.predictionTime) },
  { title: '验证时间', dataIndex: 'verificationTime', width: 170, render: ({ record }: any) => formatTime(record.verificationTime) },
  { title: '剩余', dataIndex: 'remaining', slotName: 'remaining', width: 140 },
  { title: '理由', dataIndex: 'reason', ellipsis: true, tooltip: true },
  { title: '操作', dataIndex: 'actions', slotName: 'actions', width: 120 },
];

async function load() {
  loading.value = true;
  try {
    const res = await api.pending(100);
    items.value = res.items;
  } finally {
    loading.value = false;
  }
}

async function cancel(id: string) {
  await api.cancel(id);
  Message.success('预测已作废');
  load();
}

async function runVerify() {
  await api.http.post('/verifications/run');
  Message.success('验证扫描已执行');
  load();
}

const open = (row: Prediction) => router.push({ name: 'detail', params: { id: row.id } });

let timer: number | undefined;

onMounted(() => {
  load();
  timer = window.setInterval(() => {
    nowTs.value = Date.now();
  }, 1000);
});

onBeforeUnmount(() => timer && window.clearInterval(timer));
</script>

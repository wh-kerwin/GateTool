<template>
  <a-table :data="items" :columns="columns" :pagination="false" :bordered="false" row-key="id" size="small">
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
    <template #resultPrice="{ record }">
      <span class="gpt-mono">{{ formatPrice((record as Prediction).resultPrice) }}</span>
    </template>
    <template #resultPercent="{ record }">
      <span class="gpt-mono" :class="percentClass((record as Prediction).resultPercent)">
        {{ formatPercent((record as Prediction).resultPercent) }}
      </span>
    </template>
    <template #status="{ record }">
      <a-tag :color="statusColor[(record as Prediction).status]">
        {{ statusLabel[(record as Prediction).status] }}
      </a-tag>
    </template>
    <template #actions="{ record }">
      <a-link @click="open(record as Prediction)">详情</a-link>
      <a-popconfirm
        v-if="(record as Prediction).status === 'PENDING'"
        content="作废后不可恢复，确认作废该预测？"
        @ok="emit('cancel', (record as Prediction).id)"
      >
        <a-link status="danger">作废</a-link>
      </a-popconfirm>
    </template>
  </a-table>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import type { Prediction } from '../types';
import {
  directionLabel,
  directionTag,
  formatPercent,
  formatPrice,
  formatTime,
  percentClass,
  statusColor,
  statusLabel,
} from '../utils/format';

defineProps<{ items: Prediction[] }>();
const emit = defineEmits<{ (e: 'cancel', id: string): void }>();
const router = useRouter();

const open = (row: Prediction) => router.push({ name: 'detail', params: { id: row.id } });

const columns = [
  { title: '预测时间', dataIndex: 'predictionTime', slotName: 'predictionTime', width: 160, render: ({ record }: any) => formatTime(record.predictionTime) },
  { title: '标的', dataIndex: 'symbol', slotName: 'symbol', width: 110 },
  { title: '方向', dataIndex: 'direction', slotName: 'direction', width: 100 },
  { title: '周期', dataIndex: 'timeframe', width: 70 },
  { title: '入场价', dataIndex: 'entryPrice', slotName: 'entryPrice', width: 120 },
  { title: '验证时间', dataIndex: 'verificationTime', width: 160, render: ({ record }: any) => formatTime(record.verificationTime) },
  { title: '结果价', dataIndex: 'resultPrice', slotName: 'resultPrice', width: 120 },
  { title: '涨跌', dataIndex: 'resultPercent', slotName: 'resultPercent', width: 100 },
  { title: '状态', dataIndex: 'status', slotName: 'status', width: 100 },
  { title: '操作', dataIndex: 'actions', slotName: 'actions', width: 120 },
];
</script>

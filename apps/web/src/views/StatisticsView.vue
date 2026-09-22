<template>
  <div class="gpt-page">
    <div class="gpt-card">
      <div class="gpt-title">总体表现</div>
      <a-row :gutter="16">
        <a-col :span="4"><a-statistic title="总预测" :value="stats?.total ?? 0" /></a-col>
        <a-col :span="4"><a-statistic title="待验证" :value="stats?.pending ?? 0" /></a-col>
        <a-col :span="4"><a-statistic title="已验证" :value="stats?.verified ?? 0" /></a-col>
        <a-col :span="4"><a-statistic title="正确" :value="stats?.success ?? 0" /></a-col>
        <a-col :span="4"><a-statistic title="错误" :value="stats?.fail ?? 0" /></a-col>
        <a-col :span="4">
          <a-statistic title="准确率" :value="stats?.accuracy == null ? '-' : `${stats.accuracy}%`" />
        </a-col>
      </a-row>
      <div style="margin-top: 8px; color: #86909c; font-size: 12px">
        准确率 = 正确 / (正确 + 错误)；样本数小于 10 的分组标注为“样本不足”，仅供参考。
      </div>
    </div>

    <a-row :gutter="16">
      <a-col :span="12">
        <div class="gpt-card">
          <div class="gpt-title">按周期统计</div>
          <div ref="tfEl" class="gpt-chart"></div>
        </div>
      </a-col>
      <a-col :span="12">
        <div class="gpt-card">
          <div class="gpt-title">按标的统计</div>
          <div ref="symEl" class="gpt-chart"></div>
        </div>
      </a-col>
    </a-row>

    <div class="gpt-card">
      <div class="gpt-title">标的 × 周期 矩阵</div>
      <a-table :data="matrix" :columns="columns" :pagination="false" size="small">
        <template #accuracy="{ record }">
          <span>{{ (record as any).accuracy == null ? '-' : `${(record as any).accuracy}%` }}</span>
          <a-tag v-if="!(record as any).enoughSample" size="mini" color="orange" style="margin-left: 6px">样本不足</a-tag>
        </template>
      </a-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import * as echarts from 'echarts';
import { api } from '../api';
import type { Statistics } from '../types';

const stats = ref<Statistics | null>(null);
const tfEl = ref<HTMLElement | null>(null);
const symEl = ref<HTMLElement | null>(null);
let tfChart: echarts.ECharts | null = null;
let symChart: echarts.ECharts | null = null;

const matrix = computed(() => stats.value?.breakdown?.bySymbolTimeframe ?? []);

const columns = [
  { title: '分组', dataIndex: 'key', width: 180 },
  { title: '样本数', dataIndex: 'total', width: 100 },
  { title: '正确', dataIndex: 'success', width: 80 },
  { title: '错误', dataIndex: 'fail', width: 80 },
  { title: '准确率', dataIndex: 'accuracy', slotName: 'accuracy', width: 160 },
];

function barOption(items: any[], nameKey: string) {
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 20, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: items.map((i) => i[nameKey]) },
    yAxis: { type: 'value', max: 100, name: '准确率%' },
    series: [
      {
        type: 'bar',
        data: items.map((i) => i.accuracy ?? 0),
        barWidth: '40%',
        itemStyle: { borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', formatter: '{c}%' },
      },
    ],
  };
}

function renderCharts() {
  if (!stats.value) return;
  if (tfChart) tfChart.setOption(barOption(stats.value.breakdown.byTimeframe, 'timeframe'), true);
  if (symChart) symChart.setOption(barOption(stats.value.breakdown.bySymbol, 'symbol'), true);
}

const resize = () => {
  tfChart?.resize();
  symChart?.resize();
};

onMounted(async () => {
  stats.value = await api.statistics();
  if (tfEl.value) tfChart = echarts.init(tfEl.value);
  if (symEl.value) symChart = echarts.init(symEl.value);
  renderCharts();
  window.addEventListener('resize', resize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize);
  tfChart?.dispose();
  symChart?.dispose();
});
</script>

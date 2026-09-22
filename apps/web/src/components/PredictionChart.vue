<template>
  <div ref="el" class="gpt-chart"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';
import type { Candle } from '../types';

const props = defineProps<{
  candles: Candle[];
  entryPrice?: number | null;
  targetPrice?: number | null;
}>();

const el = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;

function render() {
  if (!chart) return;
  const times = props.candles.map((c) => new Date(c.t * 1000).toLocaleTimeString('zh-CN', { hour12: false }));
  const closes = props.candles.map((c) => c.c);
  const series: any[] = [
    {
      name: '价格',
      type: 'line',
      data: closes,
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2 },
      areaStyle: { opacity: 0.08 },
      markLine: props.entryPrice
        ? {
            silent: true,
            symbol: 'none',
            data: [{ yAxis: props.entryPrice, lineStyle: { color: '#86909c', type: 'dashed' }, label: { formatter: 'Entry' } }],
          }
        : undefined,
    },
  ];
  if (props.targetPrice) {
    series[0].markLine = {
      silent: true,
      symbol: 'none',
      data: [
        ...(props.entryPrice ? [{ yAxis: props.entryPrice, lineStyle: { color: '#86909c', type: 'dashed' }, label: { formatter: 'Entry' } }] : []),
        { yAxis: props.targetPrice, lineStyle: { color: '#f53f3f', type: 'dotted' }, label: { formatter: 'Target' } },
      ],
    };
  }

  chart.setOption(
    {
      tooltip: { trigger: 'axis' },
      grid: { left: 60, right: 24, top: 24, bottom: 40 },
      xAxis: { type: 'category', data: times, boundaryGap: false },
      yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { type: 'dashed' } } },
      series,
    },
    true,
  );
}

onMounted(() => {
  if (el.value) chart = echarts.init(el.value);
  render();
  window.addEventListener('resize', resize);
});

watch(() => [props.candles, props.entryPrice, props.targetPrice], render, { deep: true });

const resize = () => chart?.resize();

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize);
  chart?.dispose();
  chart = null;
});
</script>

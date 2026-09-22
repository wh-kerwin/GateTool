<template>
  <div class="gpt-page">
    <div class="gpt-card" style="max-width: 720px">
      <div class="gpt-title">创建预测</div>

      <a-alert type="normal" style="margin-bottom: 16px">
        预测一经创建不可修改；到达验证时间后，系统会自动拉取 Gate 真实行情判定成功 / 失败。
      </a-alert>

      <a-form :model="form" layout="vertical" @submit-success="submit">
        <a-form-item label="交易标的" field="symbol" required>
          <a-radio-group v-model="form.symbol" type="button">
            <a-radio v-for="s in symbols" :key="s" :value="s">{{ s.replace('_', '/') }}</a-radio>
          </a-radio-group>
        </a-form-item>

        <a-form-item label="当前价格">
          <div style="display: flex; align-items: center; gap: 12px">
            <span class="gpt-price gpt-mono">{{ formatPrice(currentPrice) }}</span>
            <a-tag :color="wsConnected ? 'green' : 'orange'">{{ wsConnected ? '实时' : 'REST' }}</a-tag>
            <a-button size="mini" @click="refreshPrice">刷新</a-button>
          </div>
        </a-form-item>

        <a-form-item label="预测方向" field="direction" required>
          <a-radio-group v-model="form.direction" type="button">
            <a-radio value="LONG">↑ 看涨</a-radio>
            <a-radio value="SHORT">↓ 看跌</a-radio>
            <a-radio value="RANGE">→ 震荡</a-radio>
          </a-radio-group>
        </a-form-item>

        <a-form-item v-if="form.direction === 'RANGE'" label="震荡容差（±%）" field="rangePercent" required>
          <a-input-number v-model="form.rangePercent" :min="0.1" :max="10" :step="0.1" />
          <template #extra>
            验证时价格落在 ±{{ form.rangePercent }}% 区间内判定为正确
            <template v-if="currentPrice">
              （{{ formatPrice(currentPrice * (1 - form.rangePercent / 100) ) }} ~
              {{ formatPrice(currentPrice * (1 + form.rangePercent / 100)) }}）
            </template>
          </template>
        </a-form-item>

        <a-form-item label="验证周期" field="timeframe" required>
          <a-select v-model="form.timeframe" style="width: 200px">
            <a-option v-for="t in timeframes" :key="t" :value="t">{{ t }}</a-option>
          </a-select>
        </a-form-item>

        <a-form-item label="目标价格（可选，V1.1 参与命中判定）" field="targetPrice">
          <a-input-number v-model="form.targetPrice" :min="0" :step="10" placeholder="留空则不校验目标价" />
        </a-form-item>

        <a-form-item label="预测理由（可选）" field="reason">
          <a-textarea v-model="form.reason" :max-length="500" show-word-limit :auto-size="{ minRows: 3, maxRows: 6 }"
            placeholder="例如：15m 放量突破前高，价格站上前高" />
        </a-form-item>

        <a-form-item>
          <a-space>
            <a-button type="primary" html-type="submit" :loading="submitting">创建预测</a-button>
            <a-button @click="reset">重置</a-button>
          </a-space>
          <div class="preview">
            预计验证时间：{{ previewTime }}
          </div>
        </a-form-item>
      </a-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Message } from '@arco-design/web-vue';
import dayjs from 'dayjs';
import { api } from '../api';
import { useAppStore } from '../stores/app';
import type { Direction, Timeframe } from '../types';
import { formatPrice } from '../utils/format';

const store = useAppStore();
const router = useRouter();

const form = ref<{
  symbol: string;
  direction: Direction;
  timeframe: Timeframe;
  targetPrice?: number | null;
  rangePercent: number;
  reason: string;
}>({
  symbol: 'BTC_USDT',
  direction: 'LONG',
  timeframe: '30m',
  targetPrice: null,
  rangePercent: 1,
  reason: '',
});

const submitting = ref(false);
const symbols = computed(() => store.symbols);
const timeframes = computed(() => store.config?.timeframes ?? ['15m', '30m', '1h', '4h']);
const wsConnected = computed(() => store.wsConnected);
const currentPrice = computed(() => store.tickers[form.value.symbol]?.last ?? null);

const minutes = computed(() => store.config?.timeframeMinutes?.[form.value.timeframe] ?? 30);
const previewTime = computed(() => dayjs().add(minutes.value, 'minute').format('YYYY-MM-DD HH:mm:ss'));

async function refreshPrice() {
  await store.loadTickers();
}

async function submit() {
  submitting.value = true;
  try {
    const res = await api.createPrediction({
      symbol: form.value.symbol,
      direction: form.value.direction,
      timeframe: form.value.timeframe,
      targetPrice: form.value.targetPrice || null,
      rangePercent: form.value.direction === 'RANGE' ? form.value.rangePercent : null,
      reason: form.value.reason || null,
    });
    Message.success(`预测已创建，入场价 ${formatPrice(res.prediction.entryPrice)}`);
    if (res.conflicts?.length) {
      Message.warning(`存在 ${res.conflicts.length} 条同窗口反向预测，请留意冲突`);
    }
    router.push({ name: 'pending' });
  } catch (e: any) {
    Message.error(e?.response?.data?.error || e?.message || '创建失败');
  } finally {
    submitting.value = false;
  }
}

function reset() {
  form.value = {
    symbol: 'BTC_USDT',
    direction: 'LONG',
    timeframe: '30m',
    targetPrice: null,
    rangePercent: 1,
    reason: '',
  };
}

onMounted(async () => {
  await store.loadConfig();
  form.value.symbol = store.symbols[0];
  await store.loadTickers();
});

watch(
  () => form.value.symbol,
  () => store.loadTickers(),
);
</script>

<style scoped>
.preview {
  margin-top: 10px;
  color: #86909c;
  font-size: 13px;
}
</style>

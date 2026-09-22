<template>
  <div class="gpt-page">
    <div class="gpt-card">
      <a-page-header :title="`推荐详情 · ${rec?.symbol?.replace('_', '/') || ''}`" @back="router.push({ name: 'advisor' })" />

      <a-descriptions v-if="rec" :column="4" bordered size="small">
        <a-descriptions-item label="方向">
          <a-tag :color="rec.direction === 'LONG' ? 'green' : rec.direction === 'SHORT' ? 'red' : 'gray'">
            {{ rec.direction === 'LONG' ? '做多' : rec.direction === 'SHORT' ? '做空' : '不建议' }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="评分 / 置信度">{{ rec.score }} / {{ ((rec.confidence ?? 0) * 100).toFixed(0) }}%</a-descriptions-item>
        <a-descriptions-item label="策略版本">v{{ rec.strategyVersion }}</a-descriptions-item>
        <a-descriptions-item label="状态">{{ rec.status }}</a-descriptions-item>
        <a-descriptions-item label="入场价">
          <span class="gpt-mono">{{ formatPrice(rec.referencePrice) }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="止损 / 止盈">
          <span class="gpt-mono">{{ formatPrice(rec.stopLoss) }} / {{ formatPrice(rec.takeProfit) }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="仓位 / 倍数">{{ rec.positionPercent }}% × {{ rec.leverage }}x</a-descriptions-item>
        <a-descriptions-item label="实际风险">{{ rec.actualRiskPercent }}%</a-descriptions-item>
        <a-descriptions-item label="生成时间">{{ formatFullTime(rec.createdAt) }}</a-descriptions-item>
        <a-descriptions-item label="到期时间">{{ formatFullTime(rec.expiresAt) }}</a-descriptions-item>
        <a-descriptions-item label="验证时间">{{ formatFullTime(rec.verifiedAt) }}</a-descriptions-item>
        <a-descriptions-item label="结果">
          <span :class="rec.status === 'SUCCESS' ? 'gpt-up' : rec.status === 'FAIL' ? 'gpt-down' : 'gpt-flat'">
            {{ rec.resultType || '-' }}
          </span>
        </a-descriptions-item>
        <a-descriptions-item label="价格收益 %" :span="2">
          <span :class="(rec.resultPercent ?? 0) >= 0 ? 'gpt-up' : 'gpt-down'">
            {{ rec.resultPercent?.toFixed(2) ?? '-' }}%（保证金口径 {{ rec.pnlPercent?.toFixed(2) ?? '-' }}%）
          </span>
        </a-descriptions-item>
        <a-descriptions-item label="R 倍数" :span="2">{{ rec.rMultiple?.toFixed(2) ?? '-' }}</a-descriptions-item>
        <a-descriptions-item label="MFE / MAE" :span="2">
          {{ rec.mfePercent?.toFixed(2) ?? '-' }}% / {{ rec.maePercent?.toFixed(2) ?? '-' }}%
        </a-descriptions-item>
        <a-descriptions-item label="出场价 / K线数" :span="2">
          {{ formatPrice(rec.verifiedDetail?.exitPrice) }} / {{ rec.verifiedDetail?.candles ?? '-' }}
        </a-descriptions-item>
      </a-descriptions>
    </div>

    <div class="gpt-card">
      <div class="gpt-title">验证窗口走势（入场 / 止盈标线）</div>
      <PredictionChart :candles="candles" :entry-price="rec?.referencePrice" :target-price="rec?.takeProfit" />
    </div>

    <div v-if="rec?.reasons?.forecasts || rec?.verifiedDetail?.forecastCheck" class="gpt-card">
      <div class="gpt-title">LLM 周期趋势预测</div>
      <a-space wrap>
        <a-tag
          v-for="(f, key) in rec?.reasons?.forecasts || {}"
          :key="key"
          size="large"
          :color="f.bias === 'UP' ? 'green' : f.bias === 'DOWN' ? 'red' : 'gray'"
        >
          {{ key }}：{{ f.bias === 'UP' ? '上涨' : f.bias === 'DOWN' ? '下跌' : '震荡' }}
          <span v-if="f.changePercent != null">{{ f.changePercent > 0 ? '+' : '' }}{{ f.changePercent }}%</span>
        </a-tag>
      </a-space>
      <div v-if="rec?.verifiedDetail?.forecastCheck" style="margin-top: 8px">
        实际（{{ rec.verifiedDetail.forecastCheck.horizon }}）：
        {{ rec.verifiedDetail.forecastCheck.actual === 'UP' ? '上涨' : '下跌' }}
        {{ rec.verifiedDetail.forecastCheck.actualChangePercent }}% ·
        <a-tag :color="rec.verifiedDetail.forecastCheck.hit ? 'green' : 'red'">
          {{ rec.verifiedDetail.forecastCheck.hit ? '预测命中' : '未命中' }}
        </a-tag>
      </div>
    </div>

    <div class="gpt-card">
      <div class="gpt-title">LLM 复盘</div>
      <div v-if="rec?.verifiedDetail?.llmReview?.review" class="llm-text">
        {{ rec.verifiedDetail.llmReview.review }}
        <ul>
          <li v-for="(l, i) in rec.verifiedDetail.llmReview.lessons || []" :key="i">{{ l }}</li>
        </ul>
      </div>
      <a-space v-else>
        <span class="gpt-flat">尚未生成 LLM 复盘</span>
        <a-button size="mini" :loading="reviewing" @click="runReview">生成复盘</a-button>
      </a-space>
    </div>

    <div class="gpt-card">
      <div class="gpt-title">因子与 LLM 意见</div>
      <a-table :data="rec?.reasons?.factors || []" :columns="factorColumns" :pagination="false" size="small" />
      <div v-if="rec?.reasons?.llm" style="margin-top: 12px">
        <a-tag :color="rec.reasons.llm.available ? 'purple' : 'gray'">
          LLM {{ rec.reasons.llm.available ? rec.reasons.llm.bias : '不可用' }}
        </a-tag>
        <span v-if="rec.reasons.llm.available">{{ rec.reasons.llm.rationale }}</span>
        <span v-else>{{ rec.reasons.llm.reason }}</span>
      </div>
    </div>

    <div class="gpt-card">
      <div class="gpt-title">事件流</div>
      <a-timeline>
        <a-timeline-item v-for="e in events" :key="e.id" :label="formatFullTime(e.createdAt)">
          {{ e.type }}
          <span class="gpt-flat">{{ e.payload ? JSON.stringify(e.payload) : '' }}</span>
        </a-timeline-item>
      </a-timeline>
    </div>

    <div class="gpt-card">
      <div class="gpt-title">我的反馈</div>
      <a-space>
        <a-switch v-model="fb.adopted"><template #checked>已采纳</template><template #unchecked>未采纳</template></a-switch>
        <a-rate v-model="fb.rating" allow-half />
        <a-input v-model="fb.comment" placeholder="备注（可选）" style="width: 260px" />
        <a-button type="primary" @click="submitFeedback">提交反馈</a-button>
      </a-space>
      <div v-for="f in feedback" :key="f.id" class="fb-item">
        {{ formatFullTime(f.createdAt) }} · 采纳：{{ f.adopted ? '是' : '否' }} · 评分 {{ f.rating ?? '-' }} ·
        {{ f.comment || '' }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Message } from '@arco-design/web-vue';
import PredictionChart from '../components/PredictionChart.vue';
import { api, signalsApi } from '../api';
import type { Candle } from '../types';
import { formatFullTime, formatPrice } from '../utils/format';

const route = useRoute();
const router = useRouter();

const rec = ref<any>(null);
const events = ref<any[]>([]);
const feedback = ref<any[]>([]);
const candles = ref<Candle[]>([]);
const reviewing = ref(false);

const fb = reactive<{ adopted: boolean; rating: number; comment: string }>({ adopted: false, rating: 0, comment: '' });

const factorColumns = [
  { title: '因子', dataIndex: 'code', width: 120 },
  { title: '权重', dataIndex: 'weight', width: 80, render: ({ record }: any) => record.weight?.toFixed(2) ?? '-' },
  { title: '取值', dataIndex: 'value', width: 80 },
  { title: '说明', dataIndex: 'desc', ellipsis: true, tooltip: true },
];

async function load() {
  const id = String(route.params.id);
  const res = await signalsApi.detail(id);
  rec.value = res.recommendation;
  events.value = res.events;
  feedback.value = res.feedback;
  const minutes = { '15m': 15, '30m': 30, '1h': 60, '4h': 240, '8h': 480 }[res.recommendation.horizon] || 240;
  const c = await api.candles(res.recommendation.symbol, '1m', Math.min(1000, minutes + 20));
  const from = new Date(res.recommendation.createdAt).getTime() / 1000;
  const to = new Date(res.recommendation.expiresAt).getTime() / 1000;
  candles.value = c.items.filter((x) => x.t >= from - 60 && x.t <= to + 120);
}

async function runReview() {
  reviewing.value = true;
  try {
    const res = await signalsApi.review(String(route.params.id));
    if (res.available) {
      Message.success('复盘已生成');
      load();
    } else {
      Message.info(`复盘不可用：${res.reason}`);
    }
  } finally {
    reviewing.value = false;
  }
}

async function submitFeedback() {
  await signalsApi.feedback(String(route.params.id), { adopted: fb.adopted, rating: fb.rating, comment: fb.comment });
  Message.success('反馈已记录');
  load();
}

onMounted(load);
</script>

<style scoped>
.llm-text {
  font-size: 13px;
  color: #4e5969;
  line-height: 1.7;
}

.fb-item {
  margin-top: 8px;
  font-size: 12px;
  color: #86909c;
}
</style>

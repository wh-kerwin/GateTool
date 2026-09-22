<template>
  <div class="gpt-page">
    <div class="gpt-card">
      <div class="gpt-title">智能交易辅助</div>
      <a-space wrap>
        <a-radio-group v-model="symbol" type="button">
          <a-radio v-for="s in symbols" :key="s" :value="s">{{ s.replace('_', '/') }}</a-radio>
        </a-radio-group>
        <a-select v-model="timeframe" style="width: 100px" placeholder="主周期">
          <a-option v-for="t in timeframes" :key="t" :value="t">{{ t }}</a-option>
        </a-select>
        <a-select v-model="horizon" style="width: 110px" placeholder="验证周期">
          <a-option v-for="h in horizons" :key="h" :value="h">{{ h }}</a-option>
        </a-select>
        <a-button type="primary" :loading="generating" @click="generate">生成推荐并入库验证</a-button>
        <a-button :loading="analyzing" @click="analyzeOnly">仅分析（不入库）</a-button>
        <a-switch v-model="useLlm" :disabled="!llmReady">
          <template #checked>LLM 辅助</template>
          <template #unchecked>纯规则</template>
        </a-switch>
        <a-tag :color="llmReady ? 'green' : 'gray'">
          {{ llmReady ? `LLM ${llmStatus.model}` : llmHint }}
        </a-tag>
        <a-tag color="arcoblue">策略 v{{ strategy?.version ?? '-' }}</a-tag>
        <a-button size="small" @click="configVisible = true">策略配置</a-button>
        <a-button size="small" type="outline" @click="adapt" :loading="adapting">执行权重自适应</a-button>
      </a-space>
      <a-alert type="warning" style="margin-top: 12px">
        工具仅输出建议与验证结果，不执行任何下单；输出不构成投资建议。
      </a-alert>
    </div>

    <div v-if="current" class="gpt-card">
      <div class="gpt-title">
        推荐结果
        <a-tag :color="dirColor(current.direction)" style="margin-left: 8px">{{ dirLabel(current.direction) }}</a-tag>
        <a-tag>{{ current.symbol.replace('_', '/') }} · {{ current.timeframe }} · 验证周期 {{ current.horizon }}</a-tag>
        <a-tag v-if="current.llmAdjusted" color="purple">LLM 已参与</a-tag>
      </div>

      <a-descriptions :column="4" bordered size="small">
        <a-descriptions-item label="参考价">
          <span class="gpt-mono">{{ formatPrice(current.referencePrice) }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="入场区间">
          <span class="gpt-mono">{{ formatPrice(current.entryLow) }} ~ {{ formatPrice(current.entryHigh) }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="止损">
          <span class="gpt-mono gpt-down">{{ formatPrice(current.stopLoss) }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="止盈">
          <span class="gpt-mono gpt-up">{{ formatPrice(current.takeProfit) }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="建议仓位">
          <span class="gpt-mono">{{ current.positionPercent ?? '-' }}%</span>
        </a-descriptions-item>
        <a-descriptions-item label="建议倍数">
          <span class="gpt-mono">{{ current.leverage ?? '-' }}x</span>
        </a-descriptions-item>
        <a-descriptions-item label="风险">
          {{ current.actualRiskPercent ?? '-' }}% / 目标 {{ current.riskPercent }}%
        </a-descriptions-item>
        <a-descriptions-item label="盈亏比">1 : {{ current.rr }}</a-descriptions-item>
        <a-descriptions-item label="评分 / 置信度">
          {{ current.score }} / {{ ((current.confidence ?? 0) * 100).toFixed(0) }}%
        </a-descriptions-item>
        <a-descriptions-item label="状态">{{ statusLabel(current.status) }}</a-descriptions-item>
        <a-descriptions-item label="生成时间">{{ formatFullTime(current.createdAt) }}</a-descriptions-item>
        <a-descriptions-item label="验证时间">{{ formatFullTime(current.expiresAt) }}</a-descriptions-item>
      </a-descriptions>

      <a-row :gutter="16" style="margin-top: 16px">
        <a-col :span="12">
          <div class="sub-title">评分因子</div>
          <a-table :data="current.reasons?.factors || []" :columns="factorColumns" :pagination="false" size="mini">
            <template #value="{ record }">
              <span :class="(record as any).value > 0 ? 'gpt-up' : (record as any).value < 0 ? 'gpt-down' : 'gpt-flat'">
                {{ (record as any).value > 0 ? '+' : '' }}{{ (record as any).value.toFixed(2) }}
              </span>
            </template>
          </a-table>
          <div class="sub-title" style="margin-top: 12px">质量因子（不决定方向）</div>
          <a-table :data="current.reasons?.quality || []" :columns="factorColumns" :pagination="false" size="mini" />
        </a-col>
        <a-col :span="12">
          <div class="sub-title">关键指标</div>
          <a-descriptions :column="2" bordered size="mini">
            <a-descriptions-item label="EMA7/25/99">
              <span class="gpt-mono">
                {{ fmt(current.indicators?.ema7) }} / {{ fmt(current.indicators?.ema25) }} /
                {{ fmt(current.indicators?.ema99) }}
              </span>
            </a-descriptions-item>
            <a-descriptions-item label="RSI14">{{ fmt(current.indicators?.rsi14) }}</a-descriptions-item>
            <a-descriptions-item label="ATR%">{{ fmt(current.indicators?.atrPct, 3) }}</a-descriptions-item>
            <a-descriptions-item label="布林 %B">
              {{ current.indicators?.boll ? (current.indicators.boll.percentB * 100).toFixed(0) + '%' : '-' }}
            </a-descriptions-item>
            <a-descriptions-item label="布林带宽">
              {{ current.indicators?.boll ? current.indicators.boll.bandwidth.toFixed(2) + '%' : '-' }}
            </a-descriptions-item>
            <a-descriptions-item label="布林上下轨">
              <span class="gpt-mono">
                {{ fmt(current.indicators?.boll?.lower) }} ~ {{ fmt(current.indicators?.boll?.upper) }}
              </span>
            </a-descriptions-item>
            <a-descriptions-item label="SAR">
              <span class="gpt-mono">{{ fmt(current.indicators?.sar?.sar) }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="SAR 方向">
              <a-tag :color="current.indicators?.sar?.trend === 1 ? 'green' : 'red'">
                {{ current.indicators?.sar?.trend === 1 ? '多头' : '空头' }}
              </a-tag>
              <span v-if="current.indicators?.sar?.reversed" style="margin-left: 4px">（刚反转）</span>
            </a-descriptions-item>
            <a-descriptions-item label="资金费率">
              {{ current.indicators?.fundingRate == null ? '-' : (current.indicators.fundingRate * 100).toFixed(4) + '%' }}
            </a-descriptions-item>
            <a-descriptions-item label="确认周期趋势">{{ current.indicators?.confirmTrend || '-' }}</a-descriptions-item>
          </a-descriptions>

          <div class="sub-title" style="margin-top: 12px">风险提示</div>
          <ul class="risk-list">
            <li v-for="(n, i) in current.reasons?.riskNotes || []" :key="i">{{ n }}</li>
            <li v-if="!(current.reasons?.riskNotes || []).length">无额外风险提示</li>
          </ul>
        </a-col>
      </a-row>

      <div v-if="current.reasons?.llm" class="llm-card">
        <div class="sub-title">LLM 辅助意见</div>
        <template v-if="current.reasons.llm.available">
          <a-space>
            <a-tag :color="current.reasons.llm.bias === 'LONG' ? 'green' : current.reasons.llm.bias === 'SHORT' ? 'red' : 'gray'">
              {{ biasLabel(current.reasons.llm.bias) }}
            </a-tag>
            <span>置信度 {{ ((current.reasons.llm.confidence ?? 0) * 100).toFixed(0) }}%</span>
            <a-tag size="mini">{{ current.reasons.llm.model }}</a-tag>
          </a-space>
          <div class="llm-text">{{ current.reasons.llm.rationale }}</div>
          <ul class="risk-list">
            <li v-for="(r, i) in current.reasons.llm.risks || []" :key="i">{{ r }}</li>
          </ul>
        </template>
        <a-alert v-else type="normal">LLM 不可用：{{ current.reasons.llm.reason }}（已按规则结果执行）</a-alert>
      </div>

      <div style="margin-top: 12px">
        <a-space>
          <a-button size="small" @click="router.push({ name: 'signal-detail', params: { id: current!.id } })">
            查看详情与验证过程
          </a-button>
          <a-button size="small" type="outline" @click="verifyOne(current!.id)">立即验证该条</a-button>
        </a-space>
      </div>
    </div>

    <div class="gpt-card">
      <div class="gpt-title">策略表现（已验证）</div>
      <a-row :gutter="16">
        <a-col :span="4"><a-statistic title="样本" :value="stats?.overall?.total ?? 0" /></a-col>
        <a-col :span="4"><a-statistic title="胜率" :value="stats?.overall?.winRate == null ? '-' : (stats.overall.winRate * 100).toFixed(1) + '%'" /></a-col>
        <a-col :span="4"><a-statistic title="平均 R" :value="stats?.overall?.avgR == null ? '-' : stats.overall.avgR.toFixed(2)" /></a-col>
        <a-col :span="4"><a-statistic title="进行中" :value="stats?.open ?? 0" /></a-col>
        <a-col :span="8">
          <a-table :data="stats?.byDirection || []" :columns="perfColumns" :pagination="false" size="mini" />
        </a-col>
      </a-row>
    </div>

    <div class="gpt-card">
      <div class="gpt-title">最近推荐</div>
      <a-table :data="items" :columns="listColumns" :pagination="false" size="small">
        <template #direction="{ record }">
          <a-tag :color="dirColor((record as Recommendation).direction)">{{ dirLabel((record as Recommendation).direction) }}</a-tag>
        </template>
        <template #result="{ record }">
          <span v-if="(record as Recommendation).status === 'OPEN'" class="gpt-flat">进行中</span>
          <span v-else :class="(record as Recommendation).status === 'SUCCESS' ? 'gpt-up' : 'gpt-down'">
            {{ resultLabel((record as Recommendation).resultType) }}
            ({{ (record as Recommendation).resultPercent?.toFixed(2) ?? '-' }}%)
          </span>
        </template>
        <template #actions="{ record }">
          <a-link @click="router.push({ name: 'signal-detail', params: { id: (record as Recommendation).id } })">详情</a-link>
        </template>
      </a-table>
    </div>

    <a-drawer :width="520" :visible="configVisible" title="策略配置" @cancel="configVisible = false" @ok="saveConfig">
      <a-form :model="form" layout="vertical">
        <a-form-item label="最低评分（低于则不给建议）">
          <a-slider v-model="form.minScore" :min="30" :max="90" show-input />
        </a-form-item>
        <a-form-item label="单笔风险（净值 %）">
          <a-input-number v-model="form.riskPercent" :min="0.1" :max="5" :step="0.1" />
        </a-form-item>
        <a-form-item label="最大倍数">
          <a-input-number v-model="form.maxLeverage" :min="1" :max="20" />
        </a-form-item>
        <a-form-item label="仓位上限（保证金 %）">
          <a-input-number v-model="form.maxPositionPercent" :min="1" :max="100" />
        </a-form-item>
        <a-form-item label="止损 ATR 倍数">
          <a-input-number v-model="form.slAtrMult" :min="0.5" :max="5" :step="0.1" />
        </a-form-item>
        <a-form-item label="盈亏比">
          <a-input-number v-model="form.rr" :min="1" :max="5" :step="0.5" />
        </a-form-item>
        <a-form-item label="默认主周期（K线判定周期）">
          <a-select v-model="form.timeframe">
            <a-option v-for="t in timeframes" :key="t" :value="t">{{ t }}</a-option>
          </a-select>
        </a-form-item>
        <a-form-item label="默认验证周期">
          <a-select v-model="form.horizon">
            <a-option v-for="h in horizons" :key="h" :value="h">{{ h }}</a-option>
          </a-select>
        </a-form-item>
        <a-divider>方向因子权重（保存后归一化）</a-divider>
        <a-form-item v-for="(w, k) in form.weights" :key="k" :label="String(k)">
          <a-slider v-model="form.weights[k as string]" :min="0" :max="1" :step="0.05" show-input />
        </a-form-item>
        <a-divider>质量因子权重</a-divider>
        <a-form-item v-for="(w, k) in form.qualityWeights" :key="k" :label="String(k)">
          <a-slider v-model="form.qualityWeights[k as string]" :min="0" :max="1" :step="0.05" show-input />
        </a-form-item>
        <a-divider>LLM 辅助</a-divider>
        <a-form-item label="启用 LLM 参与方向评分">
          <a-switch v-model="form.useLlm" />
        </a-form-item>
        <a-form-item label="LLM 权重">
          <a-slider v-model="form.llmWeight" :min="0" :max="0.6" :step="0.05" show-input />
        </a-form-item>
      </a-form>
    </a-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Message } from '@arco-design/web-vue';
import { signalsApi } from '../api';
import { useAppStore } from '../stores/app';
import type { Recommendation } from '../types';
import { formatFullTime, formatPrice } from '../utils/format';

const store = useAppStore();
const router = useRouter();

const symbol = ref('BTC_USDT');
const timeframe = ref('1h');
const horizon = ref('4h');
const timeframes = ref<string[]>(['15m', '30m', '1h', '4h']);
const horizons = ref<string[]>(['15m', '30m', '1h', '4h', '8h']);
const useLlm = ref(false);
const current = ref<any>(null);
const items = ref<Recommendation[]>([]);
const stats = ref<any>(null);
const strategy = ref<any>(null);
const llmStatus = ref<any>({});
const configVisible = ref(false);
const generating = ref(false);
const analyzing = ref(false);
const adapting = ref(false);

const symbols = computed(() => store.symbols);
const llmReady = computed(() => Boolean(llmStatus.value?.enabled && llmStatus.value?.configured));
const llmHint = computed(() => {
  if (!llmStatus.value?.enabled) return llmStatus.value?.configured ? '已配 Key，但 LLM_ENABLED=false' : 'LLM 未启用';
  return '缺少 LLM_API_KEY';
});

const form = reactive<any>({
  minScore: 55,
  riskPercent: 1,
  maxLeverage: 10,
  maxPositionPercent: 25,
  slAtrMult: 1.5,
  rr: 2,
  horizon: '4h',
  useLlm: false,
  llmWeight: 0.2,
  weights: {},
  qualityWeights: {},
});

const fmt = (v: any, d = 2) => (v == null ? '-' : Number(v).toFixed(d));

const dirLabel = (d: string) => (d === 'LONG' ? '做多' : d === 'SHORT' ? '做空' : '不建议');
const dirColor = (d: string) => (d === 'LONG' ? 'green' : d === 'SHORT' ? 'red' : 'gray');
const biasLabel = (b?: string) => (b === 'LONG' ? '偏多' : b === 'SHORT' ? '偏空' : '中性');
const statusLabel = (s: string) =>
  ({ OPEN: '进行中', SUCCESS: '成功', FAIL: '失败', SKIPPED: '未达阈值', EXPIRED: '数据缺失' } as any)[s] || s;
const resultLabel = (t?: string) =>
  ({
    TAKE_PROFIT: '止盈',
    STOP_LOSS: '止损',
    BOTH_SAME_BAR: '同K线双触',
    TIMEOUT_WIN: '到期盈利',
    TIMEOUT_LOSS: '到期亏损',
    EXPIRED: '数据缺失',
  } as any)[t || ''] || '-';

const factorColumns = [
  { title: '因子', dataIndex: 'code', width: 110 },
  { title: '权重', dataIndex: 'weight', width: 70, render: ({ record }: any) => record.weight?.toFixed(2) ?? '-' },
  { title: '取值', dataIndex: 'value', slotName: 'value', width: 80 },
  { title: '说明', dataIndex: 'desc', ellipsis: true, tooltip: true },
];

const perfColumns = [
  { title: '方向', dataIndex: 'key', width: 80 },
  { title: '样本', dataIndex: 'total', width: 70 },
  {
    title: '胜率',
    dataIndex: 'winRate',
    width: 90,
    render: ({ record }: any) => (record.winRate == null ? '-' : `${record.winRate}%`),
  },
  {
    title: '平均 R',
    dataIndex: 'avgR',
    width: 90,
    render: ({ record }: any) => (record.avgR == null ? '-' : record.avgR.toFixed(2)),
  },
];

const listColumns = [
  { title: '生成时间', dataIndex: 'createdAt', width: 165, render: ({ record }: any) => formatFullTime(record.createdAt) },
  { title: '标的', dataIndex: 'symbol', width: 110, render: ({ record }: any) => record.symbol.replace('_', '/') },
  { title: '方向', dataIndex: 'direction', slotName: 'direction', width: 90 },
  { title: '评分', dataIndex: 'score', width: 70 },
  { title: '仓位', dataIndex: 'positionPercent', width: 90, render: ({ record }: any) => (record.positionPercent ? `${record.positionPercent}%` : '-') },
  { title: '倍数', dataIndex: 'leverage', width: 70, render: ({ record }: any) => (record.leverage ? `${record.leverage}x` : '-') },
  { title: '结果', dataIndex: 'result', slotName: 'result', width: 170 },
  { title: 'R', dataIndex: 'rMultiple', width: 70, render: ({ record }: any) => (record.rMultiple == null ? '-' : record.rMultiple.toFixed(2)) },
  { title: '操作', dataIndex: 'actions', slotName: 'actions', width: 80 },
];

async function loadAll() {
  const [cfg, llm, list, st, strategies] = await Promise.all([
    signalsApi.config(),
    signalsApi.llmStatus(),
    signalsApi.list({ pageSize: 15 }),
    signalsApi.statistics(),
    signalsApi.strategies(),
  ]);
  strategy.value = cfg.strategy;
  llmStatus.value = llm;
  useLlm.value = Boolean(llm?.enabled && llm?.configured);
  items.value = list.items;
  stats.value = st;
  const s = strategies.items[0] || cfg.strategy;
  if (cfg.timeframes?.length) timeframes.value = cfg.timeframes;
  if (cfg.horizons?.length) horizons.value = cfg.horizons;
  timeframe.value = s.params.timeframe || '1h';
  horizon.value = s.params.horizon || '4h';
  Object.assign(form, {
    timeframe: timeframe.value,
    horizon: horizon.value,
    minScore: s.params.minScore,
    riskPercent: s.params.riskPercent,
    maxLeverage: s.params.maxLeverage,
    maxPositionPercent: s.params.maxPositionPercent,
    slAtrMult: s.params.slAtrMult,
    rr: s.params.rr,
    horizon: s.params.horizon,
    useLlm: Boolean(s.params.useLlm),
    llmWeight: s.params.llmWeight ?? 0.2,
    weights: { ...s.params.weights },
    qualityWeights: { ...s.params.qualityWeights },
  });
}

async function generate() {
  generating.value = true;
  try {
    const res = await signalsApi.generate(symbol.value, useLlm.value, timeframe.value, horizon.value);
    current.value = res.recommendation;
    Message.success(`推荐已生成：${dirLabel(res.recommendation.direction)}（评分 ${res.recommendation.score}）`);
    loadAll();
  } catch (e: any) {
    Message.error(e?.response?.data?.error || e?.message || '生成失败');
  } finally {
    generating.value = false;
  }
}

async function analyzeOnly() {
  analyzing.value = true;
  try {
    current.value = await signalsApi.analyze(symbol.value, useLlm.value, timeframe.value, horizon.value);
    Message.success('分析完成（未入库）');
  } catch (e: any) {
    Message.error(e?.response?.data?.error || e?.message || '分析失败');
  } finally {
    analyzing.value = false;
  }
}

async function verifyOne(id: string) {
  try {
    await signalsApi.verify(id);
    Message.success('验证已执行');
    loadAll();
  } catch (e: any) {
    Message.error(e?.response?.data?.error || '未到期且未触发止损/止盈');
  }
}

async function adapt() {
  adapting.value = true;
  try {
    const res = await signalsApi.adapt(strategy.value?.id || 'stg_trend_v1', true);
    if (res.changed) {
      Message.success(`权重已调整至 v${res.version}`);
      console.log('权重变化', res.from, res.to);
    } else {
      Message.info(`未调整：${res.reason}`);
    }
    loadAll();
  } finally {
    adapting.value = false;
  }
}

async function saveConfig() {
  try {
    const res = await signalsApi.updateStrategy(strategy.value?.id || 'stg_trend_v1', { ...form });
    strategy.value = res.strategy;
    configVisible.value = false;
    Message.success(`策略已更新至 v${res.strategy.version}`);
  } catch (e: any) {
    Message.error(e?.response?.data?.error || '保存失败');
  }
}

onMounted(async () => {
  await store.loadConfig();
  symbol.value = store.symbols[0];
  await loadAll();
});
</script>

<style scoped>
.sub-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}

.risk-list {
  margin: 4px 0 0;
  padding-left: 18px;
  color: #86909c;
  font-size: 12px;
}

.llm-card {
  margin-top: 16px;
  padding: 12px;
  border: 1px dashed #c9cdd4;
  border-radius: 6px;
}

.llm-text {
  margin-top: 6px;
  font-size: 13px;
  color: #4e5969;
}
</style>

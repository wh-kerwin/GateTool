# 智能交易辅助与自动验证工具 设计文档（V1.0）

**产品名**：Gate Trade Advisor（交易辅助与验证模块）
**定位**：在「预测记录 + 自动验证」底座之上，增加**可解释的规则化推荐**与**推荐后自动验证闭环**
**原则**：只输出建议，不执行任何下单；推荐可配置、可追溯；验证标准确定性；依据验证结果自动调整策略权重

---

## 1. 与既有系统的关系

| 已有能力 | 新模块复用方式 |
| --- | --- |
| Gate REST / WebSocket 行情 | 推荐引擎直接复用 `marketService` 与 `gateRest` |
| 预测记录（Prediction） | 保留为"人工判断"通道；新模块为"系统建议"通道 |
| 自动验证调度（60s） | 同一调度器增加"推荐验证"任务 |
| 统计与复盘 | 新增推荐维度统计（胜率 / R 倍数 / MFE·MAE） |

> 合规边界：工具不连接任何交易 API、不下单、不托管资金；所有输出标注"策略回测/验证用，不构成投资建议"。

---

## 2. 推荐逻辑的输入依据

### 2.1 数据输入

| 类别 | 字段 | 来源 | 周期 |
| --- | --- | --- | --- |
| 价格 | 最新价、24h 高低、涨跌幅 | Gate ticker（WS 优先，REST 兜底） | 实时 |
| K 线 | O/H/L/C、成交量 | Gate `/futures/usdt/candlesticks` | 主周期可配：`15m / 30m / 1h / 4h`；确认周期自动高一级（`15m、30m → 1h`，`1h → 4h`，`4h → 1d`）；验证回放固定 1m |
| 合约指标 | funding_rate、mark_price、index_price | Gate futures ticker | 实时 |

### 2.2 派生指标

`EMA(7/25/99)`、`RSI(14)`、`ATR(14)`、`BOLL(20,2)`、`Donchian(20)` 高低、量能 `VOL/MA20`、资金费率。

### 2.3 评分因子（每个因子输出 `s ∈ [-1,1]`，正数偏多、负数偏空，0 为中性）

| 因子 code | 含义 | 计算 |
| --- | --- | --- |
| `TREND` | 均线与多周期趋势一致性 | EMA7>EMA25>EMA99 且价>EMA25 → +1（反向 −1）；1h 与 4h 同向 +0.5 加权 |
| `MOMENTUM` | RSI 与动量 | RSI<35 偏多、>65 偏空；叠加 ROC(12) 符号 |
| `BREAKOUT` | 突破 | 价 > Donchian20 高 → +1；价 < 低 → −1 |
| `BOLL` | 布林带 %B 位置 | `%B≤0.05` → +0.8（下轨反弹）；`%B≥0.95` → −0.8（上轨回落）；中间按 `(0.5−%B)×1.2`；带宽 <2% 视为收敛，提示假突破风险 |
| `SAR` | 抛物线转向 | `SAR 多头 且 价 > SAR` → +1；`SAR 空头 且 价 < SAR` → −1；反转过渡区取 0；刚发生反转时权重 ×0.6（方向不稳） |
| `VOLUME` | 量能确认（质量因子） | `VOL > MA20*1.2` → 1.0；≥1 → 0.7；否则 0.4 |
| `VOLATILITY` | 波动率适配 | ATR% 落在 `[0.2%, 1.2%]` 加分；过高（>2%）减分 |
| `FUNDING` | 资金费率（合约） | 费率 > 0.05% 多头拥挤 → 对 LONG 减分、SHORT 加分 |

### 2.4 方向、置信度与门槛

```text
net   = Σ (weight_i × s_i)          // s_i ∈ [-1,1]
norm  = net / Σ weight_i            // ∈ [-1,1]
direction = norm ≥ +dirThreshold ? LONG : norm ≤ −dirThreshold ? SHORT : NO_TRADE
confidence = |norm|                 // 0–1
score = round(|norm| × 100)         // 0–100
若 score < minScore → 强制 NO_TRADE（拒绝给建议）
```

### 2.4.1 参数

`BOLL(20,2)`、`SAR(step=0.02, maxStep=0.2)`，均可在策略参数中调整；默认权重：

```text
TREND 0.25 | MOMENTUM 0.20 | BOLL 0.15 | SAR 0.15 | BREAKOUT 0.15 | FUNDING 0.10
质量因子：VOLUME 0.5 | VOLATILITY 0.5（只缩放置信度，不决定方向）
```

### 2.5 止损 / 止盈 / 仓位 / 倍数（确定性公式）

```text
atrPct   = ATR / price × 100
stopPct  = max(slAtrMult × atrPct, minStopPct)          // 默认 1.5×ATR，下限 0.5%
SL       = price × (1 ∓ stopPct/100)                    // LONG 减、SHORT 加
TP       = price × (1 ± rr × stopPct/100)               // 默认 rr = 2（盈亏比 1:2）
leverage = clamp(round(targetVolPct / atrPct), 1, maxLeverage)   // 波动越大倍数越低
margin%  = riskPercent / (stopPct × leverage) × 100     // 保证金占净值比例
positionPercent = clamp(margin%, minPositionPercent, maxPositionPercent)
actualRisk = positionPercent × leverage × stopPct / 100 // 截断后的真实风险
```

---

## 2.6 LLM 辅助判断层（可选、可关闭、可失败）

**定位**：LLM 是"旁挂意见"，不参与止损/止盈/仓位/倍数计算，不修改确定性判定。

```text
规则引擎（确定性）──► 方向 / 评分 / 仓位 / 倍数
        ▲
        │ 加权融合 norm' = norm × (1 − w) + LLM倾向 × w   （w = llmWeight，默认 0.2）
        │
LLM（可选）──► { bias, confidence, rationale, risks }
```

| 环节 | 说明 |
| --- | --- |
| 输入 | 指标快照（EMA/RSI/ATR/BOLL/SAR/唐奇安/资金费率）+ 规则引擎各因子与打分 |
| 输出 | 严格 JSON：`{bias, confidence, rationale, risks}`，解析失败即降级 |
| 失败处理 | 超时/无 Key/返回不可解析 → 记录 `available:false` 与原因，**按规则结果继续**，不阻断生成 |
| 权重 | `llmWeight`（默认 0.2，可调至 0 = 只展示不干预方向）；`useLlm` 可整体关闭 |
| 复盘 | 验证完成后可调用 LLM 生成结果解读（`review` + `lessons`），仅解释结果，不修改 SUCCESS/FAIL |

配置：`.env` 中 `LLM_ENABLED / LLM_BASE_URL / LLM_API_KEY / LLM_MODEL / LLM_WEIGHT`（任意 OpenAI 兼容接口）。

---

## 3. 输出格式

```json
{
  "id": "rec_9f2c1a",
  "symbol": "BTC_USDT",
  "strategyId": "stg_trend_v1",
  "strategyVersion": 3,
  "direction": "LONG",
  "timeframe": "1h",
  "horizon": "4h",
  "referencePrice": 84120.5,
  "entryZone": { "low": 83980.0, "high": 84260.0 },
  "stopLoss": 83190.0,
  "takeProfit": 85980.0,
  "positionPercent": 12.5,
  "leverage": 3,
  "riskPercent": 1.0,
  "actualRiskPercent": 0.96,
  "rr": 2.0,
  "confidence": 0.68,
  "score": 68,
  "reasons": [
    { "code": "TREND", "weight": 0.25, "value": 1.0, "desc": "1h/4h 均线多头排列且趋势一致" }
  ],
  "riskNotes": ["ATR% = 0.42，波动偏低，倍数上限 10x 未触发"],
  "indicators": { "ema7": 84010, "ema25": 83650, "ema99": 82100, "rsi14": 58.3, "atr14": 352.1, "atrPct": 0.42 },
  "status": "OPEN",
  "createdAt": "2026-09-22T02:10:00Z",
  "expiresAt": "2026-09-22T06:10:00Z"
}
```

字段约束：`direction ∈ LONG|SHORT|NO_TRADE`；`positionPercent ∈ [1,25]`；`leverage ∈ [1, maxLeverage]`；`confidence ∈ [0,1]`。
`NO_TRADE` 时不输出止损止盈与仓位。

---

## 4. 验证机制

### 4.1 触发与流程

推荐生成即写入 `OPEN`，`expiresAt = createdAt + horizon`。调度器每 60s 扫描到期或已触发的推荐，用 **1m K 线逐根回放**判定，避免只用收盘价造成误判。

```text
生成推荐(OPEN) → 1m K线回放 → 先触 SL / 先触 TP / 均触发 / 到期未触发
             → 写入结果(MFE·MAE·R倍数) → 反馈前端 → 计入策略统计 → 触发权重自适应
```

### 4.2 判定标准

| 结果 | 条件 | 判定 |
| --- | --- | --- |
| `TAKE_PROFIT` | 窗口内先触及 TP | SUCCESS |
| `STOP_LOSS` | 窗口内先触及 SL | FAIL |
| `BOTH_SAME_BAR` | 同一根 1m K 线同时穿越 SL 与 TP | 保守判 FAIL |
| `TIMEOUT_WIN` | 到期未触发且方向收益 > 0 | SUCCESS（可配 `timeoutAsSuccess`） |
| `TIMEOUT_LOSS` | 到期未触发且方向收益 ≤ 0 | FAIL |
| `EXPIRED` | 行情缺失，重试 5 次仍失败 | 不计入统计 |

### 4.3 量化指标

```text
resultPercent = (exit − entry)/entry × 100 × dirSign      // 价格维度
pnlPercent    = resultPercent × leverage                  // 保证金维度收益
MFE = 窗口内最大有利波动%（价格维度）
MAE = 窗口内最大不利波动%（价格维度）
R   = pnlPercent / stopPct                                // 盈亏比（R 倍数）
```

### 4.4 反馈方式

1. **实时推送**：WS `/ws` 推送 `signal_verified` 事件，前端弹出结果卡片；
2. **结果回写**：推荐详情展示触发路径、MFE/MAE、R 倍数与逐根 K 线回放依据；
3. **用户主观反馈**：`adopted`（是否采纳）、`rating`（1–5）、`comment`，用于评估"建议可执行性"而非仅看行情结果；
4. **统计面板**：按标的 / 方向 / 周期 / 策略版本展示样本数、胜率、平均 R、平均 MFE/MAE；
5. **策略自适应**：达标样本触发权重调整并生成新版本（见第 5 节）。

---

## 5. 可配置、可追溯与动态调整

### 5.1 可配置（策略参数 `params`）

```json
{
  "timeframe": "1h", "horizon": "4h",
  "minScore": 55, "dirThreshold": 0.15,
  "riskPercent": 1.0, "targetVolPct": 1.5,
  "minStopPct": 0.5, "slAtrMult": 1.5, "rr": 2.0,
  "maxLeverage": 10, "minPositionPercent": 1, "maxPositionPercent": 25,
  "horizon": "4h", "timeoutAsSuccess": true,
  "bollPeriod": 20, "bollMult": 2, "sarStep": 0.02, "sarMaxStep": 0.2,
  "useLlm": false, "llmWeight": 0.2,
  "weights": { "TREND": 0.25, "MOMENTUM": 0.2, "BOLL": 0.15, "SAR": 0.15, "BREAKOUT": 0.15, "FUNDING": 0.1 },
  "qualityWeights": { "VOLUME": 0.5, "VOLATILITY": 0.5 }
}
```

修改参数 → 写入 `strategies` 表并 `version + 1`；历史推荐仍绑定生成时的版本与参数快照，保证可复现。

单次生成可用 `POST /api/signals/generate {symbol, timeframe, horizon, useLlm}` 覆盖默认周期（例如做 15m 趋势：主周期 15m + 验证周期 15m）。

### 5.2 可追溯

| 表 | 内容 |
| --- | --- |
| `strategies` | 策略参数与版本历史 |
| `recommendations` | 推荐全量字段 + `indicators`（指标快照）+ `params`（参数快照）+ `reasons` |
| `recommendation_events` | 状态流转与验证事件（生成 / 触发 / 到期 / 失败重试） |
| `feedbacks` | 用户主观反馈 |
| `factor_stats` | 因子级胜负样本与 R 累计（自适应的输入） |

### 5.3 动态调整（确定性、可解释、可回滚）

对每个因子统计"该因子主导时的历史表现"：

```text
samples(f) ≥ minSample(10) 时：
  winRate(f) = win(f) / (win(f) + lose(f))
  mult(f)    = clamp(winRate(f) / overallWinRate, 0.5, 1.8)
  w'(f)      = w(f) × mult(f)
  weights'   = 归一化(Σ w' = 1)
```

约束：

- 冷却期 `cooldownHours = 24`，避免频繁抖动；
- 单次调整幅度受 `[0.5, 1.8]` 限制，防止权重崩塌；
- 每次调整生成新版本并保留 `previousWeights`，支持一键回滚；
- 连续 2 个版本胜率下降则自动回滚到上一版本（`autoRollback`）。

---

## 6. 成功指标

| 类别 | 指标 | 目标 |
| --- | --- | --- |
| 覆盖 | 每条推荐生成后进入验证流程的比例 | 100% |
| 时效 | `expiresAt → verifiedAt` 延迟 | P95 ≤ 60s |
| 正确性 | 判定结果人工抽检一致性 | 100%（确定性规则） |
| 策略质量 | 滚动 30 条样本的 R 倍数均值 | > 0 |
| 自适应 | 触发权重调整后连续两版胜率 | 不下降（否则回滚） |
| 可追溯 | 推荐可完整复现（指标+参数+事件） | 100% |

---

## 7. 非目标

- 不接入交易 API、不自动下单、不托管资金；
- 不使用 LLM 生成方向或仓位（仅可选用于结果解读）；
- 不做跨交易所、不做资金曲线模拟（V3 再评估）。

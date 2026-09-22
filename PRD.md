# Gate BTC/ETH 预测查看与自动验证工具 PRD

| 项目 | 内容 |
| --- | --- |
| 产品名称 | Gate Prediction Tracker（BTC / ETH 版） |
| 文档版本 | V1.0 |
| 撰写日期 | 2026-09-21 |
| 产品定位 | 基于 Gate 行情的 BTC / ETH 预测记录与自动验证工具 |
| 数据来源 | Gate REST API + Gate WebSocket |
| 覆盖标的 | BTC_USDT、ETH_USDT（V1 仅此两个，架构支持后续扩展） |
| 核心模式 | Prediction → Observation → Verification → Evaluation |

一句话定位：

> **记录你对 BTC / ETH 的判断，让时间替你验证。**

---

## 1. 背景与问题

在分析 BTC / ETH 行情时，用户会不断产生诸如"BTC 1 小时内会突破 115,000""ETH 未来 30 分钟会回调""BTC 当前区间震荡不会破位"之类的判断。但现实中这些判断几乎不被记录，导致：

1. 无法知道当时为什么这么判断；
2. 无法复盘判断是否正确；
3. 无法统计自己在 BTC / ETH 上的长期预测准确率；
4. 无法区分"短周期擅长"与"长周期擅长"。

本工具不是交易工具，而是把上述口头判断结构化沉淀，并在到期时**自动用 Gate 真实行情做客观验证**，形成"预测 → 验证 → 统计 → 复盘"的闭环。

---

## 2. 目标与非目标

### 2.1 目标

1. 提供 BTC / ETH 的实时行情查看与预测数据展示；
2. 支持用户快速创建结构化预测（含方向、周期、理由）；
3. 到达验证时间后自动拉取 Gate 真实行情并判定成功/失败；
4. 沉淀历史预测数据，输出多维度准确率统计。

### 2.2 非目标（V1 明确不做）

- 自动交易 / 自动下单 / 止盈止损 / 跟单 / 资金管理
- 自动生成交易信号或诱导交易
- 多交易所、合约下单、社区、策略市场
- LLM 参与核心验证链路（验证必须是确定性规则计算）

---

## 3. 目标用户

| 用户类型 | 特征 | 核心诉求 | 使用频次 |
| --- | --- | --- | --- |
| 日内 / 短线合约交易者 | 盯盘 BTC、ETH，频繁产生方向判断 | 把"感觉"变成可验证记录，校正自己的盘感 | 高，每日数次至数十次 |
| 行情分析爱好者 | 关注 BTC / ETH 关键位突破，无高频交易 | 记录关键位判断，验证突破逻辑是否成立 | 中，每日 1–5 次 |
| 个人量化 / 策略研究者 | 有手工策略，需要小样本统计 | 积累自有预测样本，评估策略有效性 | 中，按策略触发 |
| 交易学习 / 复盘者 | 想提升判断能力 | 通过历史预测与准确率定位自己的弱点 | 低—中，周维度复盘 |

**主要用户画像（Primary Persona）**：个人加密交易者，日常看 Gate 上 BTC_USDT 与 ETH_USDT 的 15m / 1H / 4H K 线，习惯在盘中形成方向判断，但从未系统记录与验证。

---

## 4. 使用场景

### 场景 A：盘中出现突破判断（最高频）

1. 用户在 Dashboard 看到 BTC_USDT 报 115,234，15m 放量突破前高；
2. 点击"创建预测"，系统自动带入 Symbol 与当前价；
3. 用户选择 ↑ 看涨、周期 1H，填写理由"15m 放量突破前高，价格站上前高"；
4. 系统写入预测，自动生成 `verificationTime = 创建时间 + 1H`；
5. 1 小时后系统自动取 Gate 行情，判定 SUCCESS/FAIL 并推送结果卡片。

### 场景 B：ETH 区间震荡判断

用户认为 ETH 未来 4H 维持震荡。选择 → 震荡方向并设置 ±1% 容差（默认 1%，可调）。到期后若收盘价落在 4,188 ~ 4,274 区间内判定成功，突破区间判定失败。

### 场景 C：待验证任务追踪

用户创建多条不同周期预测后，在"待验证"页看到倒计时（如 `Remaining: 18m 32s`），随时掌握即将出结果的预测，避免重复或矛盾判断。

### 场景 D：周末复盘

用户在历史记录页按 Symbol / Timeframe / 结果筛选，查看 BTC 与 ETH 各自的预测表现与逐条详情（含窗口内 High/Low/Close 走势图），定位自己在短周期判断上的偏差。

### 场景 E：周期能力自检

在统计页对比 BTC / ETH × 15m / 30m / 1H / 4H 的样本数与成功率，判断自己更适合哪种周期与标的。

---

## 5. 核心功能

### 5.1 预测数据展示

#### 5.1.1 Dashboard（首页）

| 区块 | 内容 |
| --- | --- |
| 行情卡片 | BTC_USDT、ETH_USDT 实时价格、24h 涨跌幅、更新时间（WebSocket 推送） |
| 我的预测概览 | 今日预测数、已验证数、成功数、准确率 |
| 待验证预测 | 待验证列表（Symbol、方向、周期、创建/验证时间、倒计时） |
| 最近验证 | 最近 5 条已验证结果（✓/✕ + 实际涨跌幅） |

示意：

```text
┌─────────────────────────────────────────────┐
│ Gate Prediction Tracker                     │
├─────────────────────────────────────────────┤
│ BTC/USDT     115,234.5     +1.32%           │
│ ETH/USDT       4,231.2     -0.42%           │
├─────────────────────────────────────────────┤
│ 今日预测 12   已验证 8   正确 5   准确率 62.5%│
├─────────────────────────────────────────────┤
│ 待验证预测                                   │
│ BTC ↑  30m   Remaining: 18m 32s             │
│ ETH ↓  1H    Remaining: 47m 05s             │
└─────────────────────────────────────────────┘
```

#### 5.1.2 预测历史（Prediction History）

- 筛选维度：时间范围、Symbol（BTC/ETH）、方向、周期、结果、状态；
- 列表字段：预测时间、Symbol、方向、周期、入场价、结果价、涨跌幅、状态；
- 支持分页与导出（V1.1）。

| 时间 | Symbol | 方向 | 周期 | 入场价 | 结果 | 涨跌 |
| --- | --- | --- | --- | --- | --- | --- |
| 10:00 | BTC | ↑ | 30m | 115000 | ✓ | +0.52% |
| 09:30 | ETH | ↓ | 1H | 4230 | ✓ | -1.21% |
| 08:20 | BTC | ↑ | 4H | 115000 | ✕ | -0.82% |

#### 5.1.3 预测详情（Prediction Detail）

展示预测全量信息 + 验证窗口内的价格走势图（ECharts 折线/K 线），标注 Entry、Close、High、Low：

```text
BTC/USDT
预测时间 2026-09-21 10:00
验证周期 30m
预测方向 上涨
Entry    115,000
Close    115,600
Result   +0.52%
Status   SUCCESS
窗口 High 115,800 / Low 114,900
```

#### 5.1.4 统计页（Statistics）

- 总体：总预测数、已验证数、成功数、失败数、准确率；
- 维度交叉统计：Symbol × Timeframe 的样本数与成功率矩阵；
- 图表：按周期准确率柱状图、按标的准确率对比、累计准确率趋势。

### 5.2 创建预测

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| Symbol | Select | √ | BTC_USDT / ETH_USDT |
| 预测方向 | Radio | √ | ↑ 看涨 / ↓ 看跌 / → 震荡 |
| 当前价格 | 自动获取 | √ | 创建瞬间从 Gate 取价，写入 entry_price，同时存 market_snapshot |
| 预测目标价格 | Number | 可选 | V1.1 用于 TARGET_HIT 判定 |
| 震荡容差 | Number | 条件必填 | 方向为"震荡"时必填，默认 ±1% |
| 验证周期 | Select | √ | 15m / 30m / 1H / 4H |
| 预测理由 | Textarea | 可选 | 纯文本，用于复盘 |
| 创建时间 | 自动 | √ | prediction_time（服务端 UTC） |

校验规则：

- Symbol 必须在白名单内；
- direction = RANGE 时必须提供 `rangePercent` 且 `0 < rangePercent ≤ 10`；
- entry_price 获取失败时禁止创建（必须记录确定的入场价）；
- 同一 Symbol + 同一时间窗口内允许存在多条预测，但方向冲突时前端给出提示（不阻断）。

### 5.3 自动验证机制（核心）

#### 5.3.1 流程

```text
创建预测
   ↓ 计算 verification_time = prediction_time + timeframe
写入 DB（status=PENDING）
   ↓
Scheduler 每 60s 扫描 status=PENDING 且 verification_time <= now
   ↓ 加分布式锁
拉取 Gate 验证行情（WS 缓存 → REST ticker → REST K 线，逐级兜底）
   ↓
规则引擎计算 result_percent / high / low / status
   ↓
落库（status=SUCCESS/FAIL，verified_at）+ 写入验证行情快照
   ↓
Dashboard / 历史 / 统计 实时更新，前端提示新结果
```

#### 5.3.2 验证时间定义

`verification_time = prediction_time + timeframe`，以服务端时间为准。Scheduler 每分钟扫描一次，因此实际判定时间最多滞后 60s，UI 上以 `verified_at` 展示真实判定时刻，结果可追溯。

#### 5.3.3 验证数据取值（优先级）

1. WebSocket 实时 ticker 缓存（Redis）中该 Symbol 的最新价；
2. Gate REST ticker 接口最新成交价（缓存缺失时）；
3. Gate REST K 线接口 `verification_time` 所在周期的收盘价（用于补齐 high/low，并作为一致性校验）；
4. 三次重试仍失败 → 标记 `RETRY`，保留 PENDING，最多重试 5 次（约 5 分钟），仍失败则置为 `EXPIRED` 并在 UI 明示"行情缺失，未验证"。

#### 5.3.4 判定规则（确定性，无 LLM 参与）

定义：`pct = (close - entry_price) / entry_price × 100%`

| 方向 | 成功条件 | 失败条件 |
| --- | --- | --- |
| LONG（↑） | `pct > 0` | `pct ≤ 0`（pct = 0 记为 FAIL，附注 FLAT） |
| SHORT（↓） | `pct < 0` | `pct ≥ 0`（pct = 0 记为 FAIL，附注 FLAT） |
| RANGE（→） | `abs(pct) ≤ rangePercent` | `abs(pct) > rangePercent` |

示例：

```text
10:00  BTC = 115,000，预测 30m 上涨
10:30  BTC = 115,600
pct = (115600 - 115000) / 115000 = +0.52%  →  SUCCESS
```

V1.1 扩展：

- **目标价验证**：LONG 且窗口内 `high ≥ targetPrice` → `TARGET_HIT`；SHORT 且 `low ≤ targetPrice` → `TARGET_HIT`；未触及 → `TARGET_MISS`（与 SUCCESS/FAIL 并列记录，不覆盖方向判定）。
- **窗口极值**：记录验证窗口内 High / Low / Close，输出最高涨幅 `(+1.74%)`、最大不利波动 `(-0.69%)`、最终涨幅 `(+1.04%)`。

#### 5.3.5 状态机

```text
PENDING ──行情缺失重试──► PENDING(RETRY++)
   │
   ├─ 正常验证 ──► SUCCESS / FAIL
   └─ 超过重试上限 ──► EXPIRED
```

| 状态 | 含义 |
| --- | --- |
| PENDING | 已创建，等待到达验证时间 |
| SUCCESS | 已完成验证，预测成立 |
| FAIL | 已完成验证，预测不成立 |
| EXPIRED | 行情数据不可用，未能验证（不计入准确率分母） |

#### 5.3.6 幂等与并发

- 验证任务通过 Redis 分布式锁（key = `verify:lock:{predictionId}`）保证单条预测只被验证一次；
- `verification_time <= now AND status = PENDING` 的查询加行锁，避免重复消费；
- 验证结果写入后不再变更，保证复盘数据不可篡改。

### 5.4 行情数据服务

- **WebSocket**：订阅 Gate ticker / kline 频道，维护 BTC_USDT、ETH_USDT 最新价，写入 Redis（`{SYMBOL}_PRICE`），前端经后端 WS 网关推送；
- **REST**：用于历史 K 线、数据补偿、验证取值与系统启动初始化；
- 断线自动重连 + 指数退避；WS 断连期间由 REST 轮询兜底（30s 一次），前端展示"数据延迟"标识。

---

## 6. 输入 / 输出定义

### 6.1 用户输入（创建预测）

```http
POST /api/predictions
```

```json
{
  "symbol": "BTC_USDT",
  "direction": "LONG",
  "timeframe": "1h",
  "targetPrice": 116000,
  "rangePercent": null,
  "reason": "15m 放量突破前高，价格站上前高"
}
```

字段约束：

| 字段 | 类型 | 取值域 |
| --- | --- | --- |
| symbol | string | `BTC_USDT` \| `ETH_USDT` |
| direction | enum | `LONG` \| `SHORT` \| `RANGE` |
| timeframe | enum | `15m` \| `30m` \| `1h` \| `4h` |
| targetPrice | number? | > 0（V1 仅存储，V1.1 参与判定） |
| rangePercent | number? | 0 < x ≤ 10，direction=RANGE 时必填 |
| reason | string? | ≤ 500 字符 |

### 6.2 系统自动采集输入

| 输入 | 来源 | 用途 |
| --- | --- | --- |
| entry_price | Gate REST ticker（创建瞬间） | 验证基准价 |
| market_snapshot | Gate REST ticker + 当前 K 线 | 保存预测时的 price / volume / open / high / low |
| 实时价格 | Gate WebSocket ticker | Dashboard 展示、Redis 缓存 |
| 验证行情（close/high/low） | WS 缓存 → REST ticker → REST K 线 | 验证计算 |
| prediction_time / verification_time | 服务端 UTC 时间 | 时间基准 |

### 6.3 系统输出

**单条预测详情输出**

```json
{
  "id": "prd_01J9X...",
  "symbol": "BTC_USDT",
  "direction": "LONG",
  "timeframe": "1h",
  "entryPrice": 115000.0,
  "predictionTime": "2026-09-21T10:00:00Z",
  "verificationTime": "2026-09-21T11:00:00Z",
  "status": "SUCCESS",
  "resultPrice": 115600.0,
  "resultPercent": 0.52,
  "highPrice": 115800.0,
  "lowPrice": 114900.0,
  "verifiedAt": "2026-09-21T11:00:42Z",
  "reason": "15m 放量突破前高，价格站上前高"
}
```

**列表查询输出（GET /api/predictions）**：分页数组 + `total / page / pageSize`，支持 `symbol / direction / timeframe / status / startDate / endDate` 过滤。

**统计输出（GET /api/statistics）**

```json
{
  "total": 128,
  "verified": 103,
  "success": 67,
  "fail": 36,
  "expired": 1,
  "accuracy": 65.05,
  "breakdown": [
    { "symbol": "BTC_USDT", "timeframe": "15m", "sample": 32, "accuracy": 68.75 },
    { "symbol": "ETH_USDT", "timeframe": "30m", "sample": 18, "accuracy": 44.44 }
  ]
}
```

准确率定义：`accuracy = success / (success + fail) × 100%`，`PENDING` 与 `EXPIRED` 不计入分母；样本数 < 10 时 UI 标注"样本不足"。

**前端输出**：Dashboard 卡片、待验证倒计时、历史表格、详情走势图、统计图表、验证完成提示。

---

## 7. 数据模型

```typescript
interface Prediction {
  id: string
  userId: string
  symbol: 'BTC_USDT' | 'ETH_USDT'
  direction: 'LONG' | 'SHORT' | 'RANGE'
  entryPrice: number
  targetPrice?: number
  rangePercent?: number
  timeframe: '15m' | '30m' | '1h' | '4h'
  predictionTime: string
  verificationTime: string
  reason?: string
  status: 'PENDING' | 'SUCCESS' | 'FAIL' | 'EXPIRED'
  resultPrice?: number
  resultPercent?: number
  highPrice?: number
  lowPrice?: number
  verifiedAt?: string
  createdAt: string
  updatedAt: string
}
```

主要数据表：

| 表 | 用途 | 关键字段 |
| --- | --- | --- |
| users | 用户 | id, username, email, created_at |
| predictions | 预测主体 | 见上述结构 |
| market_snapshots | 预测创建时的行情快照 | prediction_id, price, volume, open, high, low, timestamp |
| verification_snapshots | 验证时点的行情快照 | prediction_id, close, high, low, source, timestamp |

Redis 用途：实时价格缓存、Scheduler 分布式锁、预测待验证队列、API 缓存。

---

## 8. 技术架构（概要）

```text
Gate API (REST + WebSocket)
        │
        ▼
Backend（NestJS）
├─ GateModule        行情接入 / 限流 / 重连
├─ MarketModule      实时价与 K 线服务
├─ PredictionModule  预测 CRUD
├─ VerificationModule 规则引擎（确定性）
├─ SchedulerModule   每分钟扫描待验证任务
└─ StatisticsModule  多维统计
        │
   PostgreSQL + Redis
        │
   Vue3 前端（Arco Design Vue + ECharts + Pinia）
```

技术选型：Vue 3 + TypeScript + Vite + Arco Design Vue + Pinia + ECharts；后端 NestJS + TypeScript + Prisma；PostgreSQL + Redis；`@nestjs/schedule` 定时任务（后续可升级 BullMQ）；Docker + Nginx 部署；Swagger 文档。

---

## 9. 成功指标

### 9.1 业务指标（上线后 4 周内观测）

| 指标 | 定义 | 目标 |
| --- | --- | --- |
| 北极星指标 | 每周完成自动验证的预测条数 | 单活跃用户 ≥ 20 条 / 周 |
| 预测创建活跃度 | 有创建预测行为的天数 / 观测天数 | ≥ 60% |
| 验证完成率 | 已验证数 / (已验证数 + EXPIRED 数) | ≥ 99% |
| 功能闭环率 | 创建后成功出具验证结果的预测占比 | ≥ 95% |
| 次周留存 | 第 2 周仍有创建预测行为的用户占比 | ≥ 50% |
| 复盘使用度 | 周内访问过统计页 / 历史页的用户占比 | ≥ 40% |

### 9.2 技术指标

| 指标 | 目标 |
| --- | --- |
| 验证触发延迟（verification_time → verified_at） | P95 ≤ 60s，P99 ≤ 120s |
| 行情数据可用率 | ≥ 99.5%（WS 断连由 REST 兜底） |
| 验证结果正确性 | 人工抽检 100% 与规则一致（确定性计算，零偏差） |
| Dashboard 实时价更新延迟 | ≤ 3s |
| API 响应时间 | P95 ≤ 300ms |
| 前端首屏加载 | ≤ 2s |
| 重复验证率 | 0（幂等 + 分布式锁） |

### 9.3 用户价值指标（定性）

- 用户能明确说出"BTC 15m 我的成功率是多少"；
- 用户能基于历史数据发现自己擅长/不擅长的周期与标的；
- 用户在创建预测时会主动填写理由（复盘素材覆盖率 ≥ 50%）。

---

## 10. 异常与边界处理

| 场景 | 处理策略 |
| --- | --- |
| 创建预测时取价失败 | 阻断创建，提示"行情获取失败，请重试" |
| WS 断连 | 自动重连 + REST 轮询兜底，前端显示"数据延迟" |
| 验证时行情缺失 | 重试 5 次（约 5 分钟），仍失败置 EXPIRED，不计入准确率 |
| 验证时刻价格为 0 变化（pct = 0） | LONG/SHORT 判定 FAIL，附注 FLAT |
| Gate API 限流 | 令牌桶限流 + 退避重试，验证任务优先级高于展示类请求 |
| 服务重启 | 重启后 Scheduler 立即补偿扫描过期未验证的 PENDING 记录 |
| 时间基准 | 全部以服务端 UTC 存储，前端按本地时区展示 |

---

## 11. 版本规划与优先级

**MVP（V1.0）**

P0：Gate 行情接入 → 预测 CRUD → Scheduler → 验证引擎 → 历史记录 → 基础统计。
页面：Dashboard、创建预测、待验证、历史、详情、统计。
范围：仅 BTC_USDT / ETH_USDT；15m / 30m / 1H / 4H；方向涨跌震荡；Docker 部署。

**P1（V1.1）**：目标价 TARGET_HIT 判定、窗口 High/Low 极值分析、K 线图表、市场快照指标（RSI/EMA，只读展示）、置信度与标签。

**P2（V2）**：LLM 能力接入——自然语言创建预测（NL → 结构化）、验证后自动复盘解读。注意：LLM 只能解释结果，不得修改 SUCCESS/FAIL 判定。

**P3（V3）**：Prediction Profile 个人预测画像，输出样本数、成功率、平均幅度、最大不利波动等客观指标（不使用星级下结论）。

---

## 12. 核心风险

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 用户误把工具当交易信号源 | 产品定位偏离、合规风险 | 全站明示"非交易工具、不构成投资建议"，不提供任何下单入口 |
| Gate 行情波动/接口变更 | 验证数据错误 | 双源校验（ticker vs K 线 close）、异常值告警、数据快照留痕 |
| 样本量过小导致统计失真 | 结论误导 | 样本 < 10 时标注"样本不足"，不展示结论性文案 |
| 用户中途修改预测 | 复盘失真 | 预测一经创建不可编辑，仅允许作废（标记 EXPIRED 并保留痕迹） |

---

## 13. 附：术语表

| 术语 | 含义 |
| --- | --- |
| Prediction | 用户对某标的在指定周期内的方向性判断 |
| Entry Price | 预测创建时刻的 Gate 实时价，验证基准 |
| Verification Time | prediction_time + timeframe，自动验证触发时点 |
| Result Percent | (close − entry) / entry × 100%，验证核心指标 |
| Timeframe | 验证周期：15m / 30m / 1H / 4H |
| Range Percent | 震荡预测的容差带（默认 ±1%） |
| Accuracy | success / (success + fail) × 100% |

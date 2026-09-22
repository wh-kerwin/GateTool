# Gate Prediction Tracker

> 记录你对 BTC / ETH 的市场判断，让时间替你验证。

基于 Gate 行情的 **BTC / ETH 预测记录与自动验证工具**：连接 Gate 合约/现货行情 → 记录自己的预测 → 到达 15m / 30m / 1H / 4H 验证时间 → 自动拉取真实行情 → 判定预测是否正确 → 沉淀准确率与历史表现。

**本工具不做任何交易、不下单、不给信号，仅用于记录与验证个人判断。**

---

## 1. 快速开始

环境要求：**Node.js ≥ 22.5**（用到内置 `node:sqlite`，无需安装数据库）。

```bash
# 1. 安装依赖（根工作区，会同时安装前后端）
npm install

# 2. 可选：复制并按需修改配置
cp .env.example .env

# 3. 启动（后端 8787 + 前端 5173）
npm run dev
```

浏览器打开：

- 前端开发地址：<http://localhost:5173>
- 后端 API：<http://localhost:8787/api/health>

**生产模式**（单进程同时提供前端静态资源与 API）：

```bash
npm run build     # 构建前端到 apps/web/dist
npm start         # 启动后端，访问 http://localhost:8787
```

**冒烟测试**（后端运行后执行，覆盖行情接入 / 创建预测 / 自动验证 / 统计）：

```bash
npm run smoke
```

---

## 2. 我需要注册 Gate 账号或申请 API Key 吗？

**V1 版本：不需要。** 工具只使用 Gate 的**公开行情接口**（ticker、K 线、WebSocket 行情推送），这类接口无需账号、无需 API Key、无需 KYC，可直接访问。

只有当你未来要接入**私有数据**（账户资产、持仓、下单等）时，才需要 API Key。若届时确需申请，步骤如下：

1. 注册 Gate 账号：<https://www.gate.com/> → 邮箱/手机号注册 → 完成安全设置（2FA）。
2. 完成身份验证（KYC）：账号中心 → 身份验证，按提示提交证件与人脸核验。
3. 创建 API Key：右上角头像 → **API 管理** → 创建 API v4 密钥。
4. 权限设置：**只勾选「只读 / 查询」类权限**，切勿勾选交易、提现、划转权限。
5. 绑定 IP 白名单：填写你运行本工具的公网出口 IP。
6. 保存并妥善保管 `API Key` 与 `API Secret`（Secret 只显示一次）。
7. 写入 `.env`（**当前版本不会读取，仅为后续扩展预留**）：

   ```env
   GATE_API_KEY=你的Key
   GATE_API_SECRET=你的Secret
   ```

   切勿把 `.env` 提交到 Git（已在 `.gitignore` 中忽略）。

> 提醒：本工具定位是"预测记录 + 自动验证"，不需要也不应该开交易权限的 API Key。

---

## 3. 配置项（`.env`）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 后端端口 |
| `GATE_REST_BASE` | `https://api.gateio.ws/api/v4` | Gate REST 基地址 |
| `GATE_WS_URL` | 留空自动选择 | `futures → wss://fx-ws.gateio.ws/v4/ws/usdt`；`spot → wss://api.gateio.ws/ws/v4/` |
| `GATE_MARKET` | `futures` | `futures`=USDT 永续合约（默认）；`spot`=现货 |
| `SYMBOLS` | `BTC_USDT,ETH_USDT` | 支持的交易对 |
| `DB_PATH` | `./data/gate-tracker.db` | SQLite 数据文件 |
| `VERIFY_INTERVAL_MS` | `60000` | 自动验证扫描间隔 |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `LLM_ENABLED` | `false` | 是否启用 LLM 辅助判断 |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | 任意 OpenAI 兼容接口 |
| `LLM_API_KEY` | 空 | LLM Key（留空则自动降级为纯规则） |
| `LLM_MODEL` | `gpt-4o-mini` | 模型名 |
| `LLM_WEIGHT` | `0.2` | LLM 意见在方向评分中的权重（0 = 只展示） |

> 若你所在网络访问 `api.gateio.ws` 不稳定，可把 `GATE_REST_BASE` 换成可访问的 Gate 镜像域名。

---

## 4. 功能一览

| 模块 | 能力 |
| --- | --- |
| 总览 Dashboard | BTC/ETH 实时价格（WebSocket 推送）、今日预测数、已验证数、正确数、准确率、待验证倒计时、最近验证结果 |
| 创建预测 | 标的（BTC/ETH）、方向（看涨/看跌/震荡）、周期（15m/30m/1H/4H）、自动获取入场价、目标价、预测理由、预计验证时间 |
| 待验证 | 倒计时列表、手动触发验证扫描、作废预测 |
| 预测历史 | 按标的/方向/周期/状态/时间范围筛选，分页查看，跳转详情，作废 |
| 预测详情 | 全量字段、验证窗口价格走势图（含 Entry/Target 标线）、创建与验证时刻的行情快照 |
| 统计分析 | 总样本/已验证/正确/错误/准确率，按周期、按标的、按方向的准确率图表，标的 × 周期矩阵（样本 < 10 标注"样本不足"） |

### 自动验证机制

```text
创建预测 → 计算 verification_time = prediction_time + 周期
        → 写入 DB（PENDING）
        → 调度器每 60s 扫描 PENDING 且已到期的记录
        → 拉取 Gate 行情（WS 缓存 → REST ticker → REST K 线逐级兜底）
        → 规则引擎判定 → SUCCESS / FAIL
        → 落库 + 推送前端 + 计入统计
```

判定规则（`pct = (close − entry) / entry × 100%`）：

| 方向 | 成功 | 失败 |
| --- | --- | --- |
| 看涨 LONG | `pct > 0` | `pct ≤ 0` |
| 看跌 SHORT | `pct < 0` | `pct ≥ 0` |
| 震荡 RANGE | `abs(pct) ≤ rangePercent`（默认 ±1%） | `abs(pct) > rangePercent` |

- 状态机：`PENDING → SUCCESS / FAIL`，行情不可用重试 5 次后 → `EXPIRED`（不计入准确率分母）。
- 判定完全由确定性规则完成，**不引入 LLM**；验证结果写入后不可变更，保证复盘数据可信。
- 幂等：进程内锁 + 状态校验，保证一条预测只被验证一次。

---

## 5. 智能交易辅助模块（Gate Trade Advisor）

在"人工预测 + 自动验证"之外，增加了**规则化推荐 + 推荐后自动验证**：自动给出做多/做空时机、建议仓位百分比与倍数，并在生成后自动回放 K 线验证。详见 `ADVISOR_DESIGN.md`。

### 5.1 推荐逻辑输入

- 行情：Gate 多周期 K 线（主周期可配 `15m / 30m / 1h / 4h`，确认周期自动高一级，验证回放 1m）+ 实时 ticker + 资金费率
- 短周期用法：做 15m 趋势时选「主周期 15m + 验证周期 15m」，确认周期自动取 1h
- 指标：`EMA(7/25/99)`、`RSI(14)`、`ATR(14)`、`BOLL(20,2)`（含 %B 与带宽）、`Parabolic SAR(0.02, 0.2)`、`Donchian(20)`、量能 `VOL/MA20`
- 方向性因子：`TREND` / `MOMENTUM` / `BOLL` / `SAR` / `BREAKOUT` / `FUNDING`
- 质量因子（只缩放置信度）：`VOLUME` / `VOLATILITY`

### 5.2 输出

```json
{
  "direction": "LONG",
  "referencePrice": 84120.5,
  "entryZone": { "low": 83980.0, "high": 84260.0 },
  "stopLoss": 83190.0,
  "takeProfit": 85980.0,
  "positionPercent": 12.5,
  "leverage": 3,
  "riskPercent": 1.0,
  "actualRiskPercent": 0.96,
  "confidence": 0.68,
  "score": 68,
  "reasons": { "factors": [], "riskNotes": [], "llm": {} }
}
```

仓位与倍数由确定性公式给出：`leverage = clamp(round(目标波动 / ATR%), 1, maxLeverage)`，`保证金% = 单笔风险 / (止损幅度% × 倍数)`，并受仓位上下限约束。

### 5.3 验证与反馈

- 生成即写入 `OPEN`，到期时间 = 生成时间 + 验证周期（默认 4h）
- 调度器每 60s 用 **1m K 线逐根回放**：先触止损 / 先触止盈 / 同根双触（保守判失败）/ 到期按收益符号
- 记录 `MFE`、`MAE`、`R 倍数`，结果经 WebSocket `signal_verified` 推送前端
- 用户可提交 `adopted / rating / comment` 主观反馈

### 5.4 决策模式（`mode`）

| 模式 | 说明 |
| --- | --- |
| `llm` | **LLM 主导**：不看规则因子，LLM 直接依据 K 线与指标给出方向、止损止盈、倍数、仓位与 30m/1h 涨跌预测（当前默认） |
| `hybrid` | 规则打分 + LLM 倾向按 `llmWeight` 加权融合 |
| `rule` | 纯规则因子（BOLL/SAR/EMA/RSI/ATR…），完全不调用 LLM |

LLM 主导模式的输入输出：

- 输入：当前价、EMA/RSI/ATR/BOLL/SAR/唐奇安/量能/资金费率 + 最近 30 根主周期 K 线（OHLCV）+ 周期列表
- 输出（严格 JSON）：`direction(LONG/SHORT/RANGE)`、`confidence`、`entryZone`、`stopLoss`、`takeProfit`、`leverage`、`positionPercent`、`forecasts{30m,1h}`、`rationale`、`risks`
- **确定性护栏**：方向非取值域内 → RANGE；倍数截断到 `maxLeverage`；止损方向不合理 → 按 ATR 重算；仓位按 `单笔风险/(止损幅度×倍数)` 再截断，保证单笔亏损不超过目标风险；所有修正写入 `warnings`
- LLM 不可用时（可配 `llmFallback`）回退规则引擎并明确标记
- 30m/1h 涨跌预测会在到期验证时自动回测，结果写入 `verifiedDetail.forecastCheck`（预测/实际/是否命中）

### 5.5 LLM 配置（可选）

任意 OpenAI 兼容接口，在 `.env` 中配置：

```env
LLM_ENABLED=true
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-xxx
LLM_MODEL=gpt-4o-mini
LLM_WEIGHT=0.2
```

- 生成推荐时：`norm' = norm × (1 − w) + LLM倾向 × w`，`w=0` 时只展示不干预方向
- 验证完成后：可生成复盘解读（只解释结果，不修改判定）
- **失败自动降级**：未配置 / 超时 / 返回不可解析时记录原因，按规则结果继续执行

### 5.6 可配置与动态调整

- 策略参数（阈值、权重、风险、SAR/BOLL 参数、LLM 权重）可在前端"策略配置"中修改，保存即生成新版本，历史推荐仍绑定旧快照
- 每次验证后累计因子级胜负样本；满足样本量与冷却期后按 `因子胜率 / 整体胜率`（限制 0.5–1.8）调整权重并归一化，新版本表现劣化时自动回滚

### 5.7 相关接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/signals/config` | 策略参数与默认配置 |
| GET | `/api/signals/llm/status` | LLM 启用状态 |
| POST | `/api/signals/analyze` | 只分析不入库 |
| POST | `/api/signals/generate` | 生成推荐并入库验证 |
| GET | `/api/signals` | 推荐列表 |
| GET | `/api/signals/:id` | 详情（含事件流与反馈） |
| POST | `/api/signals/:id/verify` | 手动验证单条 |
| POST | `/api/signals/:id/review` | LLM 复盘 |
| POST | `/api/signals/:id/feedback` | 主观反馈 |
| GET | `/api/signals/statistics` | 胜率 / 平均 R / 分组统计 |
| GET/PUT | `/api/signals/strategies` | 策略参数读写（PUT 生成新版本） |
| POST | `/api/signals/strategies/:id/adapt` | 触发权重自适应 |

冒烟测试：

```bash
npm run smoke          # 预测记录与验证
npm run smoke:advisor  # 交易辅助（BOLL/SAR、推荐生成、回放验证、策略自适应）
```

---

## 6. 部署到 Vercel

Vercel 是无服务器环境（无常驻进程 / 无服务端 WebSocket / 文件系统不可持久化），因此做了以下适配：

| 本地（长驻进程） | Vercel（Serverless） |
| --- | --- |
| SQLite 文件 | `DATABASE_URL` 指向 Postgres（Vercel Postgres / Neon / Supabase） |
| 常驻调度器每 60s | Vercel Cron 每 10 分钟调用 `/api/cron/verify` |
| 后端维持 Gate WebSocket 并广播 | 浏览器直连 Gate WebSocket（`VITE_GATE_WS_URL`），行情按需走 REST |
| Express 监听端口 | `api/index.js` 作为 Serverless Function，`vercel.json` 把 `/api/*` 重写到它 |

### 6.1 部署步骤

1. **创建数据库**：Vercel 控制台 → Storage → Postgres → Create → 连接后复制 `DATABASE_URL`
   （也可用 Neon / Supabase 的免费 Postgres，把连接串填到环境变量）
2. **推送代码**：`git add . && git commit -m "deploy" && git push`
3. **导入项目**：Vercel → Add New → Project → 选择该仓库（框架选 Other，构建命令会自动读 `vercel.json`）
4. **配置环境变量**（Project → Settings → Environment Variables）：

   | 变量 | 值 |
   | --- | --- |
   | `DATABASE_URL` | Postgres 连接串（必填） |
   | `LLM_ENABLED` | `true`（要用 LLM 主导模式时） |
   | `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 你的 LLM 接口（如 `https://apihub.agnes-ai.com/v1`） |
   | `GATE_MARKET` | `futures`（默认）或 `spot` |
   | `SYMBOLS` | `BTC_USDT,ETH_USDT` |

   > 不要提交 `.env`；前端直连 WS 的配置已写在 `apps/web/.env.production`。

5. **Deploy**：构建会执行 `npm run build`（前端）+ 打包 `api/index.js` 函数
6. **验证**：访问 `https://<你的域名>/api/health` 返回 `{"ok":true}`；首次请求会自动建表
7. **定时任务**：`vercel.json` 中已配置每 10 分钟调用 `/api/cron/verify`（预测 + 推荐验证 + 权重自适应）。
   Hobby 计划若未开放 Cron，可用 cron-job.org 之类的外部定时器访问同一个地址（GET 即可）

### 6.2 无服务器环境下的行为差异

- 页面实时价格来自浏览器直连 Gate；后端 `/api/market/tickers` 会按需用 REST 补齐
- 验证由 Cron 触发，最长延迟 = Cron 间隔（默认 10 分钟），而非本地的 60s
- 数据全部存 Postgres，本地 SQLite 数据不会自动迁移（可用 `pg` 手动导入）

---

## 7. 目录结构

```text
gate-prediction-tracker/
├── apps/
│   ├── server/                 # 后端（Node ESM + Express）
│   │   └── src/
│   │       ├── index.js        # 启动入口、HTTP + WebSocket 网关
│   │       ├── config.js       # 环境与常量
│   │       ├── db.js           # SQLite 建表与连接
│   │       ├── scheduler.js    # 自动验证调度
│   │       ├── gate/           # Gate REST / WebSocket 客户端
│   │       ├── indicators.js   # EMA / RSI / ATR / BOLL / SAR / 量能
│       ├── services/       # market / prediction / verification / statistics
│       │   └── advisor/    # strategy(权重与版本) / engine(推荐) / verify(回放验证) / llm(辅助判断)
│   │       └── routes/         # REST API
├── api/index.js                # Vercel Serverless 入口（所有 /api/* 重写到这里）
├── vercel.json                 # Vercel 构建 / 重写 / Cron 配置
│   └── web/                    # 前端（Vue3 + Vite + Arco + ECharts）
│       └── src/
│           ├── views/          # Dashboard / Create / Pending / History / Detail / Statistics
│           ├── components/     # 价格卡片、预测表格、走势图
│           ├── stores/         # Pinia（行情 WS 状态）
│           ├── api/            # Axios 封装
│           └── utils/          # 格式化与倒计时
├── scripts/smoke.mjs           # 冒烟测试
├── data/                       # SQLite 数据（自动生成，已 gitignore）
└── .env.example
```

### 主要接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 + 行情连接状态 |
| GET | `/api/config` | 标的、周期、方向等元信息 |
| GET | `/api/market/tickers` | BTC/ETH 实时行情 |
| GET | `/api/market/candles?symbol=&interval=&limit=` | K 线 |
| POST | `/api/predictions` | 创建预测 |
| GET | `/api/predictions` | 列表（支持 symbol/direction/timeframe/status/startDate/endDate/page/pageSize） |
| GET | `/api/predictions/pending` | 待验证列表 |
| GET | `/api/predictions/:id` | 详情（含行情快照） |
| POST | `/api/predictions/:id/cancel` | 作废 |
| POST | `/api/predictions/:id/verify` | 手动触发单条验证 |
| GET | `/api/statistics` | 统计 |
| POST | `/api/verifications/run` | 立即执行一次验证扫描 |
| WS | `/ws` | 实时行情与验证结果推送 |

---

## 8. 与 PRD 技术选型的差异说明

PRD 建议 NestJS + PostgreSQL + Redis + Docker。为了做到"个人可长期维护、开箱即跑"，当前实现做了等价替换，核心逻辑（预测 → 验证 → 统计）完全一致：

| PRD | 当前实现 | 迁移方式 |
| --- | --- | --- |
| PostgreSQL | Node 内置 SQLite（`data/gate-tracker.db`） | 表结构已按关系型设计，`db.js` 换成 Prisma/PG 即可 |
| Redis | 进程内价格缓存 + 验证任务锁 | 单机足够；多实例时替换为 Redis 锁 |
| NestJS | Express + 分层 service | 目录已按 Module 语义拆分 |
| Docker | 可选，未引入 | 需要时加 `docker-compose.yml` 打包 `npm start` |

---

## 9. 常见问题

- **行情没有更新**：查看后端日志是否出现 `Gate WS 已连接`；未连接时系统会用 REST 每 30s 兜底刷新，页面会显示"行情未连接"。
- **想看现货价格**：`.env` 设置 `GATE_MARKET=spot` 后重启后端。
- **时间显示**：数据库统一存 UTC，前端按本地时区展示。
- **清空数据**：删除 `data/` 目录后重启后端（会重建表）。
- **端口占用**：修改 `.env` 的 `PORT`，前端代理目标通过 `VITE_API_TARGET` 指定。

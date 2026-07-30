# MetaTFT `current_stats` 第二阶段验收报告

日期：2026-07-29（Asia/Shanghai）

> 后续注册式架构重构、scope availability 与最新真实 HTTP/Browser 结果见
> `docs/current-stats-architecture-and-browser-e2e-report-2026-07-29.md`。
> 本文保留为第二阶段实现时点记录，其中 HTTP 数量等动态数据不再代表最新运行。

## 一、结论

- 状态：**已完成本次提出的五项补齐工作**。
- 已形成的链路：

  ```text
  Windows Task Scheduler / CLI
  → 防并发锁、失败重试、manifest、可选 webhook 告警
  → 真实 MetaTFT
  → meta_snapshot + trend_snapshot + unit_stats + 全量 comp_stats
  → KnowledgeDocument 校验
  → contentHash / recordHash 分离
  → SQLite current_stats
  → season + patch + rank + timeWindow + region 隔离
  → Router 按需召回
  → HTTP Hybrid 回答
  → 前端证据面板显示统计范围和更新时间
  ```

- 精确装备、固定条件类问题仍以本轮 MetaTFT 结构化 `QueryResult` 为第一权威，不会默认召回 `current_stats`。
- 当前统计文档共 **121 篇**：`meta_snapshot=1`、`trend_snapshot=1`、`unit_stats=62`、`comp_stats=57`。
- `comp_stats` 默认由 50 篇改为全量；当前真实上游 57 个可用候选均已生成。

## 二、现有代码证据

### 1. 自动调度、重试、manifest、告警和并发锁

- `src/knowledge/current-stats-job-runner.js`
  - `runCurrentStatsJob`
  - 使用原子 `wx` 文件锁，同一任务并发时第二个任务返回 `skipped_locked`。
  - 支持陈旧锁恢复、指数退避重试、原子写入 manifest。
  - 保存 `lastRun`、`lastSuccess`、`lastFailure` 和最近 30 次历史。
  - 所有重试失败后，可向 `CURRENT_STATS_ALERT_WEBHOOK` 发送 JSON 告警。
- `scripts/schedule-metatft-current-stats.mjs`
  - 默认执行一次受保护的 `stats:generate`。
  - `--daemon` 模式按 `CURRENT_STATS_DAILY_AT` 每日执行。
- `scripts/install-current-stats-task.ps1`
  - 安装 Windows Task Scheduler 任务。
  - `MultipleInstances=IgnoreNew`，并配置两次系统级重启；应用内部文件锁形成第二层并发保护。
- `scripts/run-current-stats-daily.cmd`
  - 计划任务入口，输出追加至 `.cache/current-stats/scheduler.log`。
- `scripts/current-stats.cron.example`
  - Linux cron 示例。
- `package.json`
  - `stats:generate`
  - `stats:daily`
  - `stats:scheduler`
  - `stats:schedule:windows`

### 2. `trend_snapshot`

- `src/knowledge/metatft-document-generator.js`
  - `buildTrendSnapshotDocument`
  - 基于真实阵容趋势结果生成一篇稳定 ID 的范围级文档，正文列出上升和下降阵容及平均名次变化。
  - `generateCurrentStatsDocuments` 将趋势文档与 meta、unit、comp 文档一并生成。
- `src/knowledge/knowledge-document-schema.js`
  - `trend_snapshot` 已进入 `current_stats` 专用文档类型白名单。
  - 仍强制 `source=metatft`、`claimType=statistics` 和完整范围元数据。
- `src/retrieval/semantic-document-store.js`、`src/retrieval/semantic-retriever.js`
  - 索引与检索均支持 `trend_snapshot`。

### 3. 全量 `comp_stats`

- `src/knowledge/metatft-current-stats-pipeline.js`
  - 未提供 `compLimit` 时不再截断候选。
- `scripts/generate-metatft-current-stats.mjs`
  - `--comp-limit=all` 为默认值，也可显式传正整数限制数量。
- 当前真实上游 `compCandidates=57`，正式生成 `comp_stats=57`。

### 4. Embedding 与 freshness 分离

- `src/knowledge/current-stats-index-manager.js`
  - `contentHash` 只由可检索正文决定，用于决定是否重新生成 embedding。
  - `recordHash` 包含正文哈希以及范围、`generatedAt`、`expiresAt` 等记录元数据，用于决定是否更新 SQLite 记录。
  - 正文未变但 freshness 改变时复用原向量，只更新 metadata。
- `src/retrieval/semantic-document-store.js`
  - SQLite schema 升级为 `semantic_index.v3`，增加 `record_hash`。
  - 对旧库执行在线列迁移和回填。
  - `upsert` 分别判断正文、记录和向量状态。

### 5. Router、HTTP 和 UI

- `src/routing/answer-mode-router.js`
  - 环境概览、稳定/主流阵容、宽泛阵容推荐和趋势问题按需加入 `current_stats`。
  - 精确单位装备问题不加入该 scope。
- `scripts/smoke-current-stats-http-e2e.mjs`
  - 启动真实本地 HTTP 服务，发出三类用户问题并验证路由、结构化结果、RAG evidence 和权威规则。
- `src/app/small-window-ui/app.js`
  - evidence 卡片显示来源、patch、rank、timeWindow、region、generatedAt。
  - 修复空时间戳被显示为 Unix epoch 的问题。
- `src/knowledge/knowledge-retriever.js`
  - 空范围时间不再被错误标准化为 `0`。

## 三、真实运行证据

### 1. 正式每日任务

执行：

```powershell
npm run stats:daily
```

正式 manifest：

```text
status=success
attempts=1
totalRows=1
unitRows=263
compDefinitions=69
compCandidates=57
sampleSize=5,496,776
documents=121
meta_snapshot=1
trend_snapshot=1
unit_stats=62
comp_stats=57
vectorsPresent=121
```

文件：

- `.cache/current-stats/manifest.json`
- `.cache/current-stats/scheduler.log`

安装并真实触发的 Windows 计划任务：

```text
TaskName=TFTAgent Current Stats Daily
State=Ready
LastTaskResult=0
LastRunTime=2026-07-29 01:20:33 local
NextRunTime=2026-07-29 04:15 local
```

手动触发后任务回到 `Ready`，日志记录成功完成 121 篇生成和写入。

### 2. 正式 SQLite 与真实 embedding

正式索引审计：

```text
healthy=true
documents=765
current_stats patch 17.7=121
embeddingModel=text-embedding-3-small
embeddingDimensions=1536
issues=0
```

迁移前已有的 644 篇其他知识记录仍保留；加入 8 篇新增文档（7 个此前被截断的阵容和 1 篇趋势）并更新旧统计记录后，未删除 YouTube、static 或 mechanism namespace。

两次相隔数分钟的正式实时拉取都产生了 121 次 embedding。上游的样本数和统计正文在两次拉取间发生变化，因此这不是“仅 freshness 变化”的场景，不能据此判定向量复用失败。

### 3. 幂等、次日 freshness 与范围隔离 smoke

执行：

```powershell
npm run smoke:current-stats
```

结果：

```text
generated=121
first inserted=121
same batch unchanged=121
next-day inserted=0
next-day updated=121
next-day embedded=0
wrong rank=0
wrong timeWindow=0
wrong region=0
wrong patch=0
wrong season=0
protected namespaces before=3 after=3
```

专门的 provider 计数测试还验证：只修改 `generatedAt`、`expiresAt` 等 freshness 元数据时，provider 接收到的 embedding 文本数量不增加。

### 4. 失败重试、manifest、并发与告警测试

执行：

```powershell
node --test test/current-stats-job-runner.test.js
```

覆盖并通过：

- 第一次失败、第二次成功，manifest 记录 `attempts=2`。
- 同一锁范围的第二个任务返回 `skipped_locked`。
- 所有重试失败时写入 `lastFailure` 并调用 webhook 告警发送器。
- 每日运行时间计算跨天正确。

本机没有提供生产告警 URL，因此未向真实外部 webhook 发送失败告警；代码路径使用本地替身验证。部署时设置 `CURRENT_STATS_ALERT_WEBHOOK` 即可启用。

### 5. 三个真实 HTTP E2E

执行：

```powershell
npm run smoke:current-stats:http
```

报告保存于 `.cache/current-stats/http-e2e-report.json`。

#### 当前环境怎么样？

```text
HTTP type=comp_rankings
mode=hybrid
structuredSource=metatft
structuredCandidates=10
scopes includes current_stats
current_stats evidence includes:
  meta_snapshot
  trend_snapshot
  comp_stats
all evidence scope:
  season=set17-live
  patch=17.7
  rank=CHALLENGER,DIAMOND,EMERALD,GRANDMASTER,MASTER,PLATINUM
  timeWindow=3d
  region=global
```

#### 当前有什么稳定阵容？

```text
HTTP type=comp_rankings
mode=hybrid
structuredSource=metatft
structuredCandidates=5
scopes includes current_stats
currentRecommendation=stats:comp:1
evidence includes trend_snapshot + meta_snapshot + comp_stats
```

#### 霞最好的装备是什么，为什么？

```text
HTTP type=unit_build_rankings
mode=hybrid
structuredSource=MetaTFT
structuredCandidates=106
currentRecommendation=stats:build:1
scopes does not include current_stats
currentStatsEvidence=[]
```

这证明精确装备问题仍由当轮结构化结果主导，统计摘要不会覆盖更新的结构化结论。

### 6. 前端真实展示

在浏览器中通过真实本地 HTTP 服务验证：

- “当前有什么稳定阵容？”显示 8 张 `current_stats` 证据卡。
- 卡片显示 patch `17.7`、rank、`3d`、`global` 和生成时间。
- 左侧回答、结构化推荐结果与右侧 evidence 面板同时渲染。
- “霞最好的装备是什么，为什么？”显示结构化装备结果，`current_stats` 卡片数量为 0。
- 空时间戳修复后，页面不再显示 `1970-01-01 00:00`。

### 7. 完整回归

执行：

```powershell
npm test
```

结果：

```text
tests=775
passed=761
failed=0
skipped=14
```

## 四、已解决项与当前边界

本次列出的缺失项均已解决：

- 自动调度：已实现并安装 Windows 计划任务。
- 失败重试、manifest、告警接口、防并发：已实现并测试。
- `trend_snapshot`：已实现、入库并被环境/稳定阵容问题召回。
- `comp_stats` 50 篇上限：已改为默认全量，当前为 57 篇。
- 用户级 HTTP E2E 和前端 evidence：已补充并真实验证。
- freshness-only 重复 embedding：已通过双哈希消除，并有专门测试证明 `embedded=0`。

当前边界：

- 真正的外部失败告警需要部署方提供 `CURRENT_STATS_ALERT_WEBHOOK`；本机没有可用 webhook，所以只完成可重复的发送器测试。
- `item_stats` 和 `unit_item_summary` 仍属于后续文档类型，不在本次要求范围内。
- `trend_snapshot` 当前描述 MetaTFT 提供的阵容趋势变化；更长周期的多日历史比较仍可继续由结构化趋势历史增强。

## 五、验收标准

- 每日任务可由 Windows Task Scheduler 自动执行，且应用层与系统层都阻止并发：通过。
- 成功/失败状态可追溯、失败可重试并可告警：通过；生产 webhook 待部署时配置。
- 真实 MetaTFT 生成四类 121 篇统计文档并写入正式 SQLite：通过。
- 57 个可用阵容全量覆盖：通过。
- 仅 freshness 改变时更新 metadata、`embedded=0`：通过。
- season、patch、rank、timeWindow、region 严格隔离：通过。
- 环境和宽泛阵容问题按需召回，精确装备问题不召回：通过。
- HTTP、Router、Coach、最终回答和 evidence UI 完整展示：通过。
- 其他 namespace 不被批次清理：通过。
- 完整自动化测试无失败：通过。

# MetaTFT `current_stats` 注册式架构与真实 E2E 验收报告

日期：2026-07-29（Asia/Shanghai）

## 一、结论

- 状态：**已完成**。
- `current_stats` 已形成真实闭环：

  ```text
  Windows Task Scheduler / 手动 CLI
  → 防并发锁、重试、manifest、可选 webhook 告警
  → 真实 MetaTFT
  → meta_snapshot + trend_snapshot + unit_stats + comp_stats
  → KnowledgeDocument 严格校验
  → contentHash / recordHash 分离
  → SQLite current_stats namespace
  → season + patch + rank + timeWindow + region + locale 隔离
  → 可用 scope 清单 / scope_unavailable
  → RAG 或 Hybrid 按需召回
  → HTTP 回答与前端证据面板
  ```

- 本轮同时消除了两个“针对案例打补丁”的实现：
  - 不再判断 `intent === "unit_build_rankings" && !unit`；所有结构化 intent 统一声明 `requiredEntities`。
  - 不再由一个持续膨胀的 `deterministicAnswer()` 直接追加任务分支；按任务类型选择 renderer。
- EvidenceBundle 候选也改为按 `resultType` 注册适配器。
- 精确装备、固定条件、指定样本查询仍以本轮 MetaTFT 结构化 `QueryResult` 为第一权威；`current_stats` 不覆盖更新的结构化结果。

## 二、现有代码证据

### 1. 结构化 intent 契约

- `src/routing/structured-intent-contracts.js`
  - `STRUCTURED_INTENT_CONTRACTS`
  - `structuredIntentReadiness`
  - 每个 intent 声明 operation 和 `requiredEntities`，覆盖 champion、item、trait 与无需实体的 comp intents。
- `src/routing/answer-mode-router.js`
  - 路由返回 `structuredReadiness`。
  - 缺实体时不声明可执行的 `structuredOperations`。
  - 普通缺实体请求仍进入原有澄清流程；只有请求 `current_stats` 且结构化契约不可执行时才转为 RAG。
  - 该规则不含任何单 intent 特判。

### 2. EvidenceBundle resultType 适配器

- `src/knowledge/evidence-bundle-builder.js`
  - `STRUCTURED_RESULT_CANDIDATE_ADAPTERS`
  - `structuredResultCandidates`
  - 已注册：
    - unit builds → `rankedBuilds`
    - unit item rankings → `itemRankings`
    - item carrier rankings → `carriers`
    - comp rankings / analysis → `rankings`
    - comp trends → `rising + improving + falling`
  - 趋势查询不再误取普通排行榜第一项。

### 3. 确定性 renderer 注册表

- `src/coach/hybrid-answer-service.js`
  - `DETERMINISTIC_ANSWER_RENDERERS`
  - `deterministicAnswer`
  - 已注册 comp trends、各结构化任务、通用结构化、纯知识、结构化空结果和证据不足 renderer。
  - `structured_empty` 明确保留 MetaTFT QueryResult 权威，不用 `current_stats` 或视频观点替代无合格候选的结果。
  - bundle 中的 `current_stats_scope_unavailable` 等 warning 会进入最终回答。

### 4. current_stats 可用 scope 清单

- `src/retrieval/semantic-retriever.js`
  - `listCurrentStatsScopesFromStore`
  - 从 SQLite 实际有效文档聚合可用范围、文档数量、类型、生成和过期时间。
- `src/knowledge/knowledge-retriever.js`
  - `currentStatsScopeMatches`
  - `currentStatsAvailability`
  - `searchWithStatus`
  - 精确比较 seasonContextId、season、patch、rank、timeWindow、region、locale。
  - 未生成范围返回：

    ```text
    status=scope_unavailable
    requestedScope=<用户请求范围>
    availableScopes=<SQLite 中真实可用范围>
    ```

  - 不可用时只移除本轮 `current_stats` 检索，不影响 video、static、mechanism。
- `src/retrieval/semantic-document-store.js`
  - `item_stats` 也进入 current_stats 专用写入保护，不能绕过专用 manager 写入静态索引。
- `src/app/small-window-server.js`
  - HTTP 返回 `currentStatsScope`。
  - 最终结构化 scope 与预检 scope 不一致时，按最终 scope 重新严格检索。
- `src/app/small-window-ui/app.js`
  - evidence 卡片显示 patch、rank、timeWindow、region、generatedAt。
  - `scope_unavailable` 时显示请求范围和当前可用范围。

### 5. 自动调度

- `src/knowledge/current-stats-job-runner.js`
  - 文件锁防并发、陈旧锁恢复、指数退避、manifest、可选 webhook 告警。
- `scripts/schedule-metatft-current-stats.mjs`
  - 单次 daily 入口与 `--daemon`。
- `scripts/install-current-stats-task.ps1`
  - Windows Task Scheduler 安装入口。
- `package.json`
  - `stats:generate`
  - `stats:daily`
  - `stats:scheduler`
  - `stats:schedule:windows`

## 三、真实运行证据

### 1. 正式 daily pipeline

执行：

```powershell
npm run stats:daily
```

2026-07-29 第一次正式运行：

```text
status=success
attempts=1
real MetaTFT endpoints=4
unitRows=179
compCandidates=57
documents=121
meta_snapshot=1
trend_snapshot=1
unit_stats=62
comp_stats=57
embedded=121
vectorsPresent=121
inserted=3
updated=118
removed=0
```

立即第二次真实拉取：

```text
documents=121
vectorsPresent=121
inserted=0
updated=118
unchanged=3
embedded=89
```

第二次不是相同输入：真实上游 `unitRows`、样本和统计指标继续变化，因此 89 个 `semanticProjection` 变化并重新 embedding 是正确行为。

正式 manifest：

- `.cache/current-stats/manifest.json`
- 最后运行 `status=success`、`attempts=1`。

### 2. 自动计划任务

真实 Windows Task Scheduler 状态：

```text
TaskName=TFTAgent Current Stats Daily
LastRunTime=2026-07-29 04:15:00
LastTaskResult=0
NextRunTime=2026-07-30 04:15:00
NumberOfMissedRuns=0
```

计划任务输出保存在 `.cache/current-stats/scheduler.log`。

### 3. 幂等、次日 freshness、隔离和保护 namespace

执行：

```powershell
npm run smoke:current-stats
```

真实 MetaTFT 临时 SQLite smoke：

```text
source=real_metatft
generated=121
first inserted=121
same batch inserted=0 updated=0 unchanged=121
next day inserted=0 updated=121 embedded=0
wrong rank=0
wrong timeWindow=0
wrong region=0
wrong patch=0
wrong season=0
protected namespaces before=3 after=3 unchanged=true
```

这证明：

- 相同批次重复生成不产生重复记录。
- 仅 `generatedAt`、`expiresAt`、完整 metadata 改变时不重新 embedding。
- 次日以稳定 ID 更新同一记录。
- prune 不会删除 YouTube、static 或 mechanism 文档。

### 4. HTTP E2E

执行：

```powershell
npm run smoke:current-stats:http
```

报告：`.cache/current-stats/http-e2e-report.json`

结果：

| 问题 | mode | current_stats | 结构化权威 | 结果 |
|---|---|---:|---:|---|
| 当前环境怎么样？ | rag | available，8 条证据 | 无需结构化任务 | 返回 trend/meta/comp 文档 |
| 当前有什么稳定阵容？ | hybrid | available，8 条证据 | MetaTFT，5 个候选 | 结构化第一名为主 |
| 霞最好的装备是什么，为什么？ | hybrid | 未请求，0 条 | MetaTFT | 不被 current_stats 覆盖 |
| GOLD + 30d 当前环境 | rag | scope_unavailable | 无范围可执行 | 返回请求范围和可用范围 |

### 5. 霞装备空候选根因

这不是路由或 RAG 错误。

真实响应：

```text
unit=TFT17_Xayah
rows=176/179
filteredBuilds=80/82
minSamples=100
rankedBuilds=0
```

MetaTFT 当前最高三件套约 77 场，低于 100 样本门槛，因此所有候选被正常排除。修复后：

- 不降低样本门槛；
- 不召回 current_stats 替代；
- 不虚构推荐；
- 返回“本轮 MetaTFT 结构化 QueryResult 已返回，但没有满足样本门槛和筛选条件的候选”。

### 6. Browser Use 五案例

在真实本地页面 `http://127.0.0.1:17331/` 输入并验证：

1. `当前环境怎么样？`
   - 页面显示 MetaTFT 趋势快照。
   - evidence 面板显示 8 张 current_stats 卡片以及完整 scope 和生成时间。
2. `当前有什么稳定阵容？`
   - 左侧展示结构化阵容榜。
   - 右侧同时展示 8 张 current_stats 证据卡。
3. `最近哪些阵容正在上升？`
   - 页面独立显示“上升阵容 Top 5”和“下降阵容 Top 5”。
   - 未退化为普通 rankings 第一项。
4. `霞最好的装备是什么，为什么？`
   - 页面显示结构化 MetaTFT 查询范围和空结果原因。
   - current_stats 证据卡为 0。
5. `黄金段位30天当前环境怎么样？`
   - 页面显示 `请求的统计范围尚未生成`。
   - 请求范围为 `set17-live · 17.7 · GOLD · 30d · global`。
   - 同时列出 SQLite 中两个真实可用范围。

## 四、自动化测试

完整回归：

```powershell
npm test
```

结果：

```text
tests=795
passed=781
failed=0
skipped=14
```

新增重点测试：

- 所有注册 intent 的 requiredEntities 通用判断。
- resultType adapter 与 task renderer 注册表。
- comp trends 使用 rising/improving/falling。
- current_stats available / scope_unavailable。
- freshness-only `embedded=0`。
- MetaTFT 空候选保持结构化权威。
- UI scope_unavailable 展示。

## 五、当前边界

- 外部失败告警需要部署方提供 `CURRENT_STATS_ALERT_WEBHOOK`；本机未配置真实 webhook，发送逻辑通过可重复测试验证。
- 当前正式 daily 生成范围是四段位 + 30d；SQLite 还保留一个未过期的六段位 + 3d 范围。用户请求其他范围时现在会明确返回 `scope_unavailable`，不会混用。
- `item_stats` 和 `unit_item_summary` 的文档生成仍属于后续范围；`item_stats` 已进入专用 namespace 写入保护。

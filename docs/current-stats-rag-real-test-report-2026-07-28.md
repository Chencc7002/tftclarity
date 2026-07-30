# MetaTFT `current_stats` RAG 最小闭环真实测试报告

测试日期：2026-07-28
测试环境：Windows / Node.js 18.20.8 / `better-sqlite3` 11.10.0
正式索引：`.cache/semantic-index.sqlite`

## 一、结论

第一版最小闭环已完成：

```text
真实 MetaTFT
→ meta_snapshot / unit_stats / comp_stats
→ 严格 KnowledgeDocument 校验
→ current_stats 专用批次写入
→ SQLite 语义文档索引
→ season / patch / rank / timeWindow / region 隔离检索
→ 稳定 ID、幂等 upsert、范围内 prune
→ Hybrid 按需召回
```

未纳入第一版的内容：`trend_snapshot`、`item_stats`、`unit_item_summary`、scheduler/cron。

## 二、实现证据

- `src/knowledge/metatft-document-generator.js`
  - `generateCurrentStatsDocuments`
  - `buildMetaSnapshotDocument`
  - `buildUnitStatsDocuments`
  - `buildCompStatsDocuments`
  - 文档 ID 包含 scope 和实体标识，不包含日期。
- `src/knowledge/knowledge-document-schema.js`
  - `assertCurrentStatsKnowledgeDocument`
  - 强制 `source=metatft`、`claimType=statistics`、`namespace=current_stats`。
  - 强制 `season`、`patch`、`rank`、`timeWindow`、`region`、`generatedAt`、`expiresAt`、`topics`。
- `src/knowledge/current-stats-index-manager.js`
  - `CurrentStatsIndexManager.indexBatch`
  - freshness hash 同时覆盖正文、scope 和 freshness metadata。
  - prune 仅作用于同一 namespace + season + patch + rank + timeWindow + region + locale。
- `src/retrieval/semantic-document-store.js`
  - 普通写入仍禁止实时 MetaTFT 统计进入静态路径。
  - 只有带专用 schema 证明、由 manager 设置 `allowCurrentStats` 的三类文档可写入。
- `src/retrieval/semantic-retriever.js` 与 `src/knowledge/knowledge-retriever.js`
  - 在 Top-K 前后分别执行 current_stats 精确范围过滤。
  - 过期文档不会返回。
- `src/routing/answer-mode-router.js`
  - current_stats 只在环境概览、宽泛推荐、趋势或显式强制时加入 scopes。
  - 精确装备、固定条件、指定样本问题不默认召回 current_stats。
- `src/knowledge/evidence-bundle-builder.js` 与 `src/coach/hybrid-answer-service.js`
  - `currentBestAuthority=metatft`。
  - `structuredEvidenceHasPriority=true`。
  - 有结构化候选时，回答必须引用第一条结构化候选作为当前推荐。
- `scripts/generate-metatft-current-stats.mjs`
  - 手动 CLI。
- `scripts/smoke-metatft-current-stats-rag.mjs`
  - 真实 MetaTFT、SQLite、幂等、freshness、范围隔离、namespace 保护 smoke。

## 三、文档粒度

- `meta_snapshot`：每个完整 scope 一篇。
- `unit_stats`：每个英雄一篇；同一英雄不同星级聚合在正文中。
- `comp_stats`：每个 MetaTFT 阵容 cluster 一篇；CLI 第一版默认最多 50 篇。
- 不会把所有英雄或所有阵容写成一篇大 JSON。
- 正文是适合自然语言检索的统计摘要，原始 JSON 不直接作为正文入库。

## 四、真实运行记录

### 1. 安装真实依赖

```powershell
npm ci
```

结果：安装 39 个包，审计 40 个包，0 个漏洞；SQLite 使用 `better-sqlite3`。

### 2. 真实闭环 smoke

```powershell
npm run smoke:current-stats
```

真实 MetaTFT 获取结果：

- `/tft-explorer-api/total`：1 行。
- `/tft-explorer-api/units_unique`：263 行。
- `/tft-comps-api/comps_data`：69 个阵容定义。
- `/tft-comps-api/comps_stats`：57 个可用阵容候选。
- 样本量：5,499,608。
- cluster：409。

生成结果：

- `meta_snapshot`：1。
- `unit_stats`：62。
- `comp_stats`：50。
- 总计：113。

首次入库：

```text
inserted=113
updated=0
unchanged=0
removed=0
```

同一批对象重复入库：

```text
inserted=0
updated=0
unchanged=113
removed=0
```

次日 freshness 模拟（正文和 ID 不变，只更新 `generatedAt`、`expiresAt`）：

```text
inserted=0
updated=113
unchanged=0
removed=0
```

这证明日期未进入 ID，freshness metadata 的变化会触发刷新，不会生成重复记录。

自然语言检索：

```text
问题：MetaTFT 当前环境热门阵容和英雄统计
结果：返回 8 条 current_stats evidence
类型：meta_snapshot / comp_stats / unit_stats
所有结果 generatedAt=2026-07-29T00:00:00.000Z
```

跨范围隔离：

```text
wrongRank=0
wrongWindow=0
wrongRegion=0
wrongPatch=0
wrongSeason=0
```

独立范围共存：

```text
原 scope=113
新增 CHALLENGER + 7d + cn scope=1
合计=114
原 scope 未被 prune
```

其他 namespace 保护：

```text
写入前 sentinel=3
写入及 prune 后 sentinel=3
unchanged=true
```

### 3. 写入正式 SQLite

```powershell
npm run stats:generate
```

首次正式写入 113 篇。再次执行真实拉取后，正式 SQLite 中 current_stats 总数仍为 113，没有重复 ID。第二次真实上游数据已经发生变化，因此结果为 `updated=110, unchanged=3`，这是 live 内容刷新，不是同一输入的幂等测试；同一输入幂等结果见上面的 smoke。

正式索引只读审计：

```text
写入前已有文档=644
写入后总文档=757
current_stats=113
既有文档仍为 644
自然语言检索返回 5 条 comp_stats
```

本地 `.env` 已启用 OpenAI-compatible embedding provider。重新执行正式 CLI 后：

```text
documents=113
embedded=113
inserted=0
updated=113
embeddingModel=text-embedding-3-small
dimensions=1536
```

`npm run semantic:audit` 的正式索引审计结果为：

```text
healthy=true
documents=757
dimensionsByModel.text-embedding-3-small=1536
issues=[]
```

真实向量问题“当前环境里有哪些热门阵容和强势英雄？”返回 5 条
`current_stats` evidence，第一条为 `meta_snapshot`，其余为 `comp_stats`。
应用仍保留 TF-IDF fallback，embedding 服务暂时不可用时不会让知识检索整体失效。

### 4. 回归测试

```powershell
npm test
```

结果：

```text
tests=770
passed=756
failed=0
skipped=14
```

14 个跳过项是测试套件中已有的运行时条件跳过；没有失败。

## 五、验收项对照

- 真实 MetaTFT：通过。
- 三类 KnowledgeDocument：通过。
- 严格 Schema：通过。
- `current_stats` 专用入库：通过。
- 范围隔离：通过。
- 稳定 ID：通过。
- 同批幂等：通过。
- 次日 freshness 更新：通过。
- 同范围 prune：通过。
- 其他 namespace 不删除：通过。
- Hybrid 按需召回：通过。
- 结构化 QueryResult 第一权威：通过。
- 手动 CLI：通过。
- scheduler/cron：按第一版要求未实现。

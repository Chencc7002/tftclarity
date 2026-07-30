# `current_stats` semanticProjection 与 Embedding 成本优化报告

日期：2026-07-29（Asia/Shanghai）

## 一、结论

- 已完成 `semanticProjection` 成本优化并升级到 `current_stats.v2`。
- 完整样本数、完整精度指标、上游实体和来源数据始终保存在 metadata，每次参与 `recordHash` 更新。
- 正文和 `contentHash` 只由规范化后的 `semanticProjection` 决定。
- 正文未变时复用已有正文和向量，不调用 Embedding provider。
- 第一次正式运行因从旧正文哈希迁移到 projection v1，按预期重新生成 121 个向量。
- 第二次真实拉取的上游样本数由 `5,494,856` 变为 `5,495,016`，121 篇记录全部更新 metadata，但只有 **17 篇**重新 Embedding，另外 **104 篇**复用原向量。
- 相比此前每次 121 篇全部 Embedding，本次真实相邻拉取减少约 **86%** 的向量生成调用。

## 二、实现证据

### 集中配置

文件：`src/knowledge/current-stats-semantic-projection.js`

- `DEFAULT_CURRENT_STATS_SEMANTIC_CONFIG`
  - `avgPlacementDecimals=2`
  - `ratePercentageDecimals=1`
  - `rankingChangeThreshold=2`
  - `criticalRankBoundaries=[]`
- `resolveCurrentStatsSemanticConfig`
  - 校验所有精度、排名阈值和关键边界。
  - 关键边界默认空数组，不包含第一名、Top 3、Top 4、Top 10 等隐式例外。
- 可配置环境变量：
  - `CURRENT_STATS_AVG_PLACEMENT_DECIMALS`
  - `CURRENT_STATS_RATE_PERCENTAGE_DECIMALS`
  - `CURRENT_STATS_RANK_CHANGE_THRESHOLD`
  - `CURRENT_STATS_CRITICAL_RANK_BOUNDARIES`
- CLI 也支持：
  - `--avg-placement-decimals`
  - `--rate-percentage-decimals`
  - `--rank-change-threshold`
  - `--critical-rank-boundaries`

### Projection 规范化和正文渲染

文件：`src/knowledge/metatft-document-generator.js`

- 样本数不进入 `semanticProjection`，也不进入正文。
- 平均名次按配置格式化，默认保留 2 位小数。
- 前四率、登顶率、选择率按配置转换为百分数，默认保留 1 位小数。
- `rawData` 保存文档相关的完整原始数据：
  - meta：完整 total response、样本数、代表阵容和来源。
  - unit：完整 overall、星级 placement count、原始行。
  - comp：完整 stats、棋子、羁绊、装备、风险、趋势和 source。
  - trend：完整 rising/falling、趋势和来源。
- Projection 显式包含实体、阵容组成、装备、风险分类和趋势方向；这些字段变化必然改变正文。

文件：`src/knowledge/current-stats-semantic-projection.js`

- `stabilizeCurrentStatsSemanticProjection`
  - 与 SQLite 中上一版 projection 比较。
  - 同一批实体的普通排名变化绝对值小于阈值时，保留上一版语义排名。
  - 排名变化达到阈值时采用整组新排名，避免重复名次。
  - 只有显式配置的关键边界发生跨越时才作为例外更新。
- `renderCurrentStatsSemanticProjection`
  - 四类文档正文统一从 projection 渲染。
  - 样本数不会被渲染。

### 双哈希与仅按需渲染

文件：`src/knowledge/current-stats-index-manager.js`

- `contentHash = SHA-256(stable semanticProjection)`。
- `recordHash` 使用稳定序列化，覆盖：
  - `contentHash`
  - freshness
  - scope
  - 完整 metadata
  - 完整 `rawData`
- 当 projection 与上一版相同：
  - 直接复用 SQLite 中已有正文。
  - 复用原 embedding。
  - 只更新 metadata 和 `recordHash`。
- 当 projection 变化：
  - 重新渲染正文。
  - 生成新的 `contentHash`。
  - 调用 Embedding。

文件：`src/knowledge/knowledge-document-schema.js`

- `current_stats.v2` 强制要求：
  - `rawData`
  - `semanticProjection`
  - `semanticProjectionConfig`
- 校验 projection 的 document type 和五维 scope 必须与 KnowledgeDocument metadata 一致。

## 三、专项测试证据

执行：

```powershell
node --test test/current-stats-rag.test.js
```

结果：

```text
tests=19
passed=19
failed=0
```

覆盖：

- 默认配置精确为 2 位平均名次、1 位百分数、排名阈值 2、关键边界空。
- 自定义 3 位平均名次和 2 位百分数真实改变 projection 与正文。
- 正文不包含样本数，metadata 保留完整 `games=300` 和未舍入指标。
- 样本 `300→301` 且指标只发生显示精度以内变化：

  ```text
  updated=1
  embedded=0
  contentHash unchanged
  recordHash changed
  rawData.games=301
  ```

- 普通排名第 1、2 名互换，默认阈值 2：

  ```text
  updated=1
  embedded=0
  ```

- 显式配置关键边界 `[1]` 后，同样的第 1、2 名互换：

  ```text
  embedded=1
  ```

- 排名移动 2 位：
  - 阈值 3：`embedded=0`
  - 阈值 2：`embedded=1`
- 以下任一变化均强制重新渲染和 Embedding：
  - 实体名称
  - 核心装备
  - 阵容组成
  - 样本风险分类
  - 趋势方向

## 四、真实运行证据

### 真实 MetaTFT 隔离 smoke

执行：

```powershell
npm run smoke:current-stats
```

结果：

```text
source=real_metatft
sampleSize=5,495,720
documents=121
meta_snapshot=1
trend_snapshot=1
unit_stats=62
comp_stats=57
repeat unchanged=121
next-day freshness updated=121
cross-scope mismatches=0
protected namespaces before=3 after=3
```

### 正式 SQLite 第一次运行：projection 迁移

执行：

```powershell
npm run stats:daily
```

结果：

```text
sampleSize=5,494,856
documents=121
updated=121
embedded=121
vectorsPresent=121
```

这是从旧正文哈希切换到 `current_stats_semantic_projection.v1` 的一次性迁移结果。

### 正式 SQLite 第二次相邻真实拉取

再次执行：

```powershell
npm run stats:daily
```

结果：

```text
sampleSize=5,495,016
sample delta=+160
documents=121
updatedMetadata=121
embedded=17
reusedEmbedding=104
vectorsPresent=121
inserted=0
removed=0
```

这证明真实数据轻微变化时不再机械地对全部 121 篇文档重新 Embedding。

随后将批次 schema 标记正式升级为 `current_stats.v2` 并再次运行。该次上游样本已继续
变化到 `5,495,368`，结果为 `updated=121, embedded=58, vectorsPresent=121`；
正式库当前所有 121 篇统计记录均已按 v2 写回。schema 标记本身只进入 recordHash，
不会触发 Embedding；58 篇来自这段时间内实际发生变化的 projection。

### 正式索引审计

执行：

```powershell
npm run semantic:audit
```

结果：

```text
healthy=true
documents=765
current_stats=121
text-embedding-3-small dimensions=1536
issues=0
```

正式 SQLite 抽查的 `meta_snapshot` 同时包含：

- 完整 `rawData.sampleSize` 和完整上游 response/source。
- 不含样本数的 semantic projection。
- 默认配置 `{2, 1, 2, []}`。
- 相互独立的 `contentHash` 与 `recordHash`。

全量记录核验：

```text
documents=121
schemaVersions=["current_stats.v2"]
projectionVersions=["current_stats_semantic_projection.v1"]
missingRawData=0
missingVectors=0
```

### HTTP Hybrid 回归

执行：

```powershell
npm run smoke:current-stats:http
```

结果：通过。

- 环境问题仍召回 `trend_snapshot`、`meta_snapshot` 和 `comp_stats`。
- 稳定阵容问题仍以结构化 MetaTFT 第一名为准并召回 current_stats。
- 霞的精确装备问题仍不召回 current_stats，`currentStatsEvidence=[]`。

## 五、完整回归

执行：

```powershell
npm test
```

结果：

```text
tests=788
passed=774
failed=0
skipped=14
```

## 六、验收结论

- 完整原始 metadata 每次更新：通过。
- 样本数不进入语义正文：通过。
- 平均名次 2 位、百分率 1 位：通过。
- 普通排名变化不足 2 位不更新 projection：通过。
- 关键边界只接受显式配置，默认无例外：通过。
- 只有 projection 变化才重新渲染和 Embedding：通过。
- freshness、完整指标和样本变化只更新 recordHash/metadata：通过。
- 实体、装备、阵容组成、风险、趋势或语义分类变化强制 Embedding：通过。
- 所有相关数字集中配置并有测试：通过。

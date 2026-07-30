# YouTube RAG 真实验收报告（2026-07-29，2026-07-30 更新）

## 一、结论

结论：**YouTube RAG 工程验收已通过，验收等级为
`ai_generated_provisional`。**

已经由代码和真实运行证明：

- 真实 YouTube 元数据与带时间戳字幕可以进入摄取链；
- 分段独立提取、逐段落盘、一次 JSON 修复、空结果二次确认、失败段
  quarantine、视频 `partial_success` 均已实现；
- `KnowledgeDocument` 包含视频版本、字幕哈希、season、patch、作者、
  发布日期和时间戳；
- `video_guides` 可以写入真实 SQLite，并用真实
  `text-embedding-3-small` 生成 1536 维向量；
- 同一成功版本重复入库保持幂等，正文不变时 `embedded=0`；
- RAG/Hybrid 检索强制要求当前 season、patch、locale 和
  `isCurrentVersion=true`；
- Hybrid 中本轮 MetaTFT 结构化 `QueryResult` 始终是当前统计首要权威，
  YouTube 只能提供解释和条件性建议；
- 同一版本的后续 `partial_success` 不再删除本次 quarantine 段上一轮的
  成功文档；新视频版本仍会替换旧版本。
- 每次运行按 `runId` 保存独立的原始字幕、provider/model 响应、校验错误、
  segment status 与完整 envelope；`--reextract` 不再覆盖上一轮 artifacts；
- 英文字幕产生中文 claim 的真实语言漂移已由 v6 Normalizer 拒绝并执行一次
  repair；最终六视频结果中语言错配文档为 0；
- 最终真实 `--reextract` 已完成：6 个视频、34 个分段、172 篇文档、
  `quarantine=0`、`reasoning_tokens=0`；
- 相同输入正常重复运行 34/34 命中缓存、模型调用为 0，六个
  `runComparison.stable=true`；
- 172/172 篇视频文档都写入
  `aiGenerated=true`、`contentOrigin=ai_generated_transcript_summary`、
  `reviewStatus=ai_generated_unreviewed` 和明确披露文本；
- HTTP Evidence 与前端证据卡真实显示
  “AI 生成 · 未经人工复核”，并提示用户点击时间点核对原视频；
- 当前顶层结果为
  `complete=true, passed=true, acceptanceLevel=ai_generated_provisional`。

验收分为两层：

1. 工程验收已经通过，包括真实来源、真实模型、段级容错、版本隔离、SQLite、
   Embedding、RAG 召回、幂等、前端披露和自动测试。
2. 六类质量指标当前基于 AI 生成的 provisional seed，只作诊断提示，
   `qualityThresholdsPassed=false`。它们没有冒充人工标注结果；若需要更高可信
   等级，可继续执行保留的独立人工审核流程，升级为 `human_reviewed`。

## 二、代码证据

### 2.1 段级摄取与可追踪 artifacts

- `services/youtube-ingestion/cli.py`
  - `ingest()`：第 358 行；
  - `videoVersion` 由 `videoId + publishedAt + transcriptHash` 计算：
    第 430 行；
  - 模型、Prompt、Normalizer、max tokens、thinking 和分段参数进入
    `configHash`：第 439 行；
  - 只复用 `finalStatus=success/empty` 的段缓存：第 538–552 行；
  - 每个 attempt 独立保存原始 provider 响应、模型正文、usage、
    校验错误和字幕窗口：第 556–575 行；
  - KnowledgeDocument 校验失败逐 claim 记录：第 578–599 行；
  - 失败段写入独立 quarantine artifact：第 654–675 行；
  - `runComparison` 分开报告语义变化、记录变化、文档增删和段状态变化：
    第 256 行。
- 每轮运行位于 `runs/<runId>/`；
- 原始字幕位于 `runs/<runId>/raw-transcript.json`；
- 原始模型结果位于 `runs/<runId>/segments/*/attempt-*.json`；
- 段状态位于 `runs/<runId>/segments/*/segment-status.json`；
- 失败段位于 `runs/<runId>/quarantine/*.json`；
- 完整运行快照位于 `runs/<runId>/ingestion-envelope.json`；
- 可复用段缓存仍位于版本根目录 `segments/*/result-<configHash>.json`，与
  审计 artifacts 分离。

### 2.2 一次 JSON 修复、空结果确认与传输重试

- `services/youtube-ingestion/guide_extractor.py`
  - Prompt：`youtube-guide-extraction.v6`；
  - Normalizer：`youtube-claim-normalizer.v6`；
  - `extract_guide_claims_detailed()`：第 501 行；
  - 首次响应非法或所有 claim 不合约时只执行一次 `json_repair`；
  - 首次合法空数组时只执行一次 `empty_confirmation`；
  - 临时 TLS/网络、408、409、425、429、5xx 在逻辑提取 attempt 内按配置
    重试，并记录 `transportRetryCount`；
  - 每段最多 12 条互不重复的知识，防止模型重复输出直到截断 JSON；
  - claim 语言与字幕主导语言不一致时拒绝该 claim，并把明确错误送入唯一一次
    `json_repair`；repair 必须用字幕语言重写，而不是复制错误翻译。

### 2.3 DeepSeek thinking 根因修复

真实失败 artifact 显示多个请求：

```text
completion_tokens=4000
reasoning_tokens=4000
content=""
parse error=Expecting value
```

DeepSeek V4 默认开启 thinking；官方文档说明 thinking 模式下
`temperature` 不生效，reasoning 与最终正文共用输出预算。结构化提取现在在
官方 `api.deepseek.com` endpoint 默认发送：

```json
{"thinking":{"type":"disabled"}}
```

其他 OpenAI-compatible endpoint 默认不发送该 provider-specific 字段。
真实修复后两次运行的 `reasoning_tokens` 都为 0。

参考：

- https://api-docs.deepseek.com/guides/thinking_mode
- https://api-docs.deepseek.com/api/create-chat-completion

### 2.4 speculation/Schema 适配

- `services/youtube-ingestion/schema_validator.py`
  - 统一 `UNCERTAINTY_MARKERS` 和 `has_explicit_uncertainty()`；
  - `probably/perhaps/appears/seems` 等显式不确定措辞被接受；
  - 模型把确定性机制描述错误标成 `speculation` 且正文无不确定措辞时，
    Normalizer 可追踪地改为 `creator_advice`，
    warning=`unmarked_speculation_normalized`；
  - 真正含不确定措辞的 claim 保持 `speculation`。

### 2.5 视频版本、scope 与增量索引

- `src/knowledge/youtube-index-manager.js`
  - `sameScope()` 只处理同一
    `video_guides + sourceId + season + patch + region + locale`；
  - envelope 和文档必须具有一致的
    `videoVersion/transcriptHash/season/patch/locale`；
  - `isCurrentVersion` 必须为 `true`；
  - 只为正文变化、缺失向量或 embedding model 变化的文档重新 embedding；
  - stale prune 只发生在同一视频 scope；
  - 第 87–120 行：同一版本 `partial_success` 时保留 quarantine
    segmentId 上一次成功文档并加
    `preservedFromQuarantinedSegment=true`；
  - 新 videoVersion 不继承旧版本文档。
- `src/retrieval/semantic-retriever.js`
  - 第 154–166 行：`video_guide` 必须是 `source=youtube`、
    `namespace=video_guides`、当前版本、成功或部分成功状态；
  - 未显式提供 patch 时拒绝视频检索；
  - season 和 locale 在统一 filter 中严格匹配。

### 2.6 Hybrid 权威边界

- `src/routing/answer-mode-router.js`
  - 精确当前统计问题优先结构化；
  - YouTube、机制和静态知识按需召回；
  - authority 明确为
    `currentStatistics=metatft`、
    `creatorAdvice=youtube`、
    `videoMayOverrideCurrentStatistics=false`。
- `src/coach/hybrid-answer-service.js`
  - `currentRecommendation` 必须等于结构化候选第一名；
  - 回答中的统计数字必须来自结构化 evidence；
  - 结构化结果为空时，明确禁止 current_stats 或视频替代；
  - YouTube 只进入原因、条件和备选建议。

### 2.7 固定验收集与两层质量状态

- 六类案例位于
  `services/youtube-ingestion/acceptance/annotations/`：
  - 短视频；
  - 30 分钟以上长视频；
  - 字幕质量差；
  - 单英雄/装备攻略；
  - 阵容运营攻略；
  - TFT 与推广/闲聊混合内容。
- `services/youtube-ingestion/acceptance_evaluator.py`
  实现：
  - entity precision/recall/F1；
  - claim accuracy/recall/F1；
  - condition extraction rate；
  - timestamp accuracy；
  - irrelevant content filtering rate；
  - duplicate knowledge rate。
- claim 使用一对一匹配，禁止一篇输出同时覆盖多个 ground-truth claim；
- 实体按匹配 claim 逐条计算，禁止跨 claim 串配；
- 无关窗口按文档与窗口的真实时间区间重叠判断，而不是只看文档起点；
- `thresholds.enforcement=advisory` 时，AI provisional 指标不阻断工程验收，
  但报告仍保留每项 threshold 是否达到的原始结果；
- 当前顶层状态显式输出：
  `annotationOrigin=ai_generated_provisional`、
  `qualityMetricsStatus=provisional_ai_generated` 和
  `qualityThresholdsPassed=false`。
- 可选人工升级仍使用 `independent_review_errors()`，要求：
  - `annotationStatus=complete`；
  - `reviewerType=human`；
  - `independentHumanReview=true`；
  - `transcriptCoverageReviewed=true`；
  - `exhaustiveClaimReview=true`；
  - reviewer、ISO reviewedAt；
  - 每条 claim 的人工 decision；
  - 每个无关窗口的人工 decision。
- `scripts/build-youtube-human-review-packet.mjs` 会校验冻结字幕 hash，并把六个
  视频全部 3730 个带时间戳字幕片段写入审核包；不再只提供旧 seed 附近的窗口。
- `services/youtube-ingestion/review_acceptance_annotations.py` 导出和应用机器可校验
  的审核表；它锁定 manifest、字幕与逐条 claim/window fingerprint，支持
  `modified` 和 `additionalClaims`，并默认输出新的 reviewed 集而不覆盖 seed。
- `scripts/run-youtube-captured-acceptance.mjs` 可按冻结的 capture mode 和
  chunk size 重放六个真实来源并自动计算指标。

### 2.8 AI 内容披露与 metadata-only 更新

- `services/youtube-ingestion/cli.py` 创建的每篇 `video_guide` 必须包含：
  - `aiGenerated=true`；
  - `contentOrigin=ai_generated_transcript_summary`；
  - `reviewStatus=ai_generated_unreviewed | human_reviewed`；
  - `contentDisclosure`。
- Python 与 Node 两侧 KnowledgeDocument 校验器都强制检查这些字段。
- `src/knowledge/knowledge-retriever.js` 将披露字段传入 HTTP Evidence。
- `src/app/small-window-ui/app.js` 在每张 AI 视频证据卡显示披露徽标和风险说明。
- `src/retrieval/semantic-document-store.js` 的 `recordHash` 现在包含 metadata；
  metadata-only 更新会保留已有向量，不重新 Embedding，也不会清空 SQLite
  中的 embedding blob 和 model。

## 三、真实运行证据

### 3.1 真实 YouTube 来源

| 案例 | videoId | 作者/日期 | 时长 | 字幕片段 | scope |
|---|---|---|---:|---:|---|
| 短视频 | BpFL4kmfp1Q | dpei / 2026-02-14 | 290.88s | 134 | set17-live / 17.7 |
| 长视频 | FkDvDkdid_w | BunnyMuffins / 2026-03-28 | 2575.88s | 1322 | set17-live / 17.7 |
| 差字幕 | K0LJ1j1xANc | Why TFT / 2026-04-16 | 2358.96s | 682 | set17-live / 17.7 |
| 单英雄装备 | ag_FVgVScMk | BaracudaOfficial / 2020-05-22 | 1243.13s | 564 | set3-historical / 10.11 |
| 阵容运营 | Bv3nJAHUeLA | BunnyMuffins / 2026-07-18 | 1367.92s | 737 | set17-live / 17.7 |
| 混合闲聊 | aSW-okm70Ns | leduck / 2026-03-28 | 630.36s | 291 | set17-live / 17.7 |

其中短视频由真实 live pull 获得；其余五例由已登录浏览器取得 YouTube
signed timedtext JSON3，再以不含 Cookie 的文件进入摄取器。捕获文件和
transcript hash 均保存在 `.cache/youtube-acceptance/`，未导出 Cookie。

### 3.2 旧配置成功基线与生产重复

旧 v4 normalizer 最终缓存重复结果：

| 案例 | 状态 | 文档 | 段 | quarantine | 最终重复 cache hits |
|---|---|---:|---:|---:|---:|
| 短视频 | success | 8 | 4 | 0 | 4/4 |
| 长视频 | success | 12 | 9 | 0 | 9/9 |
| 差字幕 | success | 11 | 8 | 0 | 6/8 |
| 单英雄装备 | partial_success | 15 | 5 | 1 | 2/5 |
| 阵容运营 | partial_success | 27 | 5 | 1 | 4/5 |
| 混合闲聊 | success | 15 | 3 | 0 | 0/3 |

短视频第三次 `--force` 和长视频下一次 `--force` 都达到：

```text
全部成功段 cache hit
model calls=0
runComparison.stable=true
```

这证明正常生产重复不会出现文档数量漂移；`--reextract` 被明确作为模型漂移
压力测试，不与生产幂等混为一谈。

### 3.3 独立强制重提取（修复前，真实失败）

六视频共 34 段、无缓存的 `--reextract`：

```text
documents=71（provisional seed 为 88）
quarantinedSegments=5
entityPrecision=0.777778
entityRecall=0.635897
claimAccuracy=0.507042
claimRecall=0.409091
conditionExtractionRate=0.347826
timestampAccuracy=0.861111
irrelevantContentFilteringRate=1.0
duplicateKnowledgeRate=0.0
passed=false
```

失败不是评估器“故意卡住”：artifact 显示大量 4000 reasoning token
耗尽且无 JSON 正文。这直接促成 thinking 修复。

### 3.4 最终 v6 六视频真实重提取

命令：

```powershell
.\.cache\runtime\node-v24.18.0-win-x64\node.exe `
  scripts\run-youtube-captured-acceptance.mjs `
  --capture-root .cache\youtube-acceptance\live `
  --outputs .cache\youtube-acceptance\retest-v6-final `
  --reextract `
  --python C:\Users\Chencc\anaconda3\python.exe
```

真实结果：

| 案例 | 状态 | 文档 | 段 | empty | quarantine |
|---|---|---:|---:|---:|---:|
| 短视频 | success | 13 | 4 | 1 | 0 |
| 43 分钟长视频 | success | 34 | 9 | 3 | 0 |
| 差字幕 | success | 22 | 8 | 3 | 0 |
| 单英雄装备 | success | 36 | 5 | 1 | 0 |
| 阵容运营 | success | 47 | 5 | 0 | 0 |
| 混合闲聊 | success | 20 | 3 | 1 | 0 |
| **总计** | **6/6 success** | **172** | **34** | **9** | **0** |

运行级细节：

```text
attempts=45
extractAttempts=34
jsonRepairAttempts=2
emptyConfirmationAttempts=9
reasoningTokens=0
transportRetries=0
languageMismatchDocuments=0
maxClaimsPerSegment=12
artifactProblems=0
```

两次真实 language mismatch 都在首轮被拒绝，各自一次 `json_repair` 均改回
字幕语言并成功入库。历史视频定向复测还证明：原先重复内容耗尽 4000 token
并截断 JSON 的分段，在 v6 中停在 12 条互不重复的知识，5/5 分段成功。

随后不带 `--reextract` 重复运行：

```text
cacheHits=34/34
modelSegments=0
documents=172
allRunComparisonsStable=true
```

### 3.5 每轮原始 artifact 历史与 partial_success

短视频连续两次真实 `--reextract` 的 run 目录同时存在：

```text
runId=20260729T090017-2e882515
documents=10, segments=4, attemptArtifacts=5
attemptDigest=c1c77db4024543a6

runId=20260729T090105-2a5e8bc4
documents=10, segments=4, attemptArtifacts=5
attemptDigest=c5f3313ecce7859f
previousRunId=20260729T090017-2e882515
```

两个 run 均保留独立字幕、attempt、segment status 和 envelope；第二轮没有
覆盖第一轮。`runComparison` 显式记录同文档数下的模型措辞和 ID 漂移。

中间 v6 运行真实产生过一个 `partial_success`：

```text
videoId=ag_FVgVScMk
documents=18
segments=5
quarantinedSegments=1
```

在独立 SQLite 中先写入完整同版本，再写入该 partial envelope：

```text
preservedQuarantinedSegmentDocuments=12
quarantinedSegments=1
status=partial_success
```

这证明临时失败段不会删除同一 `videoVersion` 上一轮的 12 篇成功文档；
成功段仍按本轮结果正常增量更新。

### 3.6 SQLite、真实 Embedding、幂等与检索

最终数据库：

```text
.cache/youtube-acceptance/youtube-v6-final.sqlite
documents=172
namespace=video_guides
embeddingModel=text-embedding-3-small
dimensions=1536
set17-live / 17.7 = 136
set3-historical / 10.11 = 36
locale=en
isCurrentVersion=true
```

首次真实入库合计：

```text
embedded=172
inserted=172
removed=0
```

六个相同 envelope 再次入库合计：

```text
embedded=0
inserted=0
updated=0
unchanged=172
removed=0
```

生产默认 `topK=8` 的真实 Hybrid embedding 检索：

| 问题 | 命中证据 | score |
|---|---|---:|
| What items reduce enemy armor and magic resistance? | shred/sunder，30% resist reduction | 0.7574 |
| How early should I build anti-heal? | stage 4 / stage 5 | 0.6953 |
| Why should I fully itemize my main tank? | armor/MR/减伤与 HP 乘算 | 0.6711 |
| Where should utility items go in the late game? | 三件套后移给 secondary carry | 0.7687 |

严格隔离结果：

```text
wrongPatchHits=0
wrongSeasonHits=0
wrongLocaleHits=0
missingPatchHits=0
historicalHitCount=8
historicalMatchedContent=Xayah + Last Whisper
historicalLeaksIntoCurrentScope=0
```

### 3.7 provisional 诊断指标

评估器改为一对一 claim 匹配、逐 claim 实体匹配和时间区间重叠判断后，
最终 v6 对旧 output-derived seed 的诊断结果：

```text
entityPrecision=0.244141
entityRecall=0.443636
claimAccuracy=0.290698
claimRecall=0.568182
conditionExtractionRate=0.333333
timestampAccuracy=0.840000
irrelevantContentFilteringRate=0.857143
duplicateKnowledgeRate=0.000000
complete=true
passed=true
acceptanceLevel=ai_generated_provisional
qualityMetricsStatus=provisional_ai_generated
thresholdEnforcement=advisory
qualityThresholdsPassed=false
```

这些数值明确标记为 AI provisional：seed 只有 88 条并由旧模型输出派生，而 v6
生成 172 篇候选，未标注的有效新 claim 会被旧评估器计为 precision 错误；
同时旧 seed 并未由人工证明穷尽性。数值用于暴露匹配差异，不作为人工质量
背书。人工审核和补齐 `additionalClaims` 后可生成更高等级指标。

### 3.8 自动测试

```text
Python ingestion tests: 31 passed
Full Node suite:
820 tests, 812 passed, 0 failed, 8 skipped
git diff --check: passed
```

系统 Node 18 在受限沙箱中仍可能报 `EPERM lstat C:\Users\Chencc`；本次完整
套件使用工作区 Node 24，已实际进入 820 个测试且无失败。

### 3.9 披露 metadata、Embedding 与真实浏览器展示

六个真实 envelope 用缓存重建，未调用模型：

```text
documents=172
cacheHits=34/34
modelCalls=0
aiGenerated=172
reviewStatus=ai_generated_unreviewed: 172
contentDisclosure=172
```

向已有 SQLite 写入披露 metadata：

```text
first refresh:
updated=172
embedded=0
removed=0

same envelopes again:
unchanged=172
embedded=0
removed=0
```

数据库最终检查：

```text
documents=172
embeddings=172
dimensions=1536
aiGenerated=172
unreviewed=172
disclosures=172
```

真实 RAG smoke 再次通过四个自然语言案例，错误 patch/season/locale 与缺失
patch 仍为 0。浏览器输入“霞为什么需要羊刀？”后，右侧证据卡实际显示：

```text
AI 生成 · 未经人工复核
本条攻略由 AI 根据视频字幕提取和概括，可能有遗漏或误读；
请点击时间点核对原视频。
```

## 四、可选增强项

### 4.1 独立人工审核升级

工程验收不再被人工签核阻断，但完整审核工具仍保留。当前审核包：

```text
.cache/youtube-acceptance/human-review-packet.md
cases=6
claims=88
fullTranscriptSnippets=3730
timeBlocks=31
size=321655 bytes
```

如需把 `ai_generated_provisional` 升级为 `human_reviewed`：

```powershell
npm run youtube:acceptance:review:export
# 人工填写 .cache/youtube-acceptance/human-review.json
npm run youtube:acceptance:review:apply
npm run youtube:acceptance:review:evaluate
```

人工导入器要求三项 attestation、全部 claim decision、全部无关窗口
decision，并拒绝过期 manifest、字幕 hash 或逐条 fingerprint。

## 五、验收标准与结果

1. 六视频 `--reextract` 完整执行，34 段均有可追踪 artifact：**通过**；
2. 正常重复为全部成功/空段 cache hit，模型调用为 0，
   `runComparison.stable=true`；
   **通过**；
3. SQLite 重复入库 `embedded=0, unchanged=N, removed=0`：**通过**；
4. metadata-only 更新不清空向量、不重新 Embedding：**通过**；
5. 当前 scope 可以自然语言检索，错误 patch/season/locale 与缺失 patch 均为 0：
   **通过**；
6. 同版本 partial retry 保留 quarantine 段旧成功文档，新版本不混用旧文档：
   **通过**；
7. HTTP Hybrid 保持 MetaTFT 结构化统计权威，YouTube 只提供可追踪建议：
   **通过**；
8. AI 内容在 Schema、SQLite、HTTP 和前端均有明确披露：**通过**；
9. AI provisional 六类质量指标完整计算并标注来源：**通过**；
10. 独立人工审核：**可选增强，当前未执行，不影响
    `ai_generated_provisional` 工程验收等级**。

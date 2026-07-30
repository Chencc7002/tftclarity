# YouTube 攻略知识与混合回答操作说明

本功能采用“人工提供单条 YouTube URL → 本地摄取 → SQLite 知识索引 → 查询时按需检索”的工作流，不会自动爬取频道或批量发现视频。

## 1. 安装摄取依赖

Node.js 负责主服务、索引与回答；Python 只负责 YouTube 字幕和元数据摄取。

```powershell
python -m pip install -r services/youtube-ingestion/requirements.txt
```

复制 `.env.example` 为 `.env`，并配置 OpenAI-compatible 提取模型。可单独设置：

```dotenv
TFT_AGENT_YOUTUBE_EXTRACTION_ENDPOINT=https://api.deepseek.com/v1
TFT_AGENT_YOUTUBE_EXTRACTION_MODEL=deepseek-v4-flash
TFT_AGENT_YOUTUBE_EXTRACTION_API_KEY=replace-me
TFT_AGENT_YOUTUBE_EXTRACTION_RETRY_EMPTY_ONCE=true
TFT_AGENT_YOUTUBE_EXTRACTION_THINKING_MODE=disabled
TFT_AGENT_YOUTUBE_EXTRACTION_TRANSPORT_RETRIES=2
TFT_AGENT_YOUTUBE_EXTRACTION_TRANSPORT_RETRY_DELAY_MS=1000
```

未设置这些覆盖项时，摄取器会依次复用 `TFT_AGENT_CONCLUSION_*` 和项目现有的 OpenAI-compatible 配置。API Key 仅从环境变量读取，不会写入输出或日志。

DeepSeek V4 默认开启 thinking；结构化 JSON 提取会在官方 DeepSeek endpoint
上默认显式关闭它。否则 `temperature=0` 不生效，reasoning token 还可能在生成
JSON 正文前耗尽 `max_tokens`。其他 OpenAI-compatible endpoint 默认不发送
provider-specific `thinking` 字段，可通过 `auto/enabled/disabled` 显式配置。
模型、Prompt、Normalizer、输出上限、thinking 模式和分段参数都进入段缓存哈希；
HTTP/TLS 重试次数只影响传输可靠性，不使已有成功语义缓存失效。

## 2. 导入一条视频

```powershell
npm run youtube:import -- --url "https://www.youtube.com/watch?v=VIDEO_ID" --patch "17.1" --season "set17-live"
```

流程会：

1. 验证并提取 YouTube video ID；
2. 获取真实标题、作者、发布日期和带时间戳字幕；
3. 将长视频按时间和字符数分段；
4. 每个分段独立调用模型；非法 JSON/结构错误只自动修复一次，合法空结果再确认一次；
   临时 HTTP/TLS/429/5xx 会先按配置重试，并在 attempt artifact 中记录
   `transportRetryCount`；
5. 每个分段立即保存状态、原始字幕、原始模型响应、usage、拒绝 claim 和校验错误；
6. 成功分段生成严格 `KnowledgeDocument`；每篇视频文档强制标记
   `aiGenerated=true`、AI 字幕摘要来源、审核状态和披露文本；失败分段进入
   quarantine，不回滚其他分段；
7. 视频最终状态为 `success`、`partial_success` 或 `failed`；
8. 按视频版本和精确 season/patch scope 幂等写入 `.cache/semantic-index.sqlite`。

若没有配置远程 embedding，可显式使用本地 TF-IDF：

```powershell
npm run youtube:import -- --url "https://youtu.be/VIDEO_ID" --patch "17.1" --no-embeddings
```

重复导入同一视频会复用已校验的摄取结果。`--force` 会重建 envelope，
但继续复用 `视频版本 + 字幕哈希 + 模型/Prompt + 分段哈希` 一致的成功段缓存；
只有显式使用 `--reextract` 才会重新调用模型，并在 `runComparison` 中记录文档
新增、删除、变化和分段状态差异。

默认版本根目录位于输出 JSON 同目录的
`VIDEO_ID.artifacts/<videoVersion>/`。审计 artifacts 按运行隔离到
`runs/<runId>/`：

- `runs/<runId>/raw-transcript.json`：本轮原始带时间戳字幕；
- `runs/<runId>/segments/*/attempt-*.json`：原始 provider 响应、模型正文、
  usage、transport retry 和校验错误；
- `runs/<runId>/segments/*/segment-status.json`：段级 extraction status；
- `runs/<runId>/quarantine/*.json`：修复后仍失败的分段；
- `runs/<runId>/ingestion-envelope.json`：本轮完整运行快照。

版本根目录仍保留规范化字幕与
`segments/*/result-<configHash>.json` 成功段缓存。审计记录与可复用缓存分离，
所以 `--reextract` 不会覆盖前一轮原始响应。成功段缓存可跨重复执行复用；
失败段不会作为成功缓存复用，下次执行会重新尝试。

当前 Prompt 与 Normalizer 均为 v6：每段最多输出 12 条互不重复的知识；
claim 主导语言与字幕不一致时，首轮结果会被拒绝，并在唯一一次 JSON repair
中要求按字幕语言重写。

视频摘要正文来自创作者字幕，但摘要本身由 AI 提取和概括。未完成人工审核时，
文档必须使用 `reviewStatus=ai_generated_unreviewed`；HTTP 和前端证据卡会
显示“AI 生成 · 未经人工复核”，并提示用户点击时间点核对原视频。

若公共字幕接口受网络/IP 限制，可在已登录的浏览器中取得当前视频的
YouTube JSON3 timedtext 和公开元数据后，用不含 Cookie 的文件离线回放：

```powershell
npm run youtube:import -- `
  --url "https://www.youtube.com/watch?v=VIDEO_ID" `
  --timedtext-json3 ".cache/youtube/live/VIDEO_ID.en.json3" `
  --source-metadata ".cache/youtube/live/VIDEO_ID.metadata.json" `
  --season "set17-live" --patch "17.7" --region "global" --locale "en"
```

也可以用 `--source-envelope <youtube_ingestion.v2.json>` 重放此前真实捕获的
相同字幕版本。两种路径都会重新校验 `videoId`、`transcriptHash` 和
`videoVersion`；不会读取、导出或写入浏览器 Cookie。

## 3. 将服务器外部生成的 JSON 入库

生产容器无需安装 Python。可以先在受控机器完成摄取，再把 JSON 交给 Node 主服务入库：

```powershell
npm run youtube:import -- --input "services/youtube-ingestion/output/VIDEO_ID.json" --no-embeddings
```

这条路径要求 `youtube_ingestion.v2`，并再次执行 Node 侧严格校验。新版本入库后，
只删除同一 `sourceId + season + patch + region + locale` 范围内已经消失的旧文档；
其他视频、其他 patch 和其他 namespace 不受影响。

同一 `videoVersion` 后续出现 `partial_success` 时，索引器不会因为临时失败而
删除本次 quarantine `segmentId` 上一轮的成功文档；这些记录会标记
`preservedFromQuarantinedSegment=true` 和
`latestIngestionStatus=partial_success`。如果 `videoVersion` 已变化，
则不继承旧版本文档，防止两个字幕版本静默混用。

## 4. 启用查询与回答

```dotenv
TFT_AGENT_KNOWLEDGE_MODE=on
TFT_AGENT_SEMANTIC_INDEX_PATH=.cache/semantic-index.sqlite
```

`TFT_AGENT_KNOWLEDGE_MODE=on` 会在 embedding 关闭时启用本地 TF-IDF 检索。若 embedding 已正确配置，系统会同时使用向量检索和词法回退。

混合战术回答默认复用 `TFT_AGENT_CONCLUSION_*` 模型，也可以使用 `TFT_AGENT_COACH_*` 单独覆盖。模型不可改写结构化统计：涉及“当前最好”的结论必须由 MetaTFT 候选第一名决定；视频只提供原因、条件、过渡、站位和其他创作者建议。

## 5. 验证

```powershell
npm run test:youtube:python
npm run smoke:youtube
npm run youtube:acceptance
npm run youtube:acceptance:live -- --capture-root .cache/youtube-acceptance/live
npm run youtube:acceptance:review-packet
npm run youtube:acceptance:review:export
```

固定审核验收集位于
`services/youtube-ingestion/acceptance/manifest.json`。验收器分别输出：

- 实体 precision/recall/F1；
- claim 准确率、召回率与 F1；
- 条件提取率；
- 时间戳正确率；
- 无关内容过滤率；
- 重复知识率。

未取得字幕或缺少 annotation 的案例会进入 `unannotatedCaseIds`，命令返回
非零，不得把“成功生成文档”冒充为完整工程验收。

仓库当前冻结标注的 reviewer 是 `Codex transcript-window review`，状态为
`provisional`，来源显式标记为 `ai_generated_provisional`。它可用于回归和
方向性指标，但不冒充独立人工盲标。默认
`thresholds.enforcement=advisory`：工程验收可以通过，同时单独报告
`qualityThresholdsPassed`。`youtube:acceptance:review-packet` 会生成包含六个
视频、88 条 seed claim 和全部 3730 个冻结字幕片段的只读审核包。

如需升级为独立人工审核等级，可使用：

```powershell
npm run youtube:acceptance:review:export
# 人工填写 .cache/youtube-acceptance/human-review.json
npm run youtube:acceptance:review:apply
npm run youtube:acceptance:review:evaluate
```

`review:apply` 不覆盖仓库中的 provisional seed，而是在
`.cache/youtube-acceptance/reviewed/` 生成一套已签核的 manifest 与
annotations。导入器会校验 manifest hash、字幕 hash、逐条 claim/window
fingerprint，防止审核期间样本发生变化。它还支持 `modified` claim 和
`additionalClaims`，因此人工审核不能只确认模型已有输出，还必须补充 seed
遗漏的来源支持结论。

启用 `requireIndependentHumanReview=true` 时，验收器要求每个 annotation
都具备：

- `annotationStatus=complete`；
- `reviewerType=human`；
- `independentHumanReview=true`；
- `transcriptCoverageReviewed=true`；
- `exhaustiveClaimReview=true`；
- 有效的 `reviewer` 与 `reviewedAt`；
- 每条 claim 的 `reviewDecision` 为 `supported` 或 `rejected`；
- 每个无关窗口的 `reviewDecision` 为 `confirmed_irrelevant` 或 `rejected`。

默认 AI provisional 等级会明确输出
`acceptanceLevel=ai_generated_provisional`、
`qualityMetricsStatus=provisional_ai_generated` 和披露文本。启用强制人工
模式后，任一案例未签核仍会令 `complete=false, passed=false`。

`youtube:acceptance:live` 会按 annotation 中显式冻结的输入方式和分段粒度，
顺序重放六个真实捕获源，再自动运行质量门槛。默认使用 `--force`：成功段命中
缓存，失败段重试；加 `--reextract` 才会对 34 个段全部重新调用模型，用于
独立的模型漂移压力测试。输出会逐案例报告文档数、段数、quarantine、
cache hit、真实模型段数、thinking 模式和传输重试次数。

界面左栏显示最终回答，右栏“查询与证据”保留 MetaTFT 统计，并展示视频标题、
作者、发布日期、时间点、适用条件和可跳转的来源链接。每条 AI 视频摘要同时
显示审核状态徽标和核对原视频提示。移动端沿用结果面板的切换/返回交互。

## 失败与降级

- 字幕或视频级元数据不可用：视频导入失败，不写入索引。
- 单段 JSON 非法：只隔离该段；其他成功段仍可形成 `partial_success` 并入库。
- 两次都合法为空：段状态为 `empty`，保留两次原始响应，便于复核。
- 没有知识命中：结构化查询继续返回 MetaTFT 结果；知识问答明确提示证据不足。
- 回答模型不可用或输出越权：使用确定性模板回退，并保持 MetaTFT 排名不变。
- 没有 MetaTFT 结构化候选：视频观点可以作为条件性攻略回答，但不会被描述成“当前最好”。

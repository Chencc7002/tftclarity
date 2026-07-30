# YouTube Hybrid 第一阶段实施映射

更新日期：2026-07-28

## 1. 优先级与边界

实施优先级依次为：

1. 当前 `tftclarity` 代码、测试、EvidencePack、Validator、SQLite 语义索引、会话与前端协议；
2. `docs/tftclarity-youtube-hybrid-codex-handoff-v2.md`；
3. `victorxia18/tft-meta-mind` 的只读参考实现。

Node.js 继续承担用户请求、MetaTFT 查询、知识入库和检索、EvidenceBundle、最终回答、校验、会话与前端返回。Python 仅承担手动 YouTube URL 的字幕与元数据采集、时间戳分段、结构化攻略提取和 `KnowledgeDocument` JSON 输出。

## 2. 两仓库模块映射

| 参考仓库 | 可复用思路 | tftclarity 落点 | 处理方式 |
| --- | --- | --- | --- |
| `scraper/youtube.py::_extract_video_id` | 标准、短链、embed、shorts 和裸 ID | `services/youtube-ingestion/youtube_fetcher.py` | 重写并补充 URL 主机校验、live 路径和测试 |
| `TFTYouTubeScraper.fetch_transcript` | 字幕文本、开始时间、持续时间 | `services/youtube-ingestion/youtube_fetcher.py` | 使用 `youtube-transcript-api`，保留逐条时间戳和语言 |
| `fetch_video_metadata` | 标题、频道、发布日期 | `services/youtube-ingestion/metadata_fetcher.py` | 重写；oEmbed 与页面结构化元数据降级组合 |
| 长视频 15 分钟分段 | 按字幕时间切分 | `services/youtube-ingestion/transcript_chunker.py` | 重写；每段保留起止时间与逐句时间戳 |
| Gemini 攻略提取 Prompt | 过滤广告/闲聊，提取装备、开局、过渡等栏目 | `services/youtube-ingestion/guide_extractor.py` | 改为现有 OpenAI-compatible/DeepSeek，严格 JSON |
| `data/youtube_videos.json` | 视频 ID 去重 | Python 输出文件 + SQLite 确定性文档 ID | 重写；重复运行安全 upsert |
| `generate_youtube_document` | 来源标题、作者、日期、URL | `KnowledgeDocument.metadata` | 重写为统一协议，不生成自由 Markdown |
| `vector_store._chunk_by_sections` | 语义完整切块 | 时间窗口分段 + 每条结构化 claim | 重写；不引入 Markdown 标题切块 |
| ChromaDB 确定性 ID | 重跑不重复 | `semantic_documents(season_context_id,id)` | 复用思路，使用现有 SQLite |
| `chatbot/app.py` 分类检索 | 攻略题优先视频，数据题优先统计 | `src/routing/answer-mode-router.js` | 重写；不替代现有 Intent/实体解析 |
| Gemini RAG 回答 | 数据与攻略共同进入回答 | `src/coach/hybrid-answer-service.js` | 重写；MetaTFT 统计拥有“当前最好”主结论权 |
| Streamlit UI | 来源可见 | 现有小窗口左侧聊天、右侧查询与证据面板 | 仅参考交互，不接入代码 |

## 3. 可迁移、重写和禁止项

### 可迁移的算法级思路

- YouTube 视频 ID 解析覆盖面；
- 带时间戳字幕保存；
- 超过 30 分钟的视频按约 15 分钟窗口处理；
- 本地采集、服务器只读取 JSON 入库；
- 视频 ID 与片段序号组成确定性文档 ID；
- 无字幕、元数据失败和重复视频的明确错误/降级。

### 必须重写

- Gemini 调用改为项目已有 OpenAI-compatible 配置；
- 自由 Markdown 改为 `KnowledgeDocument` 与结构化 claim；
- ChromaDB 写入改为现有 `SemanticDocumentStore`；
- 英文正则 Router 改为顶层 `AnswerModeRouter`，保留现有解析器主权；
- 参考聊天层改为现有小窗口请求、会话和结论返回链；
- tactics.tools 数据改为现有 MetaTFT 查询链。

### 禁止接入

- Streamlit、ChromaDB、Gemini 强依赖；
- 第二套聊天 UI、会话状态、结论系统或向量数据库；
- tactics.tools 爬虫；
- 视频观点覆盖 MetaTFT 当前统计；
- 自动遍历 YouTube、频道订阅、Bilibili 或大规模 Agent Loop。

## 4. 协议

`KnowledgeDocument` 支持需求文档列出的全部 `documentType` 和 `claimType`。`video_guide` 文档必须包含：

- `source=youtube`、`sourceId`、`sourceTitle`、`author`；
- `publishedAt`、`timestampStart`，可选 `timestampEnd`；
- `season`、`patch`、`region`、`locale`；
- `topics`、`claimType`、`conditions`、`sourceUrl`；
- 可选 `expiresAt`。

`EvidenceBundle` 将现有结构化结果与知识证据并列，且声明：

- `structuredAuthority=primary_statistics`；
- `knowledgeAuthority=creator_advice/mechanism/...`；
- `currentBestAuthority=metatft`；
- 不同 patch/赛季不可无提示混用。

## 5. Node/Python 边界

```text
Python CLI
YouTube URL
  -> 视频 ID
  -> 字幕、时间戳、标题、频道、发布日期
  -> 时间窗口分段
  -> DeepSeek 结构化提取
  -> Schema 校验
  -> KnowledgeDocument JSON

Node CLI/服务
KnowledgeDocument JSON
  -> 二次 Schema 校验
  -> SQLite semantic_documents（video_guide）
  -> video_guides 检索
  -> MetaTFT QueryResult + KnowledgeEvidence
  -> EvidenceBundle
  -> DeepSeek 综合回答与确定性校验
  -> 左侧回答 + 右侧查询与证据
```

## 6. 新依赖

Python 第一阶段仅新增：

- `youtube-transcript-api>=1.0.0`

HTTP 元数据和 OpenAI-compatible 调用使用 Python 标准库，避免引入 `requests`、Gemini、ChromaDB、Streamlit、Playwright 或第二套模型 SDK。Node 不新增生产依赖，继续使用 Node 18+ 自带 `fetch`、现有 `dotenv` 和 SQLite 适配层。

## 7. 许可证

参考仓库为 MIT License，Copyright (c) 2026 Victor Xia。实现以接口与算法思路重写为主，不复制其 Streamlit、ChromaDB 或 Gemini 聊天层。若保留任何实质性代码片段，需在对应源文件头部和第三方声明中保留 MIT 版权与许可文本；当前计划不直接复制大段源代码。

## 8. 变更文件

计划新增：

- `src/routing/answer-mode-router.js`
- `src/knowledge/knowledge-document-schema.js`
- `src/knowledge/knowledge-indexer.js`
- `src/knowledge/knowledge-retriever.js`
- `src/knowledge/evidence-bundle-builder.js`
- `src/coach/coach-provider.js`
- `src/coach/hybrid-answer-service.js`
- `services/youtube-ingestion/*.py`
- `services/youtube-ingestion/*.schema.json`
- `scripts/import-youtube-guide.mjs`
- 对应 Node/Python 单元测试与 smoke。

计划修改：

- `src/app/small-window-server.js`：RAG/Hybrid 编排和统一返回；
- `src/app/small-window-ui/app.js`、`index.html`、`styles.css`、`i18n.js`：查询与证据面板和视频来源；
- `src/index.js`：公共导出；
- `package.json`：导入与 smoke 命令；
- `.env.example`、`.env.production.example`：提取配置；
- `README.md`：人工导入流程。

## 9. PR 拆分

1. 协议、AnswerModeRouter、EvidenceBundle 与单元测试；
2. YouTube Python ingestion、结构化提取、Schema 校验与离线 smoke；
3. `video_guide` SQLite 入库、检索与增量更新；
4. MetaTFT + YouTube Hybrid 回答、权威规则和降级；
5. 左侧教练回答与右侧查询/统计/视频证据面板；
6. 回归、真实可选 smoke 和部署文档。

## 10. 测试计划

- Router：Structured/RAG/Hybrid、未知 Intent 不直接拒绝；
- URL：标准、短链、embed、shorts、live、裸 ID、非法主机；
- 字幕分段：边界时间、空字幕、超长片段；
- 提取：严格 JSON、无效 claim、时间戳越界、空结果；
- Schema：documentType、claimType、来源、时间、topics、conditions；
- SQLite：`video_guide` upsert、重复导入、类型/patch/locale 检索；
- Hybrid：MetaTFT 首选不被视频覆盖、冲突条件化、无视频降级；
- LLM：超时/无效 JSON 时仍返回结构化统计；
- 前端：视频标题、作者、日期、时间点、原视频链接和移动端面板；
- 全量 `npm test`、SQLite smoke、小窗口 smoke。

## 11. 部署影响

- Node 主服务和现有数据库保持不变；
- 生产镜像无需运行 Python 抓取时，可只接收本地生成的 JSON；
- 若服务器需要直接运行导入 CLI，镜像需安装 Python 3.10+ 和 `youtube-transcript-api`；
- YouTube 可能阻止云 IP 获取字幕，因此推荐人工本地导入 JSON 后再由服务器入库；
- 不配置提取模型时，导入会明确失败或允许仅输出原始分段，不会伪造攻略；
- 旧 SQLite 表无需破坏性迁移，`video_guide` 使用现有 `document_type` 隔离。

# MVP 核心实现进度

更新时间：2026-07-11

## 已完成

- 建立零依赖 Node ESM 项目骨架，优先保证离线可测。
- 实现规则版 `QueryParser`：支持霞、观星、星级、三件套、普通/光明/神器策略、已持有装备、样本阈值、排序意图。
- 补齐 `PreNormalizer` 的局内查询域归一化：NFKC 和大小写/空格处理之外，常见繁体字会在实体与规则解析前统一转为简体；`２星霞，３觀星，攜帶哪三件普通裝備最好？` 可生成与简体输入相同的 MetaTFT 参数。
- 新增 `src/data/pinyin-aliases.js` 作为高频无声调拼音入口维护表，覆盖霞/逆羽、剑魔、卡牌、龙王等常用英雄，观星/暗星/幻灵/机甲等羁绊，以及羊刀/无尽/巨杀/轻语/分裂弓等装备；拼音 alias 在 `createCatalog` 统一合并，因此种子目录、Explorer 动态目录和 `/comps` 动态目录行为一致。
- 实现确定性 `EntityResolver` 与种子字典：英雄、羁绊、装备别名优先走本地字典，不调用 LLM。
- 确定性实体解析会检测同一最长输入片段映射到多个概念实体的精确别名碰撞，并返回阻断式 `ambiguous_entity` 候选；同一羁绊的多个档位按概念实体归并，较长唯一别名仍优先。碰撞不会被上一轮会话 unit 继承或自动 LLM 解析覆盖，且即使其余查询校验通过也不会继续请求/排序；小窗可直接显示并点击候选。
- 单英雄 MVP 会对同一输入中命中的多个不同英雄返回阻断式 `multiple_units` 澄清和可点击候选，不会请求 Explorer；同一英雄的中英文重复提及会按 API id 去重，不误报多英雄。
- 规则解析器会同时识别前四、吃鸡、稳健高样本排序意图；同一输入命中多种排序时返回阻断式 `conflicting_sort` 澄清，不再按代码顺序静默选一个，单一排序意图保持可执行。
- 补齐 MetaTFT 多星级参数展开直接证据：`1星和2星霞` 会生成 `TFT17_Xayah-1_1_3,TFT17_Xayah-1_2_3`，不会把网页压缩写法直接透传给 API。
- 实现装备选项比较闭环：`比较/对比/哪个好/哪个更好/哪件更好/谁更好/更适合/二选一/还是` 会进入 comparison intent；只识别出一个装备时返回阻断式 `missing_comparison_option`。识别出两个以上选项后，不再把它们误当成同时已持有，而是对每个选项聚合包含它且尽量排除其他候选的三件套 `placement_count`，按当前前四/吃鸡/高样本策略比较，并展示代表三件套和统计口径。
- 比较查询支持把真正已持有装备与候选分离，例如“已有羊刀，无尽还是巨杀哪个更好”；所有候选都达到 `min_samples` 且达到稳定展示门槛 `max(200, min_samples * 2)` 才给出胜出结论，任一候选低样本时只展示数据。当前版本不可用候选仍在 `/comps` 和 Explorer 前返回本地裁决。
- 实现装备排除意图闭环：`不要/别带/别用/不用/排除/剔除/去掉/换掉/避开/规避/不考虑` 命中的装备写入独立 `excludedItems`，不会再被当作已持有装备；本地组合过滤、QueryValidator 冲突校验、查询缓存键、会话追问冲突消解、比较候选隔离、结果条件说明、小窗序列化和反馈白名单均已接入。显式“只看普通装备”不会因被排除的光明装备而扩宽策略，持有普通装备后再明确“允许光明”则会正确使用 `include_radiant`。
- 收紧低样本措辞：达到用户所选 `min_samples` 但低于稳定展示门槛的单项结果仍展示统计数据，但标题改为“低样本参考/低样本补齐参考”、取消 winner 高亮，并明确“不作稳定推荐”；装备比较同样不会在极低样本下给出胜出项。
- 实现 Domain Catalog Memory 第一版：
  - 可从 MetaTFT Explorer `/tft-explorer-api/units_unique` 与 `/traits` 抽取当前 set 的英雄/羁绊 API id。
  - 也可从 `/tft-comps-api/latest_cluster_info` 与 `/comp_options` 补充阵容形态里的英雄/羁绊 id。
  - 动态英雄/羁绊目录会与本地种子别名合并，保留“霞/Xayah”“3观星/Stargazer”等中文和高频别名。
  - 新增 `src/data/domain-alias-overrides.js` 作为高置信中文名/俗称维护文件，可给动态 API id 补 `zhName`、aliases、source 和 confidence；当前 `.probe` 审计里的 62 个英雄 API id 已全部覆盖人工高置信中文名/俗称，包括霞、亚托克斯/剑魔、阿卡丽、奥瑞利安·索尔/龙王、布里茨/机器人、凯特琳/女警、科加斯/大虫子、菲兹/小鱼人、古拉加斯/酒桶、格雷福斯/男枪、烬/戏命师、卡莎、乐芙兰/妖姬、易/剑圣、厄运小姐/女枪、内瑟斯/狗头、拉莫斯/龙龟、雷克塞/挖掘机、塔姆·肯奇/塔姆、泰隆/男刀、维迦/小法等入口。
  - 同一 override 文件新增 `apiName` 级羁绊别名映射，覆盖幻灵战队、暗星、宇航员、机甲、灵能特工、太空律动、刺客、近战、远程、法力、召唤等可从 token 稳定确认的中文入口；羁绊 `zhName` 现在可作为小窗展示名兜底，避免直接露出内部 token。
  - 小窗服务启动/首查时会缓存动态 catalog；即使 `/comps` 阵容上下文超时，也会保留 Explorer 生成的当前 set 英雄/羁绊字典。
  - 当前 patch 的动态英雄/羁绊目录会写入 Memory、JSON 或 SQLite store；Explorer 和 `/comps` 刷新失败时可按英雄、羁绊两侧分别恢复持久化快照。快照必须含 `metatft_explorer` / `metatft_comps` 动态来源才会被标记为持久化恢复，本地种子不会伪装成远端目录。
  - `latest_cluster_info` 与 `comp_options` 可独立贡献动态目录；即使 `comp_options` 返回无效 JSON，只要 latest cluster 成功，仍会生成并持久化其中的英雄/羁绊 id。
  - 当 `/comps` 成功时，会把同一批数据复用给默认阵容选择，避免首轮查询重复拉取。
  - 动态装备/英雄/羁绊目录与 `/comps` 请求现在并发发起；小窗的目录与默认阵容辅助请求默认 2.2 秒超时，`comp_options` 单独成功时仍可补默认上下文，不会因 `latest_cluster_info` 或 `/comp_builds` 失败而丢失。`/comps` 本轮预取失败会传递空快照，避免推荐链路对同一端点二次等待。
  - 小窗监听端口成功后会非阻塞预热默认 `patch:queue` 的动态 catalog；首个查询若与预热并发，会复用同一个 in-flight Promise，不会重复发起 6 个目录/阵容请求。刷新、清缓存和别名审核使用统一代次失效，旧慢请求即使晚到也不能覆盖新 catalog；失败加载会清理 in-flight 状态并允许下一次重试。
- 实现 `ContextBuilder`：补全 2 星、3 件普通装备、current、近 3 天、铂金以上、样本>=100。
- 实现 `Default Context Builder` 的选择逻辑：从 `/comps` 形态数据中筛选包含目标英雄的 cluster，支持按样本数、前四率、score 或平均名次选择默认阵容，默认仍按 count、score、avg 排序，并保留前 3 个候选阵容摘要供小窗展示；当候选阵容羁绊形态不同，会生成 warning 提醒这是按策略选择的默认上下文；`/comp_builds` 会作为默认阵容的辅助装备构建证据记录，不参与 Explorer 三件套最终排序，并在同一 cluster 的参考数据变化时单独刷新缓存。默认会排除 traits 带 `UniqueTrait` 或 `Augment` 标记的明确专属玩法候选；用户输入命中专属强化、英雄强化、赌狗、D牌/D卡、追三或 `reroll` 时优先选择这类候选，并使用独立缓存 key。
  - 默认阵容澄清采用保守阈值：只有候选羁绊 Jaccard 重合度不高于 25%，且当前策略指标近似并列时，才返回阻断式 `ambiguous_default_context` 并在 Explorer 前追问；样本/score/均名/前四优势明确时仍自动选择并展示候选 warning。默认上下文缓存键带歧义策略版本，旧策略缓存不会绕过新判定。
- 实现 `QueryValidator`、`QueryPlanner`、`MetaTFTClient`、`CompsContextClient`。未知羁绊不再作为 warning 透传给 Explorer；标记为已找到的默认阵容若缺少单位名单或不包含目标英雄也会阻断。核心服务在调用方只传 `compsData`、未显式传 catalog 时，会从同一份 `/comps` 数据构建当前英雄/羁绊校验目录。
- 修正 MetaTFT 客户端默认 host 为 `https://api-hc.metatft.com`，避免请求网站 host 返回 HTML。
- MetaTFT 两类 GET 客户端新增有界瞬时故障重试：默认最多重试 1 次，仅覆盖网络错误、HTTP 429 和 5xx，并支持指数退避、`Retry-After` 与最大等待上限；400、非 JSON、无效 JSON 和单次请求超时不会重试，避免局内等待无界放大，最终错误会记录实际 attempts。
- 小窗热路径不再沿用通用 Explorer 客户端的 8 秒默认值：核心 `unit_builds`、动态 catalog 和 `/comps` 默认均设为 2200ms，有 `TFT_AGENT_EXPLORER_TIMEOUT_MS` / `TFT_AGENT_CATALOG_TIMEOUT_MS` / `TFT_AGENT_COMPS_TIMEOUT_MS` 与对应 CLI 参数可覆盖；`GET /api/runtime` 和设置面板会显示核心查询超时。通用 `MetaTFTClient` 默认值保持 8 秒，供离线脚本或非局内调用自行配置。
- 新增实时 API smoke 脚本 `npm run smoke:metatft`：
  - 验证 `/tft-explorer-api/items` 能生成 item catalog。
  - 验证 `/tft-explorer-api/unit_builds/{unit}` 能返回霞三件套数据。
  - 验证推荐链路能用实时响应生成结果，并过滤 legacy 装备。
  - 默认把 `/tft-comps-api/latest_cluster_info` 与 `/comp_options` 作为可降级检查；端点超时时输出 warning，不阻断 Explorer 主链路 smoke。设置 `SMOKE_REQUIRE_CONTEXT=1` 可把该检查恢复为强制失败。
- 新增离线小窗 API smoke 脚本 `npm run smoke:small-window`：
  - 启动临时本地服务端口，不访问 MetaTFT 网络。
  - 验证 `/api/health`、`/api/runtime`、静态页面、偏好读写、低置信实体候选澄清、候选别名入库、候选审核启用后推荐、候选分页查询和 `/api/cache/clear`。
  - 验证显式排除装备不会进入锁定项或结果卡，并在结构化查询与文本条件中展示排除项。
  - 使用内存缓存和本地 fixture rows，适合作为发布前小窗主链路检查。
- 实现 MetaTFT 响应适配层：
  - Explorer `{ data: [...] }` 包装可归一化为 `unit_builds` rows。
  - `/tft-comps-api/latest_cluster_info` 可归一化为 cluster 列表。
  - `/tft-comps-api/comp_options` 的 `results.options[cluster][人口]` 嵌套结构可拍平成候选阵容 rows。
  - `/tft-comps-api/comp_builds` 的 `results[cluster].builds` 可拍平成装备构建 rows，并在默认阵容上下文中筛选出目标英雄/目标 cluster 的辅助参考。
- 实现 `recommendForInput` 服务入口：支持懒输入时用 `/comps` 数据补默认阵容，再用 Explorer 响应生成推荐。
- 实现受控 LLM 结构化解析层起步版：
  - 新增 `src/llm/structured-parser.js`，校验 LLM/RAG 解析输出必须是严格 JSON，并限制 intent、星级、装备数、装备策略、排序、段位、天数等字段取值。
  - schema 现在显式拒绝未知根字段、实体字段和约束字段；模型输出中的 `answer`、`api_name`、`best_item`、`force_item` 等未受控 key 会使本次结构化解析失效，不能覆盖规则结果或触发 Explorer。
  - 顶层 `intent`、`entities`、`constraints`、`needs_clarification`、`clarification_question` 均为必需契约；同一语义同时提交 snake_case/camelCase 两种字段也会被拒绝，避免模型冲突输出被 `??` 顺序静默选择。
  - 结构化 schema 新增 `excluded_items`，模型只返回玩家可见 mention；服务端仍用本地 catalog 解析并从 `ownedItems` 中剔除排除项。
  - 新增 `src/llm/chat-structured-parser.js`，提供默认关闭的 HTTP/chat-completions 兼容 provider 适配器，支持 endpoint/model/api key/timeout 配置、JSON response format、超时中断和请求结果回调。
  - 新增 `src/llm/prompts/parse-query.md` 作为后续模型接入的输出契约，明确禁止模型计算胜率、编造 MetaTFT API name 或直接判断装备强度。
  - `recommendForInput` 支持可选注入 `structuredParser`；默认关闭，自动模式会在未识别英雄或已检测到显式但未解析的装备/羁绊片段时调用，完整命中字典的高频输入仍不进入 LLM 热路径。
  - 小窗服务支持通过 `TFT_AGENT_LLM_PROVIDER=chat`、`TFT_AGENT_LLM_ENDPOINT`、`TFT_AGENT_LLM_MODEL`、`TFT_AGENT_LLM_TIMEOUT_MS`、`TFT_AGENT_LLM_MODE` 或对应 CLI 参数启用该 provider；设置面板可持久化“继承/自动/关闭/始终”解析策略，但 endpoint、model 和 API key 仍只来自启动配置，未配置时保持纯规则/字典路径。
  - 结构化解析结果只会补充玩家可见 mention（如“霞”“羊刀”）和约束字段，最终实体仍必须经本地字典、ContextBuilder 与 QueryValidator 校验后才能查询。
- 实现本地实体候选检索兜底：
  - 新增 `src/llm/entity-candidate-retriever.js`，基于当前 catalog 的英雄/装备/羁绊别名做 BM25/关键词、子串、Damerau-Levenshtein、n-gram overlap 与本地稀疏 TF-IDF cosine 评分，用作轻量 RAG 前置版本。
  - BM25 与稀疏向量文档、IDF、文档向量范数按 catalog 对象身份与实体类型集合缓存在 `WeakMap` 中；同一运行时目录会复用索引，catalog 刷新或别名审核生成新目录时自动构建新索引，旧目录不再被引用后可由垃圾回收清理。另提供显式创建、获取和清理索引接口供后续持久化实现复用。
  - BM25/关键词召回可处理词序变化的长尾英文/拼音别名，例如 `assassin carry shadow` 可作为 `shadow assassin` 的候选召回；召回结果仍只进入澄清，不会直接执行查询。
  - 稀疏 TF-IDF 使用 alias 字符 1/2/3-gram 与关键词特征构建向量；当子串、编辑距离和 BM25 都未命中时才使用 cosine 后备。`tfidf_vector` 置信度封顶 0.88，无法满足高置信 resolver 对 `matchType=fuzzy && confidence>=0.90` 的门禁；重排中文别名测试确认只返回候选澄清，Explorer 调用为 0。
  - 新增 `src/core/high-confidence-entity-resolver.js`，补齐架构中的受控高置信 fuzzy 通道：只接受当前 catalog 内唯一领先的 Damerau-Levenshtein 模糊候选，默认要求置信度 `>=0.90`、ASCII 输入片段至少 8 字符、领先第二候选 `>=0.08`，并拒绝低置信 catalog alias。命中后仍进入 ContextBuilder、QueryValidator、装备过滤和本地排序，且在结果提示中展示识别映射。
  - `recommendForInput` 与 `recommendFromRows` 在缺少英雄，或英雄已知但“已有装备/显式羁绊”片段未被规则字典识别时，会把候选挂到 `clarification.entityCandidates`，并保留 `clarification.suggestions` 为字符串数组以兼容现有小窗 UI。
  - 候选会携带 `inputFragment`，用于把用户输入里最像别名的片段保存为候选 alias；例如 `xayha best items` 会提示 `TFT17_Xayah`，并记录 `xayha` 作为可人工审核的候选片段。
  - 已知英雄下的低置信装备/羁绊会返回 `unresolved_item` / `unresolved_trait` 阻断式澄清；例如 `霞有guinso，剩下两件怎么带？` 会给出羊刀候选，并在 Default Context Builder 与 Explorer 前停止。候选查询文本会保留原问题，只替换低置信片段。
  - BM25、稀疏向量、短词、中文近形词、低置信和近似并列候选只用于澄清与后续人工确认；高置信 fuzzy 解析也不会写入主字典。`xayha`、`guinso`、重排向量候选与两个同分长别名均保持阻断，并在 `/comps` 和 Explorer 前停止。
- 实现 `Clarification Policy` 第一版：
  - 对缺英雄的输入返回结构化 `clarification`，不直接编造查询结果。
  - 支持“只识别到装备但没有英雄”的追问，例如 `guinsoo` / “羊刀怎么带？”会问“要查哪个英雄？”。
  - 支持英雄已识别但装备/羁绊低置信时追问，不会把未识别约束静默丢弃后继续推荐。
  - 小窗 UI 会渲染追问卡、建议输入和结构化实体候选；用户可点击候选直接查询，或把低置信候选片段通过 `/api/feedback` 写入 disabled 候选别名库，等待人工启用。
  - 有效查询不会被澄清策略阻断。
- 实现零依赖缓存/记忆存储层：
  - `MemoryCacheStore` 用于小窗会话热缓存与测试。
  - `JsonFileCacheStore` 用于 SQLite 前的本地持久化过渡。
  - 支持 `query_cache`、`default_context_cache`、`session_state`、`user_preferences`、按 patch 的 `item_catalog` 和英雄/羁绊 `domainCatalogs` 快照；缓存类支持 TTL、过期清理和 stale 读取，用户偏好与版本目录长期保存。
  - `MemoryCacheStore`、`JsonFileCacheStore`、`SQLiteCacheStore` 统一提供装备和 domain catalog 的读写清理接口；`clearDomainCatalog` 统一返回删除的英雄/羁绊记录数。清查询历史保留版本目录，完整清空才删除。
  - 新增短期状态清理接口：`clearQueryCache`、`clearDefaultContextCache`、`clearSessionState`、`clearQueryHistory`/`clearTransient` 可清掉查询缓存、默认阵容缓存和会话追问历史，同时保留长期用户偏好。
  - 新增反馈/候选别名记忆接口：`addFeedbackEvent` / `listFeedbackEvents` 和 `addEntityAlias` / `findEntityAliases` / `listEntityAliases`，用于保存用户纠错、低置信 alias/RAG 候选；候选别名可保持 `enabled=false`，不会自动污染主字典。
  - 反馈幂等查找已从“最近 500 条”下沉为 store 级 `findFeedbackEventByFeedbackId`：Memory/JSON 扫描完整内存集合，SQLite 扫描完整持久表；小窗按 `feedbackId` 串行化同进程并发写入，超过 500 条历史或两个并发请求都只保留首次反馈。
  - 新增候选别名审核接口：`setEntityAliasEnabled` 可显式启用/停用候选别名；小窗加载 catalog 时只会合并 `enabled=true` 且目标实体存在于当前 catalog 的别名。
- 实现 SQLite Cache Store 起步版：
  - 新增 `SQLiteCacheStore` 与 `SQLITE_CACHE_SCHEMA`，覆盖 `user_preferences`、`session_state`、`query_cache`、`default_context_cache`、`entity_aliases`、`item_catalog`、`units`、`traits`、`feedback_events` 等文档规划表。
  - 对外接口与现有 `MemoryCacheStore` / `JsonFileCacheStore` 保持一致，支持 query/default-context/session 的 TTL、stale 读取、过期清理、长期 user preferences，以及 `entity_aliases` / `feedback_events` 的写入和查询。
  - 当前作为可选 store 使用：可注入同步 SQLite database，或在支持环境中通过 `SQLiteCacheStore.open()` 使用 `node:sqlite` / `better-sqlite3`；小窗默认仍保留零依赖 JSON store。
  - 小窗服务已支持 `TFT_AGENT_CACHE_STORE=sqlite` / `TFT_AGENT_CACHE_PATH=...`，Node 服务参数 `--cache-store sqlite --cache-path ...`，以及 PowerShell 启动器参数 `-CacheStore sqlite -CachePath ...`。
  - 新增 `npm run smoke:sqlite`，有 SQLite driver 时会创建真实文件库并覆盖偏好、会话、查询缓存、默认阵容缓存、候选别名和反馈事件的读写清理链路；无 driver 时明确输出 `SQLite smoke skipped`，不影响默认 JSON store。
  - Node 24 实际文件 smoke 现同时覆盖 `item_catalog`、`units`、`traits` 往返，以及小窗运行时关闭数据库后重开并命中查询缓存、远程调用保持 0。
- `recommendForInput` 已接入缓存与 Session Memory：
  - 追问缺英雄时可继承上一轮 `last_query`，支持“那有羊刀呢？”这类 item-only follow-up。
  - 会话继承字段在 `query.assumptions` 中标记为 `session`，文本输出使用“沿用上轮”而不是误报为本轮用户输入；上一轮由 Default Context Builder 补出的羁绊不会作为显式 trait 直接继承，而会用继承的英雄重新命中 `default_context_cache`，恢复完整 cluster、来源和默认条件说明。
  - 新追问明确识别到普通已持有装备时会回到 `ordinary_only`，不会错误沿用上一轮光明/神器策略；光明、神器、纹章等仍按当前识别到的 catalog 分类推导。
  - 默认阵容上下文优先读 `default_context_cache`，未命中才拉 `/tft-comps-api/latest_cluster_info` 和 `/comp_options`，并尽量拉 `/comp_builds` 作为辅助证据；`/comp_builds` 失败不会阻断默认阵容补全。
  - 默认阵容缓存 key 会包含默认阵容策略，避免切换样本/score/均名策略后复用旧默认阵容。
  - 当调用方已经提供 fresh `/comps` 数据时，会用 cluster 指纹校验 `default_context_cache`；若当前主流 cluster、单位列表或羁绊列表变化，会失效旧缓存并写入新默认阵容。调用方明确提供 `/comp_builds` 时，同 cluster 的辅助装备参考变化也会单独刷新，不会参与最终三件套排序。
  - MetaTFT `unit_builds` 响应优先读 `query_cache`，远程失败时可回退到过期缓存并给出提示。
- 实现 User Preference Memory 的第一版：
  - 小窗默认偏好 key 为 `small_window`，保存样本阈值、装备策略、排序偏好、天数、段位过滤、默认阵容策略。
  - 提供 `GET /api/preferences`、`POST /api/preferences` 和 `DELETE /api/preferences`。
  - `POST /api/recommend` 会先读取保存的偏好，再用当前请求里的临时偏好覆盖。
  - 前端启动时自动恢复保存的偏好；切换样本阈值、装备策略、排序、天数、段位、默认阵容策略时自动写回。
  - 小窗设置面板可修改近 1/3/7/14/30 天、段位过滤、默认阵容策略（样本/前四/Score/均名），并可重置长期偏好。
- 实现 item catalog 生成与分类规则：
  - 可从 MetaTFT `/tft-explorer-api/items` 的 `{ data: [...] }` 或 `{ results: [{ itemName, places }] }` 响应生成装备目录。
  - 自动分类普通成装、组件、光明、神器、转职/纹章、辅助/战术家、Set 特殊、legacy/removed、unknown。
  - 生成目录会与本地中文种子别名合并，保留“羊刀/火炮/RFC/分裂弓”等高频别名。
  - 新增 `src/data/item-alias-overrides.js` 作为高置信装备中文名/俗称维护文件，可给动态 item API id 补 `zhName`、`shortName`、aliases、source 和 confidence；当前覆盖法爆、泰坦、饮血、蓝 buff、反甲、龙牙、石像鬼、离子、鬼书、帽子、红 buff、电刀、血手、狂徒、大天使、组件、自然之力、正义、日炎、复活甲、鱼骨头、巫妖、卢登、纳沃利、暗爪、三相、死亡之舞、金身等常见入口。`TFT_Item_Artifact_CappaJuice` 已按 Riot 英文补丁说明加入高置信 `Cappa Juice` 英文入口，但未伪造简中译名。
  - 新增 item catalog 派生别名：`TFT17_Item_*EmblemItem` 会从当前羁绊字典自动生成“纹章/转/转职”入口；缺少 trait 映射的纹章会保留英文 token 兜底（如 `Pulsefire Emblem`），不伪造中文名；`TFT5_Item_*Radiant` 会从普通装备别名自动生成“光明 + 装备名/俗称”入口，例如“暗星转”“观星者纹章”“光明蓝 buff”“光明泰坦”；Set17 幻灵战队装备、灵能特工改件、英雄专属神器和艾克异常道具也有 token-derived 中文兜底名，例如“战斗兔弩”“光明无人机改件”“阿狸神器”“艾克异常”。
  - 新增 `npm run audit:aliases`，默认读取本地 `.probe` 抓包审计当前 set 的英雄、羁绊、装备人工别名覆盖率，并可用 `--write` 生成 `CANDIDATE_*_ALIAS_OVERRIDES` 草稿；候选草稿只用于人工审核，不会自动写入主字典。
  - 新增 `src/data/item-availability-overrides.js` 作为按 patch 维护的显式装备可用性清单；清单优先级高于动态 MetaTFT 行、本地种子状态、目录合并结果和调用方附加 denylist，当前已记录需求文档明确的 `TFT_Item_RunaansHurricane` 当前版本移除规则，并保留 reason/source 审计信息。
  - 新增 `npm run audit:items`，检查显式清单的必填字段、重复项和冲突状态，并用当前 `.probe/meta_items_expanded.json` 与合成动态行验证规则最终落为 `removed_or_legacy && current=false && obtainable=false`。
  - 小窗成功刷新 `/items` 后会把合并后的当前 patch 装备目录写入持久化 store；刷新失败或返回空目录时优先恢复同 patch 快照，只有没有快照才退回种子字典。恢复快照后仍会重新应用 `item-availability-overrides`，旧快照不能把分裂弓等硬移除项重新放行。
- 实现 `placement_count` 本地计算：样本数、前四率、吃鸡率、平均名次。
- 实现当前装备策略过滤：普通装备只允许 `ordinary_completed && current && obtainable`，分裂弓这类 legacy 会被剔除/提示。
  - 对“霞能不能带分裂弓？”这类已命中当前不可用装备清单的输入，会在 Default Context Builder 和 Explorer 之前直接返回本地 `unavailable_items` 裁决，不请求 `/comps` 或 `unit_builds`；有效英雄仍写入 `last_query`，后续追问可继承霞。
  - 用户已锁定的装备会优先按 catalog 分类推导查询策略：光明装备使用 `include_radiant`，神器使用 `include_artifact`，纹章/转职、辅助装、Set 特殊装备或跨特殊分类组合使用 `include_special`。`include_special` 仍不会放行组件、消耗品、历史装备和 unknown；输出会明确展示锁定装备及“含光明/神器/特殊装备”。
- 实现排序与中文小窗输出格式：1 个推荐 + 2 个备选，展示查询条件和系统补全。自定义段位子集会按真实集合显示，不再误标为“铂金以上”；零结果仍保留系统补全、会话来源和默认阵容来源；已锁定装备的首张小窗卡标题显示“推荐补齐”。
- 实现零依赖本地小窗原型：
  - `npm start` 启动 `src/app/small-window-server.js`，默认服务地址 `http://127.0.0.1:17317/`。
  - 提供 `POST /api/recommend`，调用现有 `recommendForInput`、MetaTFT Client、Comps Context Client 和缓存层。
  - `POST /api/recommend` 的小窗序列化会返回 `query.defaultContextSummary`，包含默认阵容名称、cluster、样本、前四率、均名、来源端点、可读来源说明、候选/备选阵容摘要、`/comp_builds` 阵容装备参考和默认阵容多候选 ambiguity。
  - 提供 `POST /api/session/clear`，可清空当前 `last_query` 追问上下文。
  - 提供 `POST /api/cache/clear`，可清空 query/default-context/session 短期缓存和运行时 catalog cache，但不会重置 `small_window` 长期偏好。
  - 提供 `GET /api/runtime`，返回脱敏后的缓存类型和 LLM provider/mode/model 状态；endpoint 与 API key 只返回是否已配置。
  - 提供 `POST /api/feedback`，可保存用户纠错、好/坏结果反馈，并可将 alias 候选以禁用状态写入候选库等待人工确认。
  - 每张小窗结果卡新增上/下反馈图标；提交内容只包含输入、结构化查询、该卡装备 API id、统计快照和缓存命中状态，不保存 MetaTFT 原始响应。`feedbackId` 在服务端做幂等，同一卡首次反馈后按钮锁定；反馈只写 `feedback_events`，不会静默修改偏好、catalog 或排序。
  - 提供 `POST /api/entity-memory/clear`，删除未启用候选别名与反馈事件，保留已启用别名和长期偏好，满足反馈记忆可清空要求。
  - 提供 `GET /api/entity-aliases`、`POST /api/entity-aliases/review` 与 `POST /api/entity-aliases/review-batch`，用于查看候选别名并人工单条或批量启用/停用；启用后会清理运行时 catalog cache，下一次查询即可走规则解析命中。
  - `GET /api/entity-aliases` 支持 `enabled`、`entityType`、`apiName`、`query`、`limit`、`offset` 参数，并返回 `pagination`，用于小窗候选审核的筛选和分页。
  - 提供 `GET /api/entity-aliases/export`，可从候选别名记忆生成 `CANDIDATE_*_ALIAS_OVERRIDES` JS 草稿，供人工审阅后再复制进正式 override 文件或从小窗下载。
  - 前端位于 `src/app/small-window-ui/`，包含输入框、结果卡片、样本阈值切换、装备策略切换、排序、刷新和查询条件展开。
  - 结果卡摘要会展示默认阵容名称、样本、前四率、均名、选择策略、备选阵容、阵容装备参考和 `MetaTFT /comps` 来源，不再只暴露 cluster id；外部接口文本在摘要里会做 HTML 转义。
  - Explorer 远程请求失败并回退过期 `query_cache` 时，结果摘要会明确显示“过期缓存”和缓存更新时间，格式化文本也会展示带更新时间的降级 warning。
  - 设置面板新增“清历史”按钮，用于清理查询历史/短期缓存；“重置”仍只负责长期偏好恢复默认。
  - 设置面板新增只读运行状态，展示当前缓存类型与 LLM 状态，不暴露 endpoint 或 API key 原文；并新增结构化解析策略选择，默认继承启动配置。
  - 设置面板新增“别名”审核区，可按状态、实体类型、文本搜索筛选候选别名，支持上一页/下一页分页，刷新候选别名列表，导出/下载 `CANDIDATE_*_ALIAS_OVERRIDES` 草稿，并对候选/已启用别名执行单条或批量启用/停用；前端会对候选内容做 HTML 转义，避免用户反馈内容注入页面。
  - 刷新按钮会绕过 query/default-context 缓存读取，并失效当前 patch/queue 的运行时 catalog，仍复用核心推荐链路并写回新缓存；其他 patch/queue 的 catalog 与长期偏好不受影响。
- 实现 Windows 小窗启动器：
  - `npm run window` 调用 `scripts/start-small-window.ps1`，启动本地服务并用 Edge/Chrome app window 打开固定尺寸小窗。
  - `npm run window:server` 以 `-NoBrowser` 模式只启动/检查服务，适合脚本验证。
  - 启动器支持 `-Port`、`-Width`、`-Height`、`-BrowserPath`、`-NodePath` 参数；已有健康服务时会复用端口。
  - 启动器新增 `-TopMost`、`-WindowLeft`、`-WindowTop` 参数，浏览器 app window 打开后会用 Win32 `SetWindowPos` 尝试置顶并定位窗口；这是轻量桌面体验封装，不等同完整原生壳。
  - 启动器默认启动单实例全局热键辅助进程，按 `Ctrl+Shift+Space` 可恢复并置前标题包含 `TFTAgent` 的 Edge/Chrome app window；可通过 `-NoHotkey` 关闭，或用 `-Hotkey "Ctrl+Alt+Space"` 改键。
  - 新增 `npm run smoke:hotkey`：以独立互斥体和 `Ctrl+Alt+F24` 真实注册一次热键，1 秒后自动注销并退出，不占用默认热键，也不会残留后台进程。
  - 启动器说明见 `docs/small-window-launcher.md`。
- 扩充种子装备字典，加入火炮/RFC、麦瑞德、力量手套、科技枪、水银等常见普通成装。
- 补充 Node 测试，覆盖标准查询、已持有羊刀、legacy 过滤、默认阵容选择、本地统计计算、默认 API host、小窗 API 序列化，以及 `.probe` 中真实 MetaTFT 抓包响应。
- 补充动态 domain/item catalog 测试，覆盖从 `.probe` 的 `/comps` 抓包和 Explorer 聚合行生成当前 set 英雄/羁绊目录，并验证非种子英雄 token（如 `aatrox`）、中文英雄别名（如“剑魔”“卡牌”“龙王”“机器人”“女警”“大虫子”“小鱼人”“酒桶”“男枪”“戏命师”“虚空之女”“女枪”“狗头”“挖掘机”“小法”）、中文羁绊别名（如“暗星”“幻灵”）以及动态装备俗称（如“法爆”“泰坦”）可被规则解析命中。

## 最新验证

```text
node --check src\core\default-context-builder.js
node --check src\core\context-builder.js
node --check src\core\query-parser.js
node --check src\core\query-validator.js
node --check src\core\recommendation-service.js
node --check src\core\response-formatter.js
node --check src\data\metatft-response-adapter.js
node --check src\data\item-availability-overrides.js
node --check src\data\item-catalog.js
node --check src\app\small-window-server.js
node --check src\app\small-window-ui\app.js
node --check src\index.js

npm test
159 tests passed

npm run smoke:small-window
Small-window smoke checks passed.
hot cache: 1ms (target <=100ms)
reopened JSON cache: 3ms (target <=300ms)

npm run smoke:visual
standalone command skips without a project Playwright dependency; desktop Browser Playwright validation passed for 460px recommendation, 360px low-sample, and 360px empty-result states

npm run smoke:hotkey
Hotkey smoke checks passed.

npm run smoke:metatft
Smoke checks passed.

npm run smoke:sqlite
SQLite smoke skipped: no SQLite driver is available.

Node 24.14.0 + node:sqlite
SQLite smoke checks passed.
database bytes: 98304
query/default-context/session clear counts: 1/1/1
small-window runtime reopened query cache: hit=true, unexpected remote calls=0
item_catalog roundtrip: passed and preserved by clearQueryHistory
units/traits roundtrip: passed and preserved by clearQueryHistory
clearDomainCatalog counts: units=1, traits=1

npm run audit:aliases -- --limit=10
units: 62/62 covered, missing=0
traits: 100/100 covered, missing=0
items: 169/169 covered, missing=0

npm run audit:items
item availability overrides: total=1, patch=current, applicable=1, observed=1
```

最近一次实时 smoke 结果显示：

- `items` 返回 180 行，生成 180 条装备 catalog，本轮耗时 1120ms。
- `unit_builds` 返回 600 行霞数据，本轮耗时 495ms，满足 2000ms 目标。
- 推荐链路可生成实时装备结果，并继续过滤 legacy 装备。
- `/comps` 上下文本轮在 1842ms 内成功选择 cluster `409013`（样本 167，均名 3.1078，score 43.231），并补出 `TFT17_RangedTrait_1`、`TFT17_SpaceGroove_3`。smoke 仍保留默认可降级 warning，避免非官方阵容端点波动误伤核心验证。需要强验证默认阵容时使用 `SMOKE_REQUIRE_CONTEXT=1 npm run smoke:metatft`；可用 `SMOKE_REMOTE_TARGET_MS` 调整核心远程目标，用 `SMOKE_REQUIRE_REMOTE_LATENCY=1` 将超目标改为失败。

小窗本地验证：

- `GET http://127.0.0.1:17317/api/health` 返回 `{ "ok": true }`。
- `GET http://127.0.0.1:17317/api/runtime` 返回脱敏运行状态，可用于确认缓存类型和 LLM 是否启用。
- `GET http://127.0.0.1:17317/api/preferences` 返回保存的默认偏好。
- `POST http://127.0.0.1:17317/api/preferences` 可保存样本阈值、装备策略、排序、天数、段位过滤、默认阵容策略和结构化解析策略，并在刷新小窗后恢复；endpoint、model 和 API key 不会进入偏好存储。
- `DELETE http://127.0.0.1:17317/api/preferences` 可清空长期偏好并恢复默认。
- `GET http://127.0.0.1:17317/` 返回小窗页面。
- `POST /api/recommend` 输入 `xayah` 可返回 2 张装备结果卡。
- 当推荐链路补默认阵容时，`query.defaultContextSummary` 和结果摘要会展示默认阵容名称、样本、前四率、均名、备选阵容、阵容装备参考与 `MetaTFT /comps` 来源；如果备选阵容羁绊形态不同，`query.warnings` 会提示系统已按当前策略选择默认阵容。
- `POST /api/recommend` 输入 `xayha best items` 会返回 `reason=missing_unit` 的澄清结果，并在 `clarification.entityCandidates[0]` 中给出 `TFT17_Xayah`，`inputFragment=xayha`，小窗可点击候选查询或保存为 disabled 候选别名。
- `POST /api/recommend` 可直接处理 `２星 xia，３guanxing，已經有yangdao，剩下兩件怎麼帶？` 这类全角数字、繁体查询语法和拼音实体混合输入，返回霞的“推荐补齐”卡并锁定羊刀，不调用 LLM。
- `霞能不能帶盧安娜的颶風？` 会先归一化为本地实体并返回 `unavailable_items`；繁体写法不会绕过当前版本装备硬规则，且 `/comps` 与 Explorer 调用均为 0。
- `POST /api/recommend` 输入 `霞有guinso，剩下两件怎么带？` 会返回 `reason=unresolved_item` 与羊刀候选，不调用 `/comps` 或 Explorer；显式但未知的羁绊同样使用 `unresolved_trait` 阻断，而不是静默改用默认羁绊。
- `POST /api/recommend` 输入 `霞能不能带分裂弓？` 会返回 `decision.type=unavailable_items` 和“当前版本不属于可用普通装备”的明确说明，不请求 `/comps` 或 Explorer，并保留霞作为后续会话英雄。
- `POST /api/recommend` 输入 `霞有光明羊刀，另外两件怎么带？` 会自动使用 `include_radiant`、锁定光明羊刀并返回补齐卡；同一规则也覆盖无“神器”字样的神器俗称和用户明确锁定的纹章/转职等特殊装备。
- `POST /api/recommend` 输入 `2星霞3观星，羊刀和无尽哪个更好？` 会返回结构化 `comparison`、两张对比卡、聚合指标和代表三件套；胜出卡使用“更优：装备名”，候选装备使用独立标记，不会进入 `lockedItems`。任一候选未达到稳定展示门槛时 `winner=null` 且卡片显示低样本。
- `POST /api/recommend` 输入 `霞不要羊刀，其他三件普通装备怎么带？` 会返回独立 `excludedItems` / `excludedItemNames`，推荐卡不会包含羊刀，文本和折叠条件都显示“已排除：羊刀”；离线 HTTP smoke 已覆盖该路径。
- 当用户把阈值降到 10、最高组合只有 18 场时，结果卡标题为“低样本参考”、`winner=false`，文本明确“仅供参考，不作稳定推荐”；装备比较即使都超过 10 场，只要未达到 200 场稳定门槛也不会给出胜出项。
- 结果卡的上/下反馈按钮会向 `POST /api/feedback` 写入 `good_recommendation` / `bad_recommendation`；同一 `feedbackId` 重复或反向提交只保留第一条。测试确认未知原始响应字段不会落库，反馈前后长期偏好与推荐卡保持不变。
- `npm run smoke:small-window` 会启动临时端口并验证小窗 API 主链路、候选入库/审核启用和清缓存流程。
- 同一 smoke 会验证启动 catalog 预热入口、多英雄、冲突排序、缺失比较项和低置信已持有装备输入在请求 Explorer 前阻断，验证完整装备对比卡、显式排除装备、结果反馈幂等、光明装备锁定查询，并验证当前不可用装备直接本地裁决且不增加 Explorer 调用；同时使用真实 query-cache 写入路径检查热缓存 `<=100ms`，随后重新打开临时 JSON 文件缓存，确认不调用远程客户端且本地缓存 `<=300ms`。最近一次结果分别为 1ms 和 3ms，可通过 `SMOKE_HOT_CACHE_MAX_MS`、`SMOKE_LOCAL_CACHE_MAX_MS` 调整发布环境阈值。
- `POST /api/recommend` 输入 `guinsoo` 返回结构化澄清：`reason=missing_unit_with_item`，问题为“你说的是 羊刀，要查哪个英雄？”。
- UTF-8 中文请求 `霞带哪三件装备最好？` 可命中并返回结果。
- 浏览器检查：桌面内置 Browser 的 Playwright API 使用与 `smoke:visual` 相同的离线 fixture 完整渲染 460px 推荐卡、360px 低样本卡和 360px 零结果摘要。首次检查发现传统滚动条会把 `width: min(100vw, 460px)` 的 `.shell` 挤出 15px；改为 `width: min(100%, 460px)` 后，页面、面板、分段控件、统计格均无横向溢出，按钮、装备名和统计文字均无裁切。
- 视觉证据保存在 `.cache/visual-smoke/desktop-result.png`、`.cache/visual-smoke/narrow-low-sample.png` 和 `.cache/visual-smoke/narrow-empty-result.png`。可选 `npm run smoke:visual` 仍支持项目已安装 Playwright 时独立运行；未安装时明确跳过。
- `scripts/start-small-window.ps1 -NoBrowser -Port 17319` 可启动临时服务，通过 `/api/health` 检查后按 PID 清理。

## 当前限制

- 装备 catalog 已能从 MetaTFT items 抓包生成，并已有高置信中文名/俗称覆盖文件、派生纹章/光明装备/Set 特殊装备/英雄专属神器别名和覆盖审计脚本；消耗品已归类为 `consumable` 并从装备别名审计范围剔除。当前 items 人工入口覆盖 169/169；其中 `TFT_Item_Artifact_CappaJuice` 仅确认并支持 Riot 官方英文名 `Cappa Juice`，尚无可靠简中本地化，不应把满覆盖率等同于全部具备官方中文名。
- legacy/removed 判断已有分类规则和按 patch 的显式可用性清单，动态 API、种子目录、目录合并与调用方附加 denylist 都不能覆盖内置硬规则；当前清单只收录已由需求文档确认的 `TFT_Item_RunaansHurricane`，后续仍需在每次 set/patch 更新时运行 `npm run audit:items` 并人工维护新增移除项，不能凭 API token 猜测。
- 英雄/羁绊 API id 已能从 Explorer 聚合端点和 `/comps` 抓包动态生成到当前 set，并按 patch 持久化到 JSON/SQLite；刷新失败时可按实体侧恢复动态快照，`latest_cluster_info` 单独成功也能继续补目录。已有高置信中文别名覆盖文件和覆盖审计脚本；当前 `.probe` 英雄人工别名覆盖 62/62，羁绊覆盖 100/100。英雄专属 trait 和观星子类型已用低/中置信 token-derived 中文兜底名覆盖，后续版本变更时仍需用审计脚本复核。
- `Default Context Builder` 已能消费真实 `/comps` 抓包结构，支持样本/前四/score/均名四种默认阵容策略，并保留前 3 个候选阵容用于展示“狙神霞/观星霞”这类多候选默认上下文；候选羁绊形态不同会进入 warning。`/comp_builds` 已接入为目标英雄/目标 cluster 的辅助装备构建参考，但最终推荐仍以 Explorer `unit_builds` 和本地过滤/排序为准。当前 `/comp_options` 若没有前四率字段，前四策略会按 score、样本数、均名兜底。默认模式会排除 traits 带 `UniqueTrait` 或 `Augment` 的明确专属玩法 cluster，仅在没有普通候选时降级使用；显式输入专属强化、英雄强化、赌狗、D牌/D卡、追三或 `reroll` 时优先选择特殊候选，且选择模式会隔离默认阵容缓存。该模块已接入缓存接口；当 fresh `/comps` 数据可用时，已按 cluster 指纹校验并失效旧默认阵容。SQLite schema/store 起步版已实现，但小窗默认仍使用 JSON store。
- `MetaTFTClient` 已封装请求，服务入口也能消费真实响应结构；已提供实时 smoke，但常规测试仍以 `.probe` 抓包为准，避免非官方 API 与网络环境影响离线验证。
- 热缓存与本地 JSON 文件缓存已有可重复速度门禁；远程 API 的 1-2 秒仍是外部网络目标而不是当前可保证的硬 SLA。启动预热可把 catalog 辅助请求移出首查等待，但 Explorer `unit_builds` 和 `/comps` 的实际耗时仍受 MetaTFT 非官方端点波动影响。
- SQLite 版本的缓存/偏好表已有实现，且小窗已有启用开关和 `npm run smoke:sqlite` 验证入口；`better-sqlite3` 已声明为 optional dependency，默认 JSON 路径不依赖它。真实文件库已在 Node 24.14.0 的 `node:sqlite` 下通过 98,304 字节磁盘库 smoke，覆盖偏好、会话、查询缓存、默认阵容、装备与英雄/羁绊目录、候选别名、反馈和清理。系统默认 Node 18.20.8 仍无 `node:sqlite` 且未安装 optional driver，因此直接执行系统 `npm run smoke:sqlite` 会跳过；发布时需选择 Node 22.5+/24，或为 Node 18 安装 `better-sqlite3`。
- 小窗已有样本阈值、装备策略、排序、天数、段位过滤、默认阵容策略、清空长期偏好、清理历史、脱敏运行状态、低置信实体候选按钮/候选入库入口，以及候选别名单条/批量启用停用、筛选、分页和导出/下载草稿入口；后续仍需做更完整的设置页和偏好说明体验。
- 小窗 UI 已可通过 Windows 启动器以浏览器 app window 形式打开，并支持轻量 `SetWindowPos` 置顶/定位和单实例全局热键恢复窗口；尚未实现透明、贴边吸附、托盘、点击穿透等完整原生悬浮窗能力。
- 默认阵容返回的 trait id 已有当前 `.probe` 全覆盖中文映射；其中英雄专属 trait 和观星子类型是 token-derived 兜底名，不等同官方译名。UI 仍先做摘要压缩，后续如果拿到官方本地化表可替换为更准确展示名。
- LLM/RAG 已有受控结构化解析接口、严格 schema 校验、prompt 契约、默认关闭的 chat provider 适配器、本地 BM25/关键词与稀疏 TF-IDF 向量候选检索兜底、受阈值和候选间距约束的高置信英文 fuzzy 解析、按 catalog 身份复用的内存索引、小窗候选确认入口、反馈/候选别名落库接口、人工启用后合并进 catalog 的安全通道，以及候选别名批量审核和导出 override 草稿接口。候选检索已覆盖缺英雄以及英雄已知时显式未解析的装备/羁绊片段。小窗现可保存“继承/自动/关闭/始终”解析策略；稠密语义向量数据库和跨进程持久化检索索引仍未接入。endpoint、model 和 API key 保持在启动配置中，不会写入浏览器或长期偏好。当前默认仍符合安全要求：高频输入走规则和字典，唯一高置信长误拼可本地解析，BM25/稀疏向量/低置信或歧义输入先返回候选澄清；LLM provider 仍需显式配置才会启用。

## 下一步建议

1. 发布环境在默认 JSON 与 SQLite 间做最终选择；若启用 SQLite，优先固定 Node 22.5+/24，并用启动器 `-NodePath`、`-CacheStore sqlite` 和 `-CachePath` 做一次完整小窗启动验收。Node 18 路径则需要安装 `better-sqlite3`。
2. 继续用 `npm run audit:aliases` 跟踪版本变化；当前 items 入口覆盖 169/169。后续若取得 `TFT_Item_Artifact_CappaJuice` 的可靠简中本地化，再补中文名/俗称；现阶段只保留已确认的官方英文 `Cappa Juice`。
3. 版本更新后重新运行 `npm run audit:aliases -- --limit=40` 与 `npm run audit:items`，复核英雄 62/62、羁绊 100/100 和显式装备移除项是否仍成立；若 MetaTFT token、set id 或装备池变化，再补 `domain-alias-overrides.js` 与 `item-availability-overrides.js`。
4. 在按 catalog 复用的内存 BM25 + 稀疏 TF-IDF 索引基础上，评估后续是否接入跨进程持久化索引文件或稠密语义 embedding；候选仍必须走人工确认后才能进入主字典。
5. 在 Windows 启动器基础上继续封装桌面体验：贴边吸附、托盘、透明/点击穿透，可评估 Electron、Tauri 或 WebView2。
6. 将 `npm run smoke:small-window` 纳入默认发布前检查；`npm run smoke:metatft` 作为需要网络和非官方 API 稳定性的手动发布前检查，而不是默认 CI。

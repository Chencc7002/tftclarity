# MVP 验收矩阵

## 2026-07-12 单英雄 Comp 过滤验收

| 要求 | 状态 | 直接证据 |
|---|---|---|
| Data Explorer Comp 真实契约 | 已验证 | 浏览器检查页面脚本；A–E 实时请求矩阵；`docs/metatft-data-explorer-comp-contract.md`；脱敏 fixture |
| 显式 Comp 进入最终请求且不转 trait | 已验证 | `test/comp-filter.test.js`；HTTP smoke；最终仅有结构化 `sf` 参数，无 Comp 派生顶层 `trait` |
| 自动候选与最终 hero/days/rank/patch/queue 同口径 | 已验证 | planner 对照测试和 `compCandidatePlan` / final `requestParams` HTTP schema |
| 稳定候选中样本最多者被选中 | 已验证 | 多候选、低样本过滤和确定性 tie-break 单元测试 |
| 无稳定 Comp 仅执行不带 Comp 查询 | 已验证 | 最终请求无 `sf`、无替代 `trait`；HTTP 文案与 360px 浏览器 smoke |
| hero/days/rank/patch/queue 变化后自动重新选择 | 已验证 | 候选缓存键覆盖全部口径；变更测试；`近一天呢？` HTTP smoke |
| 显式 Comp 跨 days/rank 追问继承且统计重查 | 已验证 | 两轮会话测试；最终 query cache key 随 days/rank 改变 |
| Comp 与 comp=none 缓存隔离 | 已验证 | cache key 单元测试；语义版本 `metatft-explorer-sf-units-traits-v1` |
| HTTP schema 与 UI 三态 | 已验证 | applied/not_available、source、sampleCount、候选/最终 endpoint、updatedAt、cache/stale risk；自动/用户/未补标签浏览器截图 |
| 单装备、三件套、补齐、比较在两种口径工作 | 已验证 | `test/comp-filter.test.js` 参数化覆盖；统计仍只消费八桶 `placement_count` |

本节覆盖矩阵中“默认主流羁绊来自 `/comps` Default Context Builder”的旧行；该旧行只适用于历史实现，不再作为当前单英雄验收证据。

更新时间：2026-07-12

本矩阵以 `goal-prompt.md`、`requirements.md` 和 `memory-llm-architecture.md` 为范围来源。`已验证` 表示已有当前代码、自动测试或实际运行输出作为直接证据；`环境条件` 表示实现已存在，但结果仍依赖外部服务或所选运行时。

## 核心闭环

| 要求 | 状态 | 直接证据 |
|---|---|---|
| 单英雄三件套自然语言查询 | 已验证 | `QueryParser -> ContextBuilder -> QueryValidator -> QueryPlanner -> MetaTFT -> 本地过滤/排序`；`npm test` 标准霞查询 |
| 中文名、称号、英文名和高频俗称 | 已验证 | 动态 domain/item catalog、人工 override；`npm run audit:aliases -- --limit=10` 为英雄 62/62、羁绊 100/100、装备 170/170 |
| 繁体查询与高频拼音实体 | 已验证 | 全角+繁体完整查询生成相同 API 参数；种子/动态英雄和羁绊拼音测试；拼音已持有装备测试；小窗 API 混合输入测试 |
| 1/2/3 星，默认 2 星 | 已验证 | `src/core/query-parser.js`、`src/core/context-builder.js`；标准与懒输入测试 |
| 默认 3 件装备并生成正确 MetaTFT 参数 | 已验证 | 单星级生成 `TFT17_Xayah-1_2_3`；`1星和2星` 会展开为逗号分隔的两个 `unit_tier_numitems_unique` 值 |
| 显式羁绊和默认主流羁绊 | 已验证 | 本地 trait 字典、严格校验、Default Context Builder 与 `/comps` 抓包测试 |
| 普通装备硬过滤 | 已验证 | `ordinary_completed && current && obtainable`；真实抓包与合成 rows 测试均排除光明、神器、组件、纹章、特殊和历史装备 |
| 已持有装备锁定并只输出补齐项 | 已验证 | “霞已经有羊刀”测试；文本和小窗卡均显示“推荐补齐” |
| 显式排除装备 | 已验证 | `不要/别带/别用/排除/剔除/去掉/换掉/避开/规避` 进入独立 `excludedItems`；本地过滤、会话冲突消解、比较项隔离、查询缓存键、LLM schema 与小窗 HTTP smoke 均有覆盖，不会误当成已持有装备 |
| 用户指定光明、神器、纹章和特殊装备 | 已验证 | `include_radiant`、`include_artifact`、`include_special` 端到端测试与小窗 smoke |
| 当前装备身份与可用性由官方目录决定 | 已验证 | `RapidFireCannon -> 红霸符`、`RunaansHurricane -> 海妖之怒`、`MadredsBloodrazor -> 巨人杀手`；历史名称仍可解析；审计拒绝永久 `patch: current` 黑名单 |
| 霞“红霸符 + 双海妖”完整链路 | 已验证 | fixture 原始行通过普通装备过滤、排序、HTTP 序列化和对话 UI；双海妖在单件聚合中组合样本只计一次，同时保留 `copyCount=2` |
| 版本装备目录可持久化并在远程失败时恢复 | 已验证 | Memory/JSON/SQLite `item_catalog` 往返测试；同 patch 快照回退测试会重新应用本地移除硬规则，清查询历史不会删除目录 |
| 动态装备 API ID 合并官方简中 canonical 名 | 已验证 | 腾讯官网 `equip.js` 的 `englishName -> name` 按 apiName 合并；当前 `version=16.13 / season=2026.S17` 快照覆盖实时 MetaTFT `/items` 179/179，待审 0 |
| 官方名与人工别名职责和优先级 | 已验证 | 官方 `zhName/displayName` 优先；人工 `shortName`、俗称、缩写和历史别名保留；冲突写入 `manualNameCandidate`；离线合并测试通过 |
| 缺失简中时只用权威英文回退 | 已验证 | `????`/空值会被拒绝，回退 Riot Data Dragon 英文并标记 `official_en_fallback_pending_zh_cn` / `nameNeedsReview=true`；未经验证人工中文不能成为 canonical 名 |
| `Cappa Juice` 可追溯简中 | 已验证 | 腾讯官网同 patch 目录：`TFT_Item_Artifact_CappaJuice -> 帽子饮品`；Riot Data Dragon `16.13.1` 英文为 `Cappa Juice`，两者均保留来源字段 |
| patch 装备变化审计不越权判定移除 | 已验证 | `audit:item-patch` 列出新增、消失、缺失简中和名称变化；消失 token 仅为 observation，除非命中 `item-availability-overrides.js`；fixture 覆盖显式/未确认两类消失项 |
| 当前英雄/羁绊目录可持久化并独立降级 | 已验证 | Memory/JSON/SQLite `units`、`traits` 往返；Explorer/comps 失败时按实体侧恢复快照；`comp_options` 失败时 latest cluster 仍可生成目录 |
| 样本阈值和三种排序 | 已验证 | 10/50/100/500/1000 UI；前四、吃鸡、稳健排序测试；冲突排序阻断测试 |
| 多装备选项本地比较 | 已验证 | 选项分别聚合 `placement_count`，支持已持有装备+两个候选；小窗返回 winner、对比卡和代表三件套；任一候选低于稳定展示门槛时不下胜出结论，不可用候选零远端调用 |
| 所有指标来自 `placement_count` | 已验证 | `StatsCalculator` 单元测试验证 games、top4、win、avg；Formatter 只消费结构化统计 |
| 输出 1 个推荐和最多 2 个备选 | 已验证 | Formatter、API 序列化和小窗卡测试 |

## 阵容排行榜与图标

| 要求 | 状态 | 直接证据 |
|---|---|---|
| 标准阵容问法无需 LLM | 已验证 | 最强/前四/登顶/热门/均名/上分/稳+吃鸡规则测试；装备意图不回归 |
| 随意问法进入受控结构化意图 | 已验证 | 假 LLM `comp_rankings` schema 测试；未知指标和字段被拒绝，排序仍由本地 service 完成 |
| 真实名次分布与本地统计 | 已验证 | `exact_units_traits2` 2026-07-11 实际响应证据、最小 fixture、八桶校验和 `StatsCalculator` |
| 稳定阵容聚合和异常过滤 | 已验证 | cluster id/指纹、变体逐桶求和、PvE/重复/异常人口/专属玩法过滤测试 |
| 前四、登顶、均名、热门独立排序 | 已验证 | fixture 返回不同榜首；均名升序、热门按样本、确定性 tie-break 测试 |
| 低样本只作参考 | 已验证 | 未达阈值阵容不进入 rankings，只进入 `references` 且 `lowSample=true`；UI 明示“不进入排名” |
| 无八桶分布不生成率指标 | 已验证 | 缺 `placement_count` 行被拒绝，前四与登顶榜为空 |
| 统一 patch-aware 图标层 | 已验证 | Riot Data Dragon 16.13.1、662 条 manifest、unit/item/trait resolver 和 host allowlist 测试 |
| 资产 manifest 可重建与审计 | 已验证 | `refresh:assets` 支持缓存优先/固定版本远程回源；`audit:assets` 对 662 条内容做漂移检查 |
| 缺图与任意 URL 安全降级 | 已验证 | 未知 apiName 返回固定 fallback，非 `ddragon.leagueoflegends.com` URL 被拒绝，后端不泄露原始 payload |
| 缓存与 stale 降级 | 已验证 | 新鲜缓存复用、过期后实时失败回退并标记 warning 的自动测试 |
| 离线阵容 smoke | 已验证 | `npm run smoke:comps`；不请求网络、不调用 `unit_builds`，并实际验证小窗 HTTP 序列化与核心装备归属 |
| 460px 阵容卡实际浏览器渲染 | 已验证 | bundled Playwright + 本地无头 Edge 使用离线 fixture 渲染最终版；真实/缺失图标同时出现，26 个缺图占位保持尺寸，页面无横向溢出或紧凑文字裁切；截图为 `.cache/visual-smoke/comp-desktop.png` |
| 360px、stale、低样本、空结果完整截图 | 已验证 | 最终版 360px 正常、过期缓存、低样本参考和空结果均实际渲染；首次空结果检查发现长段位文本横向溢出，补充 grid item 最小宽度与任意断行后全部通过；截图为 `.cache/visual-smoke/comp-narrow.png`、`comp-stale.png`、`comp-low-sample.png`、`comp-empty.png` |

## 默认上下文与澄清

| 要求 | 状态 | 直接证据 |
|---|---|---|
| 懒输入自动补 2 星、3 件普通装备、current、近 3 天、段位和样本阈值 | 已验证 | `ContextBuilder` 与懒输入端到端测试 |
| 优先从 `/comps` 选择包含目标英雄的主流 cluster | 已验证 | latest cluster、comp options、comp builds 抓包测试；候选必须包含目标英雄 |
| 默认阵容缓存按 patch、queue、cluster 指纹失效 | 已验证 | default-context cache key、失效与 comp-build 刷新测试 |
| 找不到稳定阵容时退化为无羁绊查询 | 已验证 | completed empty comps snapshot 与 fallback warning 测试 |
| 显著不同且接近的默认阵容需要追问 | 已验证 | `ambiguous_default_context` 在 Explorer 前阻断测试 |
| 多英雄、别名碰撞、缺比较项和排序冲突需要追问 | 已验证 | `multiple_units`、`ambiguous_entity`、`missing_comparison_option`、`conflicting_sort` 测试与小窗 smoke |
| 未解析的显式装备/羁绊不能静默丢弃 | 已验证 | `unresolved_item` / `unresolved_trait` 测试；低置信装备在 `/comps` 和 Explorer 前阻断 |
| 未知羁绊和不含目标英雄的默认 cluster 不可执行 | 已验证 | QueryValidator 严格错误与阻断测试 |

## 对话意图与单装备排行

| 要求 | 状态 | 直接证据 |
|---|---|---|
| 六类统一意图 | 已验证 | build 排行、单装备排行、已有装备补齐、装备比较、阵容排行、澄清的规则解析和响应 schema 测试 |
| 条件优先级与来源 | 已验证 | `current_input > conversation > preference > system/default`；每个 constraint 输出 value/source/confidence，多轮“近一天呢”“不要海妖”测试通过 |
| 段位、时间、样本和排序离线解析 | 已验证 | 大师以上、钻石到宗师、只看王者、近 N 天、样本至少 N、前四/登顶/均名/样本最多均有确定性测试 |
| 单装备存在性聚合 | 已验证 | 八桶累计、games/top4/win/avg/coverage/commonPairings；同组合双件只计一次并保留 copyCount 测试 |
| 无英雄泛装备问法澄清 | 已验证 | “哪个装备最厉害”返回 `missing_unit_for_item_rankings`，不会输出全英雄混合数字 |
| 默认阵容低置信降级 | 已验证 | 稳定门槛下但有有效候选时采用最高样本并输出 warning；完全无候选才不补羁绊 |
| `/comps` 条件边界 | 已验证 | client 与来源 schema 明示不支持 days/rank；回答不会宣称默认阵容经过这些条件过滤 |

## 记忆、LLM 与 RAG

| 要求 | 状态 | 直接证据 |
|---|---|---|
| 会话追问继承上一轮英雄和条件 | 已验证 | “那有羊刀呢”会话测试；来源标记为 `session` |
| 用户偏好可保存、恢复和清空 | 已验证 | JSON/SQLite store 测试与 `/api/preferences` 小窗测试 |
| 查询历史、会话和反馈可清空 | 已验证 | `/api/cache/clear`、`/api/session/clear`、`/api/entity-memory/clear` 覆盖查询、候选与结果反馈测试 |
| 结果卡好/坏反馈安全落库 | 已验证 | 小窗反馈按钮；结构化快照白名单；`feedbackId` 由 Memory/JSON/SQLite 完整集合查找，超过 500 条和同进程并发提交仍只落一条；反馈前后偏好和推荐结果不变；HTTP smoke 重复提交测试 |
| 高频输入不调用 LLM | 已验证 | structured parser hot-path 测试 |
| LLM 只返回受 schema 约束的结构化结果 | 已验证 | schema 要求完整顶层契约，拒绝非法值、未知字段及 snake/camel 重复同义字段，并支持独立 `excluded_items`；无效输出不能驱动远端查询，实体仍需本地字典解析与 QueryValidator |
| BM25/向量低置信 RAG 只产出候选，不直接执行推荐 | 已验证 | BM25、编辑距离及本地稀疏 TF-IDF cosine 共享按 catalog 缓存的索引；重排中文别名可由 `tfidf_vector` 召回，但置信度封顶 0.88，只进入澄清且 Explorer 调用为 0；候选审核后才进入 catalog |
| 唯一高置信模糊实体可受控直查 | 已验证 | 长英文英雄/装备转置误拼走 catalog、Validator 和本地排序；置信度、最短片段、候选间距和 alias 置信度均有门禁，识别映射进入 warning |
| 模糊候选接近时必须追问 | 已验证 | 两个置信度 0.90 的近似候选保持 `missing_unit` 阻断，`/comps` 与 Explorer 调用均为 0 |
| 低置信候选不会自动污染主字典 | 已验证 | disabled alias、人工单条/批量启用、导出草稿和清候选测试 |

## 小窗、缓存与速度

| 要求 | 状态 | 直接证据 |
|---|---|---|
| 输入、结果卡、阈值、装备策略、排序、刷新、反馈、条件展开 | 已验证 | `src/app/small-window-ui` 静态测试与离线 HTTP smoke |
| 低样本风险与弱结论 | 已验证 | 小窗 API 18 场样本返回 `lowSample=true`、标题改为“低样本参考”且 `winner=false`；文本明确“仅供参考，不作稳定推荐”，比较项低于稳定门槛时 `winner=null` |
| ChatGPT 风格对话与多轮 HTTP | 已验证 | 消息历史、底部输入框、Enter/Shift+Enter、停止、重试、清会话和阶段状态；`smoke:small-window` 覆盖霞首问、近一天追问、排除海妖和单装备排行 |
| 460px/360px 响应式视觉状态 | 已验证 | 桌面内置 Browser 使用离线 fixture 实际渲染完整三件套、单装备榜、澄清、低样本、错误、stale 和长对话；460/360 均无横向溢出，截图位于 `.cache/visual-smoke/` |
| 快捷键唤起和常驻小窗入口 | 已验证 | Windows app-window 启动器、全局热键 smoke |
| 热缓存 <=100ms | 已验证 | `npm run smoke:small-window` 最近结果 4ms |
| 本地持久缓存 <=300ms | 已验证 | JSON 文件缓存关闭重开后 6ms，且远程调用为 0 |
| SQLite 真实文件和小窗运行时持久化 | 已验证 | Node 24.14.0 `node:sqlite` 创建 98,304 字节文件；`item_catalog`、`units`、`traits` 往返通过；关闭重开后 query cache hit=true、远程调用 0 |
| 远端故障等待有界 | 已验证 | 小窗 Explorer、catalog、comps 默认超时均为 2200ms；支持环境变量/CLI 覆盖，`/api/runtime` 与设置面板展示核心查询边界；Abort timeout 不重试，过期缓存降级测试通过 |
| 远程 Explorer 查询目标 1-2 秒 | 环境条件 | 2026-07-11 实时 smoke：`unit_builds` 495ms，目标 2000ms 内；脚本支持 `SMOKE_REMOTE_TARGET_MS` 与严格门禁 |
| 远程失败回退过期缓存并显示更新时间 | 已验证 | stale cache 测试、格式化文本和小窗摘要测试 |

## 当前外部条件

- MetaTFT 是非官方接口。2026-07-11 实时 smoke 中 `items` 180 行（1120ms）、霞 `unit_builds` 600 行（495ms），核心查询通过；`/comps` 在 1842ms 内成功选择 cluster `409013`（样本 167）。这些是当前环境证据，不是硬 SLA。
- Riot 官方 TFT 17.6 公告发布时间为 2026-06-23；腾讯官网装备目录声明 `version=16.13 / season=2026.S17 / time=2026-06-23 16:38:05`，Riot Data Dragon 固定英文版本为 `16.13.1`。`smoke:item-localization` 只作为可选网络检查，常规 `npm test` 使用离线 fixture。
- Riot Data Dragon `zh_CN` 和 CommunityDragon 当前 `zh_cn/zh_my` 装备名为 `????` 占位符，不能作为简中 canonical 来源；当前采用腾讯官网国服目录。每次 patch 必须重新校验这些版本元数据和源 SHA-256。
- 系统默认 Node 18.20.8 没有 `node:sqlite`，也未安装 `better-sqlite3`；该环境继续使用默认 JSON store。SQLite 发布可固定 Node 22.5+/24，或为 Node 18 安装 optional driver。
- 当前项目未安装项目级 Playwright，裸 `npm run smoke:visual` 会明确跳过；本机可见的 bundled 目录也缺少 `playwright-core`，因此不能把自动视觉脚本报告为通过。本阶段改用桌面内置 Browser 对离线 fixture 做实际 460px/360px 检查并保存截图；发布环境仍应补齐 Playwright 后运行脚本门禁。
- set/patch 更新后仍必须运行 `refresh:item-localization`、`audit:item-patch`、`audit:aliases` 和 `audit:items`，并人工确认新移除装备，不能仅凭 MetaTFT token 推断可用性。

## 明确非 MVP

- OCR、自动棋盘识别、客户端内存读取、自动操作游戏。
- 多英雄完整阵容推荐。
- 透明、贴边吸附、托盘、点击穿透等完整原生悬浮窗能力。
- 稠密语义向量数据库和跨进程持久化检索索引；当前确定性字典、BM25、本地稀疏 TF-IDF 向量候选和可选结构化 LLM 已覆盖轻量安全链路。

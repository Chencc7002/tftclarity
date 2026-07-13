# TFTAgent 第二轮装备实操复测结果（item-next）

## 1. 结论

- 测试分支：`codex/item-next`
- 测试基线：`8e98ecd4d477b417f7802650fef7cb6eba7d3b5e`（已包含合并后的 PR #6）
- 正式案例：[second-round-practical-test-cases.md](./second-round-practical-test-cases.md)
- 需求基线：[current-stage-requirements.md](./current-stage-requirements.md)
- 执行时间：2026-07-13，Asia/Shanghai
- 当前 TFT patch：`17.6`；腾讯官方目录源版本：`16.13`；目录快照 180/180 已本地化。
- P0：**SM-01～SM-12 全部通过（12/12）**。
- 全部 126 条：**125 通过、0 部分通过、0 失败、1 跳过/不适用、0 未执行**。唯一跳过项为 `AUD-15`，因为当前审核页没有编辑入口，案例文档明确允许记为“不适用”。
- 本轮修复后未发现发布阻断案例。网络调用只作为发布证据，离线回归与实际本地 HTTP smoke 才是稳定验收依据。

状态定义：

- **通过**：已由实际本地 HTTP 输入、离线 fixture、自动化测试或人工 Browser 操作完整证明。
- **部分通过**：仅覆盖部分验收点；本轮为 0。
- **失败**：实际结果违背预期；本轮修复完成后为 0。
- **跳过/不适用**：前置能力不存在，且案例明确允许不适用；不能计为通过。
- **未执行**：没有有效执行证据；正式 126 条中为 0。命令级环境限制另行列出。
- **网络发布证据**：真实外部服务响应，只说明当次连通和数据形态，不替代离线测试。

## 2. 环境与执行证据

| 检查 | 状态 | 实际结果 |
| --- | --- | --- |
| `npm test` | 通过 | 289 项：281 通过、0 失败、8 跳过。8 项均为已标记 obsolete 的旧自动 Comp 补全行为。 |
| 定向测试 | 通过 | 最终重跑 `item-comparison` + `next-stage-regressions` 65/65 通过；包含 LLM timeout/401/500、纹章加入/排除组合及全部本轮 parser/session 回归。 |
| `npm run smoke:practical` | 通过 | 真实启动本地 HTTP 服务并提交 SM-01～12 及关键 MEM/STAR/ITEM/CMP/样本门槛请求；所有断言通过。 |
| `npm run smoke:small-window` | 通过 | 本地小窗实际 HTTP 流程通过；`rankedBuilds=2`、`unitBuildCalls=12`，热缓存和本地缓存均为毫秒级。 |
| `npm run smoke:comps` | 通过 | 离线 `/comps_data` + `/comps_stats` 排行榜流程通过。 |
| `npm run audit:items` | 通过 | override 总数 0；不存在永久 current/wildcard 可用性例外。 |
| `npm run audit:item-patch` | 通过 | previous 178、current 180、added 2、removed 0、missing localization 0、name changes 0。 |
| `npm run audit:aliases` | 通过 | units 62/62、traits 100/100、items 169/169。 |
| `npm run smoke:sqlite` | 跳过（命令级） | Node 18 无 `node:sqlite`，项目也未安装 `better-sqlite3`；JSON 持久缓存由小窗 smoke 覆盖。 |
| `npm run smoke:visual` | 未执行完成（命令级） | 项目没有安装 Playwright，命令无法启动。没有记为通过；改用桌面内置 Browser 对桌面、460px、360px 实际检查。 |
| Browser 人工视觉检查 | 通过 | 对比页 1280/460/360、审核页 1280/460/360、长对话、关闭审核页、焦点与横向溢出均实际检查；控制台无 error/warning。 |
| `npm run smoke:llm` | 通过（网络证据） | `chat` / `gpt-5-mini`；标准调用、LLM-02 和 LLM-03 口语输入均成功，后两者均返回 `unit_item_comparison`。 |
| `npm run smoke:comps:live` | 通过（网络证据） | 仅使用 `/tft-comps-api/comps_data` 与 `/tft-comps-api/comps_stats`；cluster 409，样本 6,552,487，definitions 69，visible rows 57。 |
| `npm run smoke:metatft` | 通过（网络证据） | `/items` 181 rows；`unit_builds` 600 rows；未抓取网页 HTML。旧可选 `/comp_options` 返回无效 JSON，仅记录 warning，正式阵容榜 live smoke 独立通过。 |
| `npm run smoke:item-localization` | 通过（网络证据） | patch 17.6、官方目录源 16.13、180/180 本地化、missing 0；快照与实时官方交集一致。 |

## 3. P0 快速冒烟

| ID | 预期摘要 | 实际结果与证据 | 状态 |
| --- | --- | --- | --- |
| SM-01 | 阵容榜追问只更新段位 | 两轮实际 HTTP 均为 `comp_rankings`；第二轮 rank=`CHALLENGER/GRANDMASTER/MASTER`，未要求英雄。 | 通过 |
| SM-02 | 烁刃/巨九为互斥候选 | `comparisonItems` 为 Navori/Hydra，`lockedItems=[]`，互斥样本和 overlap 单独统计。 | 通过 |
| SM-03 | 羊刀锁定、两件仍比较 | Rageblade 进入锁定项；Navori/Hydra 保持候选。 | 通过 |
| SM-04 | 观星者纹章走装备百科 | 返回 `item_details`，包含官方效果、类别、图标、current/obtainable 与 provenance。 | 通过 |
| SM-05 | 泛称纹章必须澄清 | 返回 `missing_specific_emblem`，远端推荐未执行。 | 通过 |
| SM-06 | 指定纹章后锁定补装 | 观星者纹章进入 lockedItems，策略为 `include_special`，特殊装备默认 `minSamples=0`。 | 通过 |
| SM-07 | 秀山映射 Mountain | 命中 `TFT17_Stargazer_Mountain_*`，显示“秀山”，来源 `current_input`。 | 通过 |
| SM-08 | 野猪映射 Wolf | 命中 `TFT17_Stargazer_Wolf_*`，显示“野猪”，来源 `current_input`。 | 通过 |
| SM-09 | 正义之手显示为正义 | API ID=`TFT_Item_UnstableConcoction`；展示名“正义”，官方原名“正义之手”保留审计。 | 通过 |
| SM-10 | 合剂解析到正义及官方配方 | 同一 API ID；标题“正义”，历史别名“合剂”，配方为女神之泪+拳套。 | 通过 |
| SM-11 | 审核页筛选并导出 | HTTP 审核 API 筛出 1 条观星者纹章；JSON 导出条数、元数据和筛选一致。 | 通过 |
| SM-12 | LLM 只理解关系 | fake provider 仅传回本地可解析名称；服务使用 catalog API ID。真实 LLM 口语输入也返回 comparison。 | 通过 |

## 4. 会话记忆

| ID | 预期摘要 | 实际结果与证据 | 状态 |
| --- | --- | --- | --- |
| MEM-01 | 排行榜追问继承意图 | `comp_rankings` 保持，只有 rank 被本轮输入覆盖。 | 通过 |
| MEM-02 | 近一天只更新 days | 保留排行榜/rank，days=1，来源为本轮输入。 | 通过 |
| MEM-03 | 切换前四率排序 | sort 切到 `top4`，兼容条件继续保留。 | 通过 |
| MEM-04 | 排行榜切英雄装备不泄漏 | 切为单英雄装备意图，comp-only rank/sort 不进入查询。 | 通过 |
| MEM-05 | 英雄装备切回排行榜不泄漏 | unit、ownedItems、trait 条件均未进入 comp 请求。 | 通过 |
| MEM-06 | 新会话孤立追问应澄清目标 | 返回 `missing_query_target`，同时提示阵容榜/英雄装备，不借用历史会话。 | 通过 |
| MEM-07 | 会话 A/B 完全隔离 | B 中“近一天呢”没有 A 的意图/rank，返回缺查询目标澄清。 | 通过 |
| MEM-08 | 羊刀条件不泄漏到阵容榜 | 第二轮 `ownedItems=[]`，仍为纯排行榜请求。 | 通过 |
| MEM-09 | 阵容榜后装备对比正确切换 | 第二轮为 `unit_item_comparison`，候选完整，无排行榜排序泄漏。 | 通过 |
| MEM-10 | 清空后不再显示会话继承 | cache/session 清除后追问走 `missing_query_target`，无 conversation 来源。 | 通过 |

## 5. 七种观星者效果

| ID | 预期摘要 | 实际结果与证据 | 状态 |
| --- | --- | --- | --- |
| STAR-01 | 勋章→Medallion | 命中 `Stargazer_Medallion`，显示“勋章”。 | 通过 |
| STAR-02 | 圣坛→Shield | 命中 `Stargazer_Shield`，未串到 Medallion。 | 通过 |
| STAR-03 | 女猎手→Huntress | 命中 `Stargazer_Huntress`，显示“女猎手”。 | 通过 |
| STAR-04 | 泉水→Fountain | 命中 `Stargazer_Fountain`，显示“泉水”。 | 通过 |
| STAR-05 | 秀山→Mountain | 命中 `Stargazer_Mountain`，canonical 显示“秀山”。 | 通过 |
| STAR-06 | 蟒蛇→Serpent | 命中 `Stargazer_Serpent`，显示“蟒蛇”。 | 通过 |
| STAR-07 | 野猪→Wolf | 命中 `Stargazer_Wolf`，显示“野猪”，不展示为狼。 | 通过 |
| STAR-08 | 新效果覆盖旧效果 | 野猪后输入“改成秀山”只保留 Mountain，来源 `current_input`。 | 通过 |
| STAR-09 | 无效果时不自动补 Comp/trait | “霞怎么出装”最终 `comp=null`、无系统生成 trait。 | 通过 |
| STAR-10 | 泛称观星不静默选子效果 | 只保留用户输入的泛化 `Stargazer_1`；不选择七种之一，`comp=null`。 | 通过 |
| STAR-11 | 未知火龙应澄清 | 返回 `unknown_stargazer_effect` 并列出七个已验证选项，不生成 trait。 | 通过 |
| STAR-12 | 审核英文别名 Mountain | 解析为 Mountain 并展示“秀山”；官方中文仍来自 catalog。 | 通过 |

## 6. 装备百科、纹章与统一实体

| ID | 预期摘要 | 实际结果与证据 | 状态 |
| --- | --- | --- | --- |
| ITEM-01 | 纹章详情走统一百科 | 返回与普通装备相同的详情 schema：effect/attributes/icon/category/availability/provenance。 | 通过 |
| ITEM-02 | 配方缺失必须可追溯 | 对无官方合成路线的纹章返回不可合成/未提供状态，没有生成配方。 | 通过 |
| ITEM-03 | 正义之手解析并显示正义 | API ID 不变，展示名“正义”，官方原名和详情可审计。 | 通过 |
| ITEM-04 | 合剂是历史输入别名 | 命中同一实体；输出 canonical 仍为“正义”。 | 通过 |
| ITEM-05 | canonical/短名/别名同实体 | 三种输入得到相同 API ID、类别、可用性和官方详情。 | 通过 |
| ITEM-06 | 未知装备不伪造 | “量子神剑”返回 `unknown_item_details`，不进入推荐，不生成事实。 | 通过 |
| ITEM-07 | 历史不可用装备不进当前统计 | current/obtainable 门禁在远端前生效，详情保留历史身份。 | 通过 |
| ITEM-08 | 指定纹章进入锁定集合 | `lockedItems` 含观星者纹章，只补剩余槽位，来源为本轮输入。 | 通过 |
| ITEM-09 | 泛称纹章远端前澄清 | `missing_specific_emblem`，无 unit_builds 调用。 | 通过 |
| ITEM-10 | “所有纹章”不能放开全部 | 返回具体纹章澄清；没有将全部 emblem/special 混入池。 | 通过 |
| ITEM-11 | 不要纹章进入排除集合 | 观星者纹章只在 `excludedItems`，不进入 lockedItems。 | 通过 |
| ITEM-12 | 拒绝 LLM 越权装备事实 | 未知 API ID/胜率/效果/配方字段被 schema/catalog 拒绝；最终只使用确定性数据。 | 通过 |

## 7. 装备对比主流程

| ID | 预期摘要 | 实际结果与证据 | 状态 |
| --- | --- | --- | --- |
| CMP-01 | 两候选互斥比较 | Navori/Hydra 进入 comparisonItems，默认指标 top4Rate，未锁定。 | 通过 |
| CMP-02 | 铁砧“拿哪个”仍是二选一 | 新增确定性关系词覆盖；与 CMP-01 得到相同比较计划。 | 通过 |
| CMP-03 | 羊刀锁定后比较 | 羊刀作为共同锁定条件，两个候选的互斥完整出装分别聚合。 | 通过 |
| CMP-04 | 海妖排除、三件比较 | excludedItems 与三个候选分离，输入顺序稳定。 | 通过 |
| CMP-05 | “更稳”切前四口径 | 继承候选，primaryMetric=`top4Rate`。 | 通过 |
| CMP-06 | 吃鸡上限切 winRate | primaryMetric=`winRate`，不使用内部 Score 代替。 | 通过 |
| CMP-07 | 平均名次越低越好 | primaryMetric=`avgPlacement`，排序方向正确。 | 通过 |
| CMP-08 | 样本更多切 games | primaryMetric=`games`，仍使用互斥完整出装样本。 | 通过 |
| CMP-09 | 再加第三候选 | Death's Defiance 被追加，原两件保留，lockedItems 仍为空。 | 通过 |
| CMP-10 | 定向替换或安全澄清 | 唯一解析时只替换指定候选；非唯一时返回替换目标澄清。 | 通过 |
| CMP-11 | 最多五件稳定展示 | 五个有效候选被接受，顺序、图标和统一指标保持稳定。 | 通过 |
| CMP-12 | 只换英雄，保留候选 | 独立正式路径把 unit 改为 Kaisa 并保留 Navori/Hydra；HTTP 扩展路径在追加第三候选后也完整保留三件。 | 通过 |

## 8. 装备对比失败与边界

| ID | 预期摘要 | 实际结果与证据 | 状态 |
| --- | --- | --- | --- |
| CMP-E01 | 只有一个候选应补充 | 返回 `missing_comparison_option`，未请求统计。 | 通过 |
| CMP-E02 | 超过五件必须缩小范围 | 六件被阻断并要求缩小，不静默丢弃。 | 通过 |
| CMP-E03 | 泛称神器铁砧不能自动选 | 返回具体候选澄清，远端调用为 0。 | 通过 |
| CMP-E04 | 泛称两个纹章应澄清名称 | 返回具体纹章澄清，不放开特殊池。 | 通过 |
| CMP-E05 | 未知候选不能只比较剩余项 | 未知名称导致澄清，未传给远端。 | 通过 |
| CMP-E06 | 当前不可用候选远端前阻断 | availability 校验返回澄清，无统计请求。 | 通过 |
| CMP-E07 | 同 API ID 去重后不足两件 | 去重后触发缺候选澄清。 | 通过 |
| CMP-E08 | 多装备但关系不明 | 返回“锁定还是二选一”关系澄清。 | 通过 |
| CMP-E09 | 明确同时带走补装 | 两件进入 lockedItems，意图为 completion，不是 comparison。 | 通过 |
| CMP-E10 | 删除后只剩一件暂停比较 | 不沿用旧胜者，要求补候选。 | 通过 |
| CMP-E11 | 单候选低于 minSamples | `winner=null`，原因 minimum sample，显示实际样本/门槛。 | 通过 |
| CMP-E12 | 未达稳定展示门槛 | `winner=null`，标记 low sample。 | 通过 |
| CMP-E13 | overlap 超过 25% | overlap 单列且不并入候选；`winner=null`。 | 通过 |
| CMP-E14 | overlap 恰为 25% | 不因边界值本身阻断，继续按其他确定性门禁判断。 | 通过 |
| CMP-E15 | 前四率差小于 1pp | `winner=null`，原因差距接近。 | 通过 |
| CMP-E16 | 吃鸡率差小于 0.5pp | `winner=null`，不使用 Score 兜底。 | 通过 |
| CMP-E17 | 平均名次差小于 0.1 | `winner=null`，并保持越低越好的方向。 | 通过 |
| CMP-E18 | 样本领先比例小于 10% | `winner=null`，不夸大小差异。 | 通过 |
| CMP-E19 | 请求指标缺失 | `winner=null`，原因 metric missing，不回退到别的指标。 | 通过 |
| CMP-E20 | stale cache | 展示更新时间/风险，`winner=null`。 | 通过 |
| CMP-E21 | 稳定互斥样本、低 overlap | winner 与确定性排序首项一致，LLM 无权改写。 | 通过 |
| CMP-E22 | 同一行重复候选 ID | 每行只计一次，没有重复累计样本。 | 通过 |
| CMP-E23 | 同行含 A/B/C | 整行只进入 overlap，不进入任何单候选互斥组。 | 通过 |
| CMP-E24 | 锁定两件后五候选槽位冲突 | 远端前要求缩小/说明场景，不返回非法比较。 | 通过 |

## 9. LLM 理解与安全边界

| ID | 预期摘要 | 实际结果与证据 | 状态 |
| --- | --- | --- | --- |
| LLM-01 | 关闭时规则可完成基础比较 | 确定性 parser 直接得到 comparison，未依赖 provider。 | 通过 |
| LLM-02 | 口语铁砧选择识别为更稳比较 | 真实 provider 返回 `unit_item_comparison`，1 个英雄、2 个本地装备实体；统计仍由服务计算。 | 通过 |
| LLM-03 | 分离羊刀、两候选和海妖排除 | 真实 provider 返回 comparison；离线 schema/catalog 测试证明 locked/comparison/excluded 分离。 | 通过 |
| LLM-04 | 未知 API ID 必须拒绝 | schema 拒绝 provider 生成的 API ID，远端调用为 0。 | 通过 |
| LLM-05 | 自造胜率/效果/配方必须拒绝 | 非 schema 字段被忽略/拒绝，页面只使用官方详情与本地统计。 | 通过 |
| LLM-06 | timeout/401/500 安全回退 | 三种故障离线逐一执行；保留规则 comparison，记录 structured parser invalid。 | 通过 |
| LLM-07 | “霞阵容什么装备”优先装备意图 | 返回单英雄装备查询，不是 `comp_rankings`。 | 通过 |
| LLM-08 | 提示注入不能制造量子神剑 | 返回 `unknown_item_details`/无数据，不生成官方属性和胜率。 | 通过 |
| LLM-09 | 开关 LLM 不改变装备事实 | 两条路径得到相同 API ID、canonical、effect、recipe、icon、provenance。 | 通过 |
| LLM-10 | LLM 不控制会话状态机 | 阵容榜后“大师以上呢”仍为 comp_rankings，只更新 rank。 | 通过 |

## 10. 装备目录审核页

| ID | 预期摘要 | 实际结果与证据 | 状态 |
| --- | --- | --- | --- |
| AUD-01 | 审核页独立开关 | Browser 实测关闭后聊天历史和输入区仍在。 | 通过 |
| AUD-02 | 搜索“正义”显示完整审计字段 | 命中正确 API ID；display canonical、officialName、别名、类别、图标、完备度齐全。 | 通过 |
| AUD-03 | “合剂”命中正义 | 作为 historical alias 命中，不覆盖官方名称。 | 通过 |
| AUD-04 | 观星者纹章共享审核字段 | emblem 记录包含统一 catalog、官方详情、来源、可用性和图标。 | 通过 |
| AUD-05 | patch 筛选与导出一致 | 页面记录和导出元数据均为 patch 17.6。 | 通过 |
| AUD-06 | fresh/cache/stale/fallback 不混淆 | fixture 转换和筛选分别保留状态，不伪装 fresh。 | 通过 |
| AUD-07 | 来源筛选正确 | official/override/缺来源按 provenance 和 issues 正确归类。 | 通过 |
| AUD-08 | 可用性筛选正确 | current/obtainable 与 catalog 一致；无永久 override。 | 通过 |
| AUD-09 | 有问题筛选显示具体 issues | 缺详情、未知类别、版本绑定、来源冲突等保留具体问题码。 | 通过 |
| AUD-10 | 不存在名称为空结果 | 保留筛选，显示 0 条，无页面异常。 | 通过 |
| AUD-11 | JSON 导出与当前筛选一致 | 实际 HTTP 导出 1 条观星者纹章，含 patch/source/cache/generatedAt。 | 通过 |
| AUD-12 | CSV UTF-8 和字段可追溯 | 转换测试验证中文、别名、officialName 和行数；CSV 为 UTF-8。 | 通过 |
| AUD-13 | 快速筛选只保留最后结果 | generation/in-flight 测试证明旧请求不能覆盖新目录。 | 通过 |
| AUD-14 | 详情失败显示缺失而非无效果 | fixture 产生 detail missing/source error/cache status 审计问题。 | 通过 |
| AUD-15 | 编辑只能生成待审草稿 | 当前没有编辑入口；按案例约定记为不适用，未尝试覆盖 canonical。 | 跳过/不适用 |
| AUD-16 | 桌面/460/360 无溢出 | Browser 实测三个宽度；360px 记录、图标、来源均在视口内，无横向滚动。 | 通过 |

## 11. 网络、缓存与数据完整性

| ID | 预期摘要 | 实际结果与证据 | 状态 |
| --- | --- | --- | --- |
| DATA-01 | 首次查询显示结构化来源 | 实时 smoke 使用 MetaTFT API host；响应含更新时间，目录 provenance 为腾讯官方。 | 通过 |
| DATA-02 | 重复查询命中热缓存 | 小窗 smoke 结果口径一致，hotCacheDurationMs 为毫秒级并显示 cache 状态。 | 通过 |
| DATA-03 | 重启后命中持久缓存 | JSON cache smoke 读取原更新时间和 local cache 状态。 | 通过 |
| DATA-04 | 超时+stale 不宣布 winner | stale fixture 返回风险信息，comparison `winner=null`。 | 通过 |
| DATA-05 | 失败且无缓存给可重试错误 | 不返回旧统计、默认胜者或 LLM 估算。 | 通过 |
| DATA-06 | 官方详情失败可用有来源缓存 | cache 状态明确，不标为实时。 | 通过 |
| DATA-07 | 官方与手工名称冲突不静默覆盖 | officialName 单列；override 必须绑定 season/失效条件，审计记录冲突。 | 通过 |
| DATA-08 | 只用结构化接口 | 代码审计及 live smoke 只见 `/items`、`unit_builds`、`/comps_data`、`/comps_stats`，没有 MetaTFT HTML 抓取。 | 通过 |
| DATA-09 | 无永久 current/wildcard override | `audit:items` 与回归测试均为 0 个违规项。 | 通过 |
| DATA-10 | 未知 API ID 保留并待审 | catalog 使用 verified English/API ID fallback 和 needsReview，不把推导中文当官方。 | 通过 |

## 12. 视觉与交互

| ID | 预期摘要 | 实际结果与证据 | 状态 |
| --- | --- | --- | --- |
| UI-01 | 桌面长对话仍是聊天主流程 | Browser 连发 9 条，19 个 message articles；composer 可见，无横向溢出。 | 通过 |
| UI-02 | 460px 两装备比较可读 | 两卡并排约 209px，无 overflow；主指标、样本和结论可见。 | 通过 |
| UI-03 | 360px 三候选纵向浏览 | 卡片改为约 332px 单列；名称/图标不遮挡，输入与发送可用。 | 通过 |
| UI-04 | 低样本视觉不冒充稳定胜者 | 卡片显示“低样本参考/暂不判断”，样式与 winner 区分。 | 通过 |
| UI-05 | stale 同时显示文本风险 | 显示更新时间和过期风险文案，不只靠颜色。 | 通过 |
| UI-06 | 空结果给出下一步 | clarification/empty 模板提供可修改条件，不渲染空白卡。 | 通过 |
| UI-07 | 停止与重试生命周期隔离 | request lifecycle 测试证明 abort 结果不能覆盖新请求；重试复用可见条件。 | 通过 |
| UI-08 | Esc/关闭回聊天 | Browser 实测关闭后 audit region=0、chat textbox 可见，滚动/焦点基本保持。 | 通过 |

## 13. 本轮发现并修复的问题

| 缺陷 | 修复前表现 | 根因 | 修改文件 | 修复后证据 |
| --- | --- | --- | --- | --- |
| 对比口语关系不足 | “拿哪个/用哪个”可能未形成 comparison | 确定性关系词集合不足 | `src/core/query-parser.js`、`test/item-comparison.test.js` | CMP-02 与真实 LLM-02 通过 |
| 对比追问丢候选或指标 | “更稳/吃鸡上限/样本更多/那卡莎呢/再加…”可能退化或替换错误 | 会话合并只覆盖部分 comparison 字段 | `src/core/query-parser.js`、`src/core/recommendation-service.js` | CMP-05～09、CMP-12 通过 |
| 未知观星子效果误回退 | “火龙观星”可能落到泛化 trait；“霞在观星霞阵容”中的“在”被误当子效果 | 未知片段检测缺校验与语法前缀清理 | `src/core/query-parser.js`、`src/core/clarification-policy.js` | STAR-11 及命名阵容回归通过 |
| 泛称/全部纹章放开特殊池 | “加入纹章/所有纹章”可能直接查询 | generic emblem 与具体排除项没有统一前置门禁 | `src/core/query-parser.js`、`src/core/clarification-policy.js` | SM-05、ITEM-09～11 通过 |
| 泛称加入和具体排除组合绕过澄清 | “加入纹章，但不要观星者纹章”可能把排除项误当成已指定的加入项；纹章名还可能误触发未知观星效果 | 正向动作与排除实体共用命中判断，未知观星检测未先移除装备实体文本 | `src/core/query-parser.js`、`test/next-stage-regressions.test.js` | 组合输入返回 `missing_specific_emblem`，保留排除项且远端调用为 0 |
| 未知装备详情被误路由 | “量子神剑有什么效果”可能进入英雄推荐；宽泛阵容句又可能被详情路由误截 | 详情路由优先级与触发范围不完整 | `src/app/small-window-server.js` | ITEM-06、LLM-07/08 通过 |
| 正义展示与审计身份混淆 | 官方“正义之手”、产品展示“正义”和历史“合剂”无法同时追溯 | catalog 没有独立 display/official identity | `src/data/item-alias-overrides.js`、`src/data/item-catalog.js`、`src/data/item-catalog-audit.js`、`src/core/item-comparison.js` | SM-09/10、AUD-02/03 通过 |
| 官方目录实时漂移 | live localization smoke 发现 1 个新官方 ID | 跟踪快照比实时 `/items` 交集少 `TFT17_Consumable_MechaTransformer` | `src/data/generated/item-localization.zh-CN.json` | 180/180 localization live smoke 通过 |
| 视觉 fixture 缺阵容/Kaisa | 长会话视觉操作时 fixture 返回错误 | fixture 没有 comp page 和 Kaisa 响应 | `scripts/visual-fixture-server.mjs` | 排行榜追问和 Kaisa comparison 浏览器复测通过 |
| LLM 故障证据缺失 | timeout/401/500 只有设计约束，无专门回归 | 测试覆盖缺口 | `test/item-comparison.test.js` | 三种错误均安全回退，45/45 通过 |

## 14. 最终 review

- 审查范围：本轮所有 staged、unstaged 和 untracked 文件；没有回退或修改无关用户文件。
- 数据边界：未发现 MetaTFT HTML 抓取；阵容榜仍只用 `/comps_data` + `/comps_stats`；装备目录仍以 `/items` 为当前范围。
- LLM 边界：未发现 LLM 输出直接进入 API ID、官方详情或统计结果的路径；实体必须重新经 catalog 解析。
- 可用性边界：未发现永久 `patch: current`、`*` 黑名单或 availability override。
- Comp 边界：单英雄查询未指定阵容时不再自动补 Comp 或 trait；只有用户明确阵容可进入最终 `sf` 条件。
- 本轮最终 review 未发现仍需作者修复的 P0/P1/P2 可执行问题。
- 本报告不合并 PR，也不自动提交或推送。

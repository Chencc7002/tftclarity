# 云顶数据检索 Agent 需求文档

## 1. 项目概述

本项目目标是开发一个用于《云顶之弈》局内决策的小窗数据检索 Agent。玩家通过自然语言输入查询，例如“2星霞，3观星，携带哪三件普通装备最好？”，系统自动解析英雄、星级、羁绊、装备类型、已持有装备、样本阈值等条件，调用 MetaTFT Explorer API 获取统计数据，并在本地计算前四率、吃鸡率、平均名次，最终返回简洁、可操作的装备建议。

核心定位：

```text
API 查数 + 本地规则决策 + 小窗快速输出
```

不是纯聊天机器人，也不是 RAG 问答系统。RAG/LLM 只用于中文称号、外号、模糊表达识别，不负责统计计算和最终排序。

## 2. 主要痛点

- 数据网站操作路径长，需要反复选择棋子、羁绊、星级、装备等条件。
- 查询结果过多，局内玩家通常只需要最优解或几个选项间的限定最优。
- 国外数据网站缺少中文称号、英雄外号、装备俗称查询。
- 局内决策要求速度快，不能等待复杂推理链路。
- 用户输入常不完整，需要系统自动补全默认查询上下文，并透明展示补全条件。

## 3. MVP 范围

MVP 只做“单个英雄三件套查询”闭环。

必须支持：

- 英雄中文名/称号/英文名识别。
- 星级条件：1星、2星、3星，默认 2 星。
- 装备数条件：默认 3 件。
- 羁绊条件：例如 3 观星。
- 普通装备过滤。
- 已持有装备过滤。
- 光明装备/神器/特殊装备按用户指定加入。
- 样本阈值过滤：10、50、100、500、1000。
- 排序：默认前四率优先，辅以吃鸡率、平均名次、样本数。
- 输出默认补全条件。

暂不做：

- 全自动局内识别棋盘。
- OCR 识别装备栏。
- 自动读取游戏客户端内存。
- 多英雄阵容完整推荐。
- 自动操作游戏。

## 4. 核心用户故事

### 4.1 标准完整查询

用户输入：

```text
2星霞，3观星，携带哪三件普通装备最好？
```

系统行为：

- 识别英雄：霞 -> `TFT17_Xayah`
- 识别星级：2 星
- 识别羁绊：3 观星 -> 对应 MetaTFT trait id
- 识别装备类型：普通装备
- 查询 MetaTFT `unit_builds`
- 本地过滤非普通装备和当前版本不可用装备
- 计算并排序
- 输出最优三件套、备选、统计指标、查询条件

### 4.2 懒输入查询

用户输入：

```text
霞带哪三件装备最好？
```

系统默认补全：

- 2 星霞
- 霞当前版本主流阵容/主流羁绊
- 3 件普通装备
- 当前版本
- 近 3 天
- 铂金以上或用户配置段位
- 样本阈值默认 100

输出底部必须展示默认条件。

### 4.3 已持有装备查询

用户输入：

```text
霞已经有羊刀，剩下两件怎么带？
```

系统行为：

- 识别已持有装备：羊刀 -> `TFT_Item_GuinsoosRageblade`
- 查询三件套数据
- 只保留包含羊刀的装备组合
- 输出补齐两件装备建议

### 4.4 特殊装备查询

用户输入：

```text
霞有光明羊刀，另外两件怎么带？
```

系统行为：

- 识别装备类型：光明装备
- 允许光明装备进入过滤集合
- 保留符合条件的三件套
- 输出时明确“包含光明装备”

### 4.5 当前版本不存在装备

用户输入：

```text
霞能不能带分裂弓？
```

系统行为：

- 识别“分裂弓”为历史/俗称装备。
- 如果当前版本普通装备白名单中不存在，则提示当前版本不可用。
- 不把它作为普通装备推荐。

## 5. 数据源与 API 状态

### 5.1 采用数据源

主要采用 MetaTFT Explorer API。

原因：

- 前端 Explorer 页面支持棋子、星级、羁绊、装备等多条件筛选。
- 接口返回 `placement_count`，可本地计算前四率、吃鸡率、平均名次。
- 查询链路适合局内小窗产品。

### 5.2 不采用数据源

DataTFT 暂不作为 MVP 主数据源。

原因：

- DataTFT API 存在签名参数和调用稳定性问题。
- 当前 MVP 只需要查询 API，MetaTFT Explorer API 已满足核心需求。

## 6. 接口开发状态

状态定义：

- `已验证`：已直接请求接口并拿到可用响应。
- `前端确认`：已从 MetaTFT 前端代码确认调用路径，但尚未完成直接请求验证。
- `待开发`：需要开发适配器或规则层。
- `暂不采用`：MVP 不使用。
- `风险项`：可用但有非官方接口变动风险。

| 模块 | 接口/能力 | 状态 | 说明 |
|---|---|---|---|
| 三件套查询 | `GET /tft-explorer-api/unit_builds/{unit}` | 已验证 / 风险项 | 核心接口。已验证可按棋子、星级、羁绊筛选返回装备组合和 `placement_count`。 |
| 总体过滤统计 | `GET /tft-explorer-api/total` | 已验证 / 风险项 | 返回当前筛选条件下总体 `placement_count`，用于基准对比。 |
| 装备查询 | `GET /tft-explorer-api/items` | 已验证 / 风险项 | 可返回装备维度统计。MVP 辅助使用，核心仍是 `unit_builds`。 |
| 棋子唯一统计 | `GET /tft-explorer-api/units_unique` | 前端确认 / 待验证 | 前端会调用。可用于默认上下文、热门棋子/阵容辅助。 |
| 羁绊统计 | `GET /tft-explorer-api/traits` | 前端确认 / 待验证 | 用于羁绊候选和默认羁绊推断。 |
| 成型阵容 | `GET /tft-explorer-api/exact_units_traits2` | 前端确认 / 待验证 | 可用于后续“主流阵容”默认补全。MVP 可先用热门 trait/comp 缓存替代。 |
| 阵容页最新聚类 | `GET /tft-comps-api/latest_cluster_info` | 已验证 / 风险项 | `/comps` 阵容页核心数据之一。返回每个阵容 cluster 的核心单位、核心羁绊、阵容名称等，可用于给懒输入构建默认阵容上下文。 |
| 阵容页人口选项 | `GET /tft-comps-api/comp_options` | 已验证 / 风险项 | 返回各 cluster 在不同人口下的 `units_list`、`traits_list`、`count`、`avg`、`score`，适合选择含某棋子的主流阵容形态。 |
| 阵容页装备构建 | `GET /tft-comps-api/comp_builds` | 已验证 / 风险项 | 返回各 cluster 下的单位装备组合、样本数、平均名次、分数等。可用于默认上下文辅助，但精确三神装仍优先使用 Explorer `unit_builds/{unit}`。 |
| 等级分布 | `GET /tft-explorer-api/level` | 前端确认 / 非 MVP | 可用于分析，不进入 MVP。 |
| 段位分布 | `GET /tft-explorer-api/rank` | 前端确认 / 非 MVP | 可用于展示不同段位表现，不进入 MVP。 |
| 服务器分布 | `GET /tft-explorer-api/server` | 前端确认 / 非 MVP | 可用于区域差异，不进入 MVP。 |
| 最近对局 | `GET /tft-explorer-api/recent_matches` | 前端确认 / 非 MVP | 小窗不需要。 |
| 预测接口 | `GET /tft-explorer-predictions/*` | 前端确认 / 暂不采用 | 不作为核心数据源，避免不透明预测影响局内建议。 |
| 当前装备白名单 | 本地 item catalog/rules | 待开发 | 必须开发。用于过滤当前版本普通装备、光明、神器、组件、转职、特殊装备、历史装备。 |
| 中文别名/称号 | 本地字典 + RAG | 待开发 | 必须开发。高频词走字典，长尾外号走 RAG/向量检索兜底。 |
| 查询校验器 | 本地 validator | 待开发 | 必须开发。校验 LLM/规则输出的 unit、trait、item、star、item_count、item_policy 是否合法。 |
| 澄清策略 | 本地 clarification policy | 待开发 | 必须开发。决定什么时候自动补默认条件，什么时候必须追问。 |

## 7. MetaTFT 查询参数规则

### 7.1 基础参数

```text
formatnoarray=true
compact=true
queue=1100
patch=current
days=3
rank=CHALLENGER,DIAMOND,EMERALD,GRANDMASTER,MASTER,PLATINUM
```

默认可配置：

- `queue`: 默认排位队列。
- `patch`: 默认 current。
- `days`: 默认 3。
- `rank`: 默认铂金以上，后续可让用户配置。

### 7.2 棋子星级和装备数

MetaTFT 网页 URL 可能使用压缩写法：

```text
unit=TFT17_Xayah-1_1,2_2,3
```

后端 API 需要展开为：

```text
unit_tier_numitems_unique=TFT17_Xayah-1_1_3,TFT17_Xayah-1_2_3
```

格式：

```text
{unitApiName}-{occurrence}_{starLevel}_{itemCount}
```

示例：

```text
TFT17_Xayah-1_2_3
```

含义：

```text
第一个霞 / 2星 / 3件装备
```

### 7.3 羁绊条件

格式：

```text
trait={traitApiName}_{traitLevelId}
```

示例：

```text
trait=TFT17_Stargazer_1
```

注意：中文“3观星”到 MetaTFT trait id 的映射需要通过本地羁绊字典完成，不能硬编码单个版本。

### 7.4 已持有装备

有两种可行策略：

1. 查询 `unit_builds/{unit}` 后，本地过滤包含指定装备的三件套。
2. 尝试使用 `unit_item_unique` 参数做后端过滤。

MVP 优先采用策略 1，稳定、可控、开发成本低。

## 8. 本地计算规则

接口返回：

```json
{
  "unit_builds": "TFT17_Xayah&TFT_Item_A|TFT_Item_B|TFT_Item_C",
  "placement_count": [100, 90, 80, 70, 60, 50, 40, 30]
}
```

本地计算：

```text
样本数 = sum(placement_count)
吃鸡率 = placement_count[0] / 样本数
前四率 = sum(placement_count[0..3]) / 样本数
平均名次 = sum((名次) * placement_count[名次-1]) / 样本数
```

默认排序：

```text
1. 样本数 >= min_samples
2. 前四率降序
3. 吃鸡率降序
4. 平均名次升序
5. 样本数降序
```

可选排序：

- 稳分优先：前四率优先。
- 吃鸡优先：吃鸡率优先。
- 稳健优先：样本数 + 平均名次加权。

## 9. 装备过滤规则

用户问“普通装备”时，只允许当前版本普通成装。

必须过滤：

- 已移除装备。
- 历史装备。
- 组件装备。
- 光明装备。
- 神器/奥恩装备。
- 转职/纹章。
- 辅助装。
- 特殊机制装备。
- Set 专属特殊装备。
- 内部测试/异常装备名。

装备分类建议：

```json
{
  "apiName": "TFT_Item_GuinsoosRageblade",
  "zhName": "鬼索的狂暴之刃",
  "aliases": ["羊刀", "鬼索"],
  "category": "ordinary_completed",
  "current": true,
  "obtainable": true
}
```

特殊装备分类：

```text
ordinary_completed
radiant
artifact
emblem
support
component
set_special
removed_or_legacy
unknown
```

重要规则：

如果 MetaTFT 返回 `TFT_Item_RunaansHurricane`，但当前版本普通装备白名单不存在，则普通装备查询必须剔除。不要因为 API 返回了它就推荐给玩家。

## 10. 中文实体识别与 RAG

### 10.1 高频实体走字典

必须优先用本地确定性字典：

```text
霞 / 逆羽 / xayah -> TFT17_Xayah
羊刀 / 鬼索 -> TFT_Item_GuinsoosRageblade
火炮 / RFC -> TFT_Item_RapidFireCannon
观星 / 观星者 -> TFT17_Stargazer
```

### 10.2 RAG 只做兜底

RAG 用于：

- 英雄称号。
- 装备俗称。
- 玩家黑话。
- 版本描述。
- 模糊输入改写。

RAG 不用于：

- 计算胜率。
- 判断最优装备。
- 替代装备白名单。
- 替代 API 查询。

### 10.3 置信度策略

```text
exact alias 命中 -> 直接查询
模糊匹配高置信 -> 直接查询，并可在条件里展示识别结果
低置信 -> 追问用户
多候选冲突 -> 追问用户
```

## 11. 默认上下文补全

缺省规则：

| 缺失条件 | 默认值 |
|---|---|
| 星级 | 2 星 |
| 装备数 | 3 件 |
| 装备类型 | 普通装备 |
| 版本 | current |
| 时间 | 近 3 天 |
| 段位 | 铂金以上或用户配置 |
| 样本阈值 | 100 |
| 阵容/羁绊 | 当前英雄最热门主流阵容/羁绊，MVP 可先不强制补阵容 |

输出中必须列出所有默认补全项。

### 11.1 Default Context Builder 的重要性

Default Context Builder 是本项目的关键模块。它负责处理“霞带哪三件装备最好？”这种懒输入，把缺失条件补成一个可执行、可解释、可复现的结构化查询。

默认上下文必须满足：

- 可追溯：说明每个默认条件从哪里来。
- 可解释：结果底部展示默认条件。
- 可配置：用户可修改默认段位、样本阈值、时间范围、排序偏好。
- 可失效：版本、patch、MetaTFT cluster_id 变化时刷新。

### 11.2 默认阵容数据源

默认阵容上下文建议优先使用 MetaTFT `/comps` 阵容页背后的接口，而不是只靠 Explorer。

主要数据链路：

```text
GET /tft-comps-api/latest_cluster_info
-> 获取当前版本阵容 cluster 列表、核心单位、核心羁绊、阵容名称

GET /tft-comps-api/comp_options
-> 获取每个 cluster 在不同人口下的 units_list、traits_list、count、avg、score

GET /tft-comps-api/comp_builds
-> 获取每个 cluster 下的单位装备组合，用作默认上下文辅助参考
```

`latest_cluster_info` 样例字段：

```json
{
  "Cluster": 409000,
  "units_string": "TFT17_Aatrox, TFT17_TwistedFate, TFT17_Jax, ...",
  "traits_string": "TFT17_APTrait_1, TFT17_DRX_1, ...",
  "name_string": "TFT17_Augment_JaxCarry, TFT17_Pantheon"
}
```

`comp_options` 样例字段：

```json
{
  "cluster": "409000",
  "units_list": "TFT17_Aatrox&TFT17_Jax&TFT17_Lulu&TFT17_Maokai&TFT17_Milio&TFT17_Pantheon&TFT17_TwistedFate",
  "traits_list": "TFT17_APTrait_1&TFT17_DRX_1&TFT17_Fateweaver_1&TFT17_HPTank_1&TFT17_ResistTank_1&TFT17_Stargazer_Medallion_1&TFT17_Timebreaker_1",
  "count": 851,
  "avg": 5.7121,
  "num_unit_slots": 7,
  "num_units": 7,
  "score": 50.862
}
```

### 11.3 懒输入默认构建流程

用户输入：

```text
霞带哪三件装备最好？
```

默认构建流程：

```text
1. Entity Resolver 识别 unit = TFT17_Xayah
2. Context Builder 查询/读取 comps cache
3. 在 latest_cluster_info / comp_options 中筛选包含 TFT17_Xayah 的 cluster
4. 按 count、score、avg 选择默认主流阵容
5. 从该 cluster 的 traits_list 提取主羁绊作为默认 trait_filters
6. 默认 star_level = 2
7. 默认 item_count = 3
8. 默认 item_policy = ordinary_only
9. 生成 Explorer unit_builds 查询
10. 在输出底部说明默认阵容来源
```

推荐选择规则：

```text
候选 cluster 必须包含目标英雄
优先 count 高
再看 score 高
再看 avg 低
过滤过低样本 cluster
默认不选特殊玩法/专属强化 cluster，除非用户输入命中
```

### 11.4 默认上下文输出要求

输出必须明确哪些条件是用户输入，哪些是系统补全。

示例：

```text
查询条件：
用户输入：霞
系统补全：2星 / 主流阵容：狙神霞 / 羁绊：3观星 / 3件普通装备 / 当前版本 / 近3天 / 铂金以上 / 样本>=100
默认阵容来源：MetaTFT /comps，按含霞阵容的样本数、score 和平均名次选择
```

### 11.5 MVP 与后续阶段

MVP 阶段：

- 实现 `latest_cluster_info + comp_options` 的本地缓存。
- 对“霞带哪三件装备最好？”自动补“含霞的高样本主流 cluster”。
- 如果找不到稳定 cluster，则退化为不带阵容羁绊的 `unit_builds/{unit}` 查询，并提示“未找到稳定主流阵容，未补羁绊”。

后续阶段：

- 支持用户选择默认阵容策略：最高样本、最低均名、最高前四、最热门。
- 支持多候选默认上下文：例如“狙神霞”和“观星者霞”同时展示。
- 支持根据玩家当前已开羁绊选择更贴近局内状态的默认阵容。

### 11.6 查询校验与澄清策略

#### Query Validator

LLM 或规则解析输出 JSON 后，必须先经过 Query Validator。

校验内容：

- `unit` 是否存在于当前 set。
- `item` 是否存在于 item catalog。
- `trait` 是否存在于当前 set。
- `star_level` 是否在合法范围。
- `item_count` 是否为 0-3。
- `item_policy` 是否和用户输入一致。
- “普通装备”查询是否混入光明、神器、组件、转职、特殊装备、已移除装备。
- 默认阵容 cluster 是否包含目标英雄。

校验失败时：

- 可自动修复的，修复并在查询条件中说明。
- 影响结果的，触发澄清。
- 无法修复的，返回明确错误，不编造答案。

#### Clarification Policy

自动补全优先，但以下情况需要追问：

- 英雄/装备/羁绊实体多候选且置信度接近。
- 当前版本不存在该英雄或装备，但用户明确指定。
- 用户要求比较两个选项，但只识别出一个选项。
- 用户要求“最好”但同时指定互相冲突的排序条件。
- 默认阵容候选差异很大，且会显著影响结果。

不需要追问的情况：

- 只缺星级：默认 2 星。
- 只缺装备数：默认 3 件。
- 只缺段位/天数/样本阈值：用用户偏好或系统默认。
- 只缺阵容：使用 Default Context Builder 补主流阵容，并在结果底部说明。

## 12. 小窗交互需求

### 12.1 基础 UI

- 常驻小窗。
- 快捷键唤起。
- 输入框。
- 查询结果卡片。
- 样本阈值切换：10 / 50 / 100 / 500 / 1000。
- 装备类型开关：
  - 普通
  - 包含光明
  - 包含神器
  - 包含特殊装备
- 结果刷新按钮。
- 查询条件展开/收起。

### 12.2 输出卡片

展示字段：

- 推荐三件套。
- 前四率。
- 吃鸡率。
- 平均名次。
- 样本数。
- 样本风险提示。
- 查询条件。
- 默认补全条件。

### 12.3 速度要求

目标：

- 热缓存命中：100ms 内返回。
- 本地缓存命中：300ms 内返回。
- 远程 API 查询：1-2s 内返回。
- 远程失败时展示缓存结果和更新时间。

## 13. 缓存设计

建议使用 SQLite。

核心表：

```text
entity_aliases
items
traits
units
query_cache
build_stats_cache
default_context_cache
api_request_log
```

缓存 key 应包括：

```text
unit
star_level
item_count
trait_filters
owned_items
item_policy
rank
days
patch
queue
min_samples
```

`default_context_cache` 建议字段：

```text
unit
cluster_id
comp_name
units_list
traits_list
source_endpoint
rank
days
patch
queue
score
count
avg
expires_at
updated_at
```

## 14. 后端模块划分

```text
QueryParser
  解析中文输入、星级、装备、羁绊、样本阈值、排序意图

EntityResolver
  中文名/称号/外号 -> apiName

ContextBuilder
  缺省条件补全
  默认阵容/羁绊推断
  基于 /tft-comps-api/latest_cluster_info 和 /comp_options 选择含目标英雄的主流阵容

MetaTFTClient
  封装 Explorer API
  请求重试、超时、错误处理

CompsContextClient
  封装 /tft-comps-api/latest_cluster_info
  封装 /tft-comps-api/comp_options
  封装 /tft-comps-api/comp_builds

QueryValidator
  校验结构化查询合法性
  校验默认阵容是否包含目标英雄
  校验装备类型和当前版本可用性

ClarificationPolicy
  判断自动补全还是追问

ItemPolicyFilter
  普通/光明/神器/特殊装备过滤
  当前版本可用性过滤

StatsCalculator
  placement_count -> games/top4/win/avg

Ranker
  样本过滤和排序

ResponseFormatter
  小窗结果格式化
  查询条件说明
```

## 15. 风险与注意事项

- MetaTFT API 是非官方公开接口，路径和参数可能变化。
- API 返回可能包含当前版本不可用或特殊来源装备，必须本地过滤。
- 英雄/羁绊/装备 apiName 会随赛季变化，不能写死。
- 中文称号存在歧义，低置信时需要追问。
- 样本太低时不要给强结论。
- 用户指定特殊装备时，要明确结果包含特殊装备，不应混入普通装备查询。
- `/comps` 阵容页的 cluster_id 会更新，Default Context Builder 的缓存必须按 cluster_id、patch、queue 失效。
- 默认主流阵容可能不是用户当前局面最优阵容，必须在输出中说明“默认阵容来源”和补全条件。

## 16. 推荐开发顺序

1. 实现 MetaTFT `unit_builds/{unit}` 查询客户端。
2. 实现 `placement_count` 统计计算。
3. 实现普通装备白名单和装备分类过滤。
4. 实现中文英雄/装备/羁绊基础字典。
5. 实现自然语言 QueryParser 的规则版。
6. 实现样本阈值和排序。
7. 实现 Query Validator 和 Clarification Policy。
8. 实现 Default Context Builder，接入 `/tft-comps-api/latest_cluster_info` 和 `/comp_options`。
9. 实现小窗 UI 原型。
10. 加入缓存。
11. 加入 RAG/向量检索兜底。
12. 扩展更复杂的默认阵容和羁绊自动补全。

## 17. MVP 验收标准

输入：

```text
2星霞，3观星，携带哪三件普通装备最好？
```

系统能够：

- 正确识别霞、2 星、3 观星、普通装备、3 件装备。
- 调用 MetaTFT Explorer API。
- 计算前四率、吃鸡率、平均名次、样本数。
- 过滤当前版本不可用和非普通装备。
- 按样本阈值过滤。
- 输出最优三件套和 2 个备选。
- 展示完整查询条件。

输入：

```text
霞带哪三件装备最好？
```

系统能够：

- 默认补全 2 星、3 件普通装备、当前版本、近 3 天、默认段位、样本阈值。
- 输出结果底部展示默认补全条件。

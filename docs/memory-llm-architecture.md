# 记忆系统与大模型框架设计

## 1. 设计结论

本产品不应该设计成“一个带长期记忆的聊天机器人”，而应该设计成：

```text
确定性查询系统 + 轻量个性化记忆 + 受控 LLM 解析层
```

记忆系统负责保存用户偏好、历史查询、实体别名、默认条件和反馈；大模型框架负责把自然语言稳定转换成结构化查询，不负责胜率计算、装备排序和最终数据判断。

局内热路径目标：

```text
用户输入 -> 规则/字典优先解析 -> 必要时 LLM 结构化补全 -> API 查询/缓存 -> 本地排序 -> 输出
```

## 2. 记忆系统分层

### 2.1 会话记忆 Session Memory

生命周期：当前小窗会话，游戏退出或用户清空后可丢弃。

用途：

- 记录最近一次查询条件。
- 支持追问和省略表达。
- 支持“那如果有羊刀呢？”这种上下文继承。

示例：

```json
{
  "last_query": {
    "unit": "TFT17_Xayah",
    "star_level": [2],
    "trait_filters": ["TFT17_Stargazer_1"],
    "item_policy": "ordinary_only",
    "min_samples": 100
  },
  "last_result_ids": ["build_1", "build_2", "build_3"],
  "updated_at": "2026-07-05T15:10:00+08:00"
}
```

规则：

- 可以自动写入。
- 不需要用户确认。
- 只用于短上下文，不进入长期画像。

### 2.2 用户偏好记忆 User Preference Memory

生命周期：长期保存，用户可在设置里修改或清空。

用途：

- 默认段位。
- 默认样本阈值。
- 默认排序偏好。
- 是否默认只看普通装备。
- 是否偏好稳分/吃鸡/高样本。

示例：

```json
{
  "default_rank": ["PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"],
  "default_days": 3,
  "default_min_samples": 100,
  "default_item_policy": "ordinary_only",
  "sort_preference": "top4_first",
  "show_default_context": true
}
```

规则：

- 用户主动设置时写入。
- 可以从行为中提出建议，但不要静默改变关键偏好。
- 例如连续多次选择“样本>=500”后，可以提示“是否设为默认样本阈值？”。

### 2.3 领域字典记忆 Domain Dictionary Memory

生命周期：随版本更新，长期保存。

用途：

- 英雄中文名、称号、外号。
- 装备中文名、俗称、旧称。
- 羁绊中文名、简称。
- 拼音/英文/缩写。

示例：

```json
{
  "aliases": [
    {
      "alias": "霞",
      "entity_type": "unit",
      "api_name": "TFT17_Xayah",
      "confidence": 1.0,
      "source": "official_or_manual"
    },
    {
      "alias": "逆羽",
      "entity_type": "unit",
      "api_name": "TFT17_Xayah",
      "confidence": 1.0,
      "source": "lol_title"
    },
    {
      "alias": "羊刀",
      "entity_type": "item",
      "api_name": "TFT_Item_GuinsoosRageblade",
      "confidence": 1.0,
      "source": "manual"
    }
  ]
}
```

规则：

- 高频别名必须字典命中，不走向量检索。
- RAG 只做长尾兜底。
- 如果 RAG 识别到新别名，先作为候选，不自动污染主字典。
- 需要记录来源和置信度。

### 2.4 版本装备记忆 Item Catalog Memory

生命周期：跟随 TFT set/patch 更新。

用途：

- 判断当前版本装备是否可用。
- 判断装备类型：普通、光明、神器、转职、特殊、组件、历史。
- 过滤 MetaTFT 返回里的不可用装备。

示例：

```json
{
  "api_name": "TFT_Item_GuinsoosRageblade",
  "zh_name": "鬼索的狂暴之刃",
  "aliases": ["羊刀", "鬼索"],
  "category": "ordinary_completed",
  "current": true,
  "obtainable": true,
  "patch": "current"
}
```

规则：

- 这是硬规则，不交给 LLM 判断。
- 普通装备查询只允许 `category=ordinary_completed && current=true && obtainable=true`。
- 例如当前版本没有“分裂弓”，即使 MetaTFT 返回 `TFT_Item_RunaansHurricane`，也必须剔除。

### 2.5 查询缓存 Query Cache

生命周期：短期到中期，按 patch/days/rank 失效。

用途：

- 加速局内查询。
- 避免重复请求 MetaTFT API。
- 远程失败时可返回旧结果并提示更新时间。

缓存 key：

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
sort
```

规则：

- 可以自动写入。
- 不属于用户记忆。
- patch/current、days、rank 变化时需要区分缓存。

### 2.6 默认上下文记忆 Default Context Memory

生命周期：随 patch、queue、cluster_id 更新，长期缓存但可失效。

用途：

- 给“霞带哪三件装备最好？”这种懒输入自动补主流阵容/羁绊上下文。
- 缓存 `/comps` 阵容页背后的 cluster 数据。
- 避免每次查询都重新扫描阵容列表。

数据来源：

```text
GET /tft-comps-api/latest_cluster_info
GET /tft-comps-api/comp_options
GET /tft-comps-api/comp_builds
```

示例：

```json
{
  "unit": "TFT17_Xayah",
  "cluster_id": "409123",
  "comp_name": "狙神霞",
  "units_list": ["TFT17_Xayah", "TFT17_UnitA", "TFT17_UnitB"],
  "traits_list": ["TFT17_Stargazer_1", "TFT17_Sniper_1"],
  "source_endpoint": "tft-comps-api/comp_options",
  "count": 13312,
  "avg": 4.46,
  "score": 78.2,
  "patch": "current",
  "queue": "1100",
  "updated_at": "2026-07-05T15:10:00+08:00"
}
```

规则：

- 默认阵容 cluster 必须包含目标英雄。
- 优先高样本，其次高 score，再其次低平均名次。
- cluster_id、patch、queue 变化时缓存失效。
- 输出时必须说明“默认阵容来源”。
- 找不到稳定默认阵容时，退化为不带阵容羁绊的 `unit_builds/{unit}` 查询，并提示未补阵容。

### 2.7 反馈记忆 Feedback Memory

生命周期：长期，但要可清空。

用途：

- 记录用户点踩/纠错。
- 记录实体识别纠错。
- 优化默认条件。

示例：

```json
{
  "feedback_type": "entity_correction",
  "user_input": "分裂弓",
  "wrong_entity": "TFT_Item_RunaansHurricane",
  "correction": "current_patch_unavailable",
  "created_at": "2026-07-05T15:10:00+08:00"
}
```

规则：

- 纠错类反馈要进入候选库。
- 影响全局字典前需要人工或高置信规则确认。

## 3. 推荐数据库结构

建议 SQLite 起步。

### 3.1 `user_preferences`

```sql
CREATE TABLE user_preferences (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 3.2 `entity_aliases`

```sql
CREATE TABLE entity_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  api_name TEXT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  patch TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_entity_aliases_lookup
ON entity_aliases(normalized_alias, entity_type, enabled);
```

### 3.3 `item_catalog`

```sql
CREATE TABLE item_catalog (
  api_name TEXT PRIMARY KEY,
  zh_name TEXT,
  category TEXT NOT NULL,
  current INTEGER NOT NULL,
  obtainable INTEGER NOT NULL,
  patch TEXT NOT NULL,
  aliases_json TEXT NOT NULL,
  raw_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_item_catalog_policy
ON item_catalog(category, current, obtainable, patch);
```

### 3.4 `query_cache`

```sql
CREATE TABLE query_cache (
  cache_key TEXT PRIMARY KEY,
  request_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  computed_json TEXT NOT NULL,
  source TEXT NOT NULL,
  patch TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 3.5 `session_state`

```sql
CREATE TABLE session_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 3.6 `feedback_events`

```sql
CREATE TABLE feedback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
```

### 3.7 `default_context_cache`

```sql
CREATE TABLE default_context_cache (
  cache_key TEXT PRIMARY KEY,
  unit TEXT NOT NULL,
  cluster_id TEXT NOT NULL,
  comp_name TEXT,
  units_json TEXT NOT NULL,
  traits_json TEXT NOT NULL,
  source_endpoint TEXT NOT NULL,
  rank TEXT NOT NULL,
  days INTEGER NOT NULL,
  patch TEXT NOT NULL,
  queue TEXT NOT NULL,
  score REAL,
  count INTEGER,
  avg REAL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_default_context_unit
ON default_context_cache(unit, patch, queue, expires_at);
```

## 4. 大模型框架设计

### 4.1 框架定位

大模型只做三件事：

1. 把自然语言转成严格 JSON 查询意图。
2. 在字典/规则无法识别时做候选实体召回。
3. 把结构化结果压缩成适合小窗展示的自然语言。

大模型不做：

- 不计算胜率。
- 不编造装备强度。
- 不决定当前版本装备是否存在。
- 不直接访问 MetaTFT。
- 不绕过本地过滤规则。

### 4.2 推荐链路

```text
Input
-> PreNormalizer
-> Rule Parser
-> Entity Resolver
-> LLM Structured Parser, optional
-> Context Builder
-> Query Validator
-> Query Planner
-> MetaTFT Client
-> Stats Calculator
-> Item Policy Filter
-> Ranker
-> Response Formatter
-> Memory Writer
```

### 4.3 分层职责

#### PreNormalizer

处理：

- 全角/半角。
- 繁简。
- 空格。
- 数字表达：二星、2星、两星。
- 常见错别字。

#### Rule Parser

优先用规则提取确定信息：

```text
2星
3观星
三件
普通装备
光明
神器
样本>=500
吃鸡优先
前四优先
```

#### Entity Resolver

解析实体：

```text
霞 -> TFT17_Xayah
逆羽 -> TFT17_Xayah
羊刀 -> TFT_Item_GuinsoosRageblade
```

解析顺序：

```text
exact alias
normalized alias
pinyin/fuzzy
vector/RAG
LLM candidate rerank
```

#### LLM Structured Parser

只在规则解析不完整或多意图时调用。

输出必须是严格 JSON，不允许自由文本。

示例 schema：

```json
{
  "intent": "unit_best_3_items",
  "entities": {
    "unit_mentions": ["霞"],
    "item_mentions": ["羊刀"],
    "trait_mentions": ["观星"]
  },
  "constraints": {
    "star_level": [2],
    "item_count": 3,
    "item_policy": "ordinary_only",
    "owned_items": [],
    "min_samples": 100,
    "sort": "top4_first"
  },
  "needs_clarification": false,
  "clarification_question": null
}
```

#### Context Builder

补全缺失条件：

- 星级默认 2 星。
- 装备数默认 3 件。
- 装备类型默认普通装备。
- patch 默认 current。
- days 默认 3。
- rank 默认用户偏好或铂金以上。
- min_samples 默认用户偏好或 100。
- 阵容/羁绊缺失时，通过 Default Context Builder 查找含目标英雄的主流阵容，并从该阵容提取默认羁绊。

必须记录哪些条件是用户输入，哪些是系统默认。

#### Default Context Builder

Default Context Builder 是 Context Builder 中最重要的子模块，负责把懒输入补成可执行查询。

主要数据源来自 MetaTFT `/comps` 阵容页：

```text
/tft-comps-api/latest_cluster_info
/tft-comps-api/comp_options
/tft-comps-api/comp_builds
```

构建流程：

```text
1. 输入 unit，例如 TFT17_Xayah
2. 读取 default_context_cache
3. 缓存缺失或过期时调用 CompsContextClient
4. 在 latest_cluster_info / comp_options 中筛选包含该 unit 的 cluster
5. 按 count、score、avg 选择默认主流 cluster
6. 从 units_list、traits_list 生成默认阵容上下文
7. 将主羁绊写入 trait_filters
8. 将默认来源写入 assumptions
```

默认选择规则：

```text
候选 cluster 必须包含目标英雄
优先 count 高
再看 score 高
再看 avg 低
过滤过低样本 cluster
默认不选明显的特殊强化/赌狗/专属玩法 cluster，除非用户输入命中
```

输出必须展示：

```text
默认阵容来源：MetaTFT /comps，按含该英雄阵容的样本数、score 和平均名次选择
```

#### Query Validator

LLM 和规则解析出的结构化查询必须通过校验后才能进入 Query Planner。

校验内容：

- `unit` 是否存在于当前 set。
- `item` 是否存在于 item catalog。
- `trait` 是否存在于当前 set。
- 默认 cluster 是否包含目标英雄。
- 星级和装备数是否合法。
- 普通装备查询是否混入光明、神器、组件、转职、特殊装备、历史装备。

失败策略：

```text
可自动修复 -> 修复并记录 assumption/warning
影响结果 -> 触发 Clarification Policy
无法修复 -> 返回错误，不编造答案
```

#### Query Planner

将结构化上下文转成 MetaTFT API 请求。

例：

```json
{
  "endpoint": "unit_builds",
  "path_unit": "TFT17_Xayah",
  "params": {
    "formatnoarray": true,
    "compact": true,
    "queue": "1100",
    "patch": "current",
    "days": 3,
    "rank": "CHALLENGER,DIAMOND,EMERALD,GRANDMASTER,MASTER,PLATINUM",
    "unit_tier_numitems_unique": "TFT17_Xayah-1_2_3",
    "trait": "TFT17_Stargazer_1"
  }
}
```

#### CompsContextClient

封装 `/comps` 阵容页背后的 API：

```text
GET /tft-comps-api/latest_cluster_info
GET /tft-comps-api/comp_options
GET /tft-comps-api/comp_builds
```

职责：

- 拉取最新 cluster_id。
- 拉取 cluster 的核心单位、核心羁绊和名称。
- 拉取不同人口下的阵容选项。
- 为 Default Context Builder 提供候选主流阵容。

#### Clarification Policy

决定什么时候自动补全，什么时候追问用户。

自动补全：

- 缺星级，默认 2 星。
- 缺装备数，默认 3 件。
- 缺段位/天数/样本阈值，用用户偏好或系统默认。
- 缺阵容，使用 Default Context Builder 补主流阵容。

需要追问：

- 实体多候选且置信度接近。
- 用户指定当前版本不存在的英雄或装备。
- 用户要求比较多个选项但只识别出一个。
- 默认阵容候选差异很大，且会显著影响结果。

#### Response Formatter

输入是 Ranker 的结构化结果，不允许自己改数字。

输出结构：

```json
{
  "answer_cards": [
    {
      "title": "推荐",
      "items": ["装备A", "装备B", "装备C"],
      "top4": 58.9,
      "win": 18.8,
      "avg": 3.97,
      "games": 53266
    }
  ],
  "assumptions": [
    "默认 2 星",
    "默认 3 件普通装备",
    "默认当前版本近 3 天",
    "默认样本>=100"
  ],
  "warnings": []
}
```

## 5. LLM 调用策略

### 5.1 热路径尽量不调用 LLM

高频查询应该命中规则和字典：

```text
霞三件套
2星霞3观星
霞有羊刀
霞普通装备
```

这些输入不需要 LLM。

### 5.2 低置信才调用 LLM

触发条件：

- 未识别实体。
- 多个实体冲突。
- 复杂自然语言包含比较、排除、特殊条件。
- 用户输入像口语：“我这把霞已经有个羊刀，观星开了，剩下咋补？”

### 5.3 LLM 只返回结构化结果

不要让模型直接生成最终答案。最终答案必须由 `ResponseFormatter` 基于结构化统计生成。

### 5.4 低置信追问

如果无法确定实体：

```text
你说的“卡莎”是当前赛季单位，还是英雄称号/旧称？请选择一个。
```

局内追问要尽量少。只有影响查询结果时才追问。

## 6. RAG 设计

### 6.1 RAG 数据源

- 官方英雄称号。
- 当前 TFT set 英雄列表。
- 当前 TFT set 装备列表。
- 装备中文名和俗称。
- 羁绊中文名和简称。
- 人工补充的玩家黑话。
- 用户纠错反馈。

### 6.2 检索策略

```text
BM25/关键词
+ alias exact match
+ 拼音/缩写
+ 向量检索
+ rerank
```

### 6.3 RAG 结果限制

RAG 输出只能是候选实体：

```json
{
  "candidates": [
    {
      "entity_type": "item",
      "api_name": "TFT_Item_GuinsoosRageblade",
      "matched_alias": "羊刀",
      "confidence": 0.98
    }
  ]
}
```

RAG 不能输出“最优装备是 X”。

## 7. 记忆写入策略

### 7.1 自动写入

可以自动写入：

- session state。
- query cache。
- API response cache。
- 最近查询历史。

### 7.2 半自动写入

需要用户确认或高置信规则：

- 默认样本阈值变更。
- 默认段位变更。
- 默认排序偏好变更。
- 新别名进入主字典。

### 7.3 禁止写入

不要写入：

- 用户临时局内状态为长期偏好。
- 单次查询里的特殊装备偏好。
- 低置信 RAG 结果。
- API 返回但本地 catalog 认为不可用的装备作为当前装备。

## 8. 典型流程

### 8.1 “霞带哪三件装备最好？”

```text
1. Rule Parser 识别意图：unit_best_3_items
2. Entity Resolver：霞 -> TFT17_Xayah
3. Default Context Builder 读取 /comps 缓存，选择含霞的主流阵容 cluster
4. Context Builder 默认补全：2星、3件、普通装备、主流羁绊、近3天、当前版本、样本>=100
5. Query Validator 校验默认 cluster 包含霞，并校验装备策略
6. Query Planner 生成 unit_builds/TFT17_Xayah
7. MetaTFT Client 查询或读缓存
8. Stats Calculator 计算 top4/win/avg/games
9. Item Policy Filter 剔除非当前普通装备
10. Ranker 排序
11. Formatter 输出推荐、默认条件和默认阵容来源
12. Memory Writer 写入 session/query cache/default_context_cache
```

### 8.2 “那有羊刀呢？”

```text
1. Session Memory 继承上次 unit=TFT17_Xayah
2. Entity Resolver：羊刀 -> TFT_Item_GuinsoosRageblade
3. Context Builder 加入 owned_items
4. 本地过滤包含羊刀的三件套
5. 输出剩余两件推荐
```

## 9. MVP 实现建议

第一版不要接完整 Agent 框架。先实现轻量版本：

```text
规则解析器
+ SQLite 字典
+ MetaTFT Client
+ 本地过滤/排序
+ 简单 Response Formatter
```

LLM/RAG 第二阶段再接入：

```text
第一阶段：规则和字典可覆盖 80% 高频查询
第二阶段：LLM 结构化解析复杂口语
第三阶段：RAG 处理称号、外号、版本描述和长尾黑话
```

## 10. 工程目录建议

```text
src/
  core/
    query-parser.ts
    entity-resolver.ts
    context-builder.ts
    default-context-builder.ts
    query-validator.ts
    clarification-policy.ts
    query-planner.ts
    stats-calculator.ts
    ranker.ts
    response-formatter.ts
  data/
    metatft-client.ts
    comps-context-client.ts
    cache-store.ts
    memory-store.ts
    item-catalog.ts
  llm/
    structured-parser.ts
    rag-retriever.ts
    prompts/
      parse-query.md
  app/
    small-window-ui
```

## 11. 验收标准

- 高频输入不调用 LLM 也能返回结果。
- LLM 输出必须通过 schema 校验。
- 所有最终推荐数字都来自 `placement_count` 本地计算。
- 普通装备查询不会出现当前版本不可用装备。
- 用户追问能继承上一轮上下文。
- 默认补全条件会明确展示。
- 用户可清空长期偏好和查询历史。

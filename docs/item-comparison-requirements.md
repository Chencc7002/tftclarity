# TFTAgent 多装备对比需求文档

## 1. 背景

用户在神器铁砧、装备选择或普通出装决策中，经常面对多个候选装备。例如：

```text
霞用烁刃好还是巨九好？
霞已经有羊刀，烁刃、巨九和死亡之蔑哪个更好？
烁刃和巨九呢？
```

这类输入不是要求同时锁定所有装备，而是要求在完全一致的英雄、版本、段位、天数、星级、羁绊和已有装备条件下，比较各候选装备对应的真实完整出装样本。

现有比较链路可继续复用，但需要明确“已持有装备”“比较候选”和“排除装备”是三个不同集合，并补齐互斥样本、统计稳定性、多轮会话和 UI 证据展示。

## 2. 目标

1. 支持两个或多个指定装备的单英雄装备表现对比。
2. 比较候选不能被同时写入 `ownedItems` 或作为 AND 查询条件。
3. 使用同一批结构化 MetaTFT 数据在本地形成可比样本组。
4. 输出前四率、吃鸡率、平均名次、样本量、名次分布和常见完整搭配。
5. 样本不足、指标缺失或差异不稳定时不强行宣布胜者。
6. 支持“神器铁砧”“还是”“哪个好”“A vs B”等自然语言。
7. 支持连续追问和追加候选，不让阵容榜、装备详情或已持有条件相互泄漏。

## 3. 非目标

- 不根据装备说明、攻略经验或 LLM 常识推断强弱。
- 不把相关性描述为装备造成结果提升的因果关系。
- 不抓取 MetaTFT 网页 HTML。
- 不让 LLM 生成装备名称、类别、可用性、效果、配方或统计数字。
- 不在证据不足时自动选择未指定的神器、纹章或其他特殊装备。
- 本阶段不实现跨英雄的全局装备强度榜。

## 4. 核心意图和数据模型

统一使用 `unit_item_comparison` 意图。

```json
{
  "intent": "unit_item_comparison",
  "unit": "TFT17_Xayah",
  "lockedItems": ["TFT_Item_GuinsoosRageblade"],
  "comparisonItems": ["catalog-resolved-api-id-a", "catalog-resolved-api-id-b"],
  "excludedItems": [],
  "comparisonMode": "exclusive_presence",
  "itemPolicy": "include_artifact",
  "constraints": {
    "patch": "current",
    "rankFilter": [],
    "days": 3,
    "starLevel": [2],
    "traitFilters": [],
    "minSamples": 100,
    "sort": "top4_first"
  }
}
```

字段语义：

- `lockedItems`：每个候选样本组都必须包含的已持有装备。
- `comparisonItems`：彼此独立比较的候选装备，至少两个，默认最多五个。
- `excludedItems`：所有候选样本组都必须排除的装备。
- `comparisonMode=exclusive_presence`：候选 A 组必须包含 A 且不包含其他候选；其他候选同理。
- `itemPolicy`：出现神器、光明、纹章等具体候选时按 catalog 类别自动扩展，但不能扩展为“混入全部特殊装备”。

三个集合必须去重，且同一 API ID 不能同时存在于两个集合。冲突时优先遵循本轮明确输入；无法确定时澄清。

## 5. 意图识别规则

以下表达应进入比较意图：

- `A 还是 B`
- `A 和 B 哪个好/哪个强/更适合`
- `比较 A、B、C`
- `A vs B`
- `在 A、B 里选哪个`
- `铁砧开到 A 和 B，给霞选哪个`

多个装备名本身不等于比较：

- `霞带 A 和 B`：默认表示同时锁定；如果装备类别或上下文显示为二选一场景，应澄清。
- `霞有 A，B 还是 C`：A 进入 `lockedItems`，B/C 进入 `comparisonItems`。
- `不要 A，B 还是 C`：A 进入 `excludedItems`，B/C 进入 `comparisonItems`。

比较词与“已有、已经有、锁定、不要、排除”等关系词必须按文本跨度绑定，不能仅按装备出现顺序猜测。

## 6. 实体与可用性

1. 所有候选必须通过统一 item catalog 解析。
2. canonical 名称、短名、历史别名、类别、当前可用性和图标继续共用现有目录。
3. 指定的神器候选自动使用 `include_artifact`；指定纹章使用 `include_special`，但只锁定或比较已指定 API ID。
4. 任一候选在当前 patch 不可用时，在远端查询前返回本地说明，并列出仍可比较的候选。
5. 名称证据不足或同一别名映射多个当前实体时必须澄清。
6. “烁刃”“巨九”等展示名必须来自当前官方目录或已审核别名；需求和测试不得凭名称推导 API ID。

## 7. 查询与样本分组

### 7.1 统一查询口径

优先对目标英雄执行一次同口径 `unit_builds` 查询，再在本地聚合所有比较候选。这样可保证候选来自同一 patch、更新时间、段位、天数、星级和羁绊条件。

如果上游必须按候选拆分请求，则所有请求必须使用完全相同的查询参数，并记录各自更新时间；时间窗口不一致时不能给稳定胜负结论。

### 7.2 互斥组

对候选集合 `[A, B, C]`：

```text
A 组 = 包含 A，且不包含 B/C
B 组 = 包含 B，且不包含 A/C
C 组 = 包含 C，且不包含 A/B
overlap = 同时包含两个或多个比较候选
```

默认胜负只使用互斥组。`overlap` 需要返回样本量和比例，但不混入任一候选指标。

`lockedItems` 必须存在于每个组；`excludedItems` 必须从每个组排除。

### 7.3 计数规则

- 按完整出装行的 `placement_count` 聚合。
- 同一候选在一套出装中重复出现时，该出装只计为“包含该候选”，样本量仍使用该行真实对局数。
- 不把装备出现次数乘入样本量。
- 不从装备效果文本生成任何统计。

## 8. 指标和结论

每个候选至少返回：

```json
{
  "apiName": "catalog-resolved-api-id",
  "name": "官方或已审核展示名",
  "iconUrl": null,
  "games": 0,
  "top4Rate": null,
  "winRate": null,
  "avgPlacement": null,
  "placementCount": [],
  "commonBuilds": [],
  "overlapGames": 0,
  "lowSample": false
}
```

主指标映射：

| 用户表达 | 主指标 | 次级证据 |
| --- | --- | --- |
| 哪个好、哪个强 | 前四率 | 平均名次、吃鸡率、样本 |
| 更稳、上分 | 前四率 | 平均名次、样本 |
| 上限高、吃鸡 | 吃鸡率 | 前四率、样本 |
| 平均表现 | 平均名次升序 | 前四率、样本 |
| 更常用 | 样本量/选择率 | 其他指标仅展示 |

默认按前四率比较，并在回答中明确本次口径。

只有以下条件同时满足时才可给出 `winner`：

1. 主指标在所有候选中可用。
2. 参与胜负判断的候选都达到稳定样本门槛。
3. 领先差值达到配置的最小实质差异。
4. overlap 比例没有高到破坏互斥比较。
5. 数据源不是无法确认时效的错误回退。

否则返回 `winner: null`，并说明“样本不足”“差距接近”“指标缺失”或“重叠样本过多”。不能使用 Score、经验值或 LLM 判断替代缺失的吃鸡率等指标。

## 9. 结果措辞

允许：

```text
在当前版本、大师以上、近 3 天的霞完整出装样本中，烁刃组的前四率比巨九组高 2.8 个百分点；双方样本均达到门槛，因此本次更推荐烁刃。
```

不允许：

```text
烁刃让霞的前四率提升了 2.8%。
烁刃一定比巨九强。
```

回答必须说明这是条件相关的完整出装样本比较，不是装备单独造成结果变化的因果结论。

## 10. 会话记忆

- 上一轮英雄装备查询后输入 `烁刃还是巨九呢？`：继承英雄和兼容条件，创建新的比较候选。
- 上一轮比较后输入 `那死亡之蔑呢？`：默认将新候选加入当前比较集合并重新排名；若超过候选上限则澄清替换哪一项。
- `换成死亡之蔑呢？`：替换本轮明确指向的候选；指向不清时澄清。
- `我已经有羊刀`：把羊刀加入 `lockedItems`，保留比较候选。
- `不要巨九了`：从比较候选移除巨九；不足两个候选时询问新的比较对象。
- 阵容榜会话、装备百科会话和单英雄比较条件不得互相泄漏。

最终查询字段继续保留 `current_input`、`conversation`、`preference`、`system_default` 来源。

## 11. 澄清规则

以下情况必须阻断查询并澄清：

- 缺少目标英雄且无法安全继承。
- 只有一个有效比较候选。
- 只说“比较神器”或“铁砧里选一个”但未指定具体装备。
- 多个装备同时出现，但没有比较词，也没有明确“已有”关系。
- 候选别名存在多个当前实体。
- 候选与锁定/排除集合冲突。
- 用户同时要求互相冲突的主指标。

澄清应尽量提供可点击候选，但不能自动选择装备。

## 12. LLM 边界

LLM 可负责：

- 判断“还是、二选一、哪个好、那 X 呢”等关系。
- 从复杂句子中区分已持有、比较候选和排除项。
- 把口语重写为受控结构化意图。
- 生成不超出结构化 evidence 的自然语言摘要。

LLM 不得负责：

- 生成或修正装备 canonical 名称/API ID。
- 判断装备当前是否可用。
- 生成效果、配方、图标、指标、样本或胜者。
- 在缺少主指标时用游戏常识补结论。

所有 LLM 输出必须经过严格 schema、item catalog、Query Validator 和比较服务校验。

## 13. 响应结构

```json
{
  "ok": true,
  "type": "unit_item_comparison",
  "query": {
    "intent": "unit_item_comparison",
    "unit": "TFT17_Xayah",
    "lockedItems": [],
    "comparisonItems": [],
    "excludedItems": [],
    "comparisonMode": "exclusive_presence",
    "primaryMetric": "top4Rate",
    "constraintSources": {}
  },
  "results": [],
  "overlap": {
    "games": 0,
    "rate": 0
  },
  "decision": {
    "winner": null,
    "primaryMetric": "top4Rate",
    "delta": null,
    "confidence": "insufficient",
    "reason": ""
  },
  "source": {
    "provider": "MetaTFT",
    "endpoint": "tft-explorer-api/unit_builds",
    "updatedAt": null,
    "cache": "live"
  },
  "clarification": null
}
```

## 14. UI 要求

- 保持 ChatGPT 风格消息流，不新增阻断主流程的独立查询页面。
- 两个候选使用并列对比卡；三个以上使用紧凑排行表或可横向浏览卡片。
- 每项显示名称、图标、前四率、吃鸡率、平均名次、样本和常见完整搭配。
- 显示本次主指标、条件标签及来源。
- 显示 overlap、低样本、缓存和数据时效警告。
- 只有稳定结论才显示“本次更推荐”；否则显示“数据接近”或“暂不判断”。
- 360px 和 460px 宽度下不能依赖横向滚动才能看到胜负和关键样本。

## 15. 缓存和审计

比较缓存键至少包含：

- unit、starLevel、traitFilters；
- lockedItems、排序后的 comparisonItems、excludedItems；
- comparisonMode、primaryMetric；
- patch、queue、days、rankFilter、minSamples；
- catalog 版本或当前 patch 身份。

候选顺序不应产生不同缓存键。响应仍保留用户输入顺序用于 UI 展示。

审计信息应能追踪每个候选的 API ID、canonical 名称、类别、可用性来源和统计来源。

## 16. 离线验收用例

至少覆盖：

1. `霞用烁刃好还是巨九好？` 解析为两个 `comparisonItems`，不是两个 `ownedItems`。
2. `霞已经有羊刀，烁刃还是巨九？` 羊刀锁定，两个神器进入互斥组。
3. `霞不要海妖，烁刃、巨九和死亡之蔑哪个好？` 正确分离排除项和三个候选。
4. A/B 指标与 score 顺序相反时，按用户指定真实指标排序。
5. 同时含 A/B 的行只进入 overlap。
6. 重复候选装备不重复计算样本。
7. 任一候选低样本时不宣布胜者。
8. 差距低于实质阈值时返回 `winner: null`。
9. 缺少吃鸡率时，“吃鸡优先”显示 unavailable，不用 Score 替代。
10. `那死亡之蔑呢？` 继承英雄和条件并追加候选。
11. 从阵容榜切换到装备比较时不继承阵容榜专属状态。
12. 只说 `加入神器比较` 或未指定具体装备时澄清。
13. 当前不可用装备在远端请求前被拦截。
14. 三个以上候选的响应顺序、缓存键和 UI 序列化稳定。
15. LLM 假 provider 输出仍需通过 schema 和 catalog，不能注入未知 API ID 或统计。

所有单元测试必须离线可复现。实时 MetaTFT 检查只作为发布证据，并明确区分通过、跳过和未执行。

## 17. 实施建议

1. 先扩展 parser/schema，明确 `lockedItems` 与 `comparisonItems`。
2. 将现有比较聚合升级为互斥候选组和 overlap 统计。
3. 增加稳定性决策层，不让 formatter 自行判断胜者。
4. 扩展会话序列化与继承白名单。
5. 扩展小窗响应和对比 UI。
6. 最后补齐 HTTP smoke、完整测试和视觉检查。

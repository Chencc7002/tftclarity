# 英雄阵容检索与装备携带者排行开发文档

更新时间：2026-07-27

## 1. 目标

本阶段增加两个只读、确定性的结构化能力：

1. **英雄所在阵容**：用户输入“霞能玩什么阵容”“包含剑圣的阵容”等问题时，返回当前阵容榜中包含目标英雄的阵容。
2. **装备携带者排行**：用户输入“黎明核心适合给谁”“谁带黎明核心提升最大”等问题时，按棋子聚合携带目标装备的构筑，只返回相对棋子自身基准为正提升的结果，最多 8 个棋子，每个棋子附代表出装，不调用 LLM 生成解读。

本阶段不加入散件规划、玩家背包装备、赛季 Skill、通用装备原理或视频搜索。

## 2. 架构决策

### 2.1 英雄所在阵容

复用现有 `comps_rankings` 工具和 `/tft-comps-api/comps_data`、`/tft-comps-api/comps_stats` 数据链路，不新增外部工具。

新增的只是一个可选 `unit` 约束：

```text
自然语言
  -> comp_rankings + unit
  -> comps_rankings(unit=...)
  -> 构建当前阵容榜
  -> 过滤 units 包含目标英雄的阵容
  -> 复用现有阵容卡片返回
```

理由：

- 数据源、统计口径和展示结构与全局阵容榜完全相同。
- “英雄是否在阵容中”是现有阵容候选池上的确定性过滤，不应复制一套阵容查询服务。
- `comps_rankings` 已声明允许 `champion` 实体，只需让参数、执行计划和结果构建真正消费该实体。

### 2.2 装备携带者排行

新增结构化工具 `item_carrier_rankings`，因为它与 `unit_builds` 的查询方向和必需实体不同：

```text
unit_builds:            英雄 -> 装备组合
item_carrier_rankings:  装备 -> 携带棋子
```

数据链路：

```text
自然语言
  -> item_carrier_rankings(item=...)
  -> GET /tft-explorer-api/unit_builds
       item_unique=<item>-1
  -> 本地严格过滤构筑中确实包含目标装备的行
  -> 按 unitApiName 聚合 placement_count
  -> GET /tft-comps-api/unit_items_processed
  -> 读取棋子自身 avg 基准
  -> unitDelta = 携带装备后的平均名次 - 棋子基准平均名次
  -> 只保留 unitDelta < 0
  -> 最多返回 8 个棋子及代表出装
```

MetaTFT Explorer 的 `item_unique` 请求仍可能包含同局中的其他棋子构筑，所以“本地严格过滤目标装备”是强制步骤，不能把服务端返回的所有行直接聚合。

## 3. 查询契约

### 3.1 `comps_rankings` 扩展

新增可选参数：

```json
{
  "unit": "TFT17_Xayah"
}
```

规则：

- `unit` 必须来自已解析的当前赛季棋子目录。
- 只保留 `comp.units` 包含该 `unit` 的阵容。
- 继续应用原有页面可见性、特殊玩法、最低样本和排序规则。
- 没有匹配阵容时返回空榜，不退化成全局阵容榜。
- 返回类型继续使用 `comp_rankings`，复用现有前端阵容卡片。

### 3.2 `item_carrier_rankings`

输入：

```json
{
  "item": "TFT_Item_Artifact_Dawncore",
  "days": 3,
  "patch": "current",
  "queue": "1100",
  "rank": ["CHALLENGER", "GRANDMASTER", "MASTER", "DIAMOND", "EMERALD", "PLATINUM"],
  "minSamples": 100,
  "limit": 8,
  "buildLimit": 2,
  "positiveOnly": true,
  "sort": "games_first"
}
```

边界：

- `item` 必填。
- `limit` 最大为 8，默认 8。
- `buildLimit` 最大为 3，默认 2。
- 本阶段固定 `positiveOnly=true`。
- 默认按聚合样本量降序，提升值作为次级排序；既满足“高频携带者”，又避免低样本高提升占据首位。

输出：

```json
{
  "type": "item_carrier_rankings",
  "item": "TFT_Item_Artifact_Dawncore",
  "carriers": [
    {
      "unitApiName": "TFT17_Nami",
      "stats": {
        "games": 1951,
        "avgPlacement": 3.80,
        "top4Rate": 0.66,
        "winRate": 0.18
      },
      "baselineAvgPlacement": 4.23,
      "unitDelta": -0.43,
      "placementUplift": 0.43,
      "builds": [
        {
          "items": ["TFT_Item_Artifact_Dawncore", "TFT_Item_JeweledGauntlet", "TFT_Item_Leviathan"],
          "stats": {
            "games": 1951,
            "avgPlacement": 3.80,
            "top4Rate": 0.66,
            "winRate": 0.18
          }
        }
      ]
    }
  ]
}
```

## 4. 聚合规则

### 4.1 原始行解析

`unit_builds` 行格式：

```text
<unitApiName>&<itemA>|<itemB>|<itemC>
```

处理要求：

- 丢弃没有棋子、没有合法八档 `placement_count` 的行。
- 只保留 `items` 中包含目标装备的行。
- 使用 `unitApiName + 排序后的装备多重集` 作为构筑分组键；只对“分组键与八档 `placement_count` 都完全相同”的原始重复行去重，其余同构筑行合并计数。重复装备的份数不能丢失。

### 4.2 按棋子聚合

同一棋子的所有目标装备构筑合并八档名次桶：

```text
unitPlacementCount[p] = Σ buildPlacementCount[p]
```

所有统计量都从合并后的八档桶重新计算，禁止直接平均各行百分比或平均名次。

### 4.3 棋子变化

```text
unitDelta = carrierAvgPlacement - baselineAvgPlacement
placementUplift = -unitDelta
```

平均名次越低越好，因此：

- `unitDelta < 0`：正提升，允许返回。
- `unitDelta >= 0`：零提升或负提升，过滤。
- 基准缺失：过滤并记录 `missing_unit_baseline`，不能猜测。

### 4.4 代表出装

- 每个棋子默认附 2 套，最多 3 套。
- 按构筑样本量降序。
- 只返回确实包含目标装备的构筑。
- 代表出装不参与 LLM 解释。

## 5. 前端契约

### 5.1 英雄所在阵容

继续使用现有阵容卡片，标题或条件区显示目标英雄。默认展开第一套，其余阵容保持现有折叠行为。

### 5.2 装备携带者

显示：

- 目标装备名称与图标。
- 最多 8 个棋子。
- 棋子名称、图标、场次、平均名次、前四率、登顶率、名次提升。
- 每个棋子的代表出装。

不显示：

- LLM 生成的推荐理由。
- 负提升或零提升棋子。
- 低于最低样本门槛的棋子。

## 6. 缓存和容错

- 两项能力都复用查询缓存。
- 缓存键必须包含：意图、棋子或装备、days、patch、queue、rank、minSamples、limit。
- 装备携带者缓存同时保存构筑响应和棋子基准响应，避免口径跨时间漂移。
- 远程失败时允许使用同查询口径的过期缓存，并标记 `stale`。
- 不允许在装备请求失败后退化成“只按装备全局平均值推荐棋子”。

## 7. 验收标准

### 英雄所在阵容

- “霞能玩什么阵容”被解析成 `comp_rankings`，保留霞实体。
- 返回的每个阵容都包含霞。
- 没有匹配项时为空，不返回无霞的全局热门阵容。
- `comps_rankings` 工具调用参数中包含 `unit`。

### 装备携带者

- “黎明核心适合给谁”被解析成 `item_carrier_rankings`。
- 工具注册表要求一个 `item` 实体，不要求 `unit`。
- 同一棋子的多套构筑按八档名次桶聚合。
- 负提升棋子（例如 `unitDelta=+0.02`）不返回。
- 最多返回 8 个棋子。
- 每个棋子默认最多 2 套代表出装。
- 所有代表出装都包含目标装备。
- 结果不触发结论 LLM。

## 8. 非目标

- 不从页面 HTML 抓取数据。
- 不逐棋子发起 N 次 `unit_builds/{unit}` 请求。
- 不建立本地全赛季装备反向索引。
- 不让 LLM 计算统计指标、筛选正负提升或选择代表出装。
- 不修改当前“三套装备核心判定”逻辑。

## 9. 实现状态与代码位置

截至 2026-07-27，本文档定义的两个功能已经实现：

- 自然语言与结构化解析：`src/core/query-parser.js`、`src/llm/structured-parser.js`、`src/understanding/semantic-task-parser.js`
- 工具注册与执行计划：`src/agent/tools/definitions.js`、`src/agent/execution-plan.js`
- 阵容查询与英雄成员过滤：`src/core/comp-query.js`、`src/core/comp-ranking-service.js`
- 装备反向查询与棋子聚合：`src/core/query-planner.js`、`src/data/metatft-client.js`、`src/core/item-carrier-ranking.js`
- Retrieval 契约与执行：`src/retrieval/contracts.js`、`src/retrieval/retrieval-planner.js`、`src/retrieval/structured-retriever.js`
- Agent Runtime 与 V2 会话适配：`src/domain/tft/execution-arguments.js`、`src/domain/tft/resolved-task-frame-adapter.js`、`src/domain/tft/conversation-policy.js`
- HTTP 与前端展示：`src/app/small-window-server.js`、`src/app/small-window-ui/app.js`
- 回归测试：`test/hero-comps-item-carriers.test.js`

实测的 MetaTFT `unit_builds` 行只提供构筑标识和八档名次计数，没有可直接使用的“棋子变化”原始字段。因此当前实现按本文档公式，用 `unit_items_processed` 的棋子平均名次作为基准确定性计算 `unitDelta`，前端只展示计算结果，不让 LLM 参与。

## 10. 单实体意图消歧

- 用户只发送一个英雄名（例如“霞”）时，不再默认查询三件装备。
- 系统返回受控澄清：“你想查询霞的推荐装备，还是包含霞的阵容？”
- 澄清建议必须携带完整英雄名，例如“霞推荐装备”“霞所在阵容”，保证下一轮可以独立解析。
- 明确包含“装备、出装、三件套”等词时进入英雄装备业务；明确包含“阵容、体系、能玩什么阵容”等词时进入英雄阵容业务。
- 装备携带者业务应识别“黎明核心适合谁”“黎明核心给谁”“谁带黎明核心”“黎明核心携带者”等等价表达；领域规则由 `src/domain/tft/intent-patterns.js` 统一维护，确定性解析和语义解析不得各自维护一套漂移的正则。

# 装备分析结论优化开发交接

> 用途：将本文档直接交给另一个开发 Agent，在现有 TFTAgent 架构上完成“三件套装备推荐”的数据解读优化。
>
> 本阶段只优化 `unit_build_rankings` 及兼容的“三件套推荐”结论表达。统计结果负责决定推荐、排序和核心身份；腾讯官方角色定位和装备效果只负责解释。羁绊名称可以继续展示、羁绊详情可以继续查询，但羁绊效果不进入本阶段装备结论。禁止顺手开发散件规划、玩家库存、人工游戏理解 Skill 或赛季攻略 Skill。

## 1. 给开发 Agent 的执行指令

你正在维护 `TFTAgent` 仓库。开始开发前，完整阅读：

- `docs/equipment-conclusion-optimization-development-handoff.md`
- `docs/llm-retrieval-evidence-pipeline.md`
- `docs/question-contract-conclusion-spec.md`
- `src/data/official-item-details.js`
- `src/data/official-entity-details.js`
- `src/app/small-window-server.js`
- `src/llm/conclusion-evidence.js`
- `src/retrieval/evidence-assembler.js`
- `src/core/conclusion-service.js`
- `src/llm/conclusion-spec-registry.js`
- `src/llm/conclusion-validator.js`
- `src/llm/prompts/base-conclusion.md`
- `src/llm/prompts/conclusion-intents/unit-build-rankings.md`
- `src/app/small-window-ui/app.js`

开始前执行：

```powershell
git status --short
npm test
```

执行约束：

1. 保留用户已有未提交更改，不覆盖、不整理、不提交无关文件。
2. 先记录基线测试结果，再修改代码。
3. 不改变 MetaTFT 查询、过滤、排序、样本阈值和前三套推荐卡。
4. 不改变现有核心装备判定算法。
5. 不增加第二套结论生成链路；扩展现有 Evidence Pack、ConclusionSpec、Prompt、Validator 和 UI renderer。
6. LLM 只解释服务端提供的官方角色定位和装备效果，不得使用模型记忆补充事实。
7. 官方棋子或装备详情加载失败时必须安全降级，不能影响推荐卡和主查询成功。
8. 完成后提供修改文件列表、测试结果、剩余风险，不要在没有明确要求时提交或推送。

---

## 2. 已确认的产品决策

以下决策已经由用户确认，本阶段不得再次调整。

### 2.1 只解读前三套

结论只分析前端实际展示的前三套：

```js
result.rankedBuilds.slice(0, 3)
```

不得：

- 扩大到完整合格样本池；
- 暗示分析了第四套及以后方案；
- 因为结论生成需要而改变展示数量；
- 在结论层重新排序前三套。

### 2.2 核心判定保持现状

现有规则为展示方案中的 `2/3` 频率阈值：

- 三套方案时，某装备至少出现在两套中，即 `core=true`；
- 同一装备在一套中最多计一次；
- 没达到阈值时不得称为核心装备；
- 低样本时继续沿用现有“核心倾向”风险限定。

对应实现：

- `src/core/core-item-frequency.js`
- `src/llm/conclusion-evidence.js` 中的 `buildItemSignals()`
- `src/app/small-window-server.js` 中的 `coreItemSummary`

本阶段不得：

- 把阈值改成 `3/3`；
- 新增“共同核心/高频装备”两档；
- 修改重复装备的核心计数方法；
- 修改 `requiredCoreItemAppearances()`；
- 修改推荐卡中的核心展示口径。

例外仅适用于 `unit_build_completion`：用户明确指定的 `lockedItems` 是查询前提，不是从结果中发现的核心装备。它必须从“可判定核心”的候选集合中排除，但仍单独显示为“已携带/已锁定条件”。该例外不改变未锁定装备的 `2/3` 频率阈值。

### 2.3 候选不固定为第三件

“候选装备”是前三套中未被当前核心结论覆盖、用于解释方案差异的装备，不允许在代码或 Prompt 中写死为“第三件”。

示例：

- 两件核心：剩余单件是候选；
- 一件核心：剩余两件构成候选组合；
- 没有核心：直接比较三套完整方案，不强行制造核心；
- 三件都达到当前核心阈值：重点解释首选方案和可替换关系，不强行制造候选位。

“候选不固定为第三件”只影响结论组织，不修改推荐与核心算法；`unit_build_completion` 排除锁定条件的独立例外见 2.6。

### 2.4 装备效果不人工维护

装备名称、效果文本和官方数值继续来自现有腾讯 TFT 装备数据源：

```text
https://game.gtimg.cn/images/lol/act/img/tft/js/equip.js
```

现有解析器：

```text
src/data/official-item-details.js
```

本阶段不建立以下人工映射：

```text
杀人剑 -> 高攻击力面板
轻语 -> 暴击 + 破甲
巨杀 -> 处理高血量目标
```

LLM 应根据 Evidence Pack 中的官方效果与数值自然组织这些描述。

### 2.5 角色定位不人工维护，羁绊推理延后

目标棋子的角色定位继续来自现有腾讯 TFT 官方棋子数据源：

```text
https://game.gtimg.cn/images/lol/act/img/tft/js/chess.js
```

现有解析器：

```text
src/data/official-entity-details.js
```

本阶段不建立以下人工映射：

```text
库奇 -> 轻语 / 破防
物理战士 -> 必须做夜刃
剑圣 -> 夜刃
```

规则：

- MetaTFT 前三套统计决定推荐、排序和核心装备身份；
- 官方角色定位与装备效果只解释统计结果为什么可能合理；
- 角色定位不能单独产生装备推荐；
- 不得把示例推理写死在 Prompt、业务代码或人工映射表中。

羁绊边界：

- `traitNames` 可以继续用于棋子详情页和检索；
- `trait.description` 与 `trait.levels` 可以继续用于独立的 `trait_details` 查询；
- 本阶段不把羁绊描述、档位或羁绊—装备关系写入装备结论 Evidence Pack；
- 本阶段不生成“某羁绊使某装备更好/不再需要某装备”的结论；
- 后续若接入羁绊，应独立建设机制提取、档位状态和验证能力，不混入本次文案优化。

### 2.6 已携带装备是查询条件，不是核心结论

当查询包含：

```js
query.lockedItems ?? query.ownedItems
```

必须区分：

```text
已携带/已锁定：用户输入的前置条件
核心装备：从前置条件过滤后的展示方案中归纳出的重复装备
优先保证：在补装方案中与表现差异关联最明显的未锁定装备
```

要求：

- `lockedItems` 继续出现在每套完整三件套和查询摘要中；
- `lockedItems` 不得被标记为 `core=true`；
- `lockedItems` 不得进入“核心装备”或“优先保证”候选；
- 不得因为锁定装备在三套中出现 `3/3`，就称其为核心；
- 装备如果不是用户明确锁定，只是三套都出现，仍沿用原 `2/3` 核心规则；
- Validator 必须拒绝把 `lockedItems` 称为核心、候选或差异来源。

建议保留锁定装备的可追溯信号，但改变语义：

```json
{
  "kind": "locked_condition_signal",
  "item": { "apiName": "TFT_Item_Artifact_Dawncore", "name": "黎明核心" },
  "eligibleForCore": false,
  "core": false,
  "exclusionReason": "user_locked"
}
```

不要直接从 Evidence Pack 删除锁定装备，否则 LLM 无法解释“这些方案是在已携带黎明核心的条件下比较”。

### 2.7 补装场景寻找“最大区分装备”

当 `unit_build_completion` 的多个未锁定装备都达到相同 `2/3` 频率，单纯频率无法提供有效优先级。服务端应计算“最大区分装备”，而不是让 LLM 自己做算术或凭名称判断。

定义：

- 只分析前三套可见方案；
- 先从每套装备中按多重集合扣除 `lockedItems`；
- 只比较未锁定装备；
- 对两个方案，如果扣除锁定装备后仅有一个装备位不同，则构成一次“单槽替换对比”；
- 默认主指标为平均名次，数值越低越好；
- 某装备相对被替换装备的名次优势为：

```text
placementGain = otherBuild.avgPlacement - itemBuild.avgPlacement
```

- 多个有效替换对比按较小样本数加权，避免由样本更少的一侧产生虚假高置信度：

```text
pairWeight = min(itemBuild.games, otherBuild.games)
differentiationScore = weightedMean(placementGain, pairWeight)
```

对于其他主指标：

```text
top4/win：itemBuild.rate - otherBuild.rate
avgPlacement：otherBuild.avgPlacement - itemBuild.avgPlacement
```

只有满足以下条件才能标记 `keyDifferentiator=true`：

- 不是锁定装备；
- 至少存在两个有效单槽替换对比；只有一个对比时可以保留信号，但不得指定唯一优先件；
- `differentiationScore > 0`；
- 相关方案未触发低样本或不稳定限制；
- 达到最小有效差异：平均名次默认至少 `0.10`，前四率/登顶率默认至少 `0.02`（2 个百分点）；
- 第一名与第二名分数差小于同一指标的最小有效差异时，应输出“没有明确单一优先件”，不得强行选一个。

阈值应定义为具名常量并带算法版本，不能散落在 Prompt 或 UI 中。后续可以通过评估集调整，但同一版本必须确定性一致。

建议证据：

```json
{
  "evidenceId": "item-differentiator:1",
  "kind": "item_differentiation_signal",
  "item": { "apiName": "TFT_Item_GuinsoosRageblade", "name": "羊刀" },
  "metric": "avgPlacement",
  "score": 1.03,
  "comparisonCount": 2,
  "keyDifferentiator": true,
  "stable": true,
  "pairEvidenceIds": ["build-pair:1", "build-pair:2"]
}
```

该信号是描述性区分，不是因果证明。前端和 LLM 应使用：

```text
羊刀是当前展示方案中区分度最高的补装。
包含羊刀的两个方案平均名次都更好。
```

不得使用：

```text
羊刀导致平均名次提升。
羊刀一定是最强装备。
```

---

## 3. 本阶段目标

把当前容易重复罗列数据的“数据解读”优化为简短、可复核的四段式装备结论。

目标呈现：

### ① 推荐

```text
推荐：杀人剑＋轻语＋破防。
```

要求：

- 直接给出前三套中的首选；
- 不在本段复述样本、平均名次、前四率和登顶率；
- 不增加前三套以外的装备。

### ② 核心装备或优先保证

```text
核心装备：杀人剑、轻语。
两件装备达到当前展示方案的核心判定；杀人剑提供攻击力面板，轻语提供暴击与破甲。
```

要求：

- 核心身份只由现有 `itemSignals.core` 决定；
- 装备作用只来自官方效果证据；
- 不称为该英雄所有玩法的“必备装备”或“唯一核心”；
- 没有核心信号时明确说明当前前三套没有形成稳定核心倾向。
- `unit_build_completion` 中不得把 `lockedItems` 称为核心；
- 补装场景有稳定 `keyDifferentiator` 时，本段标题和正文改为“优先保证”，说明应优先补哪件未锁定装备。

### ③ 候选装备或候选组合分析

```text
默认方案选择破防，主要补充暴击和条件增伤；巨杀的效果更偏向处理高血量目标。
```

要求：

- 候选数量根据当前核心数量动态变化；
- 解释“为什么当前首选是这一套，以及其他可见方案的效果差异”；
- 只分析前三套中实际出现的候选；
- 不逐套复述所有统计指标；
- 必要时最多引用一组关键统计差异或样本风险。

### ④ 数据提醒

```text
前三套样本均达到稳定门槛；结论只代表当前筛选条件下的展示方案。
```

要求：

- 只提醒当前真正存在的样本、稳定性、筛选范围或描述性对比限制；
- 没有风险时保持一句，不重复前三套全部指标；
- 低样本时必须明确说明结论不稳定；
- “最大区分装备”只能描述关联，必须提醒不是因果证明；
- 官方装备效果支持的适用条件可压缩进“候选分析”，不再单独占用默认第四段；
- 不得引入用户没有提供的局内状态。

### 3.1 前端默认文案原则

不设置各段或正文总计的固定字数区间，也不因长度单独拒绝结论。默认写作原则：

- 结论前置；
- 推荐段直接给出 rank=1 完整方案；
- 核心/优先保证段只解释服务端已经确定的核心或区分度信号；
- 候选分析只保留最关键的一组差异；
- 数据提醒只保留当前真实存在的风险或范围限制；
- 删除重复统计、重复装备效果和同义反复；
- `summary`、`nextAction` 不重复四段正文；
- 不得为了追求简短而删除低样本警告、锁定条件或“非因果”限定。

---

## 4. 明确排除的范围

本阶段不开发、也不为以后提前搭建下列功能。

### 4.1 散件规划

排除：

- 散件数量统计；
- 合成路线差值；
- 大剑、拳套、反曲弓等资源冲突；
- 选秀优先级；
- MetaTFT Carousel Priority；
- “不占用某散件”“给其他英雄留装备”等结论。

虽然 `official-item-details.js` 已经解析 `recipe`，本阶段不得把配方用于结论推理。可以保留现有装备详情页的配方展示，不得删除。

### 4.2 玩家局内状态

排除：

- 已有散件；
- 已合成装备；
- 当前阶段；
- 对手阵容；
- 对手前排血量；
- 强化符文；
- 装备拆卸与重铸状态。

注意：官方装备效果若明确写明“对高生命值目标……”之类条件，可以生成通用条件句，但不能声称当前对局已经满足该条件。

### 4.3 通用游戏理解 Skill

排除：

- 脱离当前统计结果和官方证据，直接套用“所有战士都需要保命装”；
- 脱离当前统计结果和官方证据，直接套用“所有法师都需要启动装”；
- 脱离当前统计结果和官方证据，直接套用“所有射手都需要持续输出装”；
- 面板、暴击、增伤等乘区平衡规则；
- 阵容需要破甲、减魔抗、重伤覆盖等通用策略。

允许的最小解释：

- 当前统计已经显示某件装备为首选或核心；
- 官方角色定位表明目标棋子属于近战/战士/远程输出等类型；
- 官方装备效果明确提供保命、启动、持续输出等机制；
- LLM 可以将以上事实组织为保守解释，但不能把角色类型直接转化为新的推荐规则。

例如，只有当夜刃已经出现在当前前三套统计并达到相应信号，且官方效果明确提供保命机制时，才可结合“物理战士”定位解释其容错价值。不得仅因为角色定位是物理战士，就绕过统计结果推荐夜刃。

### 4.4 赛季 Skill 和阵容联动

排除：

- 模型记忆或人工攻略提供的某英雄与某装备联动；
- 使用羁绊描述、羁绊档位或羁绊效果解释装备选择；
- “某羁绊让技能可以暴击，因此不依赖无尽”等跨机制推理；
- 某阵容单位已经提供破甲或减魔抗；
- 某英雄替换后导致装备优先级变化；
- 赛季专属强化和特殊玩法；
- 人工维护的英雄、阵容攻略文件。

例如本阶段不得生成：

```text
霞没有携带剑魔时需要轻语。
库奇技能攻击力加成高，所以杀人剑收益更高。
```

本阶段只允许使用目标棋子的官方角色定位配合官方装备效果解释已经存在的统计信号，例如：

```text
剑圣定位为物理战士；夜刃的官方保命效果可以解释它在当前高表现方案中的容错价值。
```

但必须同时满足：

- 结论中的装备已经出现在当前前三套；
- 推荐和核心身份仍由统计信号决定；
- 角色定位和装备效果均有本轮官方证据；
- 不引入羁绊效果、阵容成员、站位、玩家库存或强化符文；
- 不把“可能合理”写成“必然最优”。

英雄技能和羁绊联动都不属于本次范围；不要为了角色定位顺手扩展技能或羁绊推理。

---

## 5. 当前实现与问题定位

### 5.1 官方装备效果已经存在

`src/data/official-item-details.js` 当前会：

- 获取腾讯装备目录；
- 解析 `englishName` 为装备 API Name；
- 解析中文名称；
- 清理 HTML 后得到 `effect`；
- 解析 `formula` 得到 `recipe`；
- 保存图标和来源信息；
- 在 `Map.meta` 中保存版本、赛季、更新时间和来源。

因此本阶段不是新建装备效果数据库，而是把已有官方效果接入结论证据。

### 5.2 当前结论证据没有装备效果

`src/llm/conclusion-evidence.js` 的 `itemRecord()` 目前只输出：

```json
{
  "apiName": "TFT_Item_Deathblade",
  "name": "杀人剑"
}
```

`buildRecommendations()` 和 `buildItemSignals()` 可以告诉 LLM：

- 哪三套被展示；
- 哪件装备在哪些方案出现；
- 哪些装备达到核心阈值；
- 每套方案的统计表现和样本风险。

但是它们不能告诉 LLM：

- 杀人剑具体增加什么；
- 轻语是否提供破甲；
- 巨杀在什么条件下增伤。

因此当前 Prompt 只能复述统计数据，或者冒险依赖模型记忆。

### 5.3 官方角色定位已经存在，但未进入结论证据

`src/data/official-entity-details.js` 当前已经解析：

- 棋子 `cost`；
- 官方 `role`（优先取 `chessRole`）；
- 棋子的 `traitNames`；
- 棋子基础属性和技能详情；
- 羁绊 `description`；
- 羁绊各档位 `levels`；
- 棋子和羁绊的来源元数据。

`unit_details` 查询和前端详情页已经能够展示其中一部分信息，`trait_details` 也能独立返回羁绊描述和档位。

但 `src/llm/conclusion-evidence.js` 的 `unitRecord()` 当前只向装备结论输出：

```json
{
  "apiName": "TFT17_Corki",
  "name": "库奇"
}
```

因此“能够查询棋子详情”不等于“装备结论已经拥有角色定位”。本次只把目标棋子的官方 `role` 作为显式依赖接入现有结论链路；羁绊名称、羁绊描述、羁绊档位、技能和基础属性均不进入本阶段装备结论。

### 5.4 当前 Prompt 鼓励长篇统计复述

`src/llm/prompts/conclusion-intents/unit-build-rankings.md` 当前要求联合使用：

- 样本数；
- 平均名次；
- 前四率；
- 登顶率；
- 第一套与其他所有方案的比较。

这会推动模型逐套罗列卡片已有数据。新 Prompt 应保留证据比较要求，但将可见文字改为“结论优先、数据按需”，禁止完整复述三套指标。

### 5.5 当前 UI 是通用结论卡

`src/app/small-window-ui/app.js` 的 `generatedConclusionCard()` 当前按通用结构展示：

- headline；
- summary；
- reasons 列表；
- alternatives 折叠区；
- supporting evidence；
- nextAction；
- riskNotice。

如果只改 Prompt，仍可能出现：

- 标题、摘要、理由重复；
- 候选分析被藏进“备选方案”折叠区；
- 四段顺序不稳定。

因此应为 `unit_build_rankings` 增加专用 view model/renderer，但继续复用现有 `llm_conclusion.v2` 输出合同。

---

## 6. 目标架构

不要新建第二套 LLM 或结论服务。目标链路：

```text
MetaTFT 前三套推荐
  -> 现有排序与核心判定（冻结）
  -> 补装场景排除 lockedItems 并计算最大区分装备
  -> 官方装备详情 + 目标棋子详情条件加载（现有 loader）
  -> Evidence Pack 注入相关装备 effect 和目标棋子 role
  -> 现有 ConclusionSpec / Question Contract
  -> 三件套专用 Prompt
  -> 现有 Validator + 官方机制引用检查
  -> unit_build_rankings 四段式 UI renderer
  -> 原始推荐卡继续保留
```

职责：

- MetaTFT/推荐服务：决定前三套和统计结果；
- 核心判定：普通排行继续按当前 `2/3` 规则生成 `itemSignals`；补装场景排除 `lockedItems`；
- 区分度计算：服务端基于可见方案的单槽替换对比生成 `item_differentiation_signal`；
- 官方装备详情：提供效果文本和数值；
- 官方实体详情：只为本阶段提供目标棋子的官方角色定位；
- Evidence Pack：裁剪并携带本轮相关装备效果与目标棋子定位；
- LLM：结合统计结果解释已有官方事实并压缩表达，不负责重新推荐；
- Validator：拒绝没有对应官方证据的装备或角色机制描述；
- UI：稳定呈现四段结构；
- 原始数据卡：继续提供用户可复核的完整指标。

证据优先级必须固定为：

```text
统计证据 -> 决定推荐、排名、核心、候选和最大区分装备
官方机制证据 -> 结合角色定位和装备效果解释已有统计结果
LLM -> 组织语言，不新增事实和推荐
```

---

## 7. 详细实现要求

### 7.1 条件加载官方装备详情

复用：

```js
loadOfficialItemDetails(runtime)
```

加载范围：

- `unit_build_rankings`；
- 与其兼容、实际展示三件套的 legacy intent；
- 结论功能已开启且确实存在 `rankedBuilds`；
- 最多只为前三套中的装备准备证据。

要求：

1. 一次加载完整官方目录，复用现有内存缓存和 Promise 去重。
2. 不按装备逐个请求。
3. 不在 MetaTFT 查询前阻塞加载。
4. 延迟结论模式下，应在 conclusion job 内完成或复用加载结果。
5. 加载失败时：
   - 推荐卡仍正常返回；
   - 结论可以降级为仅统计的简短版本或现有模板；
   - 不得使用模型记忆补装备效果；
   - 记录不含敏感数据的失败原因。
6. 不把 API Key、文件路径或完整远程原始响应写进 Evidence Pack。

建议将 `itemDetails` 作为显式依赖沿链路传递：

```text
small-window-server
  -> generateEvidenceBackedConclusion({ itemDetails })
  -> assembleEvidencePack({ itemDetails })
  -> buildConclusionEvidence({ itemDetails })
```

不要把官方详情偷偷挂到全局变量，也不要把整张 Map 序列化进结果对象。

### 7.2 条件加载目标棋子角色定位

复用现有官方实体详情加载能力：

```js
loadOfficialEntityDetails(runtime)
```

只为 `unit_build_rankings` 当前目标棋子构造最小角色上下文，不把完整棋子目录或羁绊目录序列化进 Evidence Pack。

建议显式传递：

```text
small-window-server
  -> generateEvidenceBackedConclusion({ itemDetails, entityDetails })
  -> assembleEvidencePack({ itemDetails, entityDetails })
  -> buildConclusionEvidence({ itemDetails, entityDetails })
```

目标棋子解析要求：

1. 使用查询中已经规范化的 unit API Name 查找官方棋子详情。
2. 保留官方 `role`，并记录其来源；没有官方定位时字段为 `null`，不得由模型补齐。
3. 不把 `traitNames`、羁绊描述、羁绊档位、技能或基础属性加入装备结论上下文。
4. 加载失败时保留装备统计和装备效果路径，并将角色解释安全降级。

建议 Evidence Pack 结构：

```json
{
  "unitMechanics": {
    "evidenceId": "unit-mechanics:1",
    "kind": "official_unit_mechanics",
    "unit": {
      "apiName": "TFT17_Corki",
      "name": "库奇",
      "role": "官方定位"
    },
    "source": {
      "provider": "Tencent TFT entity catalog",
      "version": null,
      "season": null,
      "updatedAt": null
    }
  }
}
```

裁剪要求：

- 只加入当前目标棋子；
- 只加入身份字段和官方 `role`；
- 不加入目标棋子或其他棋子的羁绊、技能、属性；
- `role` 必须清理控制字符并限制长度；
- 不把图标、URL、完整原始响应写入 Evidence Pack；
- Evidence Pack 超预算时，优先保留统计和装备效果；角色定位可以降级删除；
- 不为角色定位建立英雄特判、角色到装备的映射或额外赛季规则。

### 7.3 Evidence Pack 只加入相关装备效果

相关装备集合：

```js
unique(
  result.rankedBuilds
    .slice(0, 3)
    .flatMap(build => build.items.slice(0, 3))
)
```

不加入：

- 当前目录所有装备；
- 前三套之外的候选；
- 配方；
- 散件；
- 人工解释标签；
- 英雄技能；
- 阵容知识。

推荐优先采用去重结构：将官方效果附加到已经按装备去重的 `itemSignals`。

示意：

```json
{
  "evidenceId": "item-signal:1",
  "kind": "item_core_signal",
  "item": {
    "apiName": "TFT_Item_Deathblade",
    "name": "杀人剑",
    "officialEffect": "官方清洗后的效果与数值文本"
  },
  "appearances": 3,
  "recommendationCount": 3,
  "requiredAppearances": 2,
  "core": true,
  "buildEvidenceIds": ["build:1", "build:2", "build:3"],
  "officialDetail": {
    "available": true,
    "provider": "Tencent TFT equipment catalog",
    "version": null,
    "season": null,
    "updatedAt": null
  }
}
```

说明：

- 普通 `unit_build_rankings` 的 `core`、`appearances` 等字段生成方式不变；
- `unit_build_completion` 中的锁定装备保留出现次数，但必须设置 `eligibleForCore=false`、`core=false`，并使用 `locked_condition_signal` 或等价明确字段；
- 只增加官方效果及来源元数据；
- 候选装备对应的 `core=false` item signal 也可以携带效果；
- `officialEffect` 必须做现有文本裁剪与字符清理；
- 单条效果建议限制在 500～800 字符；
- Evidence Pack 总预算继续受现有上限约束；
- 不重复把同一效果塞进三个 build 记录。

如果实现者认为新增独立 `item-effect:*` 证据更符合现有 validator，应保证：

- 每个效果证据可追溯到唯一装备；
- `structuredEvidence` 预算可控；
- Prompt 能稳定引用；
- 不为了效果证据修改核心逻辑；
- UI 不直接暴露内部 Evidence ID。

### 7.4 补装场景的条件信号与区分度信号

`buildItemSignals()` 当前只根据可见方案频率计算核心，会把每套都包含的 `lockedItems` 一并标记为核心。必须扩展为显式接收查询条件：

```js
buildItemSignals(recommendations, {
  lockedItems: result.query?.lockedItems ?? result.query?.ownedItems ?? []
})
```

`small-window-server.js` 中独立生成的 `coreItemSummary` 也必须使用同一排除规则，不能只修 Evidence Pack：

```text
普通排行：rule = visible_build_frequency_2_of_3
补装场景：rule = visible_build_frequency_2_of_3_excluding_locked
```

补装场景的 `coreItemSummary.items` 只包含未锁定核心装备；原有 `payload.lockedItems` 继续承担已携带条件展示。普通排行的响应保持兼容。

建议输出三类信号：

```text
locked_condition_signal       用户已经指定的查询条件
item_core_signal              未锁定装备的 2/3 频率信号
item_differentiation_signal   未锁定装备的表现区分度信号
```

要求：

1. 普通 `unit_build_rankings` 没有锁定装备时，输出与现有行为兼容。
2. `unit_build_completion` 中锁定装备不得进入 `item_core_signal`。
3. Evidence Pack、`coreItemSummary` 和 UI 必须共用同一锁定排除结果，不能出现三处口径不同。
4. 核心频率的分母仍是展示方案数，不因为排除锁定装备而减少。
5. 区分度计算使用前三套原始数值，不使用格式化后的 `"2.13"` 字符串。
6. 平均名次、前四率、登顶率的方向必须分别处理，统一保证“正分代表包含该装备的方案更好”。
7. 单槽替换匹配使用装备多重集合，正确处理双杀人剑等重复件。
8. 每个差异信号必须携带参与计算的 build/pair Evidence ID、指标、分数、比较次数、稳定性和样本状态。
9. 无有效匹配对、少于两次有效对比、任一关键对比低样本、分数未达到最小差异或前两名分数接近时，不生成唯一 `keyDifferentiator`。
10. LLM 不得重新计算或推翻服务端区分度结果。

黎明核心示例：

| 三件套 | 平均名次 |
|---|---:|
| 黎明核心＋羊刀＋无尽 | 2.97 |
| 黎明核心＋杀人剑＋羊刀 | 2.13 |
| 黎明核心＋杀人剑＋无尽 | 3.58 |

处理结果：

```text
黎明核心：locked_condition_signal，不是核心
羊刀：两次单槽替换对比均占优，keyDifferentiator=true
杀人剑：对羊刀处于劣势、对无尽占优，不是最大区分装备
无尽：两次对比均处于劣势
```

在未提供样本数、按等权示意时：

```text
羊刀相对杀人剑：3.58 - 2.97 = +0.61
羊刀相对无尽：3.58 - 2.13 = +1.45
羊刀 differentiationScore = (+0.61 + +1.45) / 2 = +1.03
```

真实实现必须使用每套 `games` 计算权重，并保留低样本限制。

### 7.5 官方效果缺失时的证据状态

建议增加汇总状态：

```json
{
  "itemEffectContext": {
    "requestedItemCount": 5,
    "availableItemCount": 5,
    "missingItemApiNames": [],
    "source": "tencent_official_equipment",
    "version": null,
    "updatedAt": null
  }
}
```

同时增加棋子机制汇总状态：

```json
{
  "unitMechanicsContext": {
    "requestedUnitApiName": "TFT17_Corki",
    "unitAvailable": true,
    "roleAvailable": true,
    "source": "tencent_official_entity"
  }
}
```

规则：

- 某装备没有效果时，保留装备统计证据，但不允许解释其机制；
- 所有相关效果都缺失时，Prompt 应生成精简统计结论，不在候选分析中生成机制型切换条件；
- 角色定位缺失时，不得根据模型记忆推断目标棋子是战士、法师、射手、前排或后排；
- 角色定位缺失时，仍可使用可用的装备效果做装备层解释；
- 缺失效果不是 MetaTFT 推荐失败，不得改变 HTTP 主结果状态；
- 不要为了补齐效果调用搜索引擎、模型知识或其他非授权数据源。

### 7.6 ConclusionSpec 与 Question Contract

继续使用现有：

```text
llm_conclusion.v2
question-contract.v2
unit_build_rankings.default
unit_build_completion.default
```

不要为本阶段新建不兼容输出 schema。

当前维度继续保留：

- `build_performance`
- `core_item_tendency`
- `completion_options` 与 `locked_item_compatibility`（仅补装场景）
- 条件性的 `sample_risk`

装备效果和角色定位作为这些维度的解释性证据，不改变排名和核心结论。
`item_differentiation_signal` 作为 `completion_options` / `build_performance` 的确定性统计证据，不要求新增不兼容的回答维度。

如果新增 validator 所需的 evidence requirement：

```text
official_item_effect
official_unit_mechanics
lockedItems
item_differentiation
```

必须同步：

- `VALID_EVIDENCE_REQUIREMENTS`；
- `recordMatchesRequirement()`；
- ConclusionSpec 测试；
- Question Contract 测试；
- 有效果和无效果两种动态路径。

不建议仅为了 UI 四段结构增加四个新的回答维度。四段是 presentation view model，不应替代现有问题合同。

### 7.7 三件套专用 Prompt

修改或拆分：

```text
src/llm/prompts/conclusion-intents/unit-build-rankings.md
```

如果该文件继续被 `unit_build_completion` 共用，必须按 intent 区分任务；不得让“已有装备补齐”场景被普通三件套模板破坏。更稳妥的做法是为普通 `unit_build_rankings.default` 注册独立 Prompt 文件或版本，同时保留 completion 的原有行为。

Prompt 必须明确：

1. 只分析前三套可见方案。
2. 不重排，不改变首选。
3. 核心只依据 `itemSignals.core=true`；`eligibleForCore=false` 的锁定条件绝不能称为核心。
4. 核心判定仍是当前 `2/3`，不得自行提高到 `3/3`。
5. 候选不固定叫“第三件”。
6. 装备作用只能来自 `officialEffect`。
7. 角色定位只能来自 `unitMechanics.unit.role`。
8. 统计结果决定推荐、排序和核心身份；角色定位和装备机制只能解释，不能重新选择装备。
9. 没有相应官方效果时不得补充机制。
10. 角色定位只能用于解释前三套中已经存在的装备，不得产生新装备、改变首选或改变核心身份。
11. 使用角色定位解释装备时必须采用保守措辞，不得把类型倾向表述成必然规则。
12. 不读取、不引用、不推断羁绊效果或羁绊档位。
13. 结论优先，不完整复述三套卡片数据。
14. 除非用于解释取舍或低样本风险，否则不逐项输出样本、均名、前四率和登顶率。
15. 不讨论散件、选秀、资源冲突、玩家库存、英雄技能、羁绊联动、阵容联动和人工赛季攻略。
16. 候选分析中的机制型适用条件必须来自本轮官方装备效果。
17. 使用“当前前三套/当前展示方案”限定范围。
18. `unit_build_completion` 必须先说明用户已经锁定的装备条件，但不得把它重复写入“核心/优先保证”。
19. 补装场景有 `keyDifferentiator=true` 时，②使用“优先保证”，不得把频率相同的所有未锁定装备都并列为核心。
20. 最大区分装备及其差异数字只能引用服务端 `item_differentiation_signal`，LLM 不得自行计算。
21. 使用“区分度最高、与更好表现相关、当前展示方案中更稳定”等描述性表述，禁止使用“导致、提升了、必然更强”等因果表述。
22. 正文不设固定字数限制，但必须尽量简洁，不重复数据或同一结论。

推荐内容映射：

| v2 输出字段 | 普通三件套语义 |
|---|---|
| `headline` | ① 推荐 |
| `reasons/alternatives` 中 `core_item_tendency` | ② 核心装备；补装时排除锁定装备 |
| `reasons/alternatives` 中 `completion_options` / `locked_item_compatibility` | ② 优先保证或已携带条件 |
| `reasons/alternatives` 中 `build_performance` | ③ 候选装备或候选组合分析 |
| `nextAction` | 有证据时合并进③候选分析，不单独占默认段落 |
| `riskNotice` / `sample_risk` | ④ 数据提醒 |

`summary` 为兼容字段，应保持一句简短总览；普通三件套专用 UI 有完整四段时，不应再次原样显示它造成重复。

### 7.8 Validator 增强

保持现有：

- schema 校验；
- contractId 校验；
- evidenceId 校验；
- 数值校验；
- 实体校验；
- 样本风险；
- 因果与绝对化措辞检查。

新增最小装备效果边界：

1. 当结论出现具体装备机制描述，例如攻击力、暴击、破甲、增伤、高生命值目标等，对应 `reasons/alternatives` 必须引用包含非空 `officialEffect` 的该装备证据。
2. 引用了装备统计但没有官方效果的记录，只能说明其在前三套中的出现和统计表现，不能说明机制。
3. `nextAction` 中的效果型条件必须能在本轮任一可见官方效果证据中找到支持；如果无法稳健做语义逐字匹配，至少要求同一条件已在带装备效果证据的结构化 reason/alternative 中表达。
4. 结论引用角色定位时，必须绑定当前目标棋子的 `official_unit_mechanics` 证据。
5. 角色解释不得改变首选、核心和候选身份，也不得新增前三套以外的装备。
6. 出现羁绊机制、羁绊档位或羁绊—装备关系时，应视为本阶段越界内容。
7. `lockedItems` 被称为核心、优先保证、候选或差异来源时必须拒绝。
8. “最大区分装备”必须引用 `keyDifferentiator=true` 的 `item_differentiation_signal`。
9. 差异数值必须和服务端证据一致，不能由模型重新计算。
10. 只有一个不稳定对比或 `keyDifferentiator=false` 时，不得输出唯一优先件。
11. 对描述性差异使用“导致、使平均名次提升、必然”等因果措辞时必须拒绝或降级。
12. 不要建立庞大的中文机制关键词映射表。
13. 不要用 Validator 重做游戏理解；它只检查“所引用事实是否有对应官方证据、结论身份是否仍由统计决定”。

如果现有自动 citation repair 会修改装备效果引用，必须新增回归测试，避免把机制描述错误绑定到另一件装备。

### 7.9 四段式 UI renderer

在 `generatedConclusionCard(data)` 中对以下结果启用专用 renderer：

```text
data.type === "unit_build_rankings"
data.type === "unit_build_completion"
```

兼容 alias 时可使用现有统一 intent/result type 判断。

目标 DOM：

```html
<section class="generated-conclusion equipment-conclusion">
  <div class="conclusion-section recommendation">...</div>
  <div class="conclusion-section core-items">...</div>
  <div class="conclusion-section candidate-analysis">...</div>
  <div class="conclusion-section data-notice">...</div>
</section>
```

中文标题：

```text
推荐
核心装备 / 优先保证
候选分析
数据提醒
```

英文补齐：

```text
Recommendation
Core items / Prioritize
Candidate analysis
Data note
```

渲染规则：

- 不依赖 `reasons` 数组下标；
- 按 `dimension` 分组；
- 同一维度多条证据合并成紧凑段落；
- 不显示 Evidence ID；
- 不重复显示兼容 `summary`；
- `unit_build_completion` 单独显示“已携带/已锁定”，但不把它渲染成核心；
- 普通排行显示“核心装备”，有最大区分信号的补装场景显示“优先保证”；
- 样本风险与非因果限制合并到“数据提醒”，不重复显示；
- 不设置正文固定字数区间或硬上限，由 Prompt 约束其结论前置、去重和简洁表达；
- 详细原始统计继续由已有推荐卡和静态证据折叠区承载；
- provider 失败时继续显示现有模板回退；
- 360px 和 460px 宽度下无横向溢出。

同步检查：

- `generatedConclusionText()`；
- 对话区域的“进一步数据解读”文本；
- 流式完成后的重渲染；
- 分享或复制文本；
- 中英文 i18n；
- 移动端 CSS。

不得只修改详情页卡片，导致对话区域仍输出旧的重复长文。

### 7.10 缓存与版本

官方装备效果和角色定位进入 Evidence Pack 后，现有结论缓存 Key 会因 evidence 内容变化而变化。仍需显式更新：

- 对应 intent Prompt version；
- ConclusionSpec version（如果合同或 evidence requirement 改变）；
- Validator version（如果新增校验规则）；
- Evidence schema version（只有兼容性确实变化时）。

要求：

- 相同前三套、相同官方装备效果和角色定位、相同 Prompt 和模型可以命中结论缓存；
- 官方装备效果、角色定位或来源版本变化后不能继续命中旧结论；
- `lockedItems`、区分度算法版本、主指标或 `item_differentiation_signal` 变化后不能继续命中旧结论；
- 不把加载时间、随机字段写进 evidence，避免每次破坏缓存；
- `updatedAt` 只有数据源真实提供并且稳定时才进入可哈希证据；
- 不通过关闭缓存掩盖版本问题。

---

## 8. 目标输出示例

假设前三套为：

```text
1. 杀人剑 + 轻语 + 破防
2. 杀人剑 + 轻语 + 巨杀
3. 双杀人剑 + 轻语
```

现有核心规则得出：

```text
杀人剑：core=true
轻语：core=true
破防：core=false
巨杀：core=false
```

目标可见文案：

```text
① 推荐
推荐：杀人剑＋轻语＋破防。

② 核心装备
核心装备：杀人剑、轻语。它们达到当前前三套方案的核心判定；杀人剑提供攻击力面板，轻语提供暴击与破甲。

③ 候选分析
默认方案选择破防，主要补充暴击和条件增伤；包含巨杀的方案更偏向处理高生命值目标，双杀人剑方案则进一步集中攻击力。面对相应目标时可在当前展示方案中切换。

④ 数据提醒
结论只比较当前前三套及其筛选条件；详细样本和完整指标仍以原始推荐卡为准。
```

注意：

- 示例只是目标格式，具体措辞必须由本轮官方效果证据生成；
- 不得把示例文本硬编码进 Prompt 或业务代码；
- 不得新增“破防不占大剑”“阵容大剑紧缺”等散件结论；
- 不得声称当前对局一定存在高生命值前排；
- 推荐仍是服务端排名第一套，不是 LLM 自行选择。

补装场景目标示例：

```text
查询条件：已经携带黎明核心。

前三套：
1. 黎明核心＋羊刀＋无尽，平均名次 2.97
2. 黎明核心＋杀人剑＋羊刀，平均名次 2.13
3. 黎明核心＋杀人剑＋无尽，平均名次 3.58

① 推荐
已携带黎明核心时，当前首选补羊刀＋杀人剑，组成平均名次最好的展示方案。

② 优先保证
优先保证羊刀。黎明核心是用户已经指定的条件，不参与核心判断；羊刀在两次可比的单槽替换中都对应更好的平均名次，是当前区分度最高的补装。

③ 候选分析
杀人剑与无尽都在两套方案中出现，单看 2/3 频率无法区分。保留羊刀后，搭配杀人剑的展示方案平均名次更好；无尽方案表现相对较弱，可作为前三套中的可见备选。

④ 数据提醒
该结果是前三套方案的描述性对比，不证明羊刀单独导致名次变化；仍需结合每套样本量判断稳定性。
```

上述示例用于说明四段语义和证据边界，不作为字数模板；实际输出应在信息完整的前提下尽量简洁。

该示例必须满足：

- “黎明核心”只显示为已携带条件，不得称为核心；
- “羊刀”来自服务端区分度信号，不是 LLM 自行计算；
- 首选仍使用服务端排名第一套；如果实际排名顺序与示例数字不一致，应以服务端最终排序为准；
- 没有稳定区分度信号时，②回退为“补装倾向不明确”，不强行指定优先件。

角色定位解释示例：

```text
剑圣示例：
当前前三套统计将夜刃识别为核心装备。剑圣的官方定位是物理战士，需要近身持续输出；夜刃的官方保命效果可以解释它为何能提升这类输出方式的容错。
```

示例边界：

- “物理战士需要保命”不能独立产生夜刃推荐，必须先有当前前三套统计信号；
- 示例中的角色和装备效果均必须替换为本轮官方数据，不能硬编码英雄名称或结论；
- 如果拿不到官方角色定位，删除角色解释，不得使用模型记忆补齐；
- 即使官方数据中存在羁绊描述，本阶段也不得把它用于装备结论。

无官方效果时的降级示例：

```text
① 推荐
推荐：杀人剑＋轻语＋破防。

② 核心装备
杀人剑和轻语达到当前展示方案的核心判定。

③ 候选分析
破防、巨杀和第二把杀人剑构成当前前三套的主要差异。

④ 数据提醒
当前缺少官方装备效果证据，只保留统计型结论，不补充机制解释。
```

---

## 9. 建议修改文件

预计涉及：

```text
src/app/small-window-server.js
src/data/official-entity-details.js             # 优先复用；仅在关联/裁剪能力确有缺口时修改
src/core/item-differentiation.js                # 建议新增：纯函数计算锁定条件与单槽替换区分度
src/core/conclusion-service.js
src/retrieval/evidence-assembler.js
src/llm/conclusion-evidence.js
src/llm/conclusion-spec-registry.js
src/llm/conclusion-validator.js
src/llm/prompts/conclusion-intents/unit-build-rankings.md
src/llm/prompts/base-conclusion.md              # 仅在通用边界确有必要时
src/app/small-window-ui/app.js
src/app/small-window-ui/i18n.js
src/app/small-window-ui/styles.css
```

预计新增或扩展测试：

```text
test/conclusion-evidence.test.js
test/item-differentiation.test.js
test/evidence-assembler.test.js
test/conclusion-contract-validator.test.js
test/conclusion-validator.test.js
test/conclusion-service.test.js
test/conclusion-http.test.js
test/small-window-server.test.js
test/llm-pipeline-e2e.test.js
scripts/smoke-small-window-visual.mjs
```

文件列表不是强制要求。应以最小、清晰、符合现有模块职责的修改为准。

---

## 10. 测试矩阵

### 10.1 核心逻辑冻结测试

必须证明改动前后以下结果完全一致：

| 场景 | 预期 |
|---|---|
| 装备出现在 3/3 套 | `core=true` |
| 装备出现在 2/3 套 | `core=true` |
| 装备出现在 1/3 套 | `core=false` |
| 同一套有两件同名装备 | 继续沿用现有“一套最多计一次” |
| 推荐超过三套 | 结论仍只取前三套 |
| 排名顺序 | 不发生变化 |
| 普通排行无锁定装备 | 核心输出与改动前一致 |
| 补装场景有锁定装备 | 锁定装备 `core=false`，其他装备仍按 `2/3` |

不要为了测试方便修改 `core-item-frequency.js`。

### 10.2 官方效果证据

| 场景 | 预期 |
|---|---|
| 前三套共 5 个唯一装备 | Evidence Pack 只出现这 5 个效果 |
| 同一装备出现三套 | 效果不重复三份 |
| 第四套有独有装备 | 不进入结论效果证据 |
| 官方效果包含数值 | 原值进入清理后的 `officialEffect` |
| 官方效果缺失 | 该装备保留统计，机制解释被禁止 |
| 官方目录加载失败 | 主推荐成功，结论安全降级 |
| 官方详情 Map 含 recipe | 本阶段结论证据不使用 recipe |

### 10.3 官方角色定位证据

| 场景 | 预期 |
|---|---|
| 目标棋子有官方 `role` | Evidence Pack 只出现该目标棋子的定位 |
| 角色为物理战士且夜刃已有统计信号 | 可用角色定位与夜刃官方效果解释容错 |
| 角色为物理战士但夜刃不在前三套 | 不得新增夜刃推荐 |
| 官方数据同时包含 `traitNames` | 装备结论 Evidence Pack 不包含羁绊描述或档位 |
| 模型尝试引用羁绊效果 | Validator 拒绝或触发现有降级路径 |
| 官方实体目录加载失败 | 主推荐成功，保留装备层解释并安全降级 |

### 10.4 锁定条件与最大区分装备

至少覆盖：

1. 单件 `lockedItems` 在三套中均出现，但只能是 `locked_condition_signal`；
2. 两件锁定装备时，只分析剩余一个装备位；
3. 重复装备的多重集合扣除正确；
4. Evidence Pack 与 `coreItemSummary` 都排除锁定装备；
5. 普通排行的 `coreItemSummary` 保持兼容；
6. 黎明核心示例得到羊刀 `keyDifferentiator=true`；
7. 平均名次使用“越低越好”的正确方向；
8. 前四率和登顶率使用“越高越好”的正确方向；
9. 不同样本量按 `min(gamesA, gamesB)` 加权；
10. 只有一个有效匹配对时保留描述性信号，但不产生唯一优先件；
11. 低样本匹配对不产生稳定唯一优先件；
12. 分数未达到最小有效差异时返回无明确单一优先件；
13. 两个区分度分数接近时返回无明确单一优先件；
14. 没有单槽替换匹配对时安全回退，不让 LLM 自行计算；
15. 第四套数据不参与区分度；
16. `lockedItems`、主指标或算法版本变化会使缓存失效。

### 10.5 Prompt 与输出

至少覆盖：

1. 两件核心、单件候选；
2. 一件核心、候选组合；
3. 无核心；
4. 三件都达到当前核心阈值；
5. 有低样本风险；
6. 装备效果全部可用；
7. 部分效果缺失；
8. 效果全部缺失；
9. 模型尝试引入散件规划；
10. 模型尝试引入无官方证据的英雄技能或阵容联动；
11. 模型只凭角色定位新增前三套之外的装备；
12. 模型尝试引用羁绊效果或羁绊档位；
13. 模型把已携带装备称为核心；
14. 模型忽略服务端区分度信号自行选择优先件；
15. 模型把描述性差异写成因果关系；
16. 模型重复罗列三套全部指标；
17. 模型输出冗长、重复同一指标或同一结论；
18. 模型返回无效 JSON。

### 10.6 Validator

必须拒绝：

- 机制描述引用了没有效果的装备；
- 装备名称不在前三套或效果证据中；
- 候选分析中的机制型适用条件没有官方效果支持；
- “大剑紧缺”“不占用拳套”等散件规划；
- “某英雄技能适合该装备”等无英雄技能证据结论；
- 没有 `official_unit_mechanics` 证据的角色定位描述；
- 任何羁绊效果、羁绊档位或羁绊—装备关系；
- 只根据角色定位新增或改变装备推荐；
- 把 `lockedItems` 称为核心、优先保证或候选；
- 没有 `keyDifferentiator=true` 证据却指定唯一优先件；
- 把描述性区分写成因果提升；
- 改变首选或重排前三套；
- 把 `core=false` 装备称为核心；
- 绝对化或因果化表述；
- 缺少必答维度；
- 错误 contractId。

必须接受：

- 根据官方攻击力效果解释“提供攻击力面板”；
- 根据官方破甲效果解释“提供破甲”；
- 根据官方高生命值条件生成通用条件句；
- 在已有统计信号前提下，根据官方角色定位和装备效果解释保命价值；
- 将锁定装备单独说明为查询条件；
- 根据稳定区分度信号说明某件未锁定装备应优先保证；
- 不重复数值、但引用正确 build evidence 的精简综合结论；
- 无效果时的统计型降级结论。

### 10.7 UI

验证：

- 固定四段顺序；
- 默认标题为“推荐、核心装备/优先保证、候选分析、数据提醒”；
- 候选不显示成固定“第三件”；
- 已携带装备单独显示，不进入核心/优先保证；
- 没有核心时仍可正常渲染；
- 没有数据风险时数据提醒缩短但不破坏布局；
- 风险提示不在四段之外重复；
- 渲染后正文无固定字数限制，但无重复段落、重复指标或无关铺垫；
- 原始统计卡仍存在；
- 360px/460px 无横向滚动；
- 中文和英文均无缺失 key；
- 流式生成完成后四段正确重渲染；
- 复制/分享文本顺序与页面一致。

---

## 11. 验收标准

必须全部满足：

1. 前三套卡片内容、排序、统计和数量未改变。
2. 普通排行的 `2/3` 核心判定逻辑未改变。
3. 补装场景的 `lockedItems` 不会被判定为核心、候选或优先保证。
4. 未锁定装备仍按原 `2/3` 阈值计算频率。
5. 补装场景由服务端生成可追溯的 `item_differentiation_signal`，LLM 不负责算术。
6. 黎明核心示例能够将羊刀识别为稳定最大区分装备，并将黎明核心保留为锁定条件。
7. 相关官方装备效果和目标棋子官方定位进入 Evidence Pack。
8. 不存在人工“装备名称 -> 作用”“英雄 -> 装备”“角色定位 -> 固定装备”映射表。
9. LLM 只根据当前统计与本轮官方机制证据解释装备作用，不使用模型记忆补事实。
10. 候选不被固定为第三件。
11. 可见结论稳定呈现“推荐、核心装备/优先保证、候选分析、数据提醒”四段。
12. 默认可见正文不设固定字数限制，但必须结论前置、信息去重并尽量简洁。
13. 不再逐套重复样本、均名、前四率和登顶率。
14. 原始详细统计仍可在推荐卡或折叠证据中复核。
15. 不出现散件规划、用户库存、人工通用 Skill、赛季攻略 Skill、羁绊推理或阵容联动。
16. 角色定位只能解释已有统计结果，不能新增、删除或重排装备。
17. 羁绊描述和档位不进入本阶段装备结论 Evidence Pack。
18. 官方装备或实体详情加载失败不会导致推荐接口失败。
19. LLM 超时、无效 JSON、越界内容仍沿用现有降级机制。
20. 结论缓存能随锁定条件、区分度算法、官方装备效果、角色定位和 Prompt 版本正确失效。
21. 离线自动化测试全部通过。

文案不设置分段或总长度目标。人工与自动检查聚焦于是否结论前置、是否只保留决策相关证据、是否重复指标，以及低样本与非因果限制是否完整保留。

---

## 12. 执行顺序

### P0：冻结基线

1. 运行全量测试。
2. 保存一个现有三件套 Evidence Pack fixture。
3. 记录前三套、核心信号、结论输出和 UI 截图。
4. 确认工作区已有修改归属，避免覆盖。

### P1：接入官方效果证据

1. 将 `itemDetails` 和 `entityDetails` 显式传入结论链。
2. 只提取前三套唯一装备。
3. 将清理后的官方效果附加到去重装备信号或独立效果证据。
4. 只提取当前目标棋子的官方角色定位。
5. 明确排除 `traitNames`、羁绊描述、档位、技能和基础属性。
6. 加入装备与角色定位的来源状态和缺失状态。
7. 完成 Evidence Pack 单测、越界字段测试和预算测试。

### P2：锁定条件与区分度信号

1. 为 `buildItemSignals()` 增加显式 `lockedItems` 输入。
2. 输出 `locked_condition_signal`，锁定装备固定 `eligibleForCore=false`。
3. 保持普通排行及未锁定装备的 `2/3` 规则。
4. 实现多重集合单槽替换匹配。
5. 按主指标方向和样本权重计算 `item_differentiation_signal`。
6. 增加无匹配、低样本、分数接近和重复装备回退。
7. 使用黎明核心＋羊刀示例完成确定性单测。

### P3：Prompt 和 Validator

1. 更新普通三件套专用 Prompt。
2. 保留现有 v2 Question Contract。
3. 增加装备和角色机制必须有对应官方证据的校验，并拒绝羁绊推理。
4. 增加锁定条件和最大区分装备的 Prompt 分支。
5. 拒绝锁定装备被称为核心、无证据优先件和因果化差异描述。
6. 增加越界范围、无固定字数限制和简洁性 Prompt 测试。
7. 更新 Prompt、Spec、Validator 和区分度算法版本。

### P4：四段式 UI

1. 按 dimension 构造 equipment conclusion view model。
2. 实现详情页和对话区四段渲染。
3. 补齐 i18n 和移动端 CSS。
4. 普通排行使用“核心装备”，补装差异场景使用“优先保证”。
5. 将风险与描述性限制收敛到“数据提醒”。
6. 保留来源、反馈和模板回退。

### P5：回归与可选真实模型检查

必跑：

```powershell
npm test
npm run smoke:small-window
npm run smoke:visual
```

根据修改范围补跑：

```powershell
npm run smoke:conclusion-llm
npm run eval:phase66
```

真实 LLM 调用不是离线验收前置条件。先使用 fake provider 和固定 fixture 验证：

- Evidence Pack；
- Prompt 合同；
- Validator；
- 四段 UI；
- 降级路径。

如果环境已经配置真实结论模型，可在离线测试全部通过后额外执行一次真实 smoke，重点人工检查：

- 是否重复数据；
- 是否依赖模型记忆；
- 是否出现散件和阵容越界推断；
- 是否把锁定装备错误称为核心；
- 是否把区分度关联错误写成因果；
- 是否重复同一指标、装备效果或结论；
- 四段是否简洁自然且保留必要风险边界。

真实 smoke 不得替代自动化测试。

---

## 13. 完成后的交付格式

开发 Agent 最终必须报告：

```text
1. 实现结果摘要
2. 修改文件列表及每个文件的职责
3. 普通核心判定未改变、锁定装备被排除的测试证据
4. 官方装备效果和角色定位进入 Evidence Pack 的示例
5. item_differentiation_signal 与黎明核心/羊刀用例
6. 简洁四段式最终输出示例
7. 执行过的测试及结果
8. 是否调用真实 LLM
9. 尚未完成或有风险的部分
10. 工作区是否仍有用户原有未提交修改
```

禁止用“Prompt 已优化”作为唯一完成依据。必须同时证明：

- 官方装备效果和角色定位证据真实进入结论链；
- Validator 能阻止无证据机制描述、羁绊推理、锁定装备误判、无证据优先件和角色定位越权推荐；
- UI 按四段稳定展示；
- 排名未被修改；普通核心规则保持兼容，补装场景正确排除锁定条件；
- 区分度由服务端确定性计算，LLM 没有自行做算术或因果推断；
- 默认正文没有固定字数限制，但没有重复指标或无关铺垫；
- 所有排除项都没有被引入。

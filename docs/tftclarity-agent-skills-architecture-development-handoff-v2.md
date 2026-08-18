# TFTClarity Agent Skills 架构与开发交接（V2）

> 面向：Codex / 开发 Agent  
> 修订时间：2026-08-18  
> 目标：在**不破坏现有 Quick Task、TaskFrame、Capability Matcher、ReAct、ExecutionPlan、Evidence Ledger、Conversation Bridge** 的前提下，引入一套正式、可版本化、可评估、可灰度的 Skills 体系，并同步补齐真正支撑 Skills 的数据输入。  
> 核心原则：**Tool / Retriever 提供事实，Evidence 约束事实使用，Skill 提供专业方法；能确定性完成的事情继续由代码完成，需要专业判断的复杂任务才进入 Skill。**

---

# 0. 本次修订相对旧方案的关键变化

本文件替代旧版 `tftclarity-agent-skills-architecture-development-handoff.md` 作为下一阶段 Codex 开发交接基线。

本次修订不是简单“增加几个 Skill”，而是根据当前真实数据条件重新确定开发顺序。

## 0.1 当前确认可以推进的能力

第一阶段重点：

```text
unit_play_guidance
 equipment_decision_reasoning
comp_play_guidance
augment_decision_reasoning
```

后续数据积累型能力：

```text
patch_impact_analysis
meta_trend_analysis
```

未来多模态能力，仅保留接口设计：

```text
comp_diagnosis
```

明确不进入当前或可预见开发计划：

```text
match_review（依赖完整时间轴的对局复盘）
transition_decision
game_state_decision
```

原因不是 Prompt 或 Skill 设计不足，而是当前不存在可靠、完整的对局时间轴或实时 GameState 输入。

## 0.2 MetaTFT 新确认的数据价值

MetaTFT 前端已经可以提供阵容攻略中的多类结构化信息，包括：

- 前期 / 中期等级棋盘；
- 等级 4/5/6/7 等阶段性阵容；
- 升级节奏；
- Reroll / 搜牌节奏；
- 散件优先级；
- 最终站位；
- 阵容推荐强化符文；
- 可切换 Patch 获取历史版本数据。

因此 `comp_play_guidance` 已经具备真实的数据建设基础，不再只是“未来 Skill”。

## 0.3 开发顺序调整

旧思路容易变成：

```text
先把所有 Skill 写完
→ 再补数据
→ 再改 Runtime
```

本次改为：

```text
先冻结 Skill / Evidence / Data Contract
                │
        ┌───────┴────────┐
        ▼                ▼
Skill Runtime POC     MetaTFT Data POC
        │                │
        └───────┬────────┘
                ▼
        稳定 Data / Tool Contract
                ▼
        正式 Skill 实现 + Shadow Eval
                ▼
        Controlled Rollout
```

**Skill 架构线与数据线并行推进，不先做大规模生产重构。**

---

# 1. 开发前必须先审计当前真实架构

Codex 开始编码前必须先以代码为事实来源，审计当前：

```text
User
  ↓
TaskFrame / Context / Ambiguity
  ↓
Capability Match / Takeover
  ↓
ExecutionPlan 或 ReAct
  ↓
Tool
  ↓
Evidence Ledger
  ↓
Conversation Bridge
  ↓
Answer / Validator
```

重点检查现有模块及实际调用链，而不是仅依据本文档猜测：

```text
src/understanding/task-frame.js
src/understanding/context-resolver.js
src/understanding/ambiguity-policy.js
src/understanding/capability-matcher.js

src/agent/execution-plan.js
src/agent/execution-plan-executor.js
src/agent/tools/*
src/agent/takeover-controller.js

src/react/react-loop.js
src/react/react-decision-provider.js
src/react/working-state.js
src/react/evidence-ledger.js

src/conversation/conversation-bridge.js
src/conversation/sqlite-conversation-bridge-store.js
```

如果文件路径或实现已经变化，以仓库当前代码为准，并在实施说明中记录差异。

## 1.1 必须保留的架构原则

1. **语义开放，执行封闭。**
2. LLM 不得直接生成任意 SQL、任意网络请求或未注册 Tool。
3. 当前统计和事实必须来自 Tool / Retriever / Evidence，而不是模型记忆。
4. Quick Task 已经能稳定确定性完成的请求，不因引入 Skill 而改走复杂 Agent 路径。
5. Conversation Bridge 的历史 Evidence 不得冒充当前 / 最新 Evidence。
6. ReAct 继续保持 Observation 驱动，不把 Skill 变成第二套 Planner。
7. deterministic `nextActionAffordance`、Tool Policy、Evidence Policy 优先于 Skill 的软指导。
8. 新路径必须 shadow-first、可观测、可关闭、可回退。
9. 不建立与现有 TaskFrame / ReAct 平行的第二套 Agent Runtime。

---

# 2. 术语统一：Tool / Capability / Workflow / Skill / ReAct

## 2.1 Tool

Tool 回答：

> 系统能执行什么动作、获取什么确定性事实？

例如：

```text
unit_builds
item_details_batch
comps_rankings
comps_analysis
composition_tactical_details
strategy_video_search
...
```

Tool 的职责：

- 接受结构化参数；
- 查询确定性数据源；
- 返回结构化结果；
- 形成可验证 Evidence。

Tool 不负责专业判断方法。

## 2.2 Capability

Capability 回答：

> 某个 Tool 能支持什么类型的任务？

它是 Tool 的能力描述，不等于 Skill。

## 2.3 Workflow / SOP

Workflow 回答：

> 一个稳定过程通常如何执行？

如果步骤是确定性的，应优先写成代码，而不是自然语言 Skill。

例如：

```text
candidateAugments
∩
recommendedAugments
→ matchedCandidates
```

这是确定性代码，不应让 LLM 临场判断集合关系。

## 2.4 Skill

Skill 回答：

> 面对某一类复杂 TFT 问题，一个专业分析者应该如何使用已有 Evidence、补充必要 Evidence、处理冲突、控制结论强度并完成回答？

Skill 可以：

- 定义触发边界；
- 定义需要覆盖的分析 Facet；
- 定义专业判断规则；
- 定义 Evidence 层级；
- 定义什么时候需要继续补证据；
- 定义哪些结论不能下；
- 定义完成标准；
- 约束回答结构。

Skill 不应该：

- 替代 Tool 查询事实；
- 自己访问数据库或外部网站；
- 写死所有 Tool 调用顺序；
- 重新实现简单 Quick Task；
- 把不存在的数据想象出来；
- 扩大 Tool 权限；
- 绕过 Evidence Contract。

## 2.5 ReAct

ReAct 负责：

> 在当前任务、Skill、Evidence、Tool 可用性和 Runtime 状态下，动态决定下一步动作。

因此：

```text
Skill = 专业方法与约束
ReAct = 动态决策循环
Tool = 实际执行能力
Workflow/Code = 确定性过程
```

Skill 不替代 ReAct，而是给 ReAct 增加专业方法上下文。

---

# 3. Skill 的判定标准

只有满足以下条件的任务才应该考虑 Skill：

1. 仅知道“调用哪个 Tool”不足以完成；
2. 拿到数据后仍需要可复用专业分析方法；
3. 需要综合多类 Evidence；
4. 存在明确的 Evidence 边界、完成条件或禁止结论；
5. 同类问题未来会重复出现。

## 3.1 明确不是 Skill 的请求

以下继续走现有 Quick Task / Tool / Capability：

```text
查英雄推荐装备
查两件候选装备哪个统计更好
查装备效果
查阵容排名
查当前阵容站位原始数据
查玩家最近战绩
找攻略视频
查询某个已有时间窗口的数据
```

这些本质是参数化查询。

## 3.2 应该进入 Skill 的请求

例如：

```text
为什么 A 装备统计更好，但考虑全队散件需求我实际应该做 B？
这个英雄怎么玩？不要只告诉我装备。
这套阵容从前期到成型应该怎么运营？
现在强化三选一 A/B/C，当前阵容应该选哪个？
这个 Patch 为什么让某套阵容明显变弱？
这个阵容最近是热度上升，还是强度真的上升？
```

这些问题需要“数据之上的专业理解、比较或决策”。

---

# 4. 当前 Skill Roadmap

## 4.1 V1 Pilot：`unit_play_guidance`

用户表达：

```text
英雄 XX 怎么玩？
这个英雄应该怎么理解？
什么时候适合围绕这个英雄构建阵容？
```

负责：

- 英雄定位；
- 核心装备逻辑；
- 阵容上下文；
- 站位；
- 可获得条件下的 when-to-play 建议；
- 区分当前统计事实与一般机制建议。

为什么作为第一个 Pilot：

- 当前已有数据源可以支持；
- 当前 ReAct 中已经存在 broad unit-play 类 semantic guidance；
- 有真实旧行为可做 shadow 对照；
- 适合验证 Skill Registry / Matcher / Context / Progress / Validator；
- 不依赖 MetaTFT 新数据管道。

强边界：

```text
“查 XX 装备”
→ no skill

“XX 怎么玩？不要只告诉我装备”
→ unit_play_guidance
```

---

## 4.2 V1：`equipment_decision_reasoning`

用户表达：

```text
为什么 A 数据更好，但我这局反而应该做 B？
两个核心都缺同一个散件，装备怎么分？
统计上的第三件最优与当前阵容最优为什么不同？
```

负责：

- 已有 / 固定装备条件；
- 候选装备统计；
- 样本保护；
- 装备机制差异；
- 阵容条件；
- 散件竞争；
- 机会成本；
- “统计最优”和“当前局面 / 阵容资源最优”的区分；
- 主方案 + 条件化备选。

确定性逻辑继续由代码负责，例如：

```text
sample size gate
装备 ID 解析
条件统计查询
已有装备组合过滤
```

Skill 负责解释这些事实意味着什么。

### 4.2.1 机制知识建议

后续建立独立、可维护的装备机制知识：

```text
启动
回蓝
攻速
AD / AP
暴击
增伤
吸血
护盾
坦度 / 减伤
破甲 / 魔抗削减
重伤
控制
长战斗成长
击杀滚雪球
...
```

这些知识应作为 Skill 的 Reference / Knowledge 输入，不与实时统计混在同一个数据层。

---

## 4.3 V1：`comp_play_guidance`

该 Skill 现在可以正式推进，但必须先完成 MetaTFT Data POC 和稳定的数据合同。

用户表达：

```text
这套阵容怎么玩？
前期拿什么过渡？
什么时候升人口？
什么时候搜？
散件怎么拿？
```

负责：

- 阵容成型逻辑；
- 前期 / 中期阶段棋盘；
- 主副 C / 前排资源；
- 升级节奏；
- Reroll / 搜牌节奏；
- 散件优先级；
- 装备分配；
- 最终站位；
- MetaTFT 可验证的推荐信息；
- 人工补充 / 修正后的运营知识；
- 数据缺失时明确降级，不编造过渡路线。

强边界：

```text
“查这个阵容排名”
→ no skill

“查当前站位”
→ no skill

“这套阵容从前期到成型怎么运营？”
→ comp_play_guidance
```

### 4.3.1 MetaTFT 原始数据不等于 Skill

必须保持：

```text
MetaTFT Guide Data
        ↓
Normalized Data / Tool
        ↓
Skill
```

MetaTFT 的攻略信息是 Skill 输入，不是 Skill 本身。

Skill 负责规定：

- 什么时候使用前期棋盘；
- 什么时候解释升级节奏；
- 如何区分 source recommendation 与统计事实；
- Manual Overlay 如何覆盖来源数据；
- 缺字段时如何降级；
- 不把推荐写成“唯一绝对最优”。

---

## 4.4 V1：`augment_decision_reasoning`

该 Skill 保留，并进入第一阶段可实现范围。

实际 TFT 场景是强化符文三选一，而不是“对所有强化做完整排行榜”。

最低输入：

```text
当前阵容
候选强化 A / B / C
MetaTFT 当前阵容 recommendedAugments
强化描述 / 机制知识（可用时）
```

### 4.4.1 必须先做 deterministic intersection

代码负责：

```text
matched = candidates ∩ recommendedAugments
```

并得到：

```text
0 个命中
1 个命中
2 个命中
3 个命中
```

不要让 LLM 自己判断集合成员关系。

### 4.4.2 推荐集合的语义边界

非常重要：

> `recommendedAugments` 是**正向阵容适配证据**，不是完整统计排序。

因此：

```text
候选未进入 recommended list
≠
候选被统计证明为差
```

禁止把“未推荐”解释成负向胜率证据。

### 4.4.3 三选一决策规则

#### 情况 A：只有 1 个候选命中

```text
A ✅
B ❌
C ❌
```

可以对 A 形成较强正向偏好：

> A 是三个候选中唯一有当前阵容推荐证据的选项。

但不得表述为：

> A 的统计胜率一定高于 B/C。

#### 情况 B：2 个候选命中

```text
A ✅
B ✅
C ❌
```

推荐集合不能完成 A/B 排序。

继续使用：

- 强化机制；
- 阵容需求；
- 已有强化；
- 可获得的局面信息；
- 经济 / 战力 / 上限等维度。

#### 情况 C：3 个全部命中

推荐集合完全失去排序能力。

必须依赖其他 Evidence；不足时允许并列或说明无法可靠唯一排序。

#### 情况 D：0 个命中

只能进入机制适配判断。

必须明确：

> 当前没有直接的 MetaTFT 阵容推荐证据，以下为机制适配分析。

### 4.4.4 Augment Evidence Tier

建议：

```text
Tier A：当前阵容 source recommendation 直接命中
Tier B：强化机制与阵容机制明确匹配
Tier C：一般 TFT 运营原则
Tier D：模型推测
```

原则：

> 低级 Evidence 不应无理由覆盖高级 Evidence；如果因为当前局面选择偏离 source recommendation，必须明确说明局面理由。

---

## 4.5 Future：`comp_diagnosis`

当前**不实现**。

未来可配合多模态截图 / 棋盘编辑器实现：

```text
Screenshot / UI Input
        ↓
GameState Extractor
        ↓
Normalized GameState
        ↓
comp_diagnosis
```

现在只允许提前设计轻量 `GameState` schema，避免未来重新拆架构。

例如：

```ts
interface TFTGameState {
  patch?: string;
  stage?: string;
  level?: number;
  hp?: number;
  gold?: number;
  board: BoardUnit[];
  bench?: BoardUnit[];
  components?: string[];
  items?: string[];
  augments?: string[];
}
```

不得为了提前实现 `comp_diagnosis` 而让用户手工补一大堆当前系统无法稳定读取的数据。

---

## 4.6 不做：Timeline `match_review`

当前及可预见计划内不新增依赖完整对局时间轴的 `match_review` Skill。

原因：

- 很难稳定获得 round-by-round board；
- 很难稳定获得每回合经济 / shop / actions；
- 最终棋盘无法证明 3-2、4-1 等历史节点具体发生了什么。

因此禁止新增会输出以下无证据结论的能力：

```text
“你 3-2 不该搜”
“你 4-1 应该拉 8”
“你这一回合卖错了某张牌”
```

如果现有产品已经有赛后终局事实展示或轻量 AI 解释，可以继续维护，但**本次 Skills 项目不围绕 Timeline Review 新增能力。**

---

## 4.7 不做：`transition_decision`

不进入当前路线图。

它需要可靠实时 GameState、棋盘、经济、来牌、备战席等输入；当前条件不足。

---

## 4.8 不做：`game_state_decision`

不进入当前路线图。

这是未来实时 TFT Copilot 范畴，需要远高于当前系统的实时状态观测能力。

---

## 4.9 Later：`patch_impact_analysis`

该 Skill 可做，但应在数据合同稳定后实现。

输入需要：

```text
Official / structured Patch Facts
+
Patch N-1 Statistics
+
Patch N Statistics
```

负责：

- Patch 事实；
- 受影响英雄 / 羁绊 / 装备 / 强化；
- 机制影响链；
- Patch 前后统计变化；
- 选择率 / 热度变化；
- 区分相关与因果。

禁止：

```text
“因为官方削弱了 10%，所以平均名次必然下降 0.3”
```

推荐表达：

```text
“更新后平均名次和选择率出现同方向变化，与该削弱的预期方向一致；但仅凭 Patch 前后观察不能证明单一因果。”
```

MetaTFT 可以切换 Patch，因此 Data POC 必须验证跨 Patch 数据读取是否稳定。

---

## 4.10 Later：`meta_trend_analysis`

当前每日阵容快照任务已经存在，但本地历史样本仍很短。

因此现在最重要的是**保证每天持续存储且不丢失历史**。

Skill 负责：

- 时间窗口；
- Pick Rate；
- Avg Placement；
- Top4 Rate；
- Win Rate；
- Games / Sample；
- 热度与强度分离；
- 趋势稳定性；
- 小样本保护。

建议 Availability Gate：

```text
historyDays < minimum_window
→ insufficient_history
→ 只展示当前快照 / 已知变化，不输出趋势判断
```

第一版阈值必须作为配置或数据策略，不要把未经验证的 3/7/14 天规则写死成产品真理。

---

# 5. 数据架构：Skills 之前先补“可引用的数据产品”

# 5.1 MetaTFT Comp Guide 数据管道

必须采用：

```text
MetaTFT Raw
    ↓
Parser
    ↓
Normalized Comp Guide
    ↓
Manual Overlay
    ↓
Effective Comp Guide
    ↓
Tool / Evidence
    ↓
Skill
```

不要：

```text
爬取结果
→ 直接人工修改同一份字段
```

否则下一次同步会覆盖人工知识。

## 5.1.1 Raw 层

保留来源原始结果，至少包含：

```text
source
source_comp_id
source_patch
captured_at
raw_payload / raw_html reference
parser_version
```

如果站点结构允许，应优先解析稳定的 JSON / hydration 数据，而不是依赖视觉坐标或 brittle DOM 文本。

## 5.1.2 Normalized Comp Guide

目标结构示例：

```json
{
  "schemaVersion": "comp-guide.v1",
  "compId": "...",
  "patch": "...",
  "capturedAt": "...",

  "boards": [
    {
      "level": 4,
      "units": ["..."],
      "roundWinRate": 0.498
    },
    {
      "level": 5,
      "units": ["..."],
      "roundWinRate": 0.648
    }
  ],

  "levelingPlan": [
    { "level": 4, "timing": "2-2" },
    { "level": 5, "timing": "2-6" },
    { "level": 6, "timing": "3-2" },
    { "level": 7, "timing": "3-6" }
  ],

  "rerollPlan": {},
  "componentPriority": ["..."],
  "recommendedAugments": ["..."],
  "positioning": {},

  "sourceMetadata": {}
}
```

实际字段必须以真实抓取结果为准，不允许先按截图臆造字段。

## 5.1.3 Manual Overlay

人工知识必须独立：

```json
{
  "schemaVersion": "comp-guide-overlay.v1",
  "compId": "...",
  "patchScope": "...",
  "overrides": {},
  "annotations": [],
  "updatedBy": "manual",
  "updatedAt": "..."
}
```

支持：

- 修改来源推荐；
- 补充来源没有的运营解释；
- 添加条件化说明；
- 添加维护者自己的游戏理解；
- 保留来源值与人工值的 provenance。

## 5.1.4 Effective View

Skill 和 Tool 默认消费 Effective View，不直接消费 Raw HTML。

必须保留 provenance：

```text
source-provided
manual-override
manual-annotation
derived
```

---

# 5.2 Augment 数据合同

第一阶段至少需要：

```ts
interface CompAugmentRecommendation {
  schemaVersion: "comp-augment-recommendation.v1";
  compId: string;
  patch: string;
  recommendedAugmentIds: string[];
  source: string;
  capturedAt: string;
}
```

未来可加入强化机制知识：

```ts
interface AugmentMechanismKnowledge {
  augmentId: string;
  tags: string[];
  effects: string[];
  fitPatterns?: string[];
  riskPatterns?: string[];
}
```

但不要伪造不存在的：

```text
augment win rate
augment × comp win rate
augment × unit win rate
```

除非未来有真实数据源。

---

# 5.3 Patch / Daily Snapshot 数据合同

至少保证：

```text
captured_at
patch
region / queue / rank scope
entity_type
entity_id
sample_size / games
pick_rate
avg_placement
top4_rate
win_rate
```

如果不同实体类型字段不同，可以按表拆分，但必须保留：

```text
时间
Patch
查询范围
样本量
```

## 5.3.1 每日历史优先级

对于趋势能力：

> 历史数据一旦错过，很难在未来完整重建。

因此即使 `meta_trend_analysis` Skill 暂时不实现，也必须优先保证 snapshot job 的连续性、幂等性、失败告警和历史保留。

---

# 6. Evidence Model：统一定义“什么证据能支持多强的结论”

建议引入通用 Evidence Tier，而不是每个 Skill 各写一套互相冲突的规则。

可从以下语义开始：

```text
Tier A：直接当前统计 / 官方事实 / 当前任务直接来源证据
Tier B：来源级推荐 / 当前 Patch 的结构化攻略数据
Tier C：人工维护机制知识 / 可解释规则
Tier D：一般领域启发式
Tier E：模型推断
```

注意：不同 Skill 可以对 Tier 做局部解释，但必须遵守：

1. 不把“没有 Tier A/B 证据”写成“存在反向证据”；
2. 低级 Evidence 不应无理由覆盖高级 Evidence；
3. 推断必须与事实分开；
4. 当前 / 最新结论必须满足 fresh retrieval policy；
5. 因果结论必须比相关描述使用更高证据门槛。

---

# 7. Skill Core 数据合同

第一版不要急着做动态 Markdown Loader 或外部 Skill Marketplace。

先建立强类型、可测试、可灰度的 Runtime 合同。

建议：

```text
src/skills/
├── contracts.js
├── registry.js
├── matcher.js
├── context.js
├── progress.js
├── validator.js
└── definitions/
    └── unit-play-guidance.js
```

只有 Pilot 稳定后，再增加其他 definitions。

## 7.1 SkillDefinition

建议至少包含：

```js
{
  schemaVersion: "agent-skill.v1",
  id: "unit_play_guidance",
  version: "1.0.0",
  description: "...",

  triggers: {
    domains: ["tft"],
    actions: [],
    goals: [],
    requiredEntityTypes: [],
    expectedOutputsAny: []
  },

  exclusions: {
    goals: []
  },

  dataDependencies: [],
  requiredCapabilities: [],
  optionalCapabilities: [],
  allowedTools: [],

  facets: [],
  evidencePolicy: {},
  instructions: [],

  completionPolicy: {
    allowQualifiedIncomplete: true,
    neverInventMissingEvidence: true
  }
}
```

### 7.1.1 `dataDependencies`

这是本次修订新增的重点。

Skill 不只声明 Tool，还要声明“什么数据产品必须存在”。

例如：

```text
comp_play_guidance
→ normalized_comp_guide

augment_decision_reasoning
→ comp_augment_recommendations

meta_trend_analysis
→ daily_comp_snapshots

patch_impact_analysis
→ patch_facts + patch_scoped_statistics
```

这样 Runtime / Eval 可以明确区分：

```text
Skill 不支持
vs
Skill 支持但当前数据不可用
```

---

# 8. Skill Registry / Matcher

## 8.1 Registry

建议 API：

```js
registry.register(skillDefinition)
registry.get(skillId)
registry.list()
registry.validate()
```

启动时校验：

- Skill ID 唯一；
- version 合法；
- allowedTools 存在；
- Facet ID 唯一；
- dataDependencies 命名合法；
- evidencePolicy 合法；
- completionPolicy 合法。

## 8.2 Matcher

第一版优先 deterministic：

```js
matchTaskSkill(taskFrame, skillRegistry, options)
```

不要为了 Skill Routing 强制再调用一次 LLM。

评分信号：

```text
domain
action
goal
entityTypes
expectedOutput
capabilityRequirements
explicit exclusions
```

返回：

```js
{
  schemaVersion: "skill-match.v1",
  status: "selected" | "none" | "ambiguous",
  selected: {
    skillId,
    score,
    reasons
  },
  alternatives: []
}
```

默认必须保守：

```text
宁可 no-skill
也不要把简单查询误路由到复杂 Skill
```

未来如果 TaskFrame 无法覆盖更复杂表达，再增加 semantic fallback；不要第一版就构建大而全的通用语义 Router。

---

# 9. Progressive Disclosure / Context Engineering

不要把全部 Skill instructions 放进 ReAct system prompt。

第一版：

```text
TaskFrame
→ Skill Matcher
→ 只选择一个 active Skill
→ 加载对应 SkillContext
→ ReAct
```

Stable System Contract 只保留：

- Action JSON contract；
- Tool / Evidence / 权限规则；
- Skill 不得扩大权限；
- 必须遵守 Skill completion policy。

Run Context 增加：

```text
skillContext
skillProgress
```

具体 Skill 方法只在命中时注入。

---

# 10. Skill Progress：记录“缺什么”，不记录机械 Tool TODO

建议：

```js
{
  schemaVersion: "skill-progress.v1",
  skillId: "...",
  requiredFacets: [],
  coveredFacets: [],
  missingFacets: [],
  unsupportedFacets: [],
  status: "in_progress" | "complete" | "qualified_incomplete"
}
```

不要：

```text
TODO:
1. call Tool A
2. call Tool B
3. call Tool C
```

应该：

```text
missingFacet = composition_context
```

由 ReAct 判断：

- Bridge 是否已有 Evidence；
- 当前 Tool Observation 是否已覆盖；
- 哪个 Tool 可以补足；
- 是否根本没有可用数据，只能 qualified finish。

Progress Evaluator 第一版应尽量 deterministic，不依赖 LLM 自评完成度。

---

# 11. ReAct 集成

扩展现有 Working State：

```text
WorkingState
Evidence
Transcript
RuntimeState
TaskAnchor
SemanticAdvisory
SkillContext
SkillProgress
ToolCatalog
```

行为优先级必须保持：

```text
Trusted server nextActionAffordance
        >
Skill completion / progress guidance
        >
LLM autonomous tool choice
```

Skill 不能覆盖：

- deterministic nextAction；
- server-scoped 参数；
- Tool allowlist；
- Evidence policy；
- Runtime budget；
- approval / side-effect policy。

最终可用 Tool：

```text
availableTools
∩
skill.allowedTools
∩
runtime/tool policy
```

---

# 12. Conversation Bridge 与 Evidence 复用

Skill 必须复用已有 Evidence。

例如：

```text
Quick Task
→ 已得到装备条件统计
→ 用户追问“为什么？”
→ equipment_decision_reasoning
```

正确：

```text
复用已有同 scope Evidence
→ 只补机制 / 阵容等缺失 Facet
```

错误：

```text
Skill 重新执行完全相同的统计 Tool
```

需要测试保证：

> 已有同 scope、时效仍有效的 Evidence 时不得重复 Tool Call。

---

# 13. Completion Guard

当 active Skill 尝试 finish 时：

```js
validateSkillCompletion({
  skill,
  progress,
  evidenceIds,
  answer,
  reasonCode
})
```

如果缺 required Facet 且仍有 Tool 可以补：

```text
reject premature finish
→ ReAct 再决定一步
```

如果 Facet 当前数据源根本不支持，且 Skill 允许：

```text
qualified incomplete
→ 明确说明缺少什么 Evidence
```

禁止为了满足 completion 而编造事实。

---

# 14. MetaTFT Data POC：正式建表前必须完成

该工作与 Skill Runtime POC 并行，不要放在同一个巨大 PR。

第一阶段目标不是“把 MetaTFT 全站爬完”，而是验证一套真实阵容、至少两个 Patch。

必须确认：

1. 数据是否来自稳定 JSON / hydration / API / HTML；
2. 阵容 source ID 是否稳定；
3. 英雄 / 装备 / 强化如何映射到本地实体 ID；
4. Patch 切换机制；
5. 前期棋盘是否按等级稳定获取；
6. 升级 timing 是否稳定；
7. reroll 信息具体字段；
8. 散件优先级如何表达；
9. recommended augment 是否包含稳定 ID；
10. positioning 是否能结构化；
11. 空字段 / 数据缺失如何表现；
12. 页面改版后如何 fail closed，而不是返回错误数据。

POC 输出：

```text
fixtures/raw/<comp>-<patch>.json
fixtures/normalized/<comp>-<patch>.json
parser tests
mapping tests
POC report
```

在 POC 成功前，不要先设计一套假想的完整数据库表。

---

# 15. 开发顺序：Codex 应按以下 PR 推进

# PR0 — Architecture Contract + AGENTS.md

目标：**无生产行为变化。**

Codex 必须：

1. 审计真实 TaskFrame → ReAct → Tool → Evidence 调用链；
2. 对照现有 docs 与代码，记录不一致；
3. 落地 SkillDefinition / SkillSelection / SkillContext / SkillProgress 的协议设计；
4. 明确 Evidence Tier；
5. 明确 dataDependencies；
6. 明确 shadow / control / fallback；
7. 新增一个简短根级 `AGENTS.md`，只做仓库导航和关键工程约束；
8. 不实现大量 Skill；
9. 不改变生产行为。

`AGENTS.md` 不要复制整篇设计文档，应指向：

```text
docs/* agent architecture docs
eval/*
本 Skills handoff
测试命令
关键运行约束
```

---

# PR1A — Skill Runtime Shadow POC

只实现最小 Core：

```text
contracts
registry
matcher
context
progress
validator
telemetry
```

只注册：

```text
unit_play_guidance
```

Shadow 模式：

```text
当前生产行为
+
Skill Matcher 影子匹配
+
记录 selected / none / score / reason
+
不改变执行
```

评估：

- routing precision / recall；
- no-skill precision；
- false positive；
- false negative；
- Tool call 数；
- answer coverage；
- latency / token delta。

---

# PR1B — MetaTFT Comp Guide Probe

与 PR1A 并行。

目标：

```text
1 套真实阵容
×
至少 2 个 Patch
```

产出：

```text
raw fixture
parser
normalized JSON
entity mapping
patch switching validation
parser tests
```

此 PR 不负责 Skill Runtime。

---

# PR2 — Comp Guide Data Pipeline

只有 PR1B 验证通过后实施。

实现：

```text
Raw
→ Normalized
→ Manual Overlay
→ Effective View
→ Tool / Evidence
```

包括：

- 存储；
- 同步任务；
- 失败重试；
- parser version；
- provenance；
- current patch / historical patch；
- Tool contract；
- tests。

同时把 `recommendedAugments` 纳入同一数据管道或稳定关联数据产品。

---

# PR3 — `comp_play_guidance`

消费 PR2 的 Effective Comp Guide。

需要验证：

- early board；
- leveling；
- reroll；
- component priority；
- positioning；
- manual overlay；
- source recommendation 与事实分离；
- 缺字段时不编造。

先 shadow，再 controlled rollout。

---

# PR4 — `augment_decision_reasoning`

实现两层：

## Deterministic layer

```text
3 candidates
∩
recommendedAugments
→ 0 / 1 / 2 / 3 matched
```

输出稳定 Evidence code，例如：

```text
one_direct_recommendation_match
two_direct_recommendation_matches
all_direct_recommendation_matches
no_direct_recommendation_match
```

## Skill layer

结合：

- direct recommendation evidence；
- mechanism knowledge；
- current comp needs；
- 可获得上下文；
- Evidence Tier；
- qualified uncertainty。

测试必须覆盖 0/1/2/3 四种命中情况。

---

# PR5 — Controlled Skill Router / ReAct Integration

前提：Pilot eval 通过。

逐个 Skill 开启：

```text
unit_play_guidance
→ equipment_decision_reasoning
→ comp_play_guidance
→ augment_decision_reasoning
```

不得一次性全量接管。

建议 flags：

```text
AGENT_SKILLS_SHADOW_V1
AGENT_SKILLS_CONTROL_V1
AGENT_SKILL_ALLOWLIST
```

现有 legacy / semanticAdvisory 保留 fallback，直到新路径稳定。

---

# PR6+ — Patch / Trend Skills

不要因为 Skill 代码容易写就提前开启。

先满足数据条件。

## `meta_trend_analysis` Gate

确认：

- snapshot 连续；
- 失败可见；
- 历史不会被覆盖；
- Patch / rank / region scope 明确；
- minimum history window 可配置。

## `patch_impact_analysis` Gate

确认：

- Patch facts 有稳定结构；
- 可以获取至少 Patch N/N-1 统计；
- 实体映射稳定；
- 因果 Guardrail 已测试。

---

# 16. 第一阶段不要做的事情

Codex 本阶段禁止：

1. 重写整个 Agent Runtime；
2. 建第二套与 TaskFrame / ReAct 平行的 Runtime；
3. 为每个 Skill 单独新增一次强制 LLM Router；
4. 把所有 Skill instructions 注入 system prompt；
5. 把 MetaTFT 页面文本直接塞给模型当长期知识；
6. 在 POC 前假定 MetaTFT DOM / JSON schema；
7. 把推荐列表解释为完整统计排序；
8. 构造不存在的强化胜率数据；
9. 实现 `transition_decision`；
10. 实现 `game_state_decision`；
11. 实现依赖时间轴的 `match_review`；
12. 为了 future `comp_diagnosis` 提前重构大量前端；
13. 引入 LangChain / LangGraph 作为本期必需依赖；
14. 建 Master + Sub-Agent；
15. 让 Skill 自己访问数据库/API；
16. 让 Skill 扩大 Tool 权限；
17. 用 LLM 自评代替可确定性完成的 Progress / Evidence 判断；
18. 为了目录整洁做无价值搬迁。

---

# 17. Eval Dataset

新增或扩展：

```text
eval/skills/
├── skill-routing.jsonl
├── skill-negative-boundary.jsonl
├── skill-completion.jsonl
├── skill-conversation-bridge.jsonl
├── skill-augment-decision.jsonl
└── skill-comp-guide.jsonl
```

## 17.1 Routing Positive

```text
“英雄 XX 怎么玩？”
→ unit_play_guidance

“为什么 A 数据更高，但另一个核心也缺同一散件，我该怎么选？”
→ equipment_decision_reasoning

“这套阵容从前期到成型怎么玩？”
→ comp_play_guidance

“这三个强化 A/B/C 我应该选哪个？”
→ augment_decision_reasoning
```

## 17.2 Routing Negative

```text
“查英雄 XX 装备”
→ no skill

“A 和 B 哪个统计更好？”
→ no skill

“查阵容排名”
→ no skill

“查站位”
→ no skill

“找几个攻略视频”
→ no skill
```

## 17.3 Augment Tests

必须覆盖：

```text
1 matched
2 matched
3 matched
0 matched
```

同时验证：

- unmatched 不被描述为“统计差”；
- 1 matched 不被描述为“胜率一定最高”；
- 2/3 matched 不强行制造唯一排序；
- 0 matched 时明确降级到机制解释；
- Evidence 不足时可以输出不确定性。

## 17.4 Comp Guide Tests

必须覆盖：

- 当前 Patch 有完整 guide；
- 当前 Patch 缺 reroll；
- 只有历史 Patch；
- manual overlay 覆盖 source；
- source 更新后 overlay 不丢；
- entity mapping 失败；
- parser 字段变化；
- 数据缺失时 Skill 不编造。

---

# 18. Observability

Trace 建议增加：

```js
skill: {
  selected: true,
  skillId: "...",
  skillVersion: "...",
  matchScore: 0,
  matchReasons: [],
  dataDependencies: [],
  dataAvailability: {},
  requiredFacets: [],
  coveredFacets: [],
  missingFacets: [],
  completionStatus: "...",
  evidenceTierSummary: {}
}
```

同时为 MetaTFT pipeline 记录：

```text
source patch
capture time
parser version
mapping status
raw / normalized version
manual overlay version
```

不记录模型私有 chain-of-thought；只记录 stable reason codes 和运行事实。

---

# 19. Definition of Done

第一阶段 DoD 不是“所有 Skill 都写完”。

## Core

- [ ] 真实架构审计完成；
- [ ] SkillDefinition schema；
- [ ] SkillRegistry；
- [ ] deterministic SkillMatcher；
- [ ] SkillContext；
- [ ] SkillProgress；
- [ ] SkillCompletionValidator；
- [ ] dataDependencies；
- [ ] Evidence Tier contract；
- [ ] Trace / runtime status；
- [ ] feature flags；
- [ ] legacy fallback；
- [ ] 根级 `AGENTS.md`。

## Pilot

- [ ] `unit_play_guidance` shadow 完成；
- [ ] no-skill 行为不回归；
- [ ] Quick Task 不被劫持；
- [ ] Tool calls 无明显无意义增长；
- [ ] broad unit-play coverage 不下降。

## MetaTFT Data

- [ ] 至少 1 套阵容 × 2 Patch POC；
- [ ] raw fixture；
- [ ] normalized fixture；
- [ ] entity mapping；
- [ ] patch switch 验证；
- [ ] early board / leveling / reroll / component / augment 字段真实性确认；
- [ ] Manual Overlay 设计；
- [ ] parser tests。

## First Data-backed Skills

在上述完成后才进入：

```text
comp_play_guidance
augment_decision_reasoning
```

---

# 20. Codex 第一条任务建议

可以直接将下面任务作为本文件之后的第一条执行指令：

```text
请先不要实现完整 Skill 系统，也不要改变当前生产 Agent 行为。

先按照本交接文档执行 PR0：

1. 审计当前 TaskFrame → capability matching → ReAct / ExecutionPlan → Tool → Evidence → Conversation Bridge 的真实调用链，以代码为最终事实来源。
2. 阅读仓库中与 Agent 架构、当前升级、conversation state、runtime tools、eval 相关 docs；若文档与代码冲突，以代码为准并记录。
3. 为 Skills 下一阶段建立工程合同：
   - SkillDefinition / SkillSelection / SkillContext / SkillProgress
   - dataDependencies
   - Evidence Tier
   - completion policy
   - deterministic match + future semantic fallback
   - shadow / control / fallback
   - observability / eval
4. 第一阶段只把 unit_play_guidance 作为 Runtime Pilot，不实现全部 Skills。
5. 给 equipment_decision_reasoning、comp_play_guidance、augment_decision_reasoning 预留扩展接口，但不要提前实现不存在的数据接口。
6. 新增简短根级 AGENTS.md：作为仓库导航和开发约束索引，不复制大段 docs。
7. 不修改生产行为。
8. 运行现有相关测试并报告基线。
9. 输出 PR1A（Skill Runtime Shadow）和 PR1B（MetaTFT Comp Guide Probe）的精确开发拆分。

硬约束：
- 不建立第二套与当前 TaskFrame/ReAct 平行的 Agent runtime。
- deterministic 事实判断继续由代码负责。
- Skill 负责领域策略、Evidence 使用和完成标准。
- 不把 MetaTFT 推荐列表解释为完整统计排序。
- 不实现 transition_decision / game_state_decision / timeline match_review。
- 所有行为变化必须 shadow-first、可观测、可回退。
```

---

# 21. 最终架构定义

本轮改造目标不是“给 TFTClarity 加一堆 Prompt 文件”，而是建立：

```text
Natural Language
        ↓
TaskFrame / Context
        ↓
Skill Matcher
        ↓
Selected Skill
        ↓
ReAct + SkillContext
        ↓
Tool / Deterministic Workflow
        ↓
Evidence
        ↓
Skill Progress / Completion Guard
        ↓
Answer
```

与此同时，数据层独立演进：

```text
Statistical Evidence
      +
MetaTFT Guide Data
      +
Manual Mechanism Knowledge
      +
Patch / Historical Snapshots
      ↓
Normalized Data Products
      ↓
Tools / Evidence
      ↓
Skills
```

一句话：

> **TFTClarity 的 Skill 不是数据源，也不是固定 SOP 的别名；它是在现有 TaskFrame + ReAct + Tool + Evidence 架构上，为复杂 TFT 问题增加可复用的专业方法、证据边界和完成标准。数据能确定性处理的交给代码，动态选择与解释交给 ReAct，缺数据的能力不靠 Prompt 硬补。**

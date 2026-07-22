# TFTClarity Agent（第一阶段产品方向）

## 产品定位

> **让玩家不用学习数据，也能利用数据做决定。**

LLM 不负责展示数据，而是负责：

-   综合多来源信息
-   分析原因
-   输出结论
-   给出建议

------------------------------------------------------------------------

# 方向一：游戏数据智能分析（核心）

## 核心思想

用户提出一个自然语言问题，Agent
自动综合多个数据源，而不是让用户自己查阅多个页面。

### 示例

**用户：**

> xxx 阵容当前版本还能玩吗？

### Agent 自动调用的信息

#### ① 当前版本数据

包括：

-   平均排名（Avg Place）
-   前四率（Top4 Rate）
-   登顶率（Win Rate）
-   选取率（Pick Rate）
-   样本数量（Sample Size）

#### ② 历史版本数据

比较：

-   当前版本
-   上一个版本
-   B Patch

得到：

-   平均排名变化
-   前四率变化
-   登顶率变化
-   热度变化

#### ③ 官方 Patch 公告

例如：

-   英雄加强/削弱
-   羁绊调整
-   装备改动

------------------------------------------------------------------------

## LLM 综合分析

例如：

> 夜幽还能玩吗？

Agent：

1.  获取 Patch
2.  获取当前数据
3.  获取历史数据
4.  LLM 综合分析

输出：

> 可以玩，但已经不是版本答案。
>
> 平均排名由 4.03 下降至 4.21，前四率下降约 4%，主要原因是本次 Patch
> 削弱了主 C
> 技能倍率。不过由于选取率明显下降，目前更适合作为冷门上分阵容。

------------------------------------------------------------------------

## 分析原则

LLM 不直接猜测。

分析必须建立在多个事实之上，例如：

-   当前版本数据
-   历史版本数据
-   Patch 内容
-   热度变化
-   环境变化

回答尽量遵循：

> **结论 → 原因 → 数据依据**

例如：

### 结论

夜幽当前仍然值得玩，但定位已经从 T1 降至 T2。

### 原因

本次 Patch 削弱了主 C 输出，但由于选取率下降，环境压力有所减轻。

### 数据依据

-   Avg Place：4.03 → 4.21
-   Top4：61% → 56%
-   Pick Rate：19% → 11%
-   Patch：主 C 技能倍率 -10%

------------------------------------------------------------------------

# 方向二：攻略搜索与知识整合

## 默认模式

用户：

> 有没有当前版本夜幽攻略？

Agent：

-   搜索 Bilibili
-   获取视频 Metadata
-   推荐最值得看的攻略

默认展示：

-   标题
-   发布时间
-   UP 主
-   简介
-   推荐理由

------------------------------------------------------------------------

## 深度总结（按需触发）

只有用户明确要求：

> 详细总结第二个视频

才会：

1.  获取字幕
2.  Gemini 总结
3.  输出结构化攻略

包括：

-   阵容思路
-   装备推荐
-   运营节奏
-   转型路线
-   时间轴

------------------------------------------------------------------------

## 后续扩展

多个攻略融合：

-   视频 A
-   视频 B
-   视频 C

输出：

-   共同观点
-   分歧观点
-   最终建议

目标不是替代 Bilibili，而是减少用户观看多个攻略视频的成本。

------------------------------------------------------------------------

# 方向三：自然语言条件检索

核心思想：

不是推荐阵容，而是**根据玩家的条件推荐阵容**。

例如：

  用户表达                   转换后的查询条件
  -------------------------- ---------------------------------
  我想玩95                   playstyle = Fast9
  我不喜欢玩赌狗             reroll = false
  我不想卷，但是想稳定上分   Pick Rate 较低 + Top4 Rate 较高
  我想吃鸡                   Win Rate 优先
  给我推荐3套                count = 3

LLM 负责理解自然语言。

数据库负责真正查询。

例如：

``` json
{
  "playstyle": "Fast9",
  "reroll": false,
  "goal": "Top1",
  "contested": "low",
  "count": 3
}
```

------------------------------------------------------------------------

# 第一阶段重点支持的问题

## 数据分析

-   xxx 阵容还能玩吗？
-   xxx 为什么突然强了？
-   xxx 为什么没人玩了？
-   xxx 值得冲吗？
-   xxx 适合上分还是吃鸡？
-   xxx 卷不卷？
-   xxx 适合当前环境吗？

------------------------------------------------------------------------

## 条件推荐

-   我想玩95。
-   我不喜欢玩赌狗。
-   我想稳定上分。
-   我想吃鸡。
-   我想玩冷门阵容。
-   给我推荐3套。

------------------------------------------------------------------------

## 攻略

-   推荐当前版本攻略。
-   总结这个视频。
-   对比几个攻略有什么区别。
-   当前大家都推荐怎么玩。

------------------------------------------------------------------------

# 核心理念

**Skill 提供 Facts，LLM 提供 Decisions。**

-   Skill：负责获取事实（统计数据、Patch、攻略元数据等）。
-   LLM：负责综合分析、解释原因、给出结论与建议。

产品目标不是替代数据网站，而是**替代用户自己综合、分析和做决策的过程**。

# TFTClarity 执行方案：Comp Enrichment（阵容增强层）

> **目标**
>
> 在**不建立自己的阵容数据库**的前提下，实现：
>
> - "我想玩95"
> - "推荐赌狗"
> - "推荐简单一点"
> - "适合新手"
> - "不想卷"
>
> 等自然语言推荐。

---

# 当前架构

目前系统：

```
User
    │
    ▼
Intent Parser
    │
    ▼
MetaTFT API
    │
    ▼
Evidence Pack
    │
    ▼
LLM
```

特点：

- 不维护阵容
- 不存 MetaTFT 数据
- 实时查询
- 数据始终最新

这是目前最大的优势，不应该改变。

---

# 为什么不能建立阵容库

目前所有阵容都来自 MetaTFT。

例如：

```
MetaTFT

↓

夜幽95
学院95
幻灵84
......

↓

直接返回
```

如果维护自己的 Comp Database：

- 每个版本都要同步
- 数据容易过期
- 工作量巨大

因此：

> **继续保持 MetaTFT 为唯一数据源。**

---

# 新增一层：Comp Enrichment

在 MetaTFT 返回之后增加一个增强层。

```
User
    │
    ▼
Intent
    │
    ▼
MetaTFT API
    │
    ▼
Comp Enrichment
    │
    ▼
Evidence Pack
    │
    ▼
LLM
```

Enrichment 不负责查询。

只负责：

> 给 MetaTFT 返回的数据补充更多信息。

---

# Enrichment 分两部分

## Part1：自动推导

由 MetaTFT 数据推导。

例如：

```
strategy

↓

reroll
fast8
fast9
```

推导规则例如：

```
Level & Roll

↓

7人口D

↓

strategy = reroll
```

```
Level & Roll

↓

8人口成型

↓

strategy = fast8
```

```
Level & Roll

↓

9人口成型

↓

strategy = fast9
```

如果以后 MetaTFT API 无法直接提供这些信息，

可以根据：

- 最终阵容
- 升级路线
- Roll Timing

进行规则推导。

**无需人工维护。**

---

## Part2：Comp Profile（人工维护）

这是 TFTClarity 的特色。

不是事实。

而是：

产品自己的评价。

例如：

```yaml
night_95:

  difficulty: 2

  beginnerFriendly: true

  pivotDifficulty: 3

  positioningDifficulty: 2

  econDifficulty: 3

  contestTolerance: 3

  notes:

    - 运营路线固定

    - 适合学习95
```

维护量：

约20~30套主流阵容。

每个版本更新即可。

---

# Profile 建议字段

建议控制在 7 个字段。

```yaml
difficulty             # 综合难度

beginnerFriendly       # 是否推荐新手

pivotDifficulty        # 转型要求

positionDifficulty     # 站位要求

contestTolerance       # 是否怕同行

econDifficulty         #经济压力

notes                  # 自定义说明
```

不要继续增加字段。

保持精简。

---



# 为什么没有 easy

"简单"

不是事实。

而是：

LLM 根据多个 Profile 字段总结出来。

例如：

```
difficulty = 2

pivotDifficulty = 2

positionDifficulty = 1
```

↓

LLM：

> 这套阵容整体较简单，适合新手。

而不是：

数据库：

```
easy = true
```

---

# Comp Enrichment 输出

MetaTFT：

```json
{
    "name":"夜幽95",

    "top4Rate":0.63,

    "playRate":0.14
}
```

↓

Enrichment：

```json
{
    "name":"夜幽95",

    "top4Rate":0.63,

    "playRate":0.14,

    "strategy":"fast9",

    "profile":{

        "difficulty":2,

        "beginnerFriendly":true,

        "pivotDifficulty":3,

        "positionDifficulty":2,

        "econDifficulty":3,

        "contestTolerance":3

    }
}
```

后续所有 Agent 都直接使用这份数据。

---

# 查询流程示例

## 用户：

```
我想玩95
```

↓

Intent

↓

```
strategy = fast9
```

↓

MetaTFT

↓

全部阵容

↓

Comp Enrichment

↓

筛选：

```
strategy = fast9
```

↓

LLM

↓

回答。

---

## 用户：

```
推荐简单一点
```

↓

MetaTFT

↓

Comp Enrichment

↓

读取：

```
difficulty

pivotDifficulty

positionDifficulty
```

↓

LLM：

> 推荐以下阵容……

---

## 用户：

```
不想卷
```

↓

读取：

```
contestTolerance
```

↓

结合：

```
playRate
```

↓

LLM：

推荐同行较少阵容。

---

# Profile 存放与维护

基础 Profile 建议随代码保存，作为初始种子、兜底和版本审查来源：

```
src/

    data/

        comp_profiles.yaml
```

例如：

```yaml
night_95:

  difficulty:2

  beginnerFriendly:true

academy:

  difficulty:3

reroll_duelist:

  difficulty:4
```

运行时：

```
MetaTFT

↓

Stable Profile Binding

↓

基础 YAML + 数据库人工覆盖层

↓

Merge

↓

LLM
```

MetaTFT 仍是阵容事实和实时统计的唯一来源；TFTClarity 不建立自己的阵容统计库。

为了支持管理端即时新增、修改和停用 Profile，人工覆盖记录需要持久化到数据库。数据库只保存 TFTClarity 的人工评价、稳定绑定和审计信息，不复制 MetaTFT 的阵容事实。

阵容展示名称和 MetaTFT `clusterId` 可能变化，因此 Profile 不能只用阵容名称或 `clusterId` 作为永久主键。应使用赛季内稳定的 `profileKey`，并通过核心棋子、主要羁绊等生成的阵容指纹绑定当前 MetaTFT cluster；低置信、失配或来源消失时进入管理端待审核。

---

# 最终架构

```
                    User
                      │
                      ▼
              Intent Parser
                      │
                      ▼
                MetaTFT API
                      │
                      ▼
             Comp Enrichment
          ┌──────────────┐
          │              │
          │ 自动推导      │
          │ strategy     │
          │              │
          └──────┬───────┘
                 │
          ┌──────▼───────┐
          │              │
          │ Comp Profile │
          │ 人工维护      │
          │              │
          └──────┬───────┘
                 │
                 ▼
            Evidence Pack
                 │
                 ▼
                LLM
                 │
                 ▼
               Answer
```

---

# 实施优先级

## 第一阶段（1~2 天）

- [ ] 新增 `CompEnrichment`
- [ ] 支持 strategy 自动推导
- [ ] Profile Lookup
- [ ] YAML 配置加载

---

## 第二阶段（半天）

维护约20套主流阵容：

- difficulty
- beginnerFriendly
- pivotDifficulty
- positionDifficulty
- econDifficulty
- contestTolerance
- notes

---

## 第三阶段

支持自然语言：

- 我想玩95
- 我想赌狗
- 推荐简单一点
- 推荐适合新手
- 不想卷
- 想稳定上分

全部基于：

- MetaTFT Facts
- Comp Profile

生成最终回答。

当前实现采用更严格的执行边界：LLM/规则解析器只把自然语言转换为版本化条件协议；候选过滤、样本门槛、可靠性收缩、排序、零结果判定和数量截断全部由确定性代码执行。LLM 可以基于最终 Evidence Pack 解释已选结果，但不能新增、替换、重排阵容或放宽用户条件。

---

# 设计原则

> **MetaTFT 提供事实（Facts）。**

> **TFTClarity 提供理解（Profile）。**

> **LLM 负责把自然语言翻译成查询条件，并解释确定性代码基于 Facts + Profile 得出的最终建议；LLM 不直接筛选或排序阵容。**

---

## 2026-07-22 落地状态

方向一已经完成首个可交付闭环：

- Agent 能识别“还能玩吗、为什么突然强/弱、为什么没人玩、值得硬玩吗、前四与吃鸡差异、是否太卷”等阵容分析问题。
- 当前版本事实严格来自 MetaTFT 统计，覆盖平均名次、前四率、吃鸡率、选择率和样本数；缺失字段保持 `unavailable`，不会补零。
- 历史比较采用同 SeasonContext、provider、队列、天数、段位与数据版本的本地快照。MetaTFT 历史 patch 接口尚不能稳定验证，因此没有历史基线时明确提示“当前没有可验证的历史版本数据，不能判断它是突然变强还是突然变弱”。
- 官方版本公告只按相关英雄或羁绊关联，并以“可能相关”表达因果，不把同时发生误写成确定原因。
- Evidence Pack 区分 `metatft_fact`、`historical_fact`、`official_patch`、`automatic_derivation` 与 `manual_comp_profile`；每条证据携带来源、更新时间、生效 patch、SeasonContext 和置信度。
- 最终结论先由确定性代码生成“结论→原因→数据依据→风险”，可选 LLM 只能解释同一证据包，不能新增数据、趋势或因果关系。

方向二（Bilibili/社区攻略内容）不在本轮范围内，未接入，也没有把社区内容伪装为事实来源。

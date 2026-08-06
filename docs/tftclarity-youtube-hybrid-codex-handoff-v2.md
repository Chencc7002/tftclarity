# tftclarity 混合问答与 YouTube 知识接入开发交接

更新时间：2026-07-28
状态：方案已确认；第一阶段直接实现 YouTube 攻略接入与 Hybrid 闭环

---

## 1. 项目目标

将当前 `tftclarity` 从偏严格的 TFT 数据查询工具，升级为：

> 一个结合 MetaTFT 当前统计、TFT 静态知识、机制知识和视频攻略的中文 TFT 智能教练。

产品仍使用一个聊天入口。用户不需要选择“数据查询”或“攻略问答”。

系统根据问题自动决定：

- 查询当前结构化统计；
- 检索知识文档；
- 或同时执行两者。

核心体验：

- **右侧展示本次查询得到的统计数据或知识证据；**
- **左侧聊天区由 LLM 给出结论、原因、条件和实战建议。**

---

## 2. 已确认的基本事实

### 2.1 当前系统不是原始对局统计引擎

当前平均名次、前四率、登顶率、样本数等指标主要由 MetaTFT 上游聚合。

`tftclarity` 当前主要负责：

1. 理解用户问题；
2. 选择对应的数据获取路径；
3. 获取 MetaTFT 已聚合的数据；
4. 本地执行筛选、排序、比较、风险标记和结果组装；
5. 将结果组成 Evidence Pack；
6. 由 LLM 解释；
7. 对数字、实体、目标和越界结论进行校验；
8. 失败时回退到确定性回答。

因此，不应再将项目宣传成“从原始对局重新计算全部数据”。

### 2.2 文档 RAG 与结构化查询都可以实现对话助手

两者的差异不是“一个能聊天、一个不能聊天”，也不是“一个能算、一个不能算”。

区别是：

- **文档 RAG**：提前把常见数据和知识整理成文档，用户提问时检索相关段落；
- **结构化查询**：根据本轮问题获取对应的数据，再执行确定性筛选和排序。

二者需要并存。

---

## 3. 最终系统形态

系统采用三种回答模式。

### 3.1 Structured：结构化数据查询

适用于：

- 霞最好的三件套是什么；
- 霞已有羊刀，剩下两件怎么补；
- 比较无尽和巨杀；
- 样本至少 500；
- 指定段位、时间范围、星级或阵容；
- 阵容排行和趋势查询。

流程：

```text
用户问题
→ Intent / Entity / Constraint 解析
→ MetaTFT 数据获取
→ 本地筛选、排序、比较和风险标记
→ QueryResult / Evidence Pack
→ LLM 解释
→ Validator
```

### 3.2 RAG：开放式知识问答

适用于：

- 霞为什么需要羊刀；
- 某阵容怎么过渡；
- 什么开局适合玩；
- 什么时候应该转阵容；
- 这套阵容难在哪里；
- 某个装备为什么适合某英雄。

流程：

```text
用户问题
→ 实体和主题识别
→ 检索静态知识、机制知识、视频攻略
→ LLM 综合回答
→ 来源展示
```

### 3.3 Hybrid：混合问答

适用于同时需要当前统计和攻略解释的问题：

- 霞最好的装备是什么，为什么；
- 霞有羊刀后怎么补，什么情况下换巨杀；
- 这个阵容当前还能玩吗，应该怎么运营；
- 当前统计很强，为什么实战很难。

流程：

```text
                 ┌→ MetaTFT 结构化查询 → 当前统计
用户问题 → Router
                 └→ 知识检索 → 视频攻略 / 机制 / 静态知识
                                  ↓
                           Evidence Bundle
                                  ↓
                               LLM
                                  ↓
                       左侧回答 + 右侧证据
```

Hybrid 是未来最重要的默认体验。

---

## 4. 页面交互方案

### 4.1 桌面端

建议布局：

```text
┌─────────────────────────────┬─────────────────────────────┐
│ 左侧：聊天区                │ 右侧：查询与证据面板        │
│                             │                             │
│ 用户问题                    │ 查询条件                    │
│ LLM 综合回复                │ MetaTFT 数据卡片            │
│ 来源引用                    │ 视频攻略来源                │
│ 继续追问输入框              │ 数据时间与版本              │
└─────────────────────────────┴─────────────────────────────┘
```

### 4.2 移动端

不强制左右分栏。

建议：

```text
聊天回复
↓
“查看本次数据与来源”
↓
展开式卡片或底部抽屉
```

### 4.3 右侧面板的定位

右侧不只叫“数据结果”，统一命名为：

> 查询与证据

根据问题类型显示不同内容：

| 问题 | 右侧内容 |
|---|---|
| 霞最好的装备 | MetaTFT 装备组合数据 |
| 霞已有羊刀怎么补 | 固定装备条件下的候选组合 |
| 霞为什么需要羊刀 | 装备说明、统计摘要、攻略片段 |
| 霞阵容怎么过渡 | 视频攻略来源和关键时间点 |
| 当前环境怎么样 | 阵容排名、趋势和环境摘要 |

---

## 5. 典型用户问题的数据流

用户提问：

> 霞最好的装备是什么？

系统同时执行：

### 5.1 结构化查询链

```text
识别英雄：霞
→ 查询 MetaTFT 霞的当前装备数据
→ 获得三件套、平均名次、前四率、登顶率、样本数
→ 根据既有规则排序和标记低样本风险
→ 生成 QueryResult
→ 右侧展示
```

### 5.2 知识检索链

```text
使用“霞 + 装备 + 当前版本”等主题
→ 检索 YouTube 攻略文档
→ 检索装备效果、英雄技能和机制知识
→ 返回相关 KnowledgeEvidence
```

### 5.3 LLM 回答链

LLM 接收：

- 用户原始问题；
- 当前 QueryResult；
- YouTube 攻略片段；
- 机制和静态知识；
- 回答规则。

LLM 输出：

1. 当前推荐；
2. 当前数据依据；
3. 装备作用和联动解释；
4. 视频攻略中的条件性观点；
5. 特殊环境下的替代方案；
6. 数据和攻略来源。

---

## 6. 结论权威规则

这是必须实现的核心约束。

### 6.1 “当前最好”由谁决定

当用户询问当前排名、最好、最强、表现等统计结论时：

> 主结论必须由 MetaTFT 结构化查询结果决定。

视频攻略不得直接覆盖当前统计首选。

### 6.2 视频攻略负责什么

视频攻略主要负责：

- 为什么这样出装；
- 哪件装备优先做；
- 什么开局适合；
- 如何过渡；
- 搜牌和升级节奏；
- 站位；
- 什么环境下使用备选；
- 作者对版本环境的理解。

视频内容属于：

> 创作者观点 / 攻略建议

不能自动升级为统计事实或游戏客观规律。

### 6.3 数据与视频冲突时

示例：

- MetaTFT 当前首选：羊刀 + 无尽 + 轻语；
- 某视频推荐：羊刀 + 巨杀 + 轻语。

正确回答：

> 当前整体统计仍更支持无尽版本。该攻略认为高血量前排较多时巨杀更合适，因此巨杀属于环境针对方案，而不是无条件替代当前统计首选。

禁止回答：

> 当前最好的装备就是羊刀、巨杀、轻语。

### 6.4 没有视频时

系统仍应使用：

```text
MetaTFT 数据
+ 英雄技能
+ 装备说明
+ 机制知识
```

生成回答，并明确说明：

> 当前没有检索到足够相关的视频攻略，以下解释主要基于当前统计和装备机制。

### 6.5 没有结构化数据时

若问题属于运营、过渡、站位等攻略类问题，可以仅基于知识文档回答。

若用户询问“当前最好”但当前数据不可用，不得让视频观点伪装成当前统计结论。

---

## 7. 统一后端返回结构

建议将一次问答统一返回为：

```json
{
  "mode": "structured | rag | hybrid",
  "query": {
    "intent": "unit_best_items",
    "entities": {
      "unit": "霞"
    },
    "constraints": {
      "rank": "GM+",
      "timeWindow": "3d"
    }
  },
  "queryResult": {
    "resultType": "item_builds",
    "generatedAt": "2026-07-28T00:00:00Z",
    "source": "metatft",
    "candidates": [
      {
        "evidenceId": "stats_build_1",
        "items": ["羊刀", "无尽", "轻语"],
        "avgPlacement": 4.02,
        "top4Rate": 0.563,
        "winRate": 0.141,
        "sampleSize": 1843,
        "riskFlags": []
      }
    ]
  },
  "knowledgeEvidence": [
    {
      "evidenceId": "video_claim_1",
      "sourceType": "youtube",
      "sourceId": "video_id",
      "sourceTitle": "视频标题",
      "author": "频道名称",
      "publishedAt": "2026-07-20",
      "season": "S18",
      "patch": "18.1",
      "timestampStart": 332,
      "claimType": "creator_advice",
      "claim": "羊刀通常应优先制作",
      "conditions": ["没有其他稳定攻速来源"]
    }
  ],
  "assistantResponse": {
    "text": "当前综合首选是……",
    "citations": ["stats_build_1", "video_claim_1"],
    "warnings": []
  }
}
```

前端映射：

- `assistantResponse` → 左侧聊天；
- `queryResult` → 右侧统计数据；
- `knowledgeEvidence` → 右侧攻略和知识来源；
- `query` → 右侧查询条件。

---

## 8. 统一知识文档协议

不要直接把不同来源都保存成任意 Markdown。

先建立统一 `KnowledgeDocument`：

```json
{
  "id": "youtube:video_id:item_priority:3",
  "documentType": "video_guide",
  "title": "霞的装备优先级",
  "text": "作者建议在没有其他攻速来源时优先保证羊刀。",
  "metadata": {
    "source": "youtube",
    "sourceId": "video_id",
    "sourceTitle": "视频标题",
    "author": "频道名称",
    "publishedAt": "2026-07-20",
    "season": "S18",
    "patch": "18.1",
    "region": "NA",
    "locale": "en",
    "topics": ["霞", "羊刀", "装备"],
    "timestampStart": 332,
    "claimType": "creator_advice",
    "expiresAt": null
  }
}
```

需要支持的 `documentType`：

- `meta_snapshot`
- `unit_stats`
- `comp_stats`
- `item_stats`
- `trend_snapshot`
- `video_guide`
- `mechanism_knowledge`
- `patch_note`
- `static_game_knowledge`

需要支持的 `claimType`：

- `statistics`
- `official_fact`
- `mechanism`
- `creator_advice`
- `strategic_advice`
- `speculation`

---

## 9. MetaTFT 文档化方案

MetaTFT 结构化数据不仅用于查询，也要增加一套 RAG 文档消费方式。

建议按周期生成：

```text
knowledge/current/
├── meta-overview
├── top-comps
├── comp-trends
├── units
├── comps
└── items
```

第一版生成：

1. 当前环境总览；
2. 当前主要阵容摘要；
3. 每个英雄的整体表现与常见装备；
4. 阵容趋势摘要；
5. 热门装备和适用英雄摘要。

每份统计文档必须带：

- season；
- patch；
- rank；
- timeWindow；
- generatedAt；
- expiresAt；
- source；
- locale。

不得将不同版本、段位或时间窗口的数据混在同一答案中。

### 9.1 索引隔离

现有静态语义索引不要直接被高频统计文档污染。

建议：

```text
static_knowledge namespace
current_stats namespace
historical_stats namespace
video_guides namespace
mechanism_knowledge namespace
```

可继续使用现有 SQLite 索引基础设施，无须为此强制引入 ChromaDB。

---

## 10. YouTube 接入方案

### 10.1 复用范围

参考或移植 `tft-meta-mind` 的 YouTube ingestion 管线：

- 视频 ID 解析；
- 字幕获取；
- 字幕时间戳；
- 视频标题、频道和发布日期获取；
- 长视频分段；
- 重复视频检测；
- 视频来源保存；
- 本地采集、服务器入库的隔离方式。

不复用：

- Streamlit UI；
- Gemini 聊天层；
- 简单正则 Router；
- tactics.tools 爬虫；
- 整套 ChromaDB 架构。

### 10.2 第一阶段架构

建议先作为 Python 子服务或离线工具：

```text
services/youtube-ingestion/
├── youtube_fetcher.py
├── transcript_chunker.py
├── guide_extractor.py
├── schema_validator.py
└── output/
```

输入：

```text
YouTube URL
```

输出：

```text
KnowledgeDocument JSON
```

Node 主服务负责：

- 读取或接收 JSON；
- 写入现有语义索引；
- 检索；
- 组织 Evidence Bundle；
- 调用 DeepSeek；
- 返回前端。

### 10.3 视频知识提取要求

不要直接让模型输出一整篇自由 Markdown。

要求输出结构化 JSON：

```json
{
  "knowledge": [
    {
      "type": "item_priority",
      "subjects": ["霞", "羊刀"],
      "claim": "优先保证羊刀",
      "conditions": ["没有其他稳定攻速来源"],
      "timestampStart": 332,
      "patchSpecific": true,
      "confidence": "creator_advice"
    }
  ]
}
```

建议提取栏目：

- 阵容推荐；
- 装备优先级；
- 开局条件；
- 过渡路线；
- 升级和搜牌节奏；
- 站位；
- 后期转换；
- 风险和不适用条件；
- 版本特定观点。

过滤：

- 开场和结尾；
- 广告；
- 订阅提醒；
- 娱乐闲聊；
- 与 TFT 无关的内容；
- 无法落到明确实体或策略的空泛表达。

---

## 11. LLM 使用规则

DeepSeek 或其他 OpenAI-compatible 模型负责：

- 对用户回答；
- 将结构化统计翻译成自然语言；
- 综合视频攻略和机制知识；
- 生成条件建议；
- 提取视频攻略的结构化知识。

LLM 不负责：

- 修改 MetaTFT 原始数值；
- 更改程序排序；
- 绕过样本限制；
- 将视频观点声明为统计事实；
- 在证据中不存在时编造数字；
- 将旧版本知识无提示地应用到当前版本；
- 自由调用未列入白名单的远程操作。

---

## 12. Router 设计

第一版不需要复杂 Agent Loop。

新增顶层：

```text
AnswerModeRouter
```

输出：

```json
{
  "mode": "structured | rag | hybrid",
  "structuredOperations": [],
  "retrievalScopes": []
}
```

基础规则：

### Structured

命中以下特征时优先：

- 固定装备；
- 指定样本；
- 明确比较；
- 明确排序指标；
- 指定段位、时间、星级或阵容；
- 查询当前排名或数据。

### RAG

命中以下问题时优先：

- 为什么；
- 怎么玩；
- 怎么过渡；
- 什么条件适合；
- 站位；
- 搜牌节奏；
- 机制解释。

### Hybrid

同时包含：

- 当前数据结论；
- 原因、打法或条件解释。

例如：

- “霞最好的装备是什么，为什么？”
- “霞有羊刀后怎么补，遇到大肉前排怎么办？”

### 兜底

Router 不确定时：

1. 优先检索当前实体和相关知识；
2. 若问题涉及“当前最好/排名/表现”，必须尝试结构化查询；
3. 不能因 Intent 未注册就直接拒绝；
4. 数据不足时输出边界说明。

---

## 13. Validator 改造

现有严格验证保留，但从“整篇答案统一强约束”改为“按声明类型验证”。

| 声明类型 | 校验要求 |
|---|---|
| statistics | 必须匹配 QueryResult 和 Evidence ID |
| official_fact | 必须匹配官方或当前实体数据 |
| mechanism | 必须来自机制知识 |
| creator_advice | 必须关联视频来源和作者 |
| strategic_advice | 必须写明适用条件 |
| speculation | 必须使用可能、通常、推测等边界表达 |

新增检查：

- 视频观点是否覆盖统计首选；
- 是否混用了不同 patch；
- 是否使用过期攻略；
- 是否把作者观点写成共识；
- 是否引用了不存在的时间戳；
- 左侧数字是否与右侧完全一致。

---

## 14. 用户提问方式的变化

用户不需要学习新的语法。

已有精确问法继续支持：

- 霞已有羊刀，剩下两件怎么补；
- 无尽和巨杀哪个好；
- 样本至少 500；
- 查近三天宗师以上。

新增自然问法：

- 霞为什么需要羊刀；
- 这套阵容怎么过渡；
- 我有两把大剑能玩什么；
- 我不想玩赌狗，有什么稳定阵容；
- 这个阵容数据很好，为什么实战难；
- 当前版本霞还能强玩吗；
- 没有羊刀应该怎么办。

目标是：

> 用户可以像问教练一样表达条件和目标，而不是必须像操作筛选器一样说话。

---

## 15. 第一阶段 MVP：直接实现 YouTube Hybrid 闭环

第一阶段不再只做协议和路由，而是直接完成一个可使用的 YouTube 问答闭环。

### 15.1 必做闭环

用户提问：

```text
霞最好的装备是什么，为什么？
```

系统必须完成：

```text
MetaTFT 查询霞的当前装备数据
+
检索已经导入的 YouTube 霞攻略
+
DeepSeek 生成综合回答
+
左侧展示回答
+
右侧展示 MetaTFT 数据与视频来源
```

### 15.2 必做功能

1. 新增 `KnowledgeDocument` schema；
2. 新增 `EvidenceBundle`；
3. 新增 `AnswerModeRouter`，支持 `structured / rag / hybrid`；
4. 保留现有 MetaTFT 查询链；
5. 新增 YouTube 手动 URL 导入入口或 CLI；
6. 获取视频 ID、字幕、时间戳、标题、频道和发布日期；
7. 长视频分段；
8. 使用 DeepSeek 提取结构化攻略知识；
9. 将攻略知识写入现有 SQLite 语义索引的 `video_guides` namespace；
10. 新增视频攻略检索；
11. 新增 Hybrid 回答服务；
12. 左侧展示 LLM 综合回答；
13. 右侧展示：
    - 查询条件；
    - MetaTFT 统计候选；
    - 视频标题；
    - 作者；
    - 日期；
    - 时间点；
    - 原视频来源；
14. 保证“当前最好”由 MetaTFT 查询结果决定；
15. 视频观点与统计冲突时，按条件性建议表达；
16. 无视频结果时，正常降级到统计数据、静态知识和机制知识；
17. LLM 失败时，右侧结构化结果仍然可展示。

### 15.3 第一阶段测试问题

```text
霞最好的装备是什么？
霞最好的装备是什么，为什么？
霞已经有羊刀，剩下两件怎么补？
霞为什么需要羊刀？
霞没有羊刀还能玩吗？
霞阵容怎么过渡？
当前有哪些稳定阵容？
我不喜欢赌狗，有什么阵容？
```

### 15.4 第一阶段暂不做

- 自动遍历 YouTube 全站；
- 自动订阅频道并抓取新视频；
- Bilibili；
- 多创作者可信度排名；
- 自动消解所有视频观点冲突；
- 大规模 Agent Loop；
- 让 LLM 自由调用任意 API；
- 用 ChromaDB 替换现有 SQLite；
- 引入 Streamlit；
- 推翻现有 Intent、EvidencePack 或 Validator；
- 完整历史赛季迁移；
- 全自动生产调度。

### 15.5 第一阶段允许采用的实现方式

为了尽快打通闭环，YouTube ingestion 可以先采用 Python 子工具：

```text
Node 主服务
→ 调用 Python CLI 或读取其生成的 JSON
→ 写入 SQLite 知识索引
```

Python 工具只负责：

```text
YouTube URL
→ 字幕与元数据
→ 分段
→ DeepSeek 提取
→ KnowledgeDocument JSON
```

禁止 Python 工具承担：

- 用户聊天；
- MetaTFT 查询；
- 最终答案生成；
- 前端服务；
- 第二套向量数据库；
- 第二套会话系统。

---

## 16. YouTube MVP 实施细节

1. 手动输入 YouTube URL；
2. 获取字幕和元数据；
3. 长视频分段；
4. DeepSeek 提取结构化攻略知识；
5. Schema 校验；
6. 写入 `video_guides` namespace；
7. Hybrid 问答可检索相关视频；
8. 回答中展示：
   - 视频标题；
   - 作者；
   - 发布日期；
   - 时间点；
   - 原视频来源；
9. 无相关视频时正常降级；
10. 视频与数据冲突时遵守结论权威规则。

---

## 17. 建议代码模块

Node 主项目：

```text
src/
├── routing/
│   └── answer-mode-router.js
├── knowledge/
│   ├── knowledge-document-schema.js
│   ├── metatft-document-generator.js
│   ├── knowledge-indexer.js
│   ├── knowledge-retriever.js
│   └── evidence-bundle-builder.js
├── coach/
│   ├── coach-answer-service.js
│   ├── hybrid-answer-service.js
│   └── coach-prompt.js
├── validation/
│   ├── claim-validator.js
│   └── cross-panel-consistency-validator.js
└── app/
    └── evidence-panel-presenter.js
```

Python 视频采集：

```text
services/youtube-ingestion/
├── youtube_fetcher.py
├── metadata_fetcher.py
├── transcript_chunker.py
├── guide_extractor.py
├── schema_validator.py
└── cli.py
```

---

## 18. 测试与验收标准

### 18.1 数据一致性

- 左侧出现的每个统计数字都能对应右侧 Evidence ID；
- 左侧首选与右侧排名首选一致；
- 不同 patch、段位、时间窗口不得混合；
- MetaTFT 查询失败时不能伪造当前结论。

### 18.2 RAG 质量

- “霞为什么需要羊刀”能检索装备、技能或攻略知识；
- 无相关知识时明确降级；
- 视频来源能展示标题、作者、日期和时间点；
- 不引用与当前实体无关的攻略片段。

### 18.3 Router

- 精确条件问题走 Structured；
- 开放攻略问题走 RAG；
- 当前数据 + 原因问题走 Hybrid；
- Intent 未覆盖时不直接报“不支持”。

### 18.4 前端

- 右侧能展示查询条件、候选、指标、样本和来源；
- 左侧回答加载失败时，右侧结构化结果仍可展示；
- 手机端证据面板可折叠；
- 用户能看懂当前使用的数据范围。

### 18.5 安全回退

- LLM 超时：展示确定性结果和简短模板；
- RAG 无结果：只根据数据和静态知识回答；
- 数据无结果：只回答攻略范围，不声称当前最好；
- 视频观点冲突：保留统计首选并说明视频适用条件。

---

## 19. Codex 实施顺序

目标是尽快完成一个端到端可演示的 YouTube Hybrid 闭环，但仍应拆分为可回滚的小 PR。

### PR 1：协议、路由与参考项目映射

- 阅读 `tftclarity`；
- 阅读 `tft-meta-mind`；
- 输出模块映射；
- 实现 `KnowledgeDocument`；
- 实现 `EvidenceBundle`；
- 实现 `AnswerModeRouter`；
- 为 `video_guide` 预留 schema；
- 单元测试。

### PR 2：YouTube ingestion MVP

- 手动输入 YouTube URL；
- 视频 ID 解析；
- 字幕和时间戳获取；
- 视频元数据；
- 长视频分段；
- DeepSeek 结构化提取；
- Schema 校验；
- 输出 `KnowledgeDocument JSON`；
- 重复视频检测；
- 错误和无字幕降级。

### PR 3：视频知识索引与检索

- 新增 `video_guides` namespace；
- 写入现有 SQLite 索引；
- 增量更新；
- 按英雄、装备、阵容、patch 和主题检索；
- 来源与时间点绑定；
- 检索评测。

### PR 4：Hybrid 回答

- MetaTFT QueryResult；
- YouTube KnowledgeEvidence；
- EvidenceBundle 合并；
- DeepSeek 综合回答；
- 视频与数据冲突规则；
- 无视频降级；
- Claim 分类和校验。

### PR 5：前端查询与证据面板

- 左侧聊天回答；
- 右侧 MetaTFT 数据；
- 右侧视频来源与时间点；
- 桌面双栏；
- 手机折叠面板；
- LLM 失败时保留数据结果。

### PR 6：MetaTFT 文档化与开放 RAG

- 当前环境总览；
- 英雄与阵容摘要；
- 统计知识 namespace；
- 开放推荐类问题；
- `rag` 模式补全。

### PR 7：评测与回归

- Router 评测；
- YouTube 提取评测；
- Hybrid 回答评测；
- 数据冲突测试；
- 过期知识测试；
- LLM 降级测试；
- 现有功能回归。

---

## 20. Codex 开工前必须先做的事

1. 阅读现有 README 和相关设计文档；
2. 同时读取参考仓库 `victorxia18/tft-meta-mind`；
3. 重点检查：
   - `scraper/youtube.py`
   - `pipeline/document_generator.py`
   - `rag/vector_store.py`
   - `chatbot/app.py`
4. 列出现有 Intent、RetrievalPlan、EvidencePack、Validator、语义索引和前端返回结构；
5. 输出参考项目到主项目的模块映射；
6. 标记：
   - 可直接移植；
   - 需要重写；
   - 禁止接入；
7. 给出新增 Python 依赖和 Node/Python 边界；
8. 给出许可证声明保留方式；
9. 给出第一批 YouTube 测试视频的人工导入流程；
10. 给出变更文件、测试计划和部署影响；
11. 第一阶段必须完成 YouTube 端到端闭环，不只停留在协议设计；
12. 不得完整复制 Streamlit、ChromaDB 或 Gemini 聊天层。

---

## 21. 给 Codex 的首轮任务提示词

```text
主仓库：
https://github.com/Chencc7002/tftclarity

只读参考仓库：
https://github.com/victorxia18/tft-meta-mind

需求文档：
tftclarity-hybrid-rag-youtube-codex-handoff.md

本阶段目标不是只做协议，而是直接完成 YouTube 攻略接入的端到端 MVP：

用户询问“霞最好的装备是什么，为什么？”时：
1. 现有 MetaTFT 查询链返回当前装备数据；
2. YouTube 知识库返回与霞和装备相关的攻略片段；
3. DeepSeek 结合两类证据生成回答；
4. 左侧展示 LLM 回答；
5. 右侧展示 MetaTFT 数据和视频来源；
6. “当前最好”必须由 MetaTFT 数据决定；
7. 视频只负责原因、条件、运营和替代建议。

请先阅读：
- tftclarity 的 README、LLM retrieval/evidence pipeline、Question Contract/
  ConclusionSpec、语义索引、MetaTFT 查询、会话和前端返回结构；
- tft-meta-mind 的 scraper/youtube.py、pipeline/document_generator.py、
  rag/vector_store.py、chatbot/app.py、README 和 LICENSE。

参考项目仅用于选择性复用 YouTube ingestion 和文档处理思路。
禁止将 tftclarity 整体迁移到 Python、Streamlit 或 ChromaDB。

必须保留：
- Node.js 主服务；
- MetaTFT 查询链；
- SQLite 语义索引；
- 中文实体和别名解析；
- 会话系统；
- EvidencePack；
- Validator；
- 现有前端。

第一轮先输出：
1. 两个仓库的模块映射；
2. 可直接移植、需要重写和禁止接入的代码；
3. YouTube ingestion 的 Node/Python 边界；
4. KnowledgeDocument 和 EvidenceBundle schema；
5. 新增依赖；
6. 许可证处理；
7. PR 拆分；
8. 测试计划。

然后开始实施 PR 1 和 PR 2：
- 协议与 AnswerModeRouter；
- 手动 URL 的 YouTube ingestion MVP；
- 字幕、时间戳、元数据、长视频分段；
- DeepSeek 结构化攻略提取；
- KnowledgeDocument JSON 输出；
- 对应单元测试和 smoke test。

不要停留在方案分析。完成后运行相关测试并报告结果、失败项和剩余风险。
```

---

## 22. 最终产品定义

最终产品不是纯 RAG，也不是纯结构化数据查询器。

定位为：

> 右侧像 MetaTFT，展示当前数据和证据；左侧像 TFT 教练，结合当前数据、机制知识和视频攻略，解释应该怎么选、为什么，以及什么情况下需要调整。

系统中的角色分工：

```text
MetaTFT
→ 告诉系统当前统计是什么

程序查询与排序
→ 决定本轮数据候选和当前统计首选

YouTube 攻略
→ 提供打法、原因、条件和作者经验

机制知识
→ 提供可迁移的游戏原理

LLM
→ 将以上证据组织成用户能理解的建议

Validator
→ 防止数字、来源、版本和结论越界
```

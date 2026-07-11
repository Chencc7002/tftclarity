# 下一阶段开发 Agent Prompt

你现在接手项目：云顶之弈局内数据检索 Agent / 小窗插件。

## 一、开始前必须阅读

不要跳过，按顺序阅读并以这些文档为约束：

1. `C:\Users\Chencc\Desktop\TFTAgent\docs\goal-prompt.md`
2. `C:\Users\Chencc\Desktop\TFTAgent\docs\requirements.md`
3. `C:\Users\Chencc\Desktop\TFTAgent\docs\memory-llm-architecture.md`
4. `C:\Users\Chencc\Desktop\TFTAgent\docs\current-stage-requirements.md`
5. `C:\Users\Chencc\Desktop\TFTAgent\docs\implementation-progress.md`
6. `C:\Users\Chencc\Desktop\TFTAgent\docs\mvp-verification-matrix.md`
7. `C:\Users\Chencc\Desktop\TFTAgent\docs\item-localization-pipeline.md`
8. `C:\Users\Chencc\Desktop\TFTAgent\docs\small-window-launcher.md`

先检查 `git status`、当前分支、最近提交和现有 PR。工作区可能包含用户或其他 Agent 的改动；不要回退、覆盖或重写不属于你的修改。不要重新发散产品方向。

## 二、当前事实

- 单英雄三件套装备检索已闭环并通过测试。
- `/comps` 已用于单英雄查询的默认阵容上下文，但尚未提供玩家可直接使用的全局阵容排行榜。
- 当前前端主要显示文字，没有统一英雄、装备、羁绊图标资源层。
- 当前 LLM 只负责受控自然语言解析；标准查询优先走规则和本地目录。
- 当前 LLM schema 只有单英雄装备和装备可用性意图，没有 `comp_rankings`。
- 当前离线 `comp_options` 主要提供 count、avg、score；没有可靠 `placement_count` 时，不得计算或声称阵容前四率、登顶率。
- MetaTFT 是非官方接口，单元测试必须离线可复现。

## 三、本阶段唯一主目标

在不破坏现有单英雄装备查询的前提下，完成“阵容排行榜 + 图标化构筑展示”的端到端闭环。

玩家应能查询：

```text
当前版本最强阵容有哪些？
前四率最高的三套阵容。
登顶率最高的阵容有哪些？
最热门的阵容。
平均名次最好的阵容。
这版本玩什么容易上分？
有没有比较稳、同时也有吃鸡能力的阵容？
```

标准表达必须无需 LLM；随意表达可由可选 LLM 转成同一个受控结构化意图。

## 四、先完成数据可行性验证

这是实现前置条件，不要先画一个使用假指标的 UI。

1. 检查现有 MetaTFT `/comps`、Explorer 端点和前端请求，寻找能为阵容或稳定阵容定义返回 `placement_count` 或等价名次分布的数据源。
2. 优先验证需求文档中待验证的 `exact_units_traits2`，也可以使用经实际响应证据确认的其他端点。
3. 保存最小、脱敏、可离线测试的 fixture；不要重新提交大型第三方网页 bundle。
4. 记录 endpoint、参数、patch、queue、days、rank、字段定义、抓取时间和风险。
5. 只有实际名次分布可以计算：

```text
样本数 = sum(placement_count)
前四率 = sum(placement_count[0..3]) / 样本数
登顶率 = placement_count[0] / 样本数
平均名次 = sum((index + 1) * placement_count[index]) / 样本数
```

6. `avg` 可以直接作为有来源的平均名次展示；不能从 `avg`、score 或 count 反推前四率和登顶率。
7. 如果某个指标没有可靠来源，API 和 UI 必须标记 unavailable，不能由 LLM 或经验值补齐。

## 五、新增阵容查询领域模型

新增并贯通意图：

```json
{
  "intent": "comp_rankings",
  "metrics": ["top4_rate", "win_rate"],
  "limit": 3,
  "min_samples": 500,
  "days": 3,
  "patch": "current",
  "rank_filter": ["PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"]
}
```

要求：

- 规则解析器识别“阵容、最强、上分、稳、前四、登顶、吃鸡、热门、平均名次”等高频表达。
- “最强阵容”默认同时返回前四率榜和登顶率榜，而不是偷偷选择单一指标。
- “稳/上分”映射到前四优先；“吃鸡/登顶”映射到登顶率；“热门/最多人玩”映射到样本或选择率；“平均名次最好”映射到均名升序。
- 扩展 LLM prompt/schema 支持 `comp_rankings`、metrics 和 limit，但模型只解析，不计算、不排序、不生成阵容。
- 所有 LLM 输出仍通过严格 schema 和本地枚举校验。
- 新意图不应要求 unit；单英雄装备意图的现有校验不能被放宽。

## 六、阵容聚合与排序

实现独立的 comp ranking service，不要把全局榜单硬塞进 Default Context Builder。

每个阵容记录至少包含：

```json
{
  "compId": "stable-cluster-or-fingerprint",
  "name": "可读阵容名",
  "patch": "current",
  "units": [],
  "traits": [],
  "coreBuilds": [],
  "stats": {
    "games": 0,
    "top4Rate": null,
    "winRate": null,
    "avgPlacement": null,
    "pickRate": null
  },
  "source": {
    "endpoint": "...",
    "updatedAt": "..."
  }
}
```

要求：

- 使用稳定 cluster id 或单位/羁绊规范化指纹去重，避免同一阵容因人口或细微变体占满榜单。
- 明确主形态与变体的合并规则，并用测试锁定。
- 排除明显英雄强化、专属玩法或异常召唤物形态，除非玩家明确查询特殊玩法。
- 默认应用最低样本阈值；低样本阵容可以作为参考，但不能获得稳定 S/A 结论。
- 前四、登顶、均名、热度分别排序，不要把不同口径混成一个“综合最强”。
- 阵容等级标签如果没有透明、可测试的分档规则就不要显示；禁止复制第三方网站的不可解释评级。
- 返回数据口径、时间范围、段位、样本阈值、更新时间和外部数据风险。

## 七、图标资产层

建立统一、patch-aware 的 asset resolver，不要在 UI 组件里手写 URL。

支持三类资源：

```text
unit apiName -> 英雄头像
item apiName -> 装备图标
trait apiName/filterId -> 羁绊图标
```

要求：

- 优先使用可追溯、版本化的 Riot/TFT 静态数据或经验证的 CDN；记录来源和版本。
- 不直接依赖 MetaTFT 网页 bundle，不提交无引用第三方脚本。
- 可以返回远程 CDN URL并依赖浏览器缓存，也可以在 `.cache/assets` 做运行时缓存；不要未经评估把完整大图包提交进 Git。
- 生成或维护 asset manifest，字段至少包括 entityType、apiName/filterId、iconUrl、source、sourcePatch 和 fallback 状态。
- 资源 URL 必须经过后端白名单/规范化，前端不能渲染任意用户输入 URL。
- 图标缺失时保留文字和固定尺寸占位，不允许布局跳动或破坏查询。
- 装备本地化快照和资产快照职责分离，但必须共用同一 `apiName`。

## 八、后端响应扩展

现有装备卡至少扩展：

```json
{
  "unit": {
    "apiName": "TFT17_Nunu",
    "name": "努努和威朗普",
    "iconUrl": "..."
  },
  "items": [
    {
      "apiName": "TFT_Item_WarmogsArmor",
      "name": "狂徒铠甲",
      "iconUrl": "...",
      "locked": false
    }
  ]
}
```

阵容榜响应建议：

```json
{
  "type": "comp_rankings",
  "rankings": {
    "top4Rate": [],
    "winRate": [],
    "avgPlacement": [],
    "popularity": []
  },
  "query": {},
  "source": {},
  "warnings": []
}
```

每个阵容的 units 应包含 apiName、中文名、iconUrl、可证实的星级、core 标记和该英雄明确对应的装备。没有数据时保持 `null`/空数组，不要猜测星级、站位或装备归属。

## 九、小窗 UI

参考用户提供的阵容列表和三件套表格截图，但不要照搬桌面宽屏布局。目标仍是 460px 主视口和 360px 窄视口。

### 装备结果

- 显示目标英雄头像。
- 三件装备使用图标为主、短名称或 tooltip 为辅。
- 锁定、比较、排除、低样本用一致且可辨认的视觉状态。
- 图标按钮和陌生图标必须有 tooltip/aria-label。

### 阵容结果

- 使用可展开的阵容卡。
- 折叠态显示：阵容名、主要羁绊、核心成员头像、榜单指标和样本。
- 展开态显示：完整成员、羁绊层数、核心英雄、明确的英雄装备归属、数据条件和来源。
- 英雄头像、装备图标和羁绊图标必须固定尺寸；异步加载和失败占位不能导致卡片跳动。
- 不允许横向溢出、文字遮挡、嵌套卡片或为了塞内容把字号缩到不可读。
- 第一屏应优先显示可行动信息，来源与完整条件可以折叠。
- 站位图和运营路线不在本阶段强制范围，除非已经找到可靠结构化数据源。

## 十、缓存与降级

- 阵容榜按 patch、queue、days、rank、minSamples、specialMode 和数据版本缓存。
- 新鲜数据失败时可回退到过期缓存，但必须显示缓存更新时间和 stale warning。
- 资产缓存与查询缓存分离。
- 当前业务规模继续使用 JSON/SQLite 即可，不引入 MySQL、Redis 或外部向量数据库。
- 新路径不能拖慢现有单英雄装备热路径；标准装备输入仍不调用 LLM。

## 十一、测试与验收

必须补充：

1. 高频阵容问法在 LLM 关闭时解析为 `comp_rankings`。
2. 随意问法的假 LLM 输出通过 schema 后进入同一 service。
3. 单英雄装备查询仍走原路径，168 个现有测试不得回归。
4. 阵容 fixture 归一化、去重、样本过滤、前四/登顶/均名/热门排序测试。
5. 没有 `placement_count` 时不生成前四率和登顶率。
6. 不同指标榜单可以返回不同顺序，且排序稳定。
7. asset resolver 覆盖当前 fixture 中英雄、装备、羁绊，缺失资源有固定 fallback。
8. 后端响应不泄露原始第三方 payload、API key 或任意资源 URL。
9. 装备卡和阵容卡的 460px/360px 视觉验收，包含正常、低样本、无图标、stale、空结果状态。
10. 使用真实截图和元素尺寸检查无横向溢出、文字裁切、重叠和布局跳动。
11. `smoke:visual` 如果因 Playwright 缺失而跳过，必须明确报告“未执行”，不能写成通过。
12. 新增离线阵容查询 smoke；联网 smoke 作为手动发布检查，不进入默认单元测试。

验收示例：

```text
当前版本阵容榜｜近3天｜铂金以上｜样本>=500

前四率最高
1. 阵容A：前四 61.2% / 登顶 16.8% / 均名 3.72 / 样本 12,430
2. 阵容B：前四 59.7% / 登顶 18.1% / 均名 3.81 / 样本 8,210

登顶率最高
1. 阵容C：登顶 20.3% / 前四 56.4% / 样本 5,930
2. 阵容B：登顶 18.1% / 前四 59.7% / 样本 8,210
```

卡片中应能直接看到每套阵容的英雄头像、主要羁绊和核心装备；用户不应只得到阵容名字。

## 十二、工程约束

- 延续现有 Node ESM、无框架小窗和本地缓存架构，优先复用当前模式。
- 结构化解析、数据适配、统计、排序、资产解析和 UI 序列化保持职责分离。
- 不用 LLM 生成数据、指标、阵容、装备或评级。
- 不自动把第三方 API token 的出现/消失当成版本事实。
- 不修改无关文件，不重写用户改动，不提交真实 `.env`、密钥、缓存、数据库或大型抓包。
- 手工编辑使用 `apply_patch`；运行格式、测试、smoke 和审计后更新进度文档。
- 完成后给出：改动摘要、数据来源证据、测试结果、视觉证据、已知风险和下一步，不要把未运行检查写成通过。

现在开始：先阅读文档和代码，验证阵容统计数据源，然后按数据层、领域服务、响应 schema、资产层、前端和测试的顺序推进。不要只产出方案，目标是在本阶段完成可运行的端到端实现。

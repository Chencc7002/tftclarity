# tftclarity

> 听得懂中文俗称，支持自然语言查询，用 AI 总结数据，帮助玩家快速得到可靠结论。

tftclarity 是一个面向《云顶之弈》中文玩家的数据决策助手。它把玩家的自然语言问题转换为结构化查询，从 MetaTFT 获取数据并在本地计算指标，再给出首选方案、备选方案、样本可靠性和可选的 AI 数据解读。

项目既可以作为浏览器中的本地小窗口运行，也可以部署为公开 Web 服务。

## 为什么使用 tftclarity？

常规数据网站适合浏览完整榜单和手动筛选原始数据；tftclarity 更关注中文玩家的自然表达，以及从“提出问题”到“做出选择”的速度。

### 中文俗称支持

不需要记住完整官方名称或 API 名称，可以直接使用常见中文称呼：

- 羊刀、无尽、巨杀、石像鬼
- 挑战者转、斗士转
- 英雄简称、旧称和常见中文别名
- 简体中文、繁体中文及部分拼音表达

系统会先在本地目录中解析这些称呼，无法确定唯一实体时会要求用户确认，不会直接猜测。

### 自然语言查询

可以像聊天一样描述需求：

```text
霞已经有羊刀，剩下两件怎么补？

查询这个阵容里三星贾克斯的出装，样本至少 500。

当前版本有哪些阵容正在上升？

推荐当前版本热门阵容，然后按胜率排序。
```

系统会提取英雄、星级、阵容、装备、段位、统计时间、样本要求和排序目标，并支持在后续对话中继承或修改条件。

### AI 总结数据

除了展示前四率、胜率、平均名次和样本数，系统还可以说明：

- 推荐方案为什么更合适
- 高排名是否可能来自低样本波动
- 哪个方案更普适
- 不同备选方案适合什么取舍

AI 只负责受控解析和数据解读，不能直接改写底层统计结果。生成内容必须通过证据 ID、数字、实体和风险边界校验；校验未通过时会自动使用确定性模板，不影响基础查询结果。

### 快速得到结论

查询结果会直接组织为：

- 首选方案
- 备选方案
- 关键指标
- 样本覆盖和稳定性
- 推荐依据与下一步建议

用户还可以从阵容卡片直接查询某个棋子的出装，查询结束后返回原阵容继续分析其他棋子。

## 当前功能

- 英雄三件套、单件装备、已有装备补全和多装备对比
- 普适性推荐：综合表现、样本规模和覆盖范围，降低低样本高排名误导
- 热门阵容：准备 21 个展示样本，可在平均排名、前四率和胜率之间切换
- 阵容趋势：上升 5 个、下降 5 个、选择率前 10 个，并标记高选择率“卷”阵容
- 阵容棋子快捷查询：自动携带阵容、星级和高样本条件
- 查询返回导航：棋子出装查询后可返回原阵容继续浏览
- 英雄、装备和羁绊详情
- 中文/英文界面、响应式布局和赛季壁纸
- JSON 或 SQLite 持久化缓存
- 可选结构化解析、语义检索和证据约束的 LLM 数据解读
- 匿名公开访问、使用额度控制和反馈记录

## 快速开始

### 环境要求

- Windows、macOS 或 Linux
- Node.js 18 或更高版本
- 推荐使用带有 `node:sqlite` 的新版 Node.js；如果当前 Node.js 不包含该模块，需要成功安装可选依赖 `better-sqlite3`

如果启动时同时提示缺少 `node:sqlite` 和 `better-sqlite3`，请升级 Node.js 后重新执行 `npm install`。

### 安装与启动

```powershell
git clone https://github.com/Chencc7002/tftclarity.git
cd tftclarity
npm install
npm start
```

启动后访问：

```text
http://127.0.0.1:17317/
```

Windows 桌面小窗口：

```powershell
npm run window
```

只启动服务、不自动打开浏览器：

```powershell
npm run window:server
```

## 可选 AI 配置

基础数据查询不要求配置 LLM。需要自然语言增强解析、语义检索或 AI 数据解读时：

```powershell
Copy-Item .env.example .env
```

然后在 `.env` 中填写所使用的 OpenAI-compatible 服务配置。不要把真实 API Key 提交到 Git。

主要开关：

| 配置 | 作用 |
| --- | --- |
| `TFT_AGENT_LLM_MODE` | 可选的结构化查询解析 |
| `TFT_AGENT_CONCLUSION_MODE` | 证据约束的数据解读 |
| `TFT_AGENT_EMBEDDING_MODE` | 持久化语义索引 |
| `TFT_AGENT_CONCLUSION_MAX_CORRECTIONS` | 数据解读校验失败后的最大纠错次数 |

完整配置和安全占位符见 [.env.example](.env.example)。公开部署配置见 [.env.production.example](.env.production.example)。

YouTube 攻略手动摄取、知识索引、混合回答与降级规则见 [YouTube 攻略知识与混合回答操作说明](docs/youtube-hybrid-operations.md)。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm start` | 启动本地小窗口服务 |
| `npm run window` | 启动 Windows 桌面窗口 |
| `npm test` | 运行完整自动化测试 |
| `npm run smoke:small-window` | 验证本地 API 主流程 |
| `npm run smoke:conclusion-llm` | 一次性验证真实 LLM 数据解读 |
| `npm run smoke:visual` | 运行可选的视觉冒烟测试 |
| `npm run semantic:index` | 构建持久化语义索引 |
| `npm run youtube:import -- --url <URL>` | 手动摄取并索引一条 YouTube 攻略 |
| `npm run smoke:youtube` | 验证视频版本替换、partial_success、幂等入库与严格检索 |
| `npm run youtube:acceptance` | 对固定审核标注视频集计算六类提取质量指标 |
| `npm run youtube:acceptance:live` | 重放六个真实捕获视频并执行完整提取质量验收 |
| `npm run youtube:acceptance:review-packet` | 生成六视频完整字幕人工升级审核包 |
| `npm run youtube:acceptance:review:export` | 导出带哈希和逐条 decision 的机器审核表 |
| `npm run youtube:acceptance:review:apply` | 校验并生成独立的已审核 acceptance set |
| `npm run youtube:acceptance:review:evaluate` | 对已审核集与真实重提取结果执行正式质量门槛 |
| `npm run test:youtube:python` | 运行 YouTube 摄取器单元测试 |
| `npm run semantic:audit` | 审核语义索引状态 |
| `npm run audit:aliases` | 审核实体别名覆盖 |
| `npm run audit:items` | 审核当前装备可用性 |
| `npm run backup:sqlite` | 创建并校验 SQLite 备份 |

涉及 MetaTFT 或真实模型的联网 smoke 会受到外部服务状态、网络和额度影响。

## 数据与可信度边界

- 查询解析、数据聚合、指标计算和基础排序保持确定性
- LLM 不能提供未出现在证据包中的数字、实体或 API 名称
- 低样本、旧缓存和无法确定胜出的对比必须显示风险边界
- LLM 不可用或输出校验失败时，系统继续返回确定性结果
- MetaTFT 是非官方外部数据源，接口变化或网络失败可能影响实时查询
- YouTube 攻略摘要由 AI 从视频字幕提取和概括；未完成人工审核时，Schema、
  HTTP Evidence 和界面都会明确标记“AI 生成 · 未经人工复核”，并保留时间点
  链接供用户核对原视频
- `.probe/` 中保存离线捕获样本，用于回归测试、目录审核和数据契约验证

数据解读与检索设计详见：

- [LLM 检索与证据流水线](docs/llm-retrieval-evidence-pipeline.md)
- [LLM 与会话记忆架构](docs/memory-llm-architecture.md)
- [Question Contract 与 ConclusionSpec Registry](docs/question-contract-conclusion-spec.md)
- [阵容排行数据来源](docs/comp-ranking-data-source.md)
- [语义索引构建](docs/semantic-index-build.md)

## 测试

```powershell
npm test
```

### MetaTFT current_stats 生成与每日调度

```powershell
npm run stats:generate
npm run stats:daily
npm run stats:schedule:windows
npm run smoke:current-stats
npm run smoke:current-stats:http
```

`stats:generate` 把 `meta_snapshot`、`trend_snapshot`、`unit_stats` 和全量
`comp_stats` 写入独立的 `current_stats` namespace。`stats:daily` 在文件锁保护下
执行一次任务，写入 `.cache/current-stats/manifest.json`，失败时自动重试；设置
`CURRENT_STATS_ALERT_WEBHOOK` 后，最终失败会发送 JSON 告警。`stats:schedule:windows`
安装每天 04:15 执行的 Windows 计划任务，Node 常驻调度可使用
`npm run stats:scheduler`，Linux cron 示例见
[`scripts/current-stats.cron.example`](scripts/current-stats.cron.example)。

两个 smoke 分别验证真实 MetaTFT → SQLite 的幂等、freshness、范围隔离、namespace
保护，以及完整 HTTP → Router → Hybrid → Evidence 链路。最新验收结果见
[`docs/current-stats-phase2-automation-trend-http-e2e-report-2026-07-29.md`](docs/current-stats-phase2-automation-trend-http-e2e-report-2026-07-29.md)。

统计文档使用 `semanticProjection` 控制正文和 Embedding：样本数与完整原始指标
每次写入 metadata/`recordHash`，正文只保留规范化后的语义指标。默认平均名次保留
2 位小数，前四率、登顶率和出场率保留 1 位百分数，普通排名变化阈值为 2 位。
关键 Top-N 边界默认不启用，可通过
`CURRENT_STATS_CRITICAL_RANK_BOUNDARIES=1,3,4,10` 显式配置。成本优化验证见
[`docs/current-stats-semantic-projection-optimization-report-2026-07-29.md`](docs/current-stats-semantic-projection-optimization-report-2026-07-29.md)。

测试覆盖查询解析、别名解析、阵容趋势、热门阵容、多轮会话、缓存、SQLite、推荐排序、LLM 证据校验、HTTP 接口和前端交互。

## 部署

公开 Web 版本支持匿名访问隔离、LLM 使用额度、反馈记录、SQLite 持久化和 Caddy 自动 HTTPS。

部署步骤见 [腾讯云部署指南](docs/deploy-tencent-cloud-v1.md)。

## 项目声明

tftclarity 是由玩家独立制作的非商业粉丝项目，与 Riot Games 不存在隶属、合作、赞助或认可关系。

MetaTFT 为非官方外部数据来源。Riot Games、Teamfight Tactics 及相关角色、图像、名称和游戏资产归 Riot Games 或其权利人所有。

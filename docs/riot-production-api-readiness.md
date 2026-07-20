# Riot Production API 申请与数据架构评估

> 更新日期：2026-07-20
>
> 项目：tftclarity
>
> 公开站点：<https://tftclarity.cn/>

## 1. 结论摘要

tftclarity 已经具备公开、可运行、可演示的产品原型，产品定位和主要用户流程也基本符合 Riot 对 TFT 第三方工具的方向要求。当前项目不是因为功能不足而无法申请，而是仍需补齐合规页面和 Riot 官方数据接入。

现阶段建议目标为申请标准 **Production API Key**。Riot 的标准生产密钥初始限额为每个区域：

- 500 次请求 / 10 秒
- 30,000 次请求 / 10 分钟

更高限额不是首次申请时可以直接取得的独立密钥等级。产品需要先获得 Production Key，保持良好合规记录，证明社区价值，并在确实超过标准限额后再申请扩容。

截至本次评估，申请前最重要的工作是：

1. 上线独立的 Privacy Policy 和 Terms of Service。
2. 实现至少一条可演示的 Riot API 数据采集与聚合链路。
3. 在提交申请后，按照 Riot 提供的验证字符串完成域名所有权验证。
4. 明确首期支持区域及中国大陆服务器的数据边界。

最终是否批准由 Riot Developer Relations 决定，本文只用于项目内部准备度评估。

## 2. 产品定位与差异化

tftclarity 面向中文 TFT 玩家，核心价值不是替代完整数据榜单，而是缩短用户从“提出问题”到“得到结论”的路径。

主要差异包括：

- 支持英雄、装备、羁绊和阵容的中文简称、俗称与常见别名。
- 支持自然语言查询，不要求用户记住官方名称或 API 标识。
- 把查询条件转换为确定性的结构化请求。
- 使用 AI 总结数据，但不允许 AI 改写底层统计结果。
- 展示样本数、低样本风险、适用范围和多个候选方案。
- 支持阵容榜、阵容趋势、英雄装备查询和连续上下文导航。

这类聚合数据和静态推荐可以作为赛前参考或长期学习工具。产品描述应强调“提供多个选择、解释数据和帮助复盘”，避免使用“实时指挥”“根据当前棋盘告诉玩家下一步必须做什么”等表述。

## 3. Riot 密钥类型

### Development Key

- 登录 Developer Portal 后自动获得。
- 每 24 小时失效。
- 适合探索接口和开发原型。
- 不允许支持公开产品长期运行。

### Personal Key

- 适合个人项目、小范围私有社区和研究。
- 需要提交详细产品说明。
- 不允许用于公开 Alpha、Beta 或正式产品。
- 默认限额较低：每区域 20 次 / 秒、100 次 / 2 分钟。

### Production Key

- 面向公开网站、应用和较大社区。
- 通常要求可运行或接近完成的产品原型。
- 需要可访问的网站、清晰用户流程和域名所有权验证。
- 一个产品使用一个密钥，不能用多个应用绕过限流。
- API Key 必须只保存在后端，使用 HTTPS，不得写入前端或分发的二进制文件。

## 4. 当前项目申请准备度

| 审核项目 | 当前状态 | 判断 |
| --- | --- | --- |
| 产品价值和差异化 | 中文俗称、自然语言查询、AI 数据总结、快速结论 | 已达标 |
| 可运行原型 | 本地和公开 Web 版本均可运行 | 已达标 |
| 用户流程 | 阵容、趋势、英雄装备、连续查询和返回导航完整 | 已达标 |
| 公开网站 | `https://tftclarity.cn/` 外网 GET 返回 HTTP 200 | 已达标 |
| 自有正式域名和 HTTPS | 正式 `.cn` 域名、Caddy、HTTPS 和 HSTS 正常 | 已达标 |
| Riot 法律声明 | 界面中已有 Riot 要求的英文声明 | 已达标 |
| API Key 基础安全 | `.env` 未跟踪，服务端环境变量方案已存在 | 基本达标 |
| 自动化测试 | 2026-07-20 执行 439 项：424 通过、15 跳过、0 失败 | 已达标 |
| Privacy Policy | `https://tftclarity.cn/privacy` 公网 GET 返回 200，首页存在公开入口 | 已达标 |
| Terms of Service | `https://tftclarity.cn/terms` 公网 GET 返回 200，首页存在公开入口 | 已达标 |
| Riot 域名验证 | 需在提交 Production 申请并取得验证字符串后完成 | 待完成 |
| Riot 官方 API 数据链路 | 核心实时统计仍来自 MetaTFT 非官方接口 | 未达标 |
| Riot 限流与采集调度 | 尚无 Riot 专用限流器、采集 Worker 和统计仓库 | 未实现 |
| Developer Portal 产品注册 | 无法从仓库确认 | 待人工完成 |
| 中国大陆数据 | Riot 公共 API 没有中国大陆平台路由 | 必须声明边界 |

### 公开站点核验说明

2026-07-20 再次通过公网浏览器核验正式域名：

```text
GET https://tftclarity.cn/         → 200 text/html; charset=utf-8
GET https://tftclarity.cn/privacy → 200 text/html; charset=utf-8
GET https://tftclarity.cn/terms   → 200 text/html; charset=utf-8
```

首页固定页脚和设置面板均包含 Riot 独立项目声明以及 Privacy Policy、Terms of Service 入口。生产 HTML 已核对页面标题、关键政策内容和 `tftclarity@outlook.com` 联系地址。

首页响应已经包含 CSP、HSTS、`X-Content-Type-Options` 等安全响应头，并设置了 `HttpOnly`、`Secure`、`SameSite=Lax` 的匿名访客 Cookie。`HEAD` 请求当前返回 405，但普通 `GET` 可以正常访问，这不影响网站作为公开产品使用。

仓库中的 `.env.production.example` 仍使用 `tft.example.com` 作为安全占位符。评估公开部署状态时，应以正式站点为准，不能仅依据示例配置。

## 5. 必须补充的合规页面

### Privacy Policy

网站当前会设置匿名访客 Cookie，因此隐私政策至少应说明：

- Cookie 名称、用途和有效期。
- 是否保存查询内容、偏好、反馈、IP 和服务日志。
- 各类数据的保存期限。
- 查询内容是否发送给第三方 LLM 服务。
- 第三方服务的用途和数据边界。
- 用户如何申请查询、更正或删除数据。
- 产品运营者的联系渠道。
- 政策生效日期和更新方式。

### Terms of Service

服务条款至少应说明：

- 产品用途和使用资格。
- 数据可能存在延迟、缺失或第三方服务中断。
- 统计结论不保证游戏结果。
- 禁止滥用、攻击、批量抓取或绕过访问限制。
- Riot Games 与项目不存在隶属、赞助或认可关系。
- Riot、MetaTFT、静态资源和第三方 LLM 的责任边界。
- 服务暂停、终止和条款更新机制。
- 联系方式和适用法律说明。

具体文本应根据实际运营主体、日志配置、LLM 服务商和部署地区填写；不要直接发布与真实数据处理方式不一致的模板。

## 6. Riot 官方数据接入与后端变化

仅申请 API Key 不会迫使现有应用重写。但如果要用 Riot 官方数据替代 MetaTFT 的成品统计，就需要增加一条离线数据采集和聚合链路。

建议保留：

- 现有前端和交互。
- 中文别名与自然语言解析。
- 查询上下文和返回导航。
- 推荐排序和样本风险机制。
- LLM 证据包与结果校验。
- HTTP、会话、匿名访问、反馈和缓存。

建议新增：

```text
Riot API
  → 高段位玩家种子
  → 玩家对局 ID
  → 对局详情
  → 去重与原始数据保存
  → 英雄、装备、羁绊和阵容特征标准化
  → 阵容识别
  → 指标聚合
  → 查询服务
  → 当前前端
```

代码层面宜增加统一 `StatsProvider` 接口：

```text
StatsProvider
├── MetaTFTStatsProvider
└── RiotWarehouseStatsProvider
```

迁移期间可使用双数据源影子对比，先验证统计口径，再逐步切换主数据源。SQLite 可以继续保存用户偏好、缓存、反馈和本地语义索引；原始对局和聚合统计建议使用 PostgreSQL，原始 JSON 可进入对象存储。只有在数据规模明显超过 PostgreSQL 的舒适范围后，才需要评估 ClickHouse。

## 7. 阵容统计的核心壁垒

Riot 提供的是原始对局数据，不会直接提供 MetaTFT 或 TFTable 页面上的成品阵容榜、装备推荐和趋势结论。需要自行完成：

- 样本玩家发现和持续扩展。
- 对局拉取、去重、补采和版本隔离。
- 英雄、星级、装备、羁绊和排名标准化。
- 阵容聚类、人工命名、合并与拆分。
- 每个版本的阵容身份持续追踪。
- 平均排名、前四率、胜率、选择率和趋势计算。
- 低样本修正、异常数据过滤和展示门槛。

阵容识别可以先用人工维护的阵容原型和加权相似度实现，再用 HDBSCAN 等离线聚类方法发现未分类棋盘。推荐的商业化流程是：

```text
自动发现候选聚类
→ 人工审核、合并、拆分和命名
→ 版本化阵容注册表
→ 新棋盘在线归类
→ 漂移监控
```

真正的壁垒不是单个聚类算法，而是长期数据规模、每版本阵容注册表、权重与过滤规则、人工运营经验、阵容身份连续性和新版本响应速度。

## 8. 英雄装备查询需要增加的能力

英雄装备查询不需要新的 Riot 接口。TFT 对局详情已经提供英雄标识、星级、携带装备和玩家最终排名；静态英雄与装备名称、图标可以从 Data Dragon 获取。

### 原始记录

每场对局中的英雄可标准化为：

```text
match_id
patch
region
queue
rank_tier
placement
comp_id
champion_id
star_level
item_1
item_2
item_3
augment_ids
```

装备组合必须进行无序标准化。例如“无尽 + 科技枪 + 破防者”和“科技枪 + 破防者 + 无尽”必须落到同一个组合键。

### 装备目录

需要维护：

```text
item_id → 中文名、图标、类别、所属赛季、是否允许统计
```

并区分：

- 基础散件
- 普通成装
- 光明装备
- 奥恩神器
- 辅助装备
- 特殊模式装备
- 消耗品和不可统计对象

### 聚合表

完整三件套至少需要：

```text
champion_id
star_level
comp_id
item_set_hash
patch
rank_bucket
sample_count
avg_placement
top4_rate
win_rate
```

单件装备统计至少需要：

```text
champion_id
item_id
sample_count
avg_placement
top4_rate
win_rate
equip_rate
```

### 样本修正

推荐不能只按平均排名排序。应使用贝叶斯收缩或类似的置信度修正，避免几十场的极端结果压过数万场的稳定方案：

```text
修正平均排名 =
(样本数 × 方案平均排名 + 先验强度 × 全局平均排名)
÷ (样本数 + 先验强度)
```

最终推荐可以综合修正平均排名、修正前四率、修正胜率和样本可信度，并标注“稳定推荐”“潜力方案”“低样本参考”。

### 阵容内英雄快捷查询

用户点击阵容中的英雄时，应携带：

```json
{
  "championId": "TFT17_Ornn",
  "starLevel": 3,
  "compId": "challenger_ornn",
  "patch": "current",
  "rank": ["MASTER", "GRANDMASTER", "CHALLENGER"],
  "minSample": 100
}
```

阵容中显示三星时查询三星，否则默认二星。查询结束后应保留原阵容页面和滚动位置。

为避免条件交集过小导致频繁无结果，后端应按顺序自动放宽：

```text
同阵容 + 同星级
→ 同阵容 + 不限星级
→ 全阵容 + 同星级
→ 全阵容 + 不限星级
```

每次放宽都必须在页面中说明实际采用的条件。

## 9. 中国大陆服务器边界

Riot Developer API 当前公开平台路由中没有中国大陆服务器。Production Key 不等于腾讯国服数据权限。

建议申请说明使用如下范围：

> tftclarity 面向中文用户，提供 Riot API 支持区域中的 TFT 聚合统计和自然语言数据解读。首期支持 TW2、SG2、JP1、KR 等公开区域，不承诺中国大陆服务器对局覆盖。

如果未来必须提供中国大陆服务器统计，需要另外确认腾讯侧数据授权或合作渠道，不能假设 Riot Production Key 会自动解决。

## 10. 推荐申请顺序

1. 保持现有公开站点稳定可用。
2. 上线 `/privacy`、`/terms` 和可选的 `/about`、`/data-sources`。
3. 准备英文产品说明、用户流程截图或演示视频。
4. 明确不提供实时棋盘决策、对手侦察或玩家隐藏信息分析。
5. 在 Developer Portal 注册产品并直接提交 Production Key 申请，Personal Key 不是强制前置步骤。
6. 部署 Riot 提供的验证字符串，完成域名所有权验。
7. 审核期间可使用 Development Key 在本地或私有环境验证 Riot 接口。
8. 获批后实现 Riot 专用限流、重试、去重、原始对局存储和聚合统计。
9. 优先让英雄装备统计通过 Riot 数据端到端生成。
10. 逐步扩大阵容分类、聚类和统计仓库覆盖。

完整操作流程参见 [tftclarity Riot Production Key 申请流程](riot-production-key-application-guide.md)。

## 11. 申请说明建议

申请材料应突出：

- 中文别名和自然语言查询降低了数据工具的使用门槛。
- AI 只负责解释经过验证的聚合统计，不生成或修改底层数据。
- 产品展示多个候选方案、样本量和风险边界，不替玩家做唯一决策。
- 数据用于赛前静态参考、赛后学习和长期版本理解。
- 产品不读取当前对局状态，不侦察对手，不进行实时动态指挥。
- API Key 仅保存在 HTTPS 后端。
- 聚合统计不展示特定玩家身份，因此当前产品不需要 RSO。

如果以后增加“用户登录后查看自己的对局历史”，需要在 Production 应用获批后另外申请 RSO。

## 12. 官方参考资料

- [Riot Developer Portal 与 API Key 类型](https://developer.riotgames.com/docs/portal)
- [Riot Production Key、网站与域名验证 FAQ](https://developer.riotgames.com/docs/faqs)
- [Riot 通用开发者政策](https://developer.riotgames.com/policies/general)
- [Riot Teamfight Tactics 开发政策与 API 文档](https://developer.riotgames.com/docs/tft)
- [Riot API Reference](https://developer.riotgames.com/apis/)

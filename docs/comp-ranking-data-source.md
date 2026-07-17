# 阵容排行榜数据源与口径

更新时间：2026-07-17

## 与 MetaTFT `/comps` 一致的数据契约

阵容排行榜必须复用 MetaTFT 页面本身使用的两个结构化接口，不抓取网页 HTML，也不再使用 `exact_units_traits2` 结算棋盘做相似度聚类：

```text
GET https://api-hc.metatft.com/tft-comps-api/comps_data
queue=1100

GET https://api-hc.metatft.com/tft-comps-api/comps_stats
queue=1100
patch=current
days=3
rank=CHALLENGER,DIAMOND,EMERALD,GRANDMASTER,MASTER,PLATINUM
permit_filter_adjustment=true
cluster_id=<comps_data.results.data.cluster_id>
```

`comps_data` 是阵容身份、英雄、羁绊、名称提示和核心出装的权威来源；`comps_stats` 是当前筛选条件下名次分布和榜单统计的权威来源。两者的 `cluster_id` 必须一致。若 MetaTFT 正在切换 cluster，客户端会重新获取一次两份数据；仍不一致时不得把不同版本的数据拼在一起。

2026-07-13 的发布核对中，当前 cluster 为 `409`，`comps_data` 有 69 个阵容定义；同筛选的 `comps_stats` 有 69 个有效阵容统计行，总对局数为 6,516,732。外部数据会持续变化，这些数字只作为发布证据，不写入业务常量。

## 指标转换

MetaTFT 每个阵容返回九个 `places` 值：前八项是第一至第八名数量，第九项是该行总样本。页面实际按前八项求和，并用全局空 cluster 行的 `places[0]` 计算登场率：

```text
games = sum(places[0..7])
top4Rate = sum(places[0..3]) / games
winRate = places[0] / games
avgPlacement = sum((index + 1) * places[index]) / games
pickRate = games / overallGames
```

本地适配器只做上述确定性转换。LLM 不得生成或修补阵容名称、英雄、羁绊、名次分布或统计数据。

## 页面默认可见范围与排序

默认结果与 MetaTFT `/comps` 的公开页面一致：

- 只保留同时存在于 `comps_data.cluster_details` 和 `comps_stats.results` 的 cluster；
- 排除空 cluster 和 `-1`；
- 隐藏 `centroid` 最大值小于 1 的阵容；
- 默认隐藏 `name_string` 中带 `Augment` 的情境阵容；用户明确查询特殊玩法时才显示；
- 应用页面默认 `min_playrate=0.01`，即隐藏 `pickRate * 8 < 0.01` 的阵容；
- 平均名次按升序，其余指标按降序；完全相同时保持 API 原始顺序，与浏览器稳定排序一致。

页面默认 `sortOn` 是 `Avg Placement`。TFTAgent 允许用户明确选择前四率、登顶率、平均名次或热门度；每个列表都必须与页面选择同一指标后的 cluster 顺序相同。输出中禁止出现 `fingerprint:*` 等本地推导阵容身份。

## 官方页面趋势复现

“近 3 天新兴强阵容”优先接受旧版 `comps_data.results.data.comps[*]["Average Placement Change"]`。当前 MetaTFT 响应未返回该旧字段时，使用页面同源的 `cluster_details[*].trends` 复现其三日变化：取最近四个日节点；若当天仍为低样本残缺日，则以昨天为终点；最终计算“终点平均名次 − 三天前基线平均名次”。至少三个阵容的结果严格小于 `-0.10` 时，才生成三张趋势卡。

- 页面计算值必须完全来自 MetaTFT 官方日节点，不允许 LLM、常量或本地统计补造，并明确标成“MetaTFT 页面计算”；
- 原始字段和页面日节点均缺失、格式无效或不足三项时，API 返回 `trend.officialGate`，前端明确说明没有足够趋势证据；
- 门禁未打开时保存同查询口径的本地快照，完整 72 小时后可以显示明确标为“本地 72 小时”的变化，但不能把它写回官方门禁；
- 趋势查询缓存使用 `comp-trend-gate-v3` 数据版本，区分旧原始字段、MetaTFT 页面计算和本地 72 小时三种来源。

## 缓存、超时与失败处理

`comps_data` 冷请求实测可能超过原来的 2.2 秒小窗上下文超时，因此排行榜接口有独立的 8 秒默认超时，可通过 `TFT_AGENT_COMP_RANKINGS_TIMEOUT_MS` 或 `--comp-rankings-timeout-ms` 调整。`latest_cluster_info`、`comp_options` 和 `comp_builds` 的上下文请求仍使用原来的 `TFT_AGENT_COMPS_TIMEOUT_MS`，避免扩大其他热路径等待时间。

查询缓存把两份同 cluster 响应作为一个快照存储。实时刷新失败时允许使用过期快照，但 API 和 UI 必须显示 stale 状态与更新时间，不能静默切回 `exact_units_traits2` 或混用旧 cluster。

## 验证

默认单元测试使用脱敏的离线 fixture：

```text
test/fixtures/comp-rankings/metatft-comps-page-minimal.json
```

`npm run smoke:comps` 验证离线服务与 HTTP 序列化；`npm run smoke:comps:live` 才访问实时 MetaTFT，并以独立参考转换逐项比较四种指标的 cluster 顺序。实时检查只作发布证据，不加入默认 `npm test`。

趋势目标使用以下门控命令：

```text
npm run check:trend-gate
npm run verify:trend-goal
```

`verify:trend-goal` 在门槛未满足时只输出 `waiting_for_official_trend_evidence`，并明确跳过实时查询、页面验证和完整回归。门槛满足后才依次运行实时阵容查询、真实小窗页面验证、`npm test`、离线阵容 smoke 和小窗 smoke。页面验证必须实际启动 Playwright/Edge；缺少浏览器运行时会失败，不得记作通过。

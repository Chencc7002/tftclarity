# 对局字段与棋子后续查询修复（2026-08-30）

状态：已上线。发布提交 `ece5e13c1bb47c8b481088a83fe8faacaf45cd97`，Web 与 Player MCP 均已切换并通过健康检查；正式域名真实对局和聊天→阵容接口验收通过。工作区包含其他任务修改，本次未携带 Skills 实验等无关差异。

## 根因

- MetaTFT 玩家列表返回的是摘要，通常没有棋子费用/稀有度，羁绊也可能只有 ID。完整单局包含 rarity、num_units、style、tier_current。适配器曾丢弃 rarity；展示链路又把 `null` 转成数字 0，导致所有棋子看起来都是 0 费。并非所有对局都缺字段，因此有些正常。
- 后续建议通过问题文字判断“已看过装备/阵容”，漏掉“怎么带”这类装备问法，却把失败的阵容查询也记为完成。
- 阵容按钮只提交自然语言，可能再次选择 `comps_analysis`。该 handler 把解析结果的 intent 改成分析，却未重建 analysis target，造成已有候选也可能 not_found。原截图缺少原始 tool trace，不能断言当时具体选择了哪个工具；上述 handler 缺陷已用回归用例重现。

## 修复边界

- 单局页面仅在摘要缺字段时调用已注册的 `get_match` MCP 工具；沿用原有身份、赛季、URL、限流、缓存、超时边界。校验单局 ID/赛季，完成后关闭客户端，不遍历补抓整个玩家池、不修改采集新鲜度。
- rarity/cost 沿数据链路保留；未知费用显示“费用未知”，真实 0 值保留。激活羁绊仅展示已有激活证据的条目，缺失人数/激活状态单独说明。数据来源按实际 source 显示。
- 建议依据本轮工具结果及服务器已存查询结果判断展示进度；历史按访问者、会话、赛季隔离，最多 8 条、7 天。历史只用于避免重复按钮，不进入当前 Evidence，不支持新的统计结论。失败、澄清、空结果不计完成。
- 装备/阵容后续按钮使用既有 `unit-build` / `hero-comps` Quick Task，并携带棋子 ID；自然语言和 ReAct 路径保持可用。`comps_analysis` 正常重建分析目标。
- 原先测试把无证据的 direct_answer 视为已完成查询，与 Evidence 边界不一致；已改为不能宣称完成，并补成功/失败结果、跨会话隔离、完整 handler 用例。

## 验证

使用仓库 Node 24 运行标准 CI 入口：

- `scripts/run-ci-test-lane.mjs --lane=main`：1205 通过，7 跳过，0 失败。
- `scripts/run-ci-test-lane.mjs --lane=integration`：232 通过，1 跳过，0 失败。
- `scripts/run-agent-eval.mjs`：50/50。
- 本次文件 `git diff --check` 通过。

Browser 本地实际操作（真实页面/handler、隔离内存库、固定决策与样本，不等同于线上真实模型验收）：

1. `visual-fixture-server.mjs --followup-fixes --port=17362 --bridge=.cache/followup-browser-bridge.sqlite`：S17 输入“卡尔玛怎么带”，返回出装后仅推荐阵容/视频；点击“卡尔玛阵容搭配”，返回含卡尔玛的阵容，无 not_found；没有新证据时不出现误报完成的后续建议。
2. `player-pool-fixture-server.mjs --port=17363 --match-fixture=.cache/match-display-evidence.json`：使用截图对应单局核对过的 8 个棋子费用和羁绊字段，其他账号/装备/星级为隔离测试样本。完整详情显示费用 `[3,4,4,3,4,4,3,4]`、七项激活羁绊（峡谷野怪 ×4，其余六项 ×2），三项未激活羁绊不混入激活列表。
3. 同一脚本加 `--detail-unavailable --port=17364`：上游失败后保留摘要，费用/羁绊标注未知，不显示伪造 0 费或 `×?`。

核对来源为 MetaTFT 单局 `NA1_5631068140` 的公开详情及 S18 中文 catalog。完整原始响应只存本地忽略目录；未把其他参与者数据提交入仓库。

发布需同时更新 Web 和 MetaTFT Player MCP adapter；本地阶段已验证成功补全/缺失降级两条路径，生产阶段结果见下文。

## 隔离发布包复验

- 基线：`9f7cc6e52fec571b1ac9c2cee847b9e422f0b351`，保留已上线的装备解读、核心装备图标、新手引导和语音功能。
- 主回归 1135 通过 / 7 跳过；集成 232 通过 / 1 跳过；Agent 评估 50/50。数量少于开发工作区，因为未包含其他任务的实验及测试。
- 不改 Compose、Dockerfile、依赖、数据库 schema、Worker 或流量入口；只更新 Web 与 Player MCP，保留旧镜像和发布前数据库备份。
- `r1-release-readiness.md` 的 8 月 11 日域名未就绪状态已过时，本次以实际生产站点健康状态和用户明确上线授权为准。

## 生产发布与验收

- GitHub Actions `33300097130`：test-main、test-integration、bilibili-compose-runtime-gate 三项全部成功。
- 发布前备份目录：`/root/tftclarity/backups/match-followup-20260830/`。PostgreSQL dump 的 `pg_restore --list` 通过；玩家库快照 integrity_check=ok（26 玩家、984 对局），两份 SHA256 校验通过。
- PostgreSQL SHA256：`3a55acfd784743917f7385d03e54d5f99e3c2c404add72a943cc4c4bb45bf8de`；玩家库 SHA256：`959743e4c3ae78741d6c8b8911ca47c20ccb9f156af976271505bb6bc3cc58ee`。
- 旧镜像保留为 `tftclarity-match-followup-rollback-app:20260830` 和 `tftclarity-match-followup-rollback-metatft-player-mcp:20260830`，回退目标 `9f7cc6e`。未改数据库 schema、Compose、Worker 或网关，不删除历史数据。
- 先构建两个镜像，再先切 MCP、确认 healthy，后切 Web、确认 healthy。正式域名 `/api/health`、`/api/ready` 返回 200；PostgreSQL/Redis ready。
- 真实单局 `NA1_5631068140`：费用 `[3,4,4,3,4,4,3,4]`，七项已激活羁绊人数正确，source=metatft，warnings=[]。不是用本地 fixture 冒充线上单局。
- 正式站点独立测试会话“绯红树怪怎么带”：真实链路调用 entity_catalog_query、unit_builds，status=completed；仅建议“绯红树怪阵容搭配”“绯红树怪视频攻略”。继续按服务端返回的 hero-comps QuickTask 查询，得到“峡谷野怪 · 远古石甲虫”“猎人 · 希维尔”，两者均包含 DA_Cinderling18。
- 线上 Browser 能打开站点并读取原生页面 DOM，但 Playwright DOM 与点击控制多次超时，未计为线上浏览器点击通过。补充验证使用同一正式 API 和原样按钮参数；此前本地 Browser 点击验收仍有效。
- 线上报告存放于本地忽略目录 `.cache/match-followup-production-after.json`、`.cache/match-followup-production-chat-summary.json`；不提交原始会话和访问凭据。

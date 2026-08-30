# Player Pool 缺陷修复交付记录（2026-08-30）

## 目标与验收

1. **刷新获取新对局**：明确刷新从前端到上游的路径，避免只重读旧缓存；展示数据时间及失败/部分成功状态，不把旧样本伪装成最新数据。
2. **具体阵容卡片**：Pool 阵容趋势展示真实样本中的英雄/阵容信息与统计；没有完整阵容证据时明确缺失，不编造阵容。
3. **NA 职业默认池补丁**：定位 `16.14` 来源，展示由有效对局/查询范围确认的补丁；不能将硬编码、跨赛季或旧缓存当成当前补丁。

## 工作边界

- 保留已有未提交改动；本次开始时仓库已有大量赛季、UI、ReAct 与测试变更。
- 优先修复 Player Pool 的确定性 API、存储与展示路径；不增加 Agent/Skill runtime、不改权限或证据边界。
- 不删除现有玩家/对局缓存，不提交或部署未授权变更。
- 当前状态：**已上线并完成生产验收。Web 与 Player Match MCP 均运行发布提交 `8ce655b9`；默认 NA 池已从 16.14 旧样本恢复为 S18 18.1 最新样本和可追溯阵容卡片。**

## 检查点

| 工作项 | 状态 | 证据/结果 |
| --- | --- | --- |
| 交付记录与基线 | 已建立 | 已阅读 AGENTS.md、docs/player-pools.md；已记录脏工作树 |
| 刷新链路与数据时效 | 已修复并验证 | 趋势、成员、阵容详情、自定义 Pool 看板接通 POST /api/opgg/pools/:id/refresh；显式刷新触发上游更新并绕过 MCP profile 缓存，保留限流和并发合并 |
| 阵容卡片与样本字段 | 已修复并验证 | 趋势页直接展示可展开卡片，保留原统计表；代表棋盘附带真实对局引用；不完整刷新不清空同局已存棋子/羁绊 |
| NA 默认池补丁 | 已修复 | 外部对局入库复用 patchLabelFromVersion；自定义 Pool router 初始化也修复历史原始 patch；页面标记为样本补丁 |
| 定向测试 | 已通过 | 127/127，含新增 test/player-pool-refresh.test.js 的 7 项行为回归 |
| 全量主回归 | 已通过 | 1180 通过 / 7 跳过 / 0 失败，152 个文件 |
| 集成回归 | 已通过 | 232 通过 / 1 跳过 / 0 失败，16 个文件 |
| Agent 评测 | 已通过 | 50/50，通过率 100% |
| 浏览器验收 | 已通过 | 真实 renderer + router + 内存库 + 明示虚构上游；卡片展开、真实对局入口、默认池刷新、新增数量、自定义看板刷新通过 |

## 已确认根因与本地证据

- `opgg-panel.js` 的刷新按钮只处理 personal 模式，其余视图被 setResult 禁用；默认池趋势只有 GET 读本地数据库的路径。
- `my-review/refresh` 调用 list_matches，但服务原先优先读取 120 秒 profile 缓存，且没有强制刷新参数。更关键的是：原 adapter 只调用 `lookup_by_riotid`，没有触发 MetaTFT 上游刷新。
- 2026-08-30 核对 [MetaTFT 官方页面脚本](https://www.metatft.com/assets/main-BUnlqv4F.js)：页面通过 **POST refresh_by_riotid → GET 轮询 completed → GET lookup_by_riotid** 刷新。已将该流程接入现有 adapter；最多轮询 3 次，整个流程沿用 8 秒总请求预算，排队超限返回 REFRESH_PENDING，不把旧数据当作刷新成功。
- `ingestExternalPlayerMatches` 直接把上游 patch 写入 patch_label；OP.GG 自身采集则会归一化。已有映射为 Set17 客户端 16.14 → TFT 17.8；本次不改映射、更不把历史补丁换成假定当前版本。
- 只读检查本地 `.cache/opgg-pro-pool.sqlite`：NA 默认池样本最新至 2026-07-28，PBE 样本最新至 2026-08-20；该本地库已有 17.8 的归一化值，没有直接复现用户线上显示 16.14，但确认了能再次写回原始值的缺陷。不要声称本地库就是线上库。
- 趋势页原来是带缩略棋盘的统计行；自定义看板已有卡片代码。新增趋势卡片入口，不声称所有旧视图都没有渲染代码。
- MetaTFT profile 摘要可能缺字段；外部导入原先会覆盖相同对局的完整棋盘。本次保留同一玩家同一 match 已存的非空棋子/羁绊/强化数据。

## 数据与权限边界

- 新刷新接口复用 accessiblePool，不能刷新其他用户私有 Pool；只采集当前已有成员，不更改成员关系。
- list_matches/get_player_match_history 仅增加可选 boolean forceRefresh，原缓存、限流、环境赛季校验和不批量展开详情的约束不变。
- 同一玩家同时发起普通查询和手动更新时，更新不会合并进旧查询，旧响应也不能覆盖新缓存；已补充并发回归。
- 空返回、异常和强制刷新仍命中旧版 MCP 缓存时，保留旧数据且不更新 last_successful_poll_at。
- 返回每名成员成功/失败、新增 player-match 数量、采集时间和最新比赛时间；只有上游刷新完成且返回有效样本才标记成功，但不承诺所选玩家/赛季一定有更新的比赛。
- 真实上游抽查（只使用仓库公开种子名单，不更改本地玩家库）：NA 样本刷新后仍为 466 场，最新比赛 2026-07-13；PBE 从 94 场变为 96 场，最新比赛仍为 2026-08-18。说明上游刷新确已执行，但样本最新日期不一定变化，不能编造近期对局。结果见 `.cache/pool-fix-live-probe.json`。
- **上线时须同步更新并重启 Web 与 Player Match MCP 服务**，否则旧 MCP 可能忽略 forceRefresh。此处尚未部署/重启线上服务。
- Node 默认命令是 v18.20.8，验证使用仓库已有 `.cache/runtime/node-v24.18.0-win-x64/` 的 Node 24.18.0（SQLite 支持）。

## 续接入口

- 用户问题：刷新仍是旧对局、缺少具体阵容卡片、NA 职业默认池异常显示 16.14。
- 发布前核对本次文件清单，保留用户其他脏工作树改动；本次未执行 git add/commit/push。
- 发布顺序：先部署 Player Match MCP（支持 forceRefresh 与 refreshStatus），再部署 Web/UI，重启对应服务。旧版 MCP 未确认 completed 时 Web 会明确报错，不误报刷新成功。
- 发布后用用户实际 Pool 点击更新，核对成功/失败成员、新增条数、最新比赛时间、样本补丁和卡片；若上游仍没有近期比赛，核对 Riot ID、所选赛季和 MetaTFT 返回，不硬改补丁或日期。
- 回退只撤回下列本次修改，不对整个工作树执行 reset/restore；未新增数据库表/列，也未删除历史数据。回退到只读 UI 时仍可保留已归一化的 patch_label。

## 本次文件清单

- `services/metatft-player/adapter.mjs`：上游 POST 刷新、有界轮询、总超时。
- `services/metatft-player/service.mjs`、`mcp-tools.mjs`：显式刷新参数、完成证据、并发缓存保护。
- `services/opgg/api-router.mjs`：按访问权限更新当前池、复用个人更新、部分失败与新增计数。
- `services/opgg/collector.mjs`：外部补丁归一化，同局完整棋盘保护。
- `services/opgg/aggregator.mjs`：样本时间、采集时间、代表对局引用。
- `services/player-pools/api-router.mjs`：独立初始化旧 patch 修复、看板时效字段、内存数据库测试注入。
- `src/app/small-window-ui/opgg-panel.js`：刷新入口、样本标识、卡片与来源跳转。
- `test/player-pool-refresh.test.js`：新增 7 项行为回归；`test/opgg-api-router.test.js`：更新刷新完成 fixture。
- `scripts/player-pool-fixture-server.mjs`：可复现的隔离页面验收服务，不读写真实玩家库。
- `docs/player-pools.md` 与本文：产品契约与交付记录。

## 验证命令与产物

系统默认 Node 18 无法稳定运行 SQLite 回归，首轮 npm 启动还遇到沙箱 EPERM。实际使用现有 Node 24 直接运行 package.json 对应入口，未修改 npm scripts 或测试发现规则：

```powershell
.\.cache\runtime\node-v24.18.0-win-x64\node.exe --test test/player-pool-refresh.test.js test/player-pool-api.test.js test/opgg-api-router.test.js test/opgg-collector.test.js test/opgg-aggregator.test.js test/opgg-patch.test.js test/opgg-localization.test.js test/metatft-player-mcp.test.js test/metatft-player-api-router.test.js test/small-window-ui.test.js
.\.cache\runtime\node-v24.18.0-win-x64\node.exe scripts/run-ci-test-lane.mjs --lane=main --report=.cache/pool-fix-ci-main.xml
.\.cache\runtime\node-v24.18.0-win-x64\node.exe scripts/run-ci-test-lane.mjs --lane=integration --report=.cache/pool-fix-ci-integration.xml
.\.cache\runtime\node-v24.18.0-win-x64\node.exe scripts/run-agent-eval.mjs
.\.cache\runtime\node-v24.18.0-win-x64\node.exe scripts/player-pool-fixture-server.mjs
```

- main/integration 两条脚本分别对应 AGENTS.md 的 `npm run test:ci:main` / `npm run test:ci:integration`；评测对应 `npm run eval:agent`。
- 页面验收地址：`http://127.0.0.1:17339`（手动运行 fixture 后访问）。初始样本 17.8 / 07-28；点击更新后为 17.10 / 08-30，新增 1 条；重复更新新增 0 条。**这些版本和对局是明确标注的隔离测试数据，不代表线上版本。**
- 本地报告：`.cache/pool-fix-focused.log`、`.cache/pool-fix-ci-main.xml`、`.cache/pool-fix-ci-integration.xml`、`.cache/pool-fix-eval-agent.log`、`.cache/pool-fix-live-probe.json`。
- 桌面截图：`.cache/pool-fix-desktop.png`。这些缓存产物未纳入 Git，关键结果已在本文固定记录。
- 界面验证只覆盖 Pool 面板的隔离实例；未把它称为生产站点验收。其他已有脏改动包含完整 App 壳、赛季与 Agent 代码，均保留原状。

## 上线续接记录（用户已授权）

- 生产基线：`c785d7ed5bf05428a5897c910d7214cb4b347d97`。独立发布目录 `.cache/player-pool-release-20260830`，分支 `codex/player-pool-fix-20260830`，仅包含本文列举的 Pool 文件及新增 `services/player-pools/season.mjs`。
- **发布前发现并修复遗漏**：生产已在 8 月 27 日切换 S18，但 Pool API 仍写死 `set17-live`。默认池及个人账号现在从服务端 `DEFAULT_SEASON_CONTEXT_ID` 获取正式服赛季；既有明确固定赛季的自定义池保持原范围，并按 set_number 隔离统计。新正式服池走当前赛季 MetaTFT 验证；旧 OP.GG 路径保留。PBE 种子不能导入正式服池。
- 先前 NA 实测查的是 S17，不能据此推断玩家没有近期比赛。改查 S18 后同一公开种子玩家返回 78 场，最新 `2026-08-30T01:33:48.241Z`（北京时间 09:33）、补丁 18.1、7 个棋子、4 个羁绊。PBE 仍保留其 8 月 18 日历史样本，不自动转为正式服。
- 干净发布包验证：主回归 **1112 通过 / 7 跳过 / 0 失败**（144 文件）；集成 **232 通过 / 1 跳过 / 0 失败**（16 文件）；Agent 评测 **50/50**；额外赛季与 Pool 定向测试 **29/29**。与上文首次脏工作区测试数不同是因为本次发布包没有包含其他任务的未提交测试。
- 生产入口：已有 SSH 配置 `root@tftclarity.cn`，工作目录 `/root/tftclarity`。沙箱内无法读取用户 SSH 配置，需要正常权限执行；未关闭主机密钥验证。
- 生产备份已完成：`/root/tftclarity/backups/pool-fix-20260830/`，含 PostgreSQL dump（pg_restore --list 通过）、Pool SQLite 一致性快照（integrity_check=ok，26 玩家、926 对局）、旧 SHA、旧镜像 ID 和 SHA256SUMS。
- 备份 SHA256：PostgreSQL `19601bdac02f59605e911040e68a72e1ddff7d5631ae3fafdf1163a51664bcba`；Pool `1ac1c6ec56128861e8674a9ba00cf650063bb4111c26f805c626cd45fc14f4fc`。
- 回退镜像已固定为 `tftclarity-pool-rollback-app:20260830` 与 `tftclarity-pool-rollback-metatft-player-mcp:20260830`。本次不改 Compose、数据库 schema、worker 或 Agent 路径。只重建并重启 MCP 与 app，其他服务及服务器已有未跟踪文件保持原状。
- `docs/r1-release-readiness.md` 的 8 月 11 日“最终域名未就绪”等状态已过时，实际站点和 8 月 29 日上线记录确认已发布；本次以实际主机与明确上线授权为准。
- 发布提交：`8ce655b9d2d6376f32958b473281c3a1717d31ca`；GitHub Actions `33286578521` 的 main、integration、Compose/MCP 三个 job 全部通过。
- 发布顺序与结果：先重建并健康启动 `metatft-player-mcp`，再重建并健康启动 `app`。发布后 `/api/health`、`/api/ready` 均为 200，PostgreSQL/Redis 就绪，运行时补丁为 18.1；两服务最近日志没有启动错误。
- 生产验收前基线：默认 NA 池补丁 `16.14`，最新对局 `2026-07-28T12:30:23.516Z`，只有 2 个窗口样本，能精确复现用户报告。
- 生产真实刷新：请求 11 名成员，10 名成功、1 名明确失败（`FNC Darth Nub`：`MetaTFT profile refresh failed`），新增 24 个 player-match；失败没有覆盖旧数据或误报成功。
- 刷新后：补丁 `18.1`，最新对局 `2026-08-30T01:46:49.889Z`（北京时间 09:46），11 人都有数据，10 人达到 10 场窗口，窗口样本 101、唯一对局 89。`sampleIsOld=false`。
- 阵容验收：返回 20 个趋势卡片，20 个均含具体棋盘，20 个均含代表对局；代表对局 `NA1_5631234275` 的详情接口可打开。生产 `opgg-panel.js` 已包含样本补丁与代表对局渲染逻辑。
- 线上验收产物：`.cache/pool-production-before.json` 与 `.cache/pool-production-after.json`（未入 Git，关键结果已固定在本文）。隔离浏览器验收已覆盖实际卡片交互；本次生产环境受浏览器连接限制，最终用正式域名 HTTP 行为与静态脚本断言完成验证，未把它描述为生产浏览器点击验收。
- 交付完成；后续若要重试唯一失败成员，可再次点击更新，不需要回退整个池。

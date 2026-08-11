# R1 Release Readiness（唯一当前状态入口）

状态日期：2026-08-11（Asia/Shanghai）
适用范围：V2 Public Beta repository readiness 与 Final Release Image Gate 入口。

本文是 R1/V2 当前发布状态的唯一 authoritative 文档。各阶段 conclusion 和历史验收报告继续作为
证据记录，但不再单独代表“当前是否可发布”。如其他文档与本文冲突，以本文为准。

## 当前决策

| 项目 | 状态 | 边界 |
| --- | --- | --- |
| ReAct Core | **PASS** | 动态只读工具执行、进展/重复/超时保护与证据终止已落地 |
| Conversation Bridge | **PASS** | QuickTask 目的、条件和结果可进入后续会话；近期结构化记录最长保留 7 天 |
| Hero real production path | **PASS** | RA-00 来源证明与 RA-01 十英雄真实模型/真实工具矩阵通过 |
| G3 Replacement | **PASS** | 给定换人后的成员、羁绊人数与档位变化由确定性 evaluator 计算 |
| G4-A Item Contention | **PASS** | 真实构筑中的装备交集、coverage 与机制 grounding 通过 |
| G5 Constraint Re-query | **PASS** | lock/exclude 在排序前生效，约束进入 query/cache fingerprint |
| G5-O ReAct Orchestration | **PASS** | 三案例真实 production matrix 已完成产品签核 |
| G4-B Allocation Priority | **DEFERRED — NOT IN PUBLIC BETA** | Public Beta 不承诺自动判断装备必须优先给谁；不是本次 Beta blocker |
| Full R1 Composite Release | **NOT YET SIGNED** | G4-B 未纳入 Beta 不等于完整 R1 Product Functional Acceptance 已完成 |
| V2 Public Beta Repository Readiness | **PASS** | 2026-08-11 完成第二批纯仓库复核；无剩余 repository blocker |
| V2 Public Beta functional scope | **READY FOR FINAL RELEASE IMAGE GATE** | 纯仓库功能与发布材料已具备进入最终镜像验收的条件 |
| Final Release Image Gate | **BLOCKED** | 2026-08-11 本地 Docker、embedding、real LLM、Browser、XFF 与 rollback Gate 已通过；只剩最终 SHA/image 固定和真实域名 HTTPS 公网入口 |

Repository review 已批准：`ENTER FINAL RELEASE IMAGE GATE`，本地 Gate 已开始执行。在真实 Gate 完成前，不得把最终镜像门槛
或完整 R1 产品功能验收标记为通过，也不得宣称 V2 已部署或 Public Beta 已对外发布。

## Public Beta 承诺范围

本次 Beta 包含 ReAct 普通聊天、QuickTask/Conversation Bridge、真实英雄出装路径、给定阵容换人结构评估、
装备竞争检测和带 lock/exclude 的条件重查。模型结论继续受工具 Evidence 和可见降级约束。

G4-B evidence-driven allocation priority 明确延期。产品可以报告某些成员实际共享装备，但不会在缺乏
可验证反事实分配证据时声称“必须优先给某棋子”。该延期不阻塞 Public Beta，也不能被描述为已经实现。

## 证据索引

- ReAct/Bridge 架构：[react-chat-r1-architecture.md](react-chat-r1-architecture.md)
- 真实英雄路径与历史 RA 记录：[r1-acceptance-report.md](r1-acceptance-report.md)
- G3：[r1-g3-real-acceptance-conclusion.md](r1-g3-real-acceptance-conclusion.md)
- G4-A：[r1-g4a-real-acceptance-conclusion.md](r1-g4a-real-acceptance-conclusion.md)
- G5 与 G5-O：[r1-g5-real-acceptance-conclusion.md](r1-g5-real-acceptance-conclusion.md)
- V2 运维入口：[deploy-v2.md](deploy-v2.md)

旧 [r1-acceptance-report.md](r1-acceptance-report.md) 中的 `RA-02 through RA-05 pending` 是当时按旧 RA
编号记录的历史结论，现已由后续 G3、G4-A、G5 和 G5-O 真实验收取代。它不再是当前 release status，
也不能与本文并列作为第二份就绪结论。

## Final Release Image Gate 最小矩阵

以下项目全部产生可追溯证据后，才可把 Gate 改为 PASS：

1. 最终 Git SHA、app/worker/migrate/Bilibili MCP image digest 固定并记录；工作区无真实 secret。
2. `docker compose config` 与最终 image build 成功；PostgreSQL、Redis、app、worker、MCP、Caddy 拓扑一致。
3. forward migration、`db:status`、PostgreSQL/Redis smoke 和 `/api/ready` 通过；production 无 memory fallback。
4. 与当前 patch/locale 匹配的语义索引发布物已安装并通过 audit，或明确记录允许的 TF-IDF 降级。
5. `/api/runtime` 显示 real model、预期 production model、`fixture=false`、ReAct on、Bridge on。
6. 公网 HTTPS、安全响应头、真实 `X-Forwarded-For`/客户端 IP 限流、匿名额度与管理入口保护通过。
7. Browser production-like matrix 覆盖中英文、AI 声明、英雄真实路径、Bridge 跟进、G3、G4-A、G5、
   system evidence fallback、MCP 正常/故障/恢复；浏览器无 unexpected console error。
8. 更新前 PostgreSQL `pg_dump` 可验证，并在隔离环境完成一次 `pg_restore` 演练。
9. 旧 image/SHA、数据库兼容判断、语义索引和回滚负责人已记录；完成一次回滚演练。
10. 记录基础日志、CPU、内存、Redis 队列/内存、PostgreSQL 连接和 LLM 成本/额度观察窗口。

执行步骤以 [V2 部署、恢复与回滚手册](deploy-v2.md) 为准。

## Repository 验证记录

2026-08-11 当前候选：

- release-config 文档/配置合同：7 pass，0 fail；相关 access/Bridge/MCP 聚焦组合：33 pass，0 fail。
- `npm run test:ci:main`：980 pass，13 skip，0 fail（embedding 与命名空间缓存兼容改动后完整重跑）。
- `npm run test:ci:integration`：224 pass，1 skip，0 fail。
- integration 首次并行于 main lane 运行时，一个旧的 10 秒边界用例超时；该文件单独复跑 14/14
  通过，随后完整 integration lane 重跑为上述 0 fail。该时序抖动保留在记录中，不冒充从未发生。
- 本地 Browser：中英文 AI 声明和 Privacy 可见，console error 0。
- Docker Desktop 29.6.2 / Compose 5.3.1 已在本机找到并启动；此前“当前机器没有 Docker”的判断已撤回。
- 原始 `npm test` 会误收集 `.cache/bilibili-mcp-js/test*`；正式 release contract 以两个 CI lane 为准，
  该 test discovery hygiene 问题不阻塞本批 repository readiness。

本节与 2026-08-11 repository review 证明仓库就绪，不是生产发布签字。Gate 结果必须追加最终 SHA/image、执行环境、
命令结果、Browser 证据、备份/恢复与回滚证据；失败或未执行项目不得写成 PASS。

## 2026-08-11 本地 Final Release Image Gate 记录

### 已通过

- `docker compose config --quiet`：PASS。
- 无缓存构建 `app`、`worker`、`migrate`、`bilibili-mcp`：PASS。
- PostgreSQL forward migration `003_comp_profile_beginner_friendly_boolean`：applied；001～003 checksum/status 全部正常。
- 新镜像运行状态：app healthy、worker running、PostgreSQL/Redis/Bilibili MCP healthy、migrate exit 0。
- `/api/health`、`/api/ready`、PostgreSQL smoke、Redis smoke：PASS；production storage 为 PostgreSQL + Redis，memory fallback false。
- Bilibili MCP 真实搜索与详情：PASS；sidecar 无宿主机端口且只加入专用网络。
- MCP 停机时 app readiness 仍返回 200；恢复后真实 MCP smoke 再次 PASS。
- pre-gate PostgreSQL custom dump 已生成并通过 list 校验；在隔离临时数据库完成真实 `pg_restore`，验证后临时库已删除。
- Caddyfile 在无网络、无端口的一次性 Caddy 容器中验证为有效配置。
- Bilibili MCP 最终 runtime 锁定依赖 `npm audit --omit=dev`：0 vulnerabilities。上游 build stage 的依赖告警不进入最终多阶段 runtime。
- 本地 embedding：`ollama/ollama:0.32.5` + `bge-m3` 已在仅内部 `backend` 网络启动，无宿主机端口绑定；真实 OpenAI-compatible embeddings 请求返回 1024 维向量。
- 正式服本地目录快照已按 `season:set17-live|current` 读取并规范化为实际补丁 `17.8`；主索引 656 条，`bge-m3` 1024 维，`semantic:audit` 为 `healthy=true`、`issues=[]`、`missing_embedding=0`。
- 应用重启后 `/api/runtime` 显示 semantic index enabled/persistent、model=`bge-m3`、endpoint configured；真实“剑圣 易大师 技能”检索以前两名召回 `TFT17_MasterYi`，retrieval mode 为 `embedding`。
- real LLM 已通过仅存在于本机、被 Git 忽略的配置接入；`/api/runtime` 显示
  `decisionProviderMode=real_model`、model=`deepseek-v4-flash`、`fixtureMode=false`。真实 `smoke:llm`
  返回正确结构化 intent、unit 和 item。
- DeepSeek V4 结构化 JSON 请求显式使用 non-thinking 模式，避免默认 thinking 只返回
  `reasoning_content` 而缺少 `content`；相关聚焦测试 21 pass，0 fail。
- 真实 ReAct live matrix：4/4 PASS；16 次模型请求，12 次首轮成功、4 次协议级重试、0 次请求失败；
  direct answer、实体目录、四/五工具链与阵容成员统计均 completed。目录预热遇到 MetaTFT items 2.2 秒
  超时后使用当日持久化目录，矩阵仍全量通过。
- 本机 loopback Browser 实测真实模型 UI：中文 AI 风险披露可见；暗星详情查询 9 秒完成并显示
  “AI 生成/真实工具证据”；后续“那暗星里四费棋子是谁？”正确继承上下文并回答卡尔玛。
- 仓库正式 `deploy/Caddyfile` 在仅绑定 `127.0.0.1` 的隔离入口返回 HSTS、CSP、
  `X-Content-Type-Options`、Referrer/Permissions Policy，且移除 `Server` 响应头。
- XFF/IP 限流实测：同一代理来源前 30 个请求为 200，第 31 个开始为 429；随后更换伪造的
  `X-Forwarded-For` 仍为 429，客户端不能借伪造头绕过 Caddy 后的 IP 限流。
- 旧 commit `1d5cd823e1320bdd1e98d29e63dd52335d04ac74` 已在 detached worktree 重新构建为
  `tftagent-app:rollback-1d5`，并在独立 loopback 端口启动；`/api/ready=200`，同一持久化
  semantic index 仍 enabled、model=`bge-m3`。演练容器和临时 worktree 已清理，旧镜像标签保留。

### 当前 blocker

1. 当前新增修复仍需形成最终 release SHA，并从该 clean SHA 重建 app/worker/migrate 镜像、记录 digest。
2. 本机 production 配置的 `DOMAIN=localhost`，当前 Browser 与 Caddy 验收均为 loopback；尚无真实公网域名、
   可信 TLS 证书和外部 HTTPS 访问证据。正式公网 Caddy 未启动，因此不能把 loopback Gate 描述为已对外发布。

在上述 blocker 消除并重跑最小矩阵前，Final Release Image Gate 保持 **BLOCKED**，不得对外发布。

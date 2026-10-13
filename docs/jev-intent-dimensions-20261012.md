# Jev 独立意图维度实现记录

实现日期：2026-10-12；收尾记录：2026-10-13（北京时间）。

状态（2026-10-13 23:35 北京时间）：新版本已部署，5%/25 次 shadow 已启用，旧 control 保留。新 control 尚未启用；本地真实模型对照因 HTTP 451 中止，不能报告准确率提升。

## 基线与范围

基于本次核实的线上提交 `5ab8ff2cbc47965e414e0e72e555d6864d0b2195`，在 `codex/jev-intent-dimensions` 独立 worktree `.cache/jev-intent-dimensions-20261012` 实现。主工作区有大量无关修改，其中 Jev 代码也落后于线上，因此不以主目录旧代码作为本次实现基线。

旧版线上已经是 intent-hint control：Jev 提示意图，ReAct LLM 选择注册工具并生成参数。覆盖率低不等于工具执行交给了 Jev，也不等于已经测出 Jev 准确率低。此次修改上下文投影与提示采纳策略，不新增运行时。

## 行为与边界

- action、domain、context 独立判断，仍使用 `min(confidence, selected probability) >= 0.70`，不降低门槛。
- 可靠 action 不再因 context 不确定或缺参数而整体丢弃。参数仍由 LLM 结合原问题和可信状态解决。
- 明确 TFT 字样、当前 catalog 实体或现有服务端 Conversation Bridge 关系可提供领域依据；明确域外输入优先。“最新”“数据”等泛词不能单独覆盖模型领域判断。
- action 不可靠时可以仅提供领域/上下文提示，action 为 null；不能把这类提示计入 action 覆盖率。
- `jev-intent-dimensions.v2` / `intent_hint_only` 进入原 decision provider。LLM 可纠正提示；工具 schema、服务端参数、Evidence、权限、预算、审批和确定性 `nextActionAffordance` 均不改变。Quick Task 保留确定性原路径。

分类在原有 Bridge 加载后进行，复用用户作用域、会话和赛季检查，不另建状态存储。只投影历史操作映射的 action、受限类型/API ID、澄清候选和关系，每组最多 6 个实体；catalog 仅使用已加载数据，不新增网络或事实查询。

最近最多 3 条用户输入作为不可信历史，各限 700 字；JSON 控制在适配器 6000 字符限制内。助手回答、工具结果、历史 Evidence、客户端 taskAnchor/summary 不作为权威元数据。startNewTask 清空继承，多个候选不自动解析为单一指代。catalog 名称命中仅供理解，不授权事实或执行参数。

当前 Bridge 主要覆盖 Quick Task 已完成记录及 ReAct 实体澄清。普通 ReAct 成功回答没有因此新增持久化的上一轮 action/实体；仍依赖有限用户历史和现有 ReAct 上下文。本次不能宣称全部多轮歧义已解决。

## 开关、预算与回滚

示例文件默认关闭；生产于下述发布中仅将新策略 mode 改为 shadow：

```dotenv
TFT_AGENT_JEV_INTENT_DIMENSIONS_MODE=off
TFT_AGENT_JEV_INTENT_DIMENSIONS_SAMPLE_RATE=0.05
TFT_AGENT_JEV_INTENT_DIMENSIONS_MAX_REQUESTS=25
```

`off` 保留原路径。`shadow` 在采样内增加一次独立 Jev 调用，不等待结果，不将新提示注入在线决策。上限按 runtime 生命周期计算，重启重置，并非日预算；并发上限 4，复用既有 key、timeout 和 confidence，无自动重试。

未来 `control` 启用时，新分类替代旧 Jev 分类，每个采样请求只调用一次 Jev；未采样、超时、达到上限、无效响应或无合格提示直接进入原 LLM，不再调用旧 Jev。默认 5%/25 上限不等于全量启用。回滚为 `off` 恢复原版配置路径。

`node scripts/check-jev-readiness.mjs` 同时检查两套配置，零网络调用。通过仅代表配置有效，不代表服务可达或质量达标。

## 指标解释

日志前缀为 `[jev-intent-dimensions]`、`[jev-intent-dimensions-outcome]`；运行指标位于 `/api/runtime` 的 `routing.jevIntentDimensions`。

分别统计 action/domain/context 合格数。`controlApplied` 表示任一维度已注入，`actionHintApplied` 才表示 action 已注入。合格或注入不代表 LLM 接受，也不代表答案正确。结果记录 `hintAcceptance=not_measured`，不能从工具名反推 LLM 是否接受意图。

日志不输出实体 ID、用户原文、工具参数、Evidence 正文或凭据。shadow 与同请求结果关联不构成新策略的实际执行效果或准确率。

## 验证记录

使用 Node 24.18.0，采用仓库 CI lanes，未使用可能发现缓存测试的无差别 `npm test`。

| 验证 | 结果 | 本 worktree 内报告 |
| --- | --- | --- |
| Jev/TaskFrame/phase5/phase66/ReAct/conversation 聚焦 | 304 通过 | `.cache/jev-v2-focused.xml` |
| `test:ci:main` | 1661 通过，0 失败，7 跳过 | `.cache/jev-v2-main.xml` |
| `test:ci:integration` | 238 通过，0 失败，1 跳过 | `.cache/jev-v2-integration.xml` |
| `eval:agent` | 50/50 | `.cache/eval/agent-eval.json` |

相同生产提交的干净基线 main 为 1650 通过、0 失败、7 跳过，报告在相邻 `.cache/video-recall-release-20261009/.cache/jev-v2-clean-baseline-main.xml`。首次受限沙箱运行遇到 localhost EACCES；允许测试监听后正式回归通过。

新增测试覆盖独立维度、缺参数、切域/重置、单实体与多候选、catalog、客户端伪造摘要、长度/脱敏/预算、慢 shadow 不改变在线输入、control 只调用一次且允许 LLM 独立结束、SQLite Bridge 会话隔离，以及两种消息布局保持工具 schema。这些测试验证接入与边界，不衡量真实意图准确率。

## 三方开发对照及阻碍

`eval/jev-dimensions-cases.json` 是 12 条开发者编写合成案例，非独立留出集或人工复核生产样本。

```powershell
node scripts/eval-jev-dimensions.mjs
# 显式提供现有环境变量后才开启付费调用：
node scripts/eval-jev-dimensions.mjs --live
```

默认 dry-run 零网络。live 比较旧 Jev、新 Jev，以及接收相同增强上下文的现有 LLM 语义组件，不是完整 ReAct 对照。每臂一次、统一 15 秒诊断期限、无重试，最多 24 次 Jev + 12 次 LLM；生产 Jev 默认期限仍为 1.5 秒。出现服务/契约失败时完成当前三方组即停止。

2026-10-12 首组 LLM 正常，两个 Jev 臂均 HTTP error，批次停止。另一次有限诊断确认 HTTP 451；未输出响应正文或凭据，未尝试改路由规避限制。共 1 次 LLM、3 次 Jev（含诊断）。不能仅凭状态码归因于余额、地区或账号。

原报告 `.cache/eval/jev-dimensions-live-1791807057425.json` 保留当时输出；旧脚本仅记 http_error，现已补充后续报告的 httpStatus/validationFailure 和领域门源文件 hash。报告标记 humanReview pending、releaseReady false。没有有效 Jev 成对样本，不能计算准确率、覆盖率增益或成本节省。

下一步需查清本地 HTTP 451 原因或确认官方支持的访问条件。取得有效三方数据后，需独立复核真实多轮样本，比较 action 质量、action 覆盖率、错误提示、回答正确性和总延迟，再进入有上限的线上 shadow；达标后才考虑新 control。

### 2026-10-13 原线上路径复查

北京时间 23:18 只读检查：线上仍为 `5ab8ff2`，app healthy，原 Jev control、sampleRate=1、进程上限 100、阈值 0.70。最近 72 小时 Jev 日志有 38 条 observed，无 unavailable/HTTP error；最近一次成功为北京时间 2026-10-13 11:53:54，186ms。关联 ReAct 结果为 completed 14、clarification_required 12、completed_with_warning 8、failed 4；这些状态不能当作分类准确率。

因此，已证实的 451 发生在本地对照环境，不能表述为整个 Jev 服务或线上旧路径不可用。日志也不保证此刻新请求必然成功。本次没有额外线上模型调用、改动部署或读取用户内容。具体原因尚未确认。

## 2026-10-13 生产 shadow 发布

用户授权上线新策略后，按 shadow-first 约束发布，保持阈值 0.70；没有启用新 control。

- 应用提交：`19851d0da568f726148f822c84d82faf443b6c18`，基于原线上 `5ab8ff2`，通过 git bundle 传输，不含主工作区无关修改或凭据。
- 生产备份：`/root/tftclarity/backups/jev-dimensions-20261013-19851d0`；包含原配置、基线及 PostgreSQL custom dump。dump 3,856,082 bytes，SHA-256 `c55ff98fec685c748f9a67badd3021315d1fc73d2c4a91ec3a4502651196a6f7`，`pg_restore --list` 通过。
- 回滚镜像：`tftclarity-app:pre-jev-dimensions-20261013`；原镜像 `sha256:eed486acdd678ffb5aa53bc944e6b5af5d5f7fd63993f400071c88861eb4bac8`。
- 新镜像：`tftclarity-app:jev-dimensions-19851d0`，运行镜像 `sha256:9fb873620a0c98ed56168e520e4a3201fca5878abed60c30343f1cd3e366a680`。
- 原 Jev 仍为 control/sampleRate=1/maxRequests=100；新策略为 shadow/sampleRate=0.05/maxRequests=25；共用阈值 0.70。不修改工具执行、充值设置或数据库 schema。
- 候选在 network=none 下通过零调用配置预检；只对 app 执行 `compose up --no-deps --no-build --wait`，未重建数据库/worker。
- 23:34:58 公网 `/`、`/api/health`、`/api/ready`、`/api/runtime` 均 HTTP 200；app healthy、RestartCount=0，启动日志 error/fatal 计数 0。runtime 确认上述两套策略配置，新旧 attempted 均为 0，因此尚无发布后效果样本。
- 首次 bundle fetch 使用了不存在的分支引用，失败于检出前；改为 bundle 实际 HEAD 引用后构建成功。未因此切换或中断运行中的服务。

只撤回新策略时将 `.env.jev.production` 中 `TFT_AGENT_JEV_INTENT_DIMENSIONS_MODE=off`，仅 recreate app。完整回滚可恢复备份中的 `.env.jev.production`，将旧镜像重新标记 `tftclarity-app:latest`，检出 `5ab8ff2`，再执行 `docker compose up -d --no-deps --no-build --wait app`。切换后的健康检查失败处理已在本次部署脚本中配置，但此次未触发回滚。

本次上线证明构建、配置和健康正常，不证明意图质量提升。没有为了获得 shadow 命中而发送大量合成请求，也没有通过改变访问路径重跑受 HTTP 451 阻断的本地测试。

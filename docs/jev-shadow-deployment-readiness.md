# Jev 旁路部署准备 — 2026-09-29

## 决策与当前状态

候选范围为 **live-source ReAct 自由对话的限量旁路观测**，不替换意图解析、实体理解或工具选择。代码、配置预检和本地容器验证已经完成，生产环境未修改、未部署。不得将本记录当作已上线证明。

原有 Quick Task 确定性路径不接入 Jev；本地数据来源不接入。Jev 的 API 调用仍是可选理解服务，不是事实检索器，不新增工具或 runtime。调用取消、失败、超时和限额均不改变主回答。

## 同题对比证据

`scripts/compare-jev-intent.mjs` 复用 `resolveSmallWindowStructuredParserConfig` 和 `createChatSemanticTaskProvider`，读取本地现有 `.env` 配置，本轮实际模型为 `deepseek-v4-flash`。比较同一输入的确定性 `parseSemanticTask`、带真实 LLM 的 `parseSemanticTask`、真实 Jev 分类；未自行重写旧模型的提示词。

范围为开发集中的 10 条单轮、自包含合成请求；没有实体 catalog、服务端会话状态、工具执行或 ReAct 全链路。两侧请求超时均设 1500ms，旧 provider 的无效输出重试显式设为 0，以限定费用。这与线上可能启用的重试不同，不能代表生产整体成功率。

首轮原始报告：`.cache/eval/jev-comparison-1790684464944.json`。

| 分支 | 动作（有标签时）与领域同时匹配 | 解析失败 | 平均耗时 |
| --- | --- | --- | --- |
| 旧确定性解析 | 7/10 | 0 | 约 1ms |
| 旧 LLM 解析组件 | 7/10 | 3 | 1057ms |
| Jev | 10/10 | 0 | 412ms |

确定性分支的区别是：装备区别问题识别为 explain（标签 compare）；概括笔记识别为 analyze（标签 summarize）；领域外注入文本未正确归域。它在已支持的稳定查询上仍是零网络、明显更快，不能用 Jev 全面替换。

旧 LLM 的 3 个未通过样本是 zh-build、zh-compare、zh-rank，均为组件解析失败，**不是已确认的模型分类错误**。首轮缺少错误细分，因此新增了脱敏错误码。仅针对 zh-build 复查后确认 parser_budget：1228 输入 token 超过解析器 1200 上限，不能归因于旧模型理解能力差。另两个首次失败未重新诊断，保持未知。没有为了让某一侧胜出放宽生产预算。

复查报告 `.cache/eval/jev-comparison-1790684502535.json` 中，Jev 也出现 1516ms 返回的 timeout（定时器调度会略超过 1500ms）。必须保留这次失败，不能只引用首轮 10/10。之前多轮比较的领域误判、一次响应契约失败仍未解决。当前只观察到小样本、组件层面延迟较低和部分分类潜力；**未证明生产准确率、端到端延迟或费用优势**。

本轮配对与诊断共调用 Jev 11 次、旧 LLM 至多 11 次，仅合成输入。脚本默认 dry-run 零调用；`--live` 才运行，`--case=zh-build` 可单例诊断。输出带时间戳，保留旧报告和 dataset SHA-256。失败时只保存固定错误码，不保存 provider 错误正文。匹配按人工预期标签判断，不是两个模型互相背书。费用统计仅有 provider token 使用情况，没有按实时单价计算。

## 新增部署措施

- `diagnoseJevIntentResponse` 给出固定字段类别、概率和、choice 不为最大值、invalid_json 等错误码。继续严格拒绝无效响应，不通过放宽校验隐藏失败，也不输出原始错误文本。
- `TFT_AGENT_JEV_INTENT_SAMPLE_RATE` 支持 0–1；默认 1，必须在小流量配置中显式设为 0.05。
- `TFT_AGENT_JEV_INTENT_MAX_REQUESTS` 支持 0–10000，默认 100。计数在发起异步调用之前预留，避免并发绕过；达到限额跳过，最多 4 个在途。**此限额按 runtime 生命周期计算，重启或增加副本会重新计数，不是账户扣款上限。**
- runtime 默认将脱敏事件以 `[jev-intent-shadow]` 前缀写到 stdout；可用 `onJevIntentObservation` 替换接收器。只含分类、用量、耗时、状态、错误码和进程内 observationId，不含原问题、历史文本、key。跨副本需要日志系统自己的实例标识。回调抛错或 Promise 拒绝被隔离。
- `scripts/check-jev-readiness.mjs` 不请求 API、不自动读取 env 文件，检查进程配置范围、key 是否存在、shadow 是否实际有采样和额度。off 模式 ready=true 只表示配置合法，不代表已开启；脚本也不验证 key 的远端有效性。

## 发布配置与操作步骤

先在干净的候选版本中收敛本次变更。当前工作目录存在大量无关修改，不能直接整目录发布。涉及新增 `src/understanding/jev-intent-*`、相关测试与三个评测/预检脚本；现有 server 仅需要 import、runtime 创建旁路、自由对话调用三个集成位置，外加 `.env.example` 和评测文档。本地 `.env.jev.local` 被 Git 忽略，不进入提交。

现有 Dockerfile 使用 Node 24 并复制 src/scripts；compose 的 app 从 `.env.production` 注入配置；`.dockerignore` 排除 `.env.*`。不需要把 key 烘焙进镜像或修改 compose 服务结构。

后续部署准备将 Jev 凭据拆到 `.env.jev.production`，该文件只由 app 服务加载；worker、migrate、数据库和其他 sidecar 不获得 TypeSafe key。文件可选，因此默认 off 的现有部署不会因为缺少它而无法解析 Compose。模板为 `.env.jev.production.example`，实际文件继续由 `.gitignore` 和 `.dockerignore` 排除。

先以 off 配置构建并验证候选镜像，确认 `/api/ready` 与现有 Quick Task/自由对话 smoke 正常。验证通过后，单个 web 实例采用以下旁路配置，key 通过服务端秘密环境注入：

```dotenv
TFT_AGENT_JEV_INTENT_MODE=shadow
TFT_AGENT_JEV_INTENT_TIMEOUT_MS=1500
TFT_AGENT_JEV_INTENT_SAMPLE_RATE=0.05
TFT_AGENT_JEV_INTENT_MAX_REQUESTS=100
```

候选环境启动前执行：

```sh
node --env-file=.env.production scripts/check-jev-readiness.mjs
```

容器由 compose 注入环境时不加 `--env-file`。预检不会打印 key。启动后收集带前缀的日志，区分 observed、timeout、unavailable 和 skipped；检查 validationFailure、domain/context 拒绝比例、token、耗时及主流程异常。此轮达到 100 次上限后停止采集并审查，不自动重启来扩大量级。采样事件无法直接提供与线上原分类器的配对准确率，仍需要后续受控标注。

出现主流程异常、持续 provider 错误或不符合范围的数据投影时，设 `TFT_AGENT_JEV_INTENT_MODE=off` 并重建/重启对应 web 容器。无需迁移数据库。重启后预检应报告 mode=off，新的正常请求不应产生 Jev 调用日志；原有回答和工具行为应通过 smoke。账户自动充值保持关闭。

## 验证与仍需完成的步骤

本轮 Jev 契约/观测测试 13/13，新增预检子进程测试 1/1；相关 Agent 测试 273/273。main 1715 通过、7 既有失败、7 跳过（该轮运行时尚未加入单独的预检测试，后者已另跑通过）；integration 238 通过、1 跳过；agent eval 50/50。main 失败名称集合与开发前基线一致。报告位于 `.cache/eval/jev-readiness-*`。

本地隔离候选和容器 smoke 已在后续记录完成。发布前仍需：选择实际生产部署基线、干净移植改动、目标环境 smoke 和日志留存验证。接管前还需：独立中文/多轮验收集、真实旧理解流程的配对数据、预算失败分离、置信度校准、成本和端到端延迟分析。本次只为旁路部署做准备，不宣称已满足接管条件。

## Docker Desktop 本地验证进展

已找到 `%LOCALAPPDATA%/Programs/DockerDesktop/resources/bin/docker.exe`，客户端版本 29.6.2，context 为 desktop-linux。之前“没有 Docker”的判断不准确，实际是用户目录安装且不在 PATH。启动前引擎管道不存在；启动 Desktop 后出现本地服务错误，而不是应用镜像错误。

初始错误为 `%LOCALAPPDATA%/Docker/run/dockerInference` 无法访问。停止本次启动的 Desktop/backend 后，保留 run 目录为 `run.jev-backup-20260929`；后续启动过程另产生 `run.jev-backup-20260929-2`。没有删除这些备份、镜像、容器或卷，也没有 factory reset。

绕过初始错误后，Desktop 在 Secrets Engine 初始化时失败：`%LOCALAPPDATA%/docker-secrets-engine/engine.sock` 返回 Windows 错误 1920（系统无法访问此文件）。只针对该 socket 的重命名和只读 reparsepoint 检查都失败；未移动秘密存储目录、未读取秘密内容、未改权限。引擎仍未就绪，镜像构建和容器 smoke 尚未执行。需要先修复 Desktop 自身的启动问题。

独立于引擎准备了 `.cache/jev-docker-candidate-3993249/`：从 Git HEAD 3993249 导出，只增加 6 个 Jev 文件及 3 个 server 接入位置，并生成文件 SHA-256 清单 `jev-candidate-manifest.json`。该目录的 Jev 测试 14/14 通过。发现测试原先硬编码 set18-live，而 HEAD 使用不同默认赛季，已将测试改为引用 DEFAULT_SEASON_CONTEXT_ID；当前工作区相关测试也通过。

该隔离目录用于验证 Jev 能否独立集成，**不是可以直接覆盖生产的发布包**：HEAD 与当前工作区的赛季和其他功能存在差异。生产候选必须选择已确认的实际部署基线再移植 Jev，不能为获得干净工作树而回退其他功能。当前工作区原有修改保留，未提交或发布。

## Docker 修复续记：等待 Windows 重启

用户明确要求继续修复后，重新核实 `%LOCALAPPDATA%/docker-secrets-engine` 仅有一个 0 字节 `engine.sock`，没有其他文件；Docker 已停止。将整个目录改名为 `docker-secrets-engine.jev-backup-20260929`，并将新产生的 run 目录保留为 `run.jev-backup-20260929-3`，随后启动 Desktop。旧备份仍保留，未删除 Docker 镜像、容器或卷。问题与 [Docker 官方仓库故障记录](https://github.com/docker/desktop-feedback/issues/554) 一致。

本次已越过 Inference/Secrets Engine 套接字初始化，日志出现新的明确原因：`Virtual Machine Platform not enabled` / `No virtualization available`。CPU 查询确认 BIOS virtualization=true；Windows 管理员脚本确认 VirtualMachinePlatform 原状态 Disabled。

已通过 Windows 管理员权限执行 `Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All -NoRestart`，结果为 ok=true、after=EnablePending、restartNeeded=true。结果保存于 `.cache/jev-docker-windows-feature-result.json`；执行脚本为 `.cache/jev-enable-docker-platform.ps1`。没有自动重启，也没有更改 BIOS、关闭安全功能或重新安装 WSL 发行版。

该阶段需要用户保存工作并重启电脑；此操作已经在后续步骤完成。组件与重启要求参见 [微软 WSL 安装说明](https://learn.microsoft.com/en-us/windows/wsl/install-manual)。

### 2026-10-04 复查

Docker CLI 仍报告 desktop-linux 引擎管道不存在。Windows 查询得到 VirtualMachinePlatform InstallState=1，但 HypervisorPresent=false，LastBootUpTime 仍为 2026-09-16 05:25:10。结合之前 EnablePending/restartNeeded=true 的安装结果，仍需完整重启后验证；本次未重启机器、未重复安装组件或启动构建。隔离候选目录和清单仍在，仓库 HEAD 仍为 3993249。

用户反馈已重启，故不能仅凭 LastBootUpTime 断言用户未重启。随后管理员级 Get-WindowsOptionalFeature 实测 VirtualMachinePlatform=EnablePending、Microsoft-Windows-Subsystem-Linux=Disabled；BCD 未见显式 hypervisorlaunchtype=Off，BIOS virtualization=true，HypervisorPresent=false。CIM 的 InstallState=1 不足以判定组件已经完成启用。诊断保存在 `.cache/jev-docker-current-diagnosis.json`。再次启动 Docker 时 dockerInference 错误 1920 复现。用户报告的重启为何未完成组件启用尚不明确；没有修改 BCD 或触发机器重启。

### 2026-10-04 重启后恢复与容器验证

获得用户明确授权后执行 `shutdown.exe /r /t 0`。重启后的 LastBootUpTime 为 2026-10-04 02:05:06 +08:00，HypervisorPresent=true，VirtualMachinePlatform InstallState=1。Docker Desktop 启动时仍遇到一次旧 `dockerInference` 套接字；停止失败进程并将只含空 socket 的 run 目录改名备份后，Docker Linux 引擎恢复，Server 版本 29.6.2。没有删除镜像、容器、卷或 factory reset。

第一次使用 `--pull` 构建时，Docker Hub token 请求网络超时；本机已有完全匹配的 `node:24-bookworm-slim` 镜像，随后使用 `--pull=false` 完成离线构建。候选镜像：

```text
tag: tftagent:jev-shadow-candidate-3993249
image id: sha256:de3ecf5f90b8226c2c562815262d7fa682d501d14c71496568c8f36c8e4e7e5a
size: 110965231 bytes
base candidate commit: 3993249e3882af9d6aa6bcbeb141b6fb04e37e5a
```

容器验证结果：

- off 配置预检通过：ready=true、calls=0。
- shadow 配置预检通过：keyPresent=true、sampleRate=0.05、maxRequests=100、calls=0。
- 容器内向 Jev 发送 1 条固定合成 TFT 查询，返回 observed，模型 `jev-1.13.0`，action=search、domain=tft、context=self_contained，耗时 853ms，input/output tokens=810/166；输出没有 key 或原始输入。
- off 与 shadow 两种配置均能启动应用，localhost `/api/ready` 返回 `{ok:true, storage:{ok:true, mode:"legacy"}}`。第一次服务 smoke 未显式关闭 production 默认 public mode，因缺少 visitor secret 正确失败；加 `TFT_AGENT_PUBLIC_MODE=false` 后通过。这是测试配置问题，与 Jev 无关。
- 镜像顶层没有 `.env*` 文件；镜像 history 未发现 TYPESAFE、JEV、secret 或 api-key 相关构建记录。密钥仅通过运行时 `--env-file` 注入。
- 临时 smoke 容器已删除，候选镜像保留。Docker Desktop 继续运行。

镜像构建中的 `npm ci --omit=dev` 报告 4 个现有依赖漏洞（3 moderate、1 high）。本次没有运行 `npm audit fix` 或升级依赖，避免把依赖变更混入 Jev 部署准备；正式发布前应在独立任务中确认这些漏洞是否影响生产路径。

本地容器验证已经通过。仍未完成的是：选择实际生产部署基线、将 Jev 小改动干净移植到该基线、目标环境构建/发布，以及 5%/100 次旁路日志审查。隔离候选基于较早 HEAD，只能证明集成和镜像可运行，不能直接替代包含当前其他功能的生产镜像。

### 2026-10-04 远端 main 生产候选

只读获取远端后确认 `origin/HEAD` 指向 `main`，生产主线 SHA 为 `5bad83486bb81209ce1156045bb3fa12f1f0a72e`。本地 `codex/chatbot` HEAD 为 3993249，和 main 自该点分叉，不能继续把旧 HEAD 镜像当生产候选。已从 `origin/main` 归档生成 `.cache/jev-release-main-5bad834/`，只移植 Jev source、测试、脚本、文档和三个 server 接入位置。

生产配置新增 `.env.jev.production.example`。实际 `.env.jev.production` 被 Git/Docker 忽略，只由 Compose app 服务可选加载；本地配置解析验证 appHasTypeSafeKey=true，worker/migrate/postgres=false，mode=shadow、sampleRate=0.05、maxRequests=100。现有 off 部署不提供该文件时仍可正常解析 Compose。

候选回归：

- Jev 专项与部署配置合同 16/16。
- Agent eval 50/50。
- integration 在沙箱外 238 通过、1 跳过、0 失败。第一次沙箱内运行有 5 个 localhost EACCES，已保留报告，属于执行环境限制。
- main 在沙箱外 1599 通过、2 失败、7 跳过。两个失败均为冻结 unit-play preflight 的 `defaultMessagesHash`；在完全干净、未含 Jev 的 `origin/main@5bad834` 上单独重跑同样 2 个失败，属于远端 main 基线，不是 Jev 新增回归。第一次沙箱内运行另有 localhost、临时文件、DNS 限制，不能作为产品失败。

基于 main 的镜像：

```text
tag: tftagent:jev-shadow-main-5bad834
image id: sha256:419f7326053c313f94c05b53dc125671df2c59dd398de2ce18ef0ecdec3bf10f
size: 112324427 bytes
```

该镜像的 shadow 预检通过；容器内固定合成请求返回 observed、`jev-1.13.0`、action=explain、domain=tft、context=self_contained，耗时 770ms、tokens=808/167。镜像无顶层 `.env*`。localhost 服务 `/api/ready` 与 `/api/runtime` 均返回 ok；本次只注入 Jev 配置，未注入 real ReAct provider，所以 runtime 的 reactMode 为空，不将其当成完整生产 Gate。临时容器已删除，镜像保留。

### 2026-10-04 干净工作树准备

已在基于 `origin/main@5bad83486bb81209ce1156045bb3fa12f1f0a72e` 的受管 Git 工作树中只移植 Jev 相关改动。工作树中的 Jev 专项与部署配置合同 16/16 通过；Compose 配置再次确认只有 app 获得 TypeSafe key，worker、migrate、postgres 均不获得，模式为 shadow、采样率 0.05、进程生命周期上限 100 次。实际 `.env.production` 与 `.env.jev.production` 均保持忽略，不进入提交或镜像。

该工作树用于形成可审阅提交和对应的本地 Docker 发布候选。目标服务器发布、数据库备份、真实 provider/runtime Gate、公网 HTTPS 与 5%/100 次观测仍未执行。

### 2026-10-04 受管工作树发布候选

已在 `codex/jev-intent-shadow` 分支形成只包含 Jev 改动的本地审阅提交，并从该提交构建 `tftagent:jev-shadow-a1766a5`。镜像 ID 为 `sha256:b1fbe28ca69d3c5e84251f541a109e95d1f4ed5f14631ee854b0fe9abd92b407`，大小 112324427 bytes；文档并入提交后可把同一镜像重标记为最终提交短 SHA。Docker 构建使用本机已存在的固定 base digest，没有从网络拉取新基础镜像。

最终候选验证结果：

- shadow 预检通过：keyPresent=true、sampleRate=0.05、maxRequests=100、calls=0、controlSupported=false。
- 单条固定合成请求返回 observed，模型 `jev-1.13.0`，action=explain、domain=tft，耗时 629ms，input/output tokens=807/165，和旧路径 action 一致。
- 同一请求被 Jev 标记为 context=missing；observer 会将其投影为 `context_missing` 且不给出可用候选。这是继续保持 shadow-only 的直接证据，也应纳入 5%/100 次日志审查。
- localhost `/api/ready` 返回 ok，`/api/runtime` 返回 ok；本次容器只验证 Jev 和应用启动，没有注入真实 ReAct provider，因此不替代目标环境的完整 runtime Gate。
- 镜像内未发现 `.env*`，镜像 history 未发现 `TYPESAFE_API_KEY` 或示例 key；临时容器已删除。

该候选已具备本地审阅、构建和旁路启动条件。发布到目标服务器前仍需明确部署主机与编排入口，在目标环境备份数据库，注入真实生产配置后验证 provider/runtime、公网 HTTPS 和回滚命令。控制路由保持未实现、未启用。

### 2026-10-04 生产 shadow 发布

生产机实际运行基线不是当时的 `origin/main`，而是热修复提交 `a7c0408735d8b2fcf37e4860b46e9c1e84b984dc`。因此没有直接发布 PR #77，而是从该生产提交建立 `codex/jev-production-a7c040`，依次叠加 Jev 的三个已审阅提交。实际发布提交为 `d24a9cc7369f7425fc3c6849b15ed97ae0fb61c2`。

该生产基线候选在本地通过：Jev 专项 20/20、integration 238 通过/1 跳过、main 1612 通过/7 跳过、Agent eval 50/50。Compose 展开结果确认 app 为 shadow、5% 采样、进程生命周期最多 100 次、1500ms 超时；`TYPESAFE_API_KEY` 只进入 app，不进入 worker、migrate 或 postgres。

发布前在 `/root/tftclarity/backups/jev-shadow-20261004-033928` 保存了当前提交、Compose 状态、数据库状态、环境配置和 PostgreSQL custom dump。数据库转储为 4.1 MB，SHA-256 为 `caaa33d0c1f7888cf7aa04fcfdf6fc35c16c91f31be6876194f44209d64e3dba`，`pg_restore --list` 和 `sha256sum -c` 均通过。旧应用镜像保留为 `tftclarity-app:pre-jev-shadow-20261004-033928`。备份阶段第一次执行 `docker compose run migrate` 未带 `--no-deps`，Compose 重建了 postgres，app 随数据库短暂重启；随后公网 `/api/ready`、Postgres 与 Redis 均恢复 healthy，数据迁移状态完整。后续临时检查均改为 `--no-deps`。

第一次切流前冒烟使用 `scripts/eval-jev-intent.mjs`，因生产镜像按设计不复制 `eval/` 而以 ENOENT 停止；当时运行中的 app 仍是旧镜像 `sha256:7dead712311523525bd96241b7fc8078ecaa2ef16e0051594bfa4974abd71603`。改用镜像内 `createJevIntentShadow` 对固定合成请求直接分类后通过：模型 `jev-1.13.0`，status=observed，action=recommend，domain=tft，context=self_contained，和旧路径 action 一致，耗时 297ms，input/output tokens=913/166。该结果保存在备份目录的 `jev-live-smoke.json`，不含 key。

只重建 app 后，生产容器镜像为 `sha256:eea88ff10a4322badd5aa7665c40006ddd828040b6d2c9998661d9d0e0e3832e`，健康状态为 healthy。容器内 Jev 预检再次确认 ready=true、mode=shadow、keyPresent=true、sampleRate=0.05、maxRequests=100、calls=0、controlSupported=false；运行中的 worker 和一次性 migrate 均确认没有 TypeSafe key。镜像顶层没有 `.env*`，镜像 history 没有 `TYPESAFE_API_KEY` 或示例 key。发布后 app 日志的 error/fatal 行数为 0，数据库三条迁移均为 applied。

公网 `https://tftclarity.cn/api/health` 与 `/api/ready` 返回 ok，Postgres/Redis 均正常；首页、隐私页和条款页均返回 HTTP 200。`/api/runtime` 确认真实 ReAct provider、ConversationState v2、Postgres/Redis 和现有工具注册正常。服务器中原有未跟踪的 `" -b"` 与 `backups/` 均保留。Jev 仍只记录脱敏旁路观察，不改变 TaskFrame、工具选择、LLM 输入或用户响应；后续需要基于最多 100 次、5% 采样日志决定是否扩大实验，当前发布不授权控制路由。

### 2026-10-04 control 发布候选

用户根据网站低流量明确要求正式启用 Jev。候选保持同一生产基线，只新增可回滚的 ReAct 意图提示：全量自由对话先请求 Jev，只有通过 TFT 领域、可解析上下文和 0.70 置信度门槛的 action 才进入 `intentAdvisory`。Jev 没有工具字段，也不能改变 Tool Catalog、工具参数、Evidence、权限、预算、TaskFrame、ConversationState 或 Quick Task；任何失败和低置信均自动走原 ReAct。

发布前验证为：真实 Jev 合成集 16/16；聚焦控制/提示测试 42/42；integration 238 通过/1 跳过；main 1616 通过/7 跳过；Agent eval 50/50。计划生产配置为 mode=control、sampleRate=1、maxRequests=100、controlMinConfidence=0.70、timeout=1500ms。运行时 `/api/runtime` 只暴露安全统计：attempted、controlApplied、fallback reason 计数和状态计数，不暴露 key 或用户输入。

### 2026-10-04 control 正式发布

生产已检出 `ce212e4ba3ac702087715623487c16d81d4b1e16` 并只重建 app。新镜像为 `sha256:7ba125d1f352e0f9058b12900a086a129fbfa73e9e0297d0dd60349bdfb72c1a`，容器 healthy、RestartCount=0，发布后 app 日志 error/fatal 为 0。运行配置预检为 ready=true、mode=control、sampleRate=1、maxRequests=100、controlMinConfidence=0.7、controlSupported=true、controlAuthority=intent_hint_only；worker 和 migrate 仍无 TypeSafe key。

本次发布前备份位于 `/root/tftclarity/backups/jev-control-20261004-052257`，shadow 回滚镜像为 `tftclarity-app:pre-jev-control-20261004-052257`。PostgreSQL custom dump 为 4.1 MB，SHA-256 为 `1c24c54eb16ce75fc7d053988804c8fd7e6d294612f9394c472d68b7b82a2f18`；dump、`.env.production` 和旧 `.env.jev.production` 的 `sha256sum -c` 均通过。本轮备份的 migrate 状态检查使用 `--no-deps`，没有重建 postgres。

切流前真实 control 冒烟通过。切流后通过公网 `/api/react-chat/stream` 发送固定合成道具效果问题，返回 HTTP 200，Jev runtime 从 attempted=0 变为 attempted=1、controlApplied=1、fallback=0、observed=1；ReAct 只调用已注册的 `entity_catalog_query` 和 `item_details`。当前赛季官方详情返回 not_found，因此最终答案按 Evidence 规则明确披露证据不足，没有编造效果数值。`/`、`/privacy`、`/terms`、`/api/health` 和 `/api/ready` 均返回 200，Postgres/Redis 正常。

日志审计确认 `[jev-intent-control]` 事件 1 条，未出现 TypeSafe key 或合成原始输入。服务器原有未跟踪的 `" -b"` 与 `backups/` 继续保留。若需要只撤销控制，不必回滚数据库：把 `.env.jev.production` 的 mode 改回 shadow 或 off，并 `docker compose up -d --no-deps --force-recreate app`；完整应用回滚可使用上述 pre-control 镜像标签。

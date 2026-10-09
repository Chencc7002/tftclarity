# Jev 意图识别开发记录 — 2026-09-29

后续已补充同题真实对比、脱敏失败诊断、采样/请求限额和发布预检，见 [旁路部署准备](jev-shadow-deployment-readiness.md)。下文为首版实现和当时验证记录；后续配置、默认 stdout 日志及新增测试以部署准备记录为准。

## 当前结果

新增默认关闭的自由对话意图旁路。Jev 同时识别 action、domain、context；原 LLM 继续完成理解、工具选择与回答。本阶段不把 Jev 候选传给 LLM，也不替换现有解析器。没有启用线上流量、部署、修改充值设置或创建新的执行 runtime。

架构依据为 phase-6-6、react-chat-r1、ConversationState v2、Skills v2/PR0 与 unit-play 控制实验契约。当前代码具有独立 Quick Task 和 ReAct 两条路径；本接入不是 TaskFrame 到 ReAct 的串行路由，也不借用 Skills 控制实验权限。没有发现本次实现需要改写这些契约的差异。

## 实现与边界

- `src/understanding/jev-intent-shadow.js`：固定 HTTPS 端点与 `jev-1.13.0`，严格响应校验，单请求、无重试；超时涵盖响应体解析，支持取消，不记录错误正文或密钥。
- `src/understanding/jev-intent-observer.js`：本 runtime 最多 4 个并发请求，满额立即跳过，不排队。输出原始分类和确定性 candidate 投影；domain 非 TFT、context 缺失或 action unknown 时候选为空。`candidate_only` 仅表示可供人工检查，并不意味着高置信、允许执行或通过验收。尚未校准置信度阈值。
- `src/app/small-window-server.js`：仅 live-source 自由对话的规范化请求进入旁路；本地来源、Quick Task 没有接入。旁路不 await，不延长 ReAct 的关键路径，不改变请求、响应、预算、Evidence、工具参数、审批、nextActionAffordance 或 ConversationState。进程退出可能丢失在途观测，这是旁路的已知限制。
- 上下文只投影当前输入和请求中最近最多 3 条 user 消息，每条最多 1500 字符；新任务清空历史。排除 assistant/system/tool 内容、taskAnchor、查询 ID、工具结果和任意外部 summary。它不是权威会话状态，因此依赖 assistant 结果或服务端历史的指代可能无法理解，必须保留 legacy。当前输入超过适配器 4000 字符上限时不截断、不调用 Jev，原 ReAct 仍按自己的 8000 字符限制执行。
- provider 可用性、用量、耗时、概率和候选拒绝原因保存在内存聚合/最近事件中；`runtime.jevIntentObserver.snapshot()` 可读取副本，`onJevIntentObservation(event)` 可接入日志系统。默认不落盘，不在用户响应中返回。回调失败被隔离。观测事件不含原问题或历史文本。没有实际 legacy action 时 `actionAgreement` 为 null，不能将其当作一致。

## 配置、运行与回滚

`.env.example` 已记录默认配置：

```dotenv
TFT_AGENT_JEV_INTENT_MODE=off
# TYPESAFE_API_KEY=服务端秘密配置
# TFT_AGENT_JEV_INTENT_TIMEOUT_MS=1500
```

显式改为 `shadow` 并向进程提供 key 后才会向 TypeSafe 发送上述用户文本投影；只有 key 不会触发调用。只接受 off/shadow，错误模式启动失败，避免误以为已启用 control。回滚时改回 off 并重启 runtime；无需迁移会话或回滚数据库。本次没有修改实际环境开关。

离线测试和合成评测使用 Node 24；项目默认 Node 18 不作为本次验证环境。

```powershell
node --test test/jev-intent-shadow.test.js test/jev-intent-observer.test.js
node scripts/eval-jev-intent.mjs
node --env-file=.env.jev.local scripts/eval-jev-intent.mjs --live
node --env-file=.env.jev.local scripts/eval-jev-intent.mjs --live --case=outside-code
```

`eval/jev-intent-cases.json` 有 16 条人工标注合成开发样本，覆盖 8 类动作、多轮、省略、新任务、跨领域和指令注入。不同于最初 6 条 smoke，但不是独立保留验收集。默认 dry-run 零请求；live 串行、最多 16 次、首次 provider 失败即停止。单例参数只能选择已有 ID，输出独立文件，不覆盖全量首次失败报告。标签不发送给 provider；eval 的 actionAgreement 是人工预期动作比较，不是线上 legacy 比较。

## 本次验证结果

- Jev 专项离线测试 11/11：off 零调用、严格契约、超时/取消、无重试、上下文投影、并发上限、观测异常隔离，以及真实 ReAct 入口保持 LLM 输入、原回答状态和并行行为。
- 相关 Agent 测试 271/271；integration 238 通过、1 跳过；agent eval 50/50。
- main 1713 通过、7 失败、7 跳过。7 个失败与接入前基线名称完全一致，涉及 miniprogram-contract、patch-note-history（3）、release-config、season-context、small-window-ui；没有修复这些无关改动。报告：`.cache/eval/jev-runtime-{main,integration}.xml`、`jev-runtime-focused.log`。
- 16 条真实开发样本已全部尝试：首次批次尝试 14 条，在 `topic-switch` 的 invalid_response 处停止；剩余 2 条通过单例命令完成。15 条有效响应，14 条所有预期检查通过；11 条有明确动作标签的样本全部动作匹配。不能将 11/11 动作匹配表述成整体识别通过。
- `follow-compare`：动作 compare 正确、context contextual 正确，但 domain 错为 out_of_domain（confidence 0.46）；候选被拒绝，不更改主流程。
- `topic-switch`：首次响应未通过严格契约检查，原始失败响应未保存，无法判定具体字段原因。另发 1 次合成诊断请求得到合法响应，domain out_of_domain/context self_contained 正确；这不抹去首次失败，也未放宽校验。本轮共 17 次合成请求，没有真实用户会话请求。
- 缺失上下文、新任务重置、非 TFT 编程请求和分类指令注入样本均未产生可观察动作候选。样本很少，不构成鲁棒性证明。
- 真实报告：`.cache/eval/jev-intent-development.json`、`jev-intent-development-outside-code.json`、`jev-intent-development-outside-injection.json`。原始概率、模型版本、用量、耗时及失败保留在这些本地报告中，不含 key。报告未提交。

## 下一阶段门槛

先完善领域与多轮分类的独立验收集、完整响应失败诊断、与真实 legacy 分类的配对观测，以及置信度校准和延迟/费用统计，再决定是否让 Jev 替代某一小块意图判定。实体消歧、完整 TurnDelta、执行计划和工具选择仍由现有架构负责。当前候选策略不可直接改为线上路由规则。

## 2026-10-04 量化复评

本次把“成功返回后的语义判断”和“在 1500ms 预算内得到可用结果”分开统计。配对测试对 Jev 与现有 `deepseek-v4-flash` 结构化解析器使用相同的 10 条单轮输入；每个 Provider 每条只调用一次、禁止格式重试。Quick Task 的确定性解析另列，仍不交给 Jev。

最新配对结果：

- Jev：10/10 action+domain 匹配，失败 0，平均 324ms，中位数 281ms，p95 672ms。
- 现有 LLM 解析器：7/10 匹配，失败 3，平均 986ms，中位数 953ms，p95 1199ms；三条未匹配均为 parser budget/结构化解析失败。
- 现有 LLM 在成功完成的 7 条中为 7/7 正确；Jev 为 10/10。因此当前证据支持的是 1500ms 条件下有效成功率从 70% 到 100%，即增加 30 个百分点，以及平均组件延迟下降 67%。它不支持“成功返回后的纯语义准确率提高 30 个百分点”。
- 2026-09-29 的同一批配对样本得到 Jev 10/10、412ms，现有 LLM 7/10、1057ms。两次延迟降幅分别为 61% 和 67%；因为输入相同，不能把两次运行当成 20 条独立准确率样本。

当前 16 条中文、上下文、域外和提示注入开发集全部完成，15/16 全字段通过（93.8%）：action 11/11、domain 15/16、context 16/16、应拒绝样本 5/5。11 条应产生候选的 TFT 请求中有 10 条产生候选（90.9%）。唯一失败是 `follow-compare`：action=compare 与 context=contextual 正确，但 domain 再次被判为 out_of_domain，因此被安全投影为 `domain_unresolved`。这与先前运行的同一失败一致，说明多轮领域继承仍是可复现弱点，而不是偶发超时。

该次 16 条运行消耗 13066 input tokens、2661 output tokens；平均 315ms，中位数 286ms，p95 766ms。开发集由实现方编写，不是独立盲测或生产流量，因此不能据此批准控制路由。

工程判断：Jev 已证明可显著降低意图分类组件延迟，并在紧时限下减少旧解析器的预算/格式失败；尚未证明成功返回后的语义判断优于现有 LLM。继续保持 shadow-only。接管前至少需要独立标注的中文真实样本、与旧路径相同上下文输入的配对评测、领域/上下文误判分层，以及生产旁路 5%/100 次观测。

## 2026-10-04 多轮领域继承修复

`follow-compare` 的输入投影包含上一条用户消息，Jev 也正确返回 action=compare、context=contextual，因此原问题不是 ConversationState 丢失，而是 domain 没有按上下文继承。修复分为两层：

- Jev domain 题目明确要求依赖型续问继承 `conversationSummary` 已建立的领域，不能因为当前输入只有“这两个/哪个好”等泛指词就判为域外。
- observer 复用已有确定性 `classifyDomain`，只读取同一批最多三条历史用户消息。当 Jev 返回 context=contextual、动作已知、历史明确为 TFT，但 domain 仍非 TFT 时，仅在 advisory candidate 上标记 `domainResolution=inherited_tft_context` 并继承 TFT；原始 Jev answers 保留。该候选仍不控制路由、工具或答案。

同时发现 TypeSafe 偶尔因显示精度把三项概率返回为总和 0.99。适配器现在只接受与 1 相差不超过 0.0101 的有限概率，并在观测结果中归一化；0.98 等更大偏差继续 fail closed。没有增加重试。

验证结果：原失败样本连续 5/5 直接返回 action=compare、domain=tft、context=contextual；修复后的完整16条集为16/16，action 11/11、domain 16/16、context 16/16、abstain 5/5。Jev 专项与部署测试20/20，integration 238通过/1跳过，Agent eval 50/50。main 为1602通过、2失败、7跳过；失败仍是已在干净 `origin/main` 复现的两个 `defaultMessagesHash` 基线问题。

## 2026-10-04 control 接入

生产 shadow 稳定上线后，用户根据低流量明确要求正式启用。control 仅作用于自由对话 ReAct：Jev 的 action/domain/context 通过 0.70 置信度门槛后，以 `jev-intent-control.v1`、`authority=intent_hint_only` 注入现有 decision provider。它不生成 TaskFrame、不直接选择工具、不改变 Tool Catalog、参数、Evidence、预算、权限或确定性 `nextActionAffordance`；Quick Task 保持确定性原路径。超时、低置信、域外、缺上下文、无效响应、未采样或达到进程上限都不注入提示，并自动回退原 ReAct。

## 2026-10-09 线上结果关联

为区分“真实域外流量”和“Jev 漏判 TFT”，每次完成的 Jev 分类新增现有确定性领域门的只读对照：`deterministicDomain` 与 `domainAgreement`。该对照只用于观测，不能覆盖 Jev、放宽控制门槛或授权工具。

control 请求完成后另写一条 `[jev-intent-outcome]` / `jev-intent-outcome.v1` 事件，用同一进程内的 `observationId` 关联分类事件。事件只记录控制处置、最终状态、终止原因、回答来源、首末决策类型、已注册工具名、决策/工具/证据数量；不记录原问题、回答正文、工具参数、Evidence 内容、会话 ID、用户 ID 或凭据。跳过、达到请求上限、并发保护与 provider 失败也有独立 `observationId`，因此 control 结果覆盖率可以完整核对。

`/api/runtime` 的 `routing.jevIntent` 新增：

- `domainComparisons`：确定性领域门与 Jev 原始 domain 的一致、分歧和不可比较计数；
- `outcomes`：已关联结果、实际应用、回退、有工具调用及最终状态计数。

这些数据能回答 Jev 是否漏掉明显 TFT 请求，以及应用/回退请求最后执行了哪些注册工具、是否完成。它仍不是准确率标签：确定性领域门不是人工真值；control 请求的 ReAct 决策已经可能受到 Jev 提示影响，也不是 legacy 反事实。语义提升仍需独立标注或成对 shadow 实验。

真实 16 条合成开发集再次得到 16/16；最低选中置信/概率为 0.42。0.70 门槛会让 `follow-more` 的 action 和 `follow-video` 的 context 回退旧路径，域外注入样本也不会获得控制提示。该门槛牺牲部分覆盖率以避免低置信结果影响工具决策。聚焦控制/提示测试 42/42，integration 238 通过/1 跳过，main 1616 通过/7 跳过，Agent eval 50/50。

这次结果证明已覆盖已知多轮领域继承缺陷和 Provider 概率舍入兼容性，但样本仍是开发集合，shadow-only 和生产接管门槛不变。

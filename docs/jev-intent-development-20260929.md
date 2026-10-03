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

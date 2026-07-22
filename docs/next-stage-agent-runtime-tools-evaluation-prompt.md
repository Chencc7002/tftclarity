# 下一阶段开发 Agent Prompt：Agent Runtime、工具注册与最小评估层

你现在接手项目：`tftclarity / TFTAgent`，一个面向中文《云顶之弈》玩家的自然语言数据决策助手。

本阶段只允许增加三项基础设施：

1. 轻量 Agent Runtime；
2. 统一工具注册与执行层；
3. 最小、可重复运行的评估层。

不要扩展产品功能，不要改变现有排序、统计、过滤、证据和结论规则，不要为了体现“Agent”而把确定性逻辑迁移给 LLM。

## 一、开始前必须阅读

按顺序阅读：

1. `C:\Users\Chencc\Desktop\TFTAgent\docs\goal-prompt.md`
2. `C:\Users\Chencc\Desktop\TFTAgent\docs\requirements.md`
3. `C:\Users\Chencc\Desktop\TFTAgent\docs\memory-llm-architecture.md`
4. `C:\Users\Chencc\Desktop\TFTAgent\docs\llm-retrieval-evidence-pipeline.md`
5. `C:\Users\Chencc\Desktop\TFTAgent\docs\question-contract-conclusion-spec.md`
6. `C:\Users\Chencc\Desktop\TFTAgent\docs\implementation-progress.md`
7. `C:\Users\Chencc\Desktop\TFTAgent\docs\mvp-verification-matrix.md`
8. `C:\Users\Chencc\Desktop\TFTAgent\src\retrieval\llm-pipeline.js`
9. `C:\Users\Chencc\Desktop\TFTAgent\src\retrieval\structured-retriever.js`
10. `C:\Users\Chencc\Desktop\TFTAgent\src\core\recommendation-service.js`
11. `C:\Users\Chencc\Desktop\TFTAgent\src\core\conclusion-service.js`
12. `C:\Users\Chencc\Desktop\TFTAgent\src\app\small-window-server.js`

开始修改前执行：

```powershell
git status --short
git branch --show-current
npm test
```

工作区可能包含用户或其他 Agent 的未提交修改。不得回退、覆盖或重写不属于本阶段的改动。记录修改前测试基线；跳过项不能记为通过。

## 二、当前架构事实

当前系统的正确定位是：

```text
确定性查询系统
+ 轻量会话/偏好记忆
+ 受控 LLM 解析
+ 混合语义检索
+ Evidence Pack
+ 受约束结论生成、校验、纠错与模板回退
```

已有能力包括：

- 规则、目录和高置信解析优先，可选 LLM 只补充结构化意图和约束；
- `IntentEnvelope`、`RetrievalPlan`、`SemanticHit`、`EvidencePack` 等版本化契约；
- `StructuredRetriever` 白名单操作与参数过滤；
- 结构化检索与语义检索的统一编排；
- LLM 结论严格 JSON、Evidence 校验、有限纠错、重复错误停止和模板回退；
- JSON/SQLite 缓存、会话、偏好、反馈、别名、查询事件和管理审计；
- 大量离线单元、集成、HTTP、smoke 和 audit 测试。

当前缺口不是业务能力不足，而是：

- 一次请求的生命周期、状态、预算、取消和阶段事件还没有统一的 Runtime 抽象；
- 内部数据操作已有白名单，但没有统一、可描述、可审计的 Tool Registry；
- 测试很多，但缺少一个小型固定数据集，把核心 Agent 契约汇总成可比较的评估报告。

## 三、本阶段唯一目标

在不改变现有用户可见行为和确定性业务算法的前提下，形成以下结构：

```text
HTTP / 小窗 UI
  -> AgentRuntime.run(request)
      -> Runtime 状态机、预算、取消、阶段事件
      -> ToolRegistry / ToolExecutor
          -> 现有解析、检索、目录和推荐能力
      -> 现有 Evidence / Conclusion 校验链路
  -> 保持兼容的 HTTP 响应

固定评估数据集
  -> Eval Runner
      -> 调用与生产相同的 AgentRuntime
      -> 生成 JSON + Markdown 报告
```

本阶段完成后：

- 每个推荐请求有唯一 `runId` 和统一生命周期；
- Runtime 可以限制截止时间、步骤数、工具调用次数和单工具重试次数；
- Runtime 可以响应取消信号，并阻止取消后的迟到结果继续推进；
- 所有纳入 Runtime 的数据能力通过统一工具定义注册和调用；
- 未注册工具、非法参数和来源不匹配在执行前被拒绝；
- 现有 API、UI、排序、证据、LLM 校验和降级行为保持兼容；
- 一个无需真实网络和真实 LLM 的最小评估命令可以稳定生成报告。

## 四、严格非目标

本阶段禁止实现或引入：

- 自主 ReAct 循环；
- 让 LLM 决定下一步调用哪个工具；
- MCP Server 或 MCP Client；
- 多 Agent、Manager Agent、Reviewer Agent 或 Agent 辩论；
- 长期记忆自动提取、自我反思、自我进化、Skills；
- 新的用户意图、新页面、新卡片或新数据源；
- 新的排名算法、样本门槛、阵容策略或装备规则；
- 将统计、过滤、排序、版本判断或证据判断交给 LLM；
- LangChain、LangGraph 等重量级框架；
- LLM-as-a-Judge、A/B 平台、大规模金标集或在线实验平台；
- 为架构整洁而一次性重写 `small-window-server.js` 或 `recommendation-service.js`；
- 没有测试保护的目录重排或大规模重命名。

如果实现过程中发现必须改变上述非目标，立即停止扩展，记录阻塞原因，不得自行扩大范围。

## 五、Agent Runtime 设计

### 5.1 模块结构

建议新增：

```text
src/agent/
  runtime.js
  run-state.js
  run-budget.js
  runtime-errors.js
```

可以根据现有代码风格调整文件名，但不得把 Runtime 再塞入 `small-window-server.js`。

### 5.2 AgentRun 契约

定义版本化、可序列化的运行快照。至少包含：

```json
{
  "schemaVersion": "agent_run.v1",
  "runId": "uuid",
  "conversationId": "string",
  "principalId": "string",
  "seasonContextId": "set17-live",
  "status": "received",
  "currentStage": "received",
  "startedAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "deadlineAt": "ISO-8601",
  "stepCount": 0,
  "toolCallCount": 0,
  "retryCount": 0,
  "events": [],
  "error": null
}
```

内部对象可以携带输入、解析结果、检索计划、证据和最终结果，但对 HTTP 暴露运行快照时必须使用安全序列化器，不得返回：

- API Key、Authorization、Cookie；
- Provider endpoint 中的凭证或查询密钥；
- 原始外部响应全集；
- 未校验的 LLM 输出；
- 管理员 Token；
- 其他访客或会话的数据。

### 5.3 状态机

允许的主状态：

```text
received
running
clarification_required
completed
fallback
cancelled
timed_out
failed
```

允许的阶段至少包括：

```text
received
resolving
planning
retrieving
assembling_evidence
generating_conclusion
validating
responding
terminal
```

要求：

- 状态迁移必须集中校验，禁止任意字符串覆盖状态；
- 终态不可重新进入运行态；
- 取消和超时后，迟到 Promise 不得覆盖终态或写入最终结果；
- `clarification_required` 是可预期业务终态，不应记为系统失败；
- LLM 不可用但确定性结果成功时使用 `fallback`，不是 `failed`；
- 非法状态迁移必须返回稳定错误码并有单元测试。

### 5.4 运行预算

定义默认值和有界配置：

```js
{
  deadlineMs: 10000,
  maxSteps: 12,
  maxToolCalls: 12,
  maxRetriesPerTool: 1,
  maxEvents: 100
}
```

具体默认值可以根据现有 Explorer、Comps、LLM timeout 调整，但必须满足：

- 不能把不同数据源的已有 timeout 全部粗暴扩大；
- Runtime 总截止时间与单工具 timeout 分开；
- 每执行一个阶段或工具都检查取消信号和总截止时间；
- 预算耗尽返回结构化 `budget_exhausted` 或 `run_timed_out`；
- 当前固定工作流正常执行不应触达步数和工具次数上限；
- 不实现 Token 预算拦截；Provider 能返回 usage 时可以记录，但不得把本阶段扩大成 Token 计费系统。

### 5.5 事件

统一阶段事件结构：

```json
{
  "schemaVersion": "agent_event.v1",
  "eventId": "uuid",
  "runId": "uuid",
  "type": "tool_call_completed",
  "stage": "retrieving",
  "timestamp": "ISO-8601",
  "durationMs": 12,
  "data": {}
}
```

至少支持：

```text
run_started
stage_started
stage_completed
tool_call_started
tool_call_completed
tool_call_failed
run_clarification_required
run_fallback
run_cancelled
run_timed_out
run_failed
run_completed
```

兼容现有 `intent_resolved`、`retrieval_plan_created`、`semantic_retrieval_*`、`structured_retrieval_*`、`conclusion_*` 事件：可以作为 Runtime 事件的 `type` 或被映射到统一事件，但不要维护两套互相矛盾的状态。

事件回调或日志失败不得改变推荐结果。

## 六、工具注册与执行层

### 6.1 模块结构

建议新增：

```text
src/agent/tools/
  registry.js
  executor.js
  tool-errors.js
  definitions.js
```

### 6.2 ToolDefinition 契约

每个工具至少定义：

```js
{
  schemaVersion: "agent_tool.v1",
  name: "get_unit_builds",
  description: "...",
  source: "metatft",
  inputSchema: {},
  outputSchema: null,
  readOnly: true,
  riskLevel: "low",
  timeoutMs: 2200,
  idempotent: true,
  cacheable: true,
  execute: async (input, context) => {}
}
```

要求：

- 工具名称全局唯一且不可运行时静默覆盖；
- `inputSchema` 必须拒绝未知字段；
- 参数校验失败时不得调用底层 client；
- 工具必须声明 `readOnly`、`riskLevel`、`timeoutMs`、`idempotent`；
- 工具描述必须说明“何时使用”“不用于什么”“关键参数”“返回内容”；
- Tool Executor 统一处理参数校验、超时、取消、事件和错误归一化；
- 不在工具层复制统计、排序或业务规则；工具只包装已有能力；
- 底层错误不得把敏感 header、key、cookie 或完整外部 payload 写进事件。

### 6.3 首批注册范围

只注册当前主要只读能力，名称可根据现有 operation 对齐：

```text
unit_builds
unit_comp_candidates
comps_rankings
comps_trends
comps_analysis
unit_details
item_details
trait_details
semantic_search
```

要求：

- 尽量复用现有 `STRUCTURED_OPERATION_REGISTRY`，不要建立第二份会漂移的操作白名单；
- 可以将现有 registry 提升为共享定义源，`StructuredRetriever` 和 Tool Registry 从同一份定义派生；
- 现有 `RetrievalPlan` 仍决定执行哪些操作；模型不能直接提交工具名；
- `semantic_search` 只负责静态语义召回，不提供实时排行数值；
- 详情类工具仍只读取受信目录，不触发结论 Provider；
- 当前没有写工具，不实现审批、Sidecar 或人工确认框架；保留未来扩展字段即可。

### 6.4 ToolResult 契约

统一返回：

```json
{
  "schemaVersion": "agent_tool_result.v1",
  "toolCallId": "uuid",
  "toolName": "comps_rankings",
  "status": "completed",
  "startedAt": "ISO-8601",
  "completedAt": "ISO-8601",
  "durationMs": 123,
  "attempts": 1,
  "value": {},
  "error": null,
  "metadata": {
    "source": "metatft",
    "patch": "current",
    "cache": null
  }
}
```

失败状态至少区分：

```text
invalid_input
not_registered
not_available
timed_out
cancelled
failed
```

只有明确标记为可恢复、幂等且未超过 `maxRetriesPerTool` 的错误允许重试。超时后副作用不明确的工具禁止自动重试；虽然本阶段只有只读工具，也要用测试锁定这条规则。

## 七、现有链路接入方式

采用渐进包装，不进行大爆炸重构。

推荐顺序：

1. 先实现独立 Runtime、Registry、Executor 及单元测试；
2. 用工具层包装 `StructuredRetriever` 的现有 operation；
3. 让 `runLlmRetrievalPipeline` 可选接收 Runtime/ToolExecutor 上下文；
4. 将小窗 `/api/recommend` 主请求接入 Runtime；
5. 保持现有 `handleRecommendRequest` 返回结构兼容；
6. 旧的直接函数调用入口可以暂时保留，避免一次性破坏测试；
7. 在完成兼容验证后再删除真正重复的薄包装，不删除仍被测试或脚本使用的公开导出。

Runtime 不得接管这些职责：

- 自然语言领域规则；
- 实体目录构建；
- Comp/装备业务过滤；
- 统计计算和可靠性收缩；
- Evidence Pack 内容定义；
- ConclusionSpec、QuestionContract 和结论校验；
- HTTP 展示序列化。

它只负责生命周期、状态、预算、取消、事件和工具调度。

## 八、最小评估层

本阶段的评估层不是平台，而是现有测试之上的小型固定数据集和报告器。

### 8.1 模块结构

建议新增：

```text
eval/
  datasets/
    core-agent-cases.jsonl
  runner.mjs
  metrics.mjs
  README.md
scripts/
  run-agent-eval.mjs
```

在 `package.json` 增加：

```json
{
  "scripts": {
    "eval:agent": "node scripts/run-agent-eval.mjs"
  }
}
```

### 8.2 数据集范围

首版准备 30～50 个离线用例，复用现有 fixture 和注入 client，不访问真实网络，不要求真实 LLM Key。

至少覆盖：

- 标准英雄装备查询；
- 已持有、排除和比较装备；
- 阵容排行榜、趋势和条件检索；
- 英雄、装备、羁绊详情；
- 多轮条件继承和用户改口；
- 缺英雄、未知装备、歧义实体等澄清；
- 低样本、空结果、stale、Embedding 失败、LLM 失败；
- 非法工具名、未知参数、来源不匹配；
- Runtime 超时、取消、预算耗尽和迟到结果；
- 赛季隔离；
- LLM 不得改变数字、排名和实体的越权用例。

每个用例使用结构化断言，不比较整段自然语言：

```json
{
  "id": "unit-build-basic-001",
  "input": "霞带哪三件装备最好？",
  "conversation": [],
  "seasonContextId": "set17-live",
  "expected": {
    "status": "completed",
    "intent": "unit_best_3_items",
    "needsClarification": false,
    "requiredTools": ["unit_builds"],
    "forbiddenTools": ["comps_rankings"],
    "resultType": "unit_best_3_items",
    "fallbackAllowed": true
  }
}
```

数据集不得包含真实 API Key、Cookie、个人标识或大体积第三方原始响应。

### 8.3 最小指标

报告至少包括：

```text
total
passed
failed
skipped
task_success_rate
intent_accuracy
clarification_accuracy
tool_selection_accuracy
tool_input_validity_rate
fallback_rate
timeout_rate
average_duration_ms
p95_duration_ms
```

说明：

- 这里的 `tool_selection_accuracy` 检查固定 `RetrievalPlan` 是否调用正确工具，不代表 LLM 自主工具选择；
- `skipped` 必须单独统计，不能计入 passed；
- 任一数字/实体越权、未注册工具执行、赛季串数据属于否决失败；
- 首版不做 Pass@k、Pass^k、LLM Judge、人工评分或在线统计显著性。

### 8.4 报告

默认生成到被 Git 忽略的目录，例如：

```text
.cache/eval/agent-eval.json
.cache/eval/agent-eval.md
```

命令退出规则：

- 全部必选用例通过：退出码 0；
- 任一必选用例失败：退出码非 0；
- 数据集格式非法、fixture 缺失、指标出现 NaN：退出码非 0；
- 可选真实 Provider 用例未配置时可以跳过，但必须明确显示 skipped；
- 默认离线评估不得因为没有 LLM Key 或网络而跳过核心用例。

## 九、HTTP 与兼容性

现有 HTTP 响应字段、前端渲染和小程序契约保持兼容。

可以增加一个安全的运行摘要，例如：

```json
{
  "run": {
    "schemaVersion": "agent_run_public.v1",
    "runId": "uuid",
    "status": "completed",
    "currentStage": "terminal",
    "stepCount": 6,
    "toolCallCount": 2,
    "durationMs": 512
  }
}
```

要求：

- 新字段必须是向后兼容的附加字段；
- 不把内部事件全集默认返回给匿名用户；
- 不新增公开的任意工具执行 HTTP endpoint；
- 不允许客户端指定或提高 `maxSteps`、`maxToolCalls`、timeout；
- 调试信息只能通过受保护管理入口或本地诊断获得；
- query event 可以关联 `runId`，但迁移必须兼容现有 JSON/SQLite 数据。

## 十、测试要求

### 10.1 Runtime 单元测试

必须覆盖：

- 合法状态迁移；
- 非法状态迁移；
- 终态不可覆盖；
- deadline 超时；
- `AbortSignal` 取消；
- 步数、工具次数和事件数限制；
- 取消后的迟到结果不会写入；
- 事件回调抛错不影响业务结果；
- 安全公共快照不泄露敏感字段。

### 10.2 Tool Registry/Executor 单元测试

必须覆盖：

- 注册、查询、重复注册拒绝；
- 未注册工具拒绝；
- 未知字段和非法类型拒绝；
- 参数失败时底层 handler 调用次数为 0；
- timeout、cancel 和错误归一化；
- 可恢复幂等错误的有界重试；
- 不可恢复错误不重试；
- 事件包含 runId、toolCallId、工具名和耗时；
- 敏感错误内容被裁剪或脱敏；
- 与 `StructuredRetriever` 白名单不漂移。

### 10.3 集成测试

必须覆盖：

- `/api/recommend` 通过 Runtime 完成现有主查询；
- 澄清、成功、fallback、stale 和失败状态映射正确；
- 现有结论纠错和模板回退行为不变；
- refresh、clear、赛季切换和并发请求互不污染；
- 前端发起新请求导致旧请求取消时，旧请求不能覆盖新结果；
- JSON store 和可用时的 SQLite store 均能兼容新增 `runId`；
- 当前所有旧测试继续通过或仅因明确、正确的契约升级而更新断言。

### 10.4 评估层测试

必须覆盖：

- JSONL schema 校验；
- 指标计算；
- P95 在小样本下行为稳定；
- skipped 不计为 passed；
- 失败用例导致非 0 退出；
- 报告可重复生成且不包含时间以外的随机差异；
- 默认离线运行不访问网络。

## 十一、实施顺序

严格按以下顺序进行，每一阶段完成后先运行定向测试，再继续：

### 阶段 A：基线与契约

1. 记录当前测试、smoke 和 git 状态；
2. 定义 `AgentRun v1`、事件、状态迁移和 Runtime 错误码；
3. 先编写契约和状态机测试；
4. 不接入生产链路。

完成标准：Runtime 可在纯内存、注入时钟和注入 UUID 下确定性测试。

### 阶段 B：工具注册与执行

1. 定义 ToolDefinition、ToolResult 和 ToolExecutor；
2. 复用现有 structured operation 定义；
3. 包装现有 handler，不复制业务逻辑；
4. 完成参数、timeout、cancel、retry 和事件测试。

完成标准：现有主要只读 operation 可通过 ToolExecutor 执行，非法操作在底层调用前被拒绝。

### 阶段 C：生产主链路接入

1. Runtime 包装现有 `/api/recommend` 生命周期；
2. 检索计划通过 ToolExecutor 执行；
3. 保持现有返回兼容；
4. 查询事件关联 `runId`；
5. 验证并发、取消、超时和降级。

完成标准：现有主流程结果不变，每个请求都有可审计 Run 摘要。

### 阶段 D：最小评估层

1. 建立 30～50 个离线固定用例；
2. 复用生产 Runtime 和 fixture；
3. 生成 JSON/Markdown 报告；
4. 添加 `npm run eval:agent`；
5. 为 runner 和 metrics 编写测试。

完成标准：无网络、无 LLM Key 环境可以完成核心评估，必选用例失败时命令可靠失败。

### 阶段 E：完整回归与文档

1. 运行全量测试；
2. 运行 `npm run eval:agent`；
3. 运行与本阶段修改相关的离线 smoke；
4. 使用可用 Node 24 运行 SQLite 测试；不可用时明确记录跳过原因；
5. 更新架构、运行状态、工具定义和评估命令文档；
6. 更新 `implementation-progress.md`，只记录真实执行结果。

## 十二、工程约束

- 使用原生 ESM 和现有 Node.js 技术栈；
- 除非有不可替代的理由，不新增生产依赖；
- 时间、UUID、handler 和外部 client 必须可注入，保证测试确定性；
- Runtime 和工具层不得依赖 HTTP request/response 对象；
- 领域核心不得反向依赖 `src/agent` 的 HTTP 适配代码；
- 错误必须有稳定 `code`，不能依赖自然语言 message 做程序判断；
- 对外暴露的 schema 必须版本化；
- 不记录内部 Chain-of-Thought；事件只记录结构化阶段、调用、结果和错误分类；
- 不将原始用户输入复制进所有事件；确需关联时使用 runId/queryId；
- 不提交 `.env`、API Key、运行时数据库、评估报告或大体积缓存；
- 不修改与本阶段无关的 UI 视觉设计和业务文案；
- 不为了减少文件数量继续扩大已有超大文件；
- 不以“测试太难”为由放宽现有校验、门槛或安全降级。

## 十三、最终验收标准

必须同时满足：

1. 每个 `/api/recommend` 请求都通过版本化 Agent Runtime 执行；
2. Runtime 状态转换、deadline、预算和取消语义有自动化测试；
3. 取消或超时后的迟到结果不能改变终态或覆盖新请求；
4. 主要结构化/语义检索能力通过统一 Tool Registry 和 ToolExecutor 调用；
5. 工具参数严格校验，未知字段、未知工具和来源不匹配在执行前拒绝；
6. Tool Registry 与现有 `StructuredRetriever` 使用同一白名单事实源；
7. LLM 仍不能决定统计、排序、数据源、工具或最终事实；
8. 现有 API 和前端契约保持向后兼容；
9. 现有 Evidence、ConclusionSpec、QuestionContract、校验、纠错和回退行为保持有效；
10. `npm run eval:agent` 可在完全离线环境运行核心用例并生成 JSON/Markdown 报告；
11. 评估报告正确区分 passed、failed、skipped，任一必选失败返回非 0；
12. 全量测试零失败；跳过项逐项说明，不能记为通过；
13. 未引入 ReAct、MCP、多 Agent、自动长期记忆或新产品功能；
14. 文档记录真实变更、真实测试命令和真实结果，不写尚未执行的“已完成”。

## 十四、最终交付报告格式

开发完成后按以下格式汇报：

```text
1. 架构变化
   - 新增 Runtime、状态机、预算和取消语义
   - 新增 Tool Registry/Executor 及已注册工具
   - 新增最小评估数据集、指标和命令

2. 兼容性
   - 保持不变的 API/UI/业务算法
   - 必要的 schema 新版本及迁移方式

3. 安全与边界
   - 参数白名单、敏感信息脱敏、超时和迟到结果处理
   - 明确未实现 ReAct/MCP/多 Agent

4. 验证结果
   - npm test：通过/失败/跳过
   - npm run eval:agent：通过/失败/跳过和核心指标
   - SQLite/smoke：实际执行结果

5. 剩余问题
   - 只列本阶段真实遗留，不扩展下一阶段产品方向
```


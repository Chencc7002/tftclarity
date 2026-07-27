# ConversationState v2 与 TurnDelta 上下文重构开发交接

> 用途：将本文档直接交给另一个开发 Agent，完成 TFTAgent 多轮自然语言上下文重构。
>
> 本阶段解决的典型问题：
>
> ```text
> 用户：推荐几个赌狗阵容
> Agent：返回 3/3 套阵容
> 用户：可以多推荐几套吗
> ```
>
> 当前系统可能丢失上一轮的阵容任务，错误进入“缺少英雄”的澄清。本阶段必须从架构上解决整类“继续、更多、换一批、追加条件、删除条件、替换条件、返回上一任务”问题，不得通过增加完整句子正则或关键词白名单修复单个案例。

## 1. 给开发 Agent 的执行指令

你正在维护 `TFTAgent` 仓库。请先阅读以下文件，再开始修改：

- `docs/phase-6-6-architecture-convergence.md`
- `docs/memory-llm-architecture.md`
- `docs/task-frame-shadow-parser.md`
- `src/understanding/task-frame.js`
- `src/understanding/context-resolver.js`
- `src/understanding/context-policy.js`
- `src/understanding/semantic-task-parser.js`
- `src/llm/chat-semantic-task-provider.js`
- `src/core/recommendation-service.js`
- `src/core/comp-query.js`
- `test/phase4-context-evaluation.test.js`
- `test/conversational-assistant.test.js`
- `test/comp-rankings.test.js`

开始前执行：

```powershell
git status --short
npm test
```

要求：

1. 保留用户已有未提交更改，不覆盖无关文件。
2. 先记录基线测试结果。
3. 使用小步提交或至少保持修改可分阶段审查。
4. 不修改 Runtime、ExecutionPlan、Tool Registry、数据抓取、排序算法和前端视觉。
5. 不通过新增“可以多推荐几套吗”等完整句子规则修复。
6. 不允许 LLM 直接决定最终工具参数、样本计算、排序结果或证据是否成立。
7. 新链路必须可影子运行、可观测、可按开关回滚。
8. 最终切换后只能有一个上下文合并事实源；旧的阵容/英雄专用继承逻辑必须退出生产主路径。

## 2. 背景与根因

### 2.1 当前已有的正确基础

Phase 6.6 已经建立统一执行链：

```text
TaskFrame
  -> Capability Matcher
  -> ExecutionPlan
  -> ExecutionPlanExecutor
  -> Tool Registry / ToolExecutor
  -> Evidence Validator
  -> response
```

这条链路不需要重写。当前问题发生在 `TaskFrame` 形成之前或上下文补全期间。

当前代码已经具备：

- `task-frame.v1`；
- 结构化 LLM 解析器；
- `conversationSummary` 和 `stateBar` 的消息位置；
- `resolveTaskFrameContext()`；
- session store；
- 澄清策略；
- Agent Runtime、工具注册、ExecutionPlan 和证据校验。

### 2.2 当前问题

现在存在多套上下文继承机制：

- `src/understanding/context-resolver.js` 使用指代和续问正则决定是否继承 TaskFrame；
- `src/core/recommendation-service.js` 中的 `inheritCompRankingFromSession()` 单独处理阵容；
- 同文件中的 `inheritParsedFromSession()` 单独处理英雄和装备；
- `src/core/comp-query.js` 中的 `isCompRankingFollowUp()` 再次判断阵容续问；
- 结构化解析器主要理解当前句子，活动任务状态没有成为统一、强类型的输入。

因此，系统是否继承上下文依赖“当前句子有没有命中某类表达”。例如“可以多推荐几套吗”不一定命中现有阵容续问判断，于是上一轮 `comp_rankings` 状态虽然已保存，却没有被正确消费。

### 2.3 根因结论

根因不是缺少某个关键词，而是缺少两个统一协议：

1. 当前会话正在执行什么任务的 `ConversationState`；
2. 用户本轮相对上一任务做了什么变化的 `TurnDelta`。

当前系统倾向于“每轮重新生成一个完整查询”，本阶段应改为：

```text
当前输入 + 当前任务状态
  -> 解释本轮变化
  -> 确定性合并
  -> 得到完整 TaskFrame
```

## 3. 本阶段目标

建立以下唯一主链：

```text
current input
  + ConversationState.v2
  -> Turn Interpreter
  -> TurnDelta.v1
  -> Context Reducer
  -> Resolved TaskFrame
  -> 现有 Phase 6.6 执行链
  -> structured result
  -> ConversationState 更新
```

职责边界：

- LLM/语义解析器：识别语言行为、任务关系、显式实体和本轮修改；
- Context Reducer：按固定优先级合并状态；
- Capability/Planner：选择能力并编译 ExecutionPlan；
- Tool：查询真实数据；
- Evidence Validator：验证证据；
- Response：解释结果；
- ConversationState：保存当前任务与上一结果的可继续操作状态。

## 4. 非目标

本阶段不要开发：

- Bilibili 视频搜索；
- 新工具；
- 自主循环或开放式多步 Agent；
- 新的长期用户画像；
- 赛季攻略 Skill；
- RAG 知识库；
- 排名或统计口径调整；
- 前端重设计；
- 通过完整聊天记录无限扩充 prompt；
- 让 LLM 生成任意工具名、URL、SQL 或未校验参数。

长期记忆、赛季知识和 RAG 可以在后续接入，但不能参与“再来几个”这类当前任务续问的核心判定。

## 5. 新增协议

### 5.1 ConversationState.v2

建议新增：

```text
src/understanding/conversation-state.js
```

最低数据结构：

```json
{
  "schemaVersion": "conversation-state.v2",
  "activeTask": {
    "taskFrame": {
      "schemaVersion": "task-frame.v1",
      "domain": "tft",
      "action": "rank",
      "subjects": [],
      "candidates": [],
      "concepts": [],
      "constraints": {
        "specialMode": true
      },
      "goal": "comp_rankings",
      "expectedOutput": [],
      "contextReferences": [],
      "ambiguities": [],
      "assumptions": [],
      "capabilityRequirements": [],
      "confidence": 1,
      "understandingStatus": "understood_and_supported"
    },
    "legacyIntent": "comp_rankings",
    "updatedAt": "2026-07-26T15:00:00.000Z"
  },
  "lastResult": {
    "resultType": "comp_rankings",
    "toolName": "comps_rankings",
    "shownIds": ["comp-a", "comp-b", "comp-c"],
    "returnedCount": 3,
    "totalCount": 3,
    "cursor": null,
    "exhausted": true,
    "appliedConstraints": {
      "specialMode": true
    },
    "updatedAt": "2026-07-26T15:00:01.000Z"
  },
  "pendingClarification": null,
  "seasonContextId": "set-17",
  "updatedAt": "2026-07-26T15:00:01.000Z"
}
```

实现要求：

- 提供 `createConversationState()`；
- 提供 `validateConversationState()`；
- 提供从现有 `{ query, lastResultIds, updatedAt }` session value 迁移的适配函数；
- 状态必须按 conversation/session key 隔离；
- 清空会话时必须同时清空 v2 状态；
- `activeTask.taskFrame` 是活动业务任务的事实源；
- `lastResult` 只记录支持后续操作所需的结构化元数据，不存放完整大结果；
- `shownIds` 必须有上限，避免 session 无限增长；
- session TTL 沿用现有配置；
- 不把 `ConversationState` 写入长期用户偏好。

迁移期可以双写兼容字段：

```json
{
  "schemaVersion": "conversation-state.v2",
  "activeTask": {},
  "lastResult": {},
  "pendingClarification": null,
  "query": {},
  "lastResultIds": []
}
```

其中 `query` 和 `lastResultIds` 仅供旧链路影子对比或回滚使用。切换完成后，新代码不得继续把它们作为主事实源。

### 5.2 TurnDelta.v1

建议新增：

```text
src/understanding/turn-delta.js
```

最低数据结构：

```json
{
  "schemaVersion": "turn-delta.v1",
  "dialogueAct": "request_more",
  "taskRelation": "continue",
  "explicitTaskFrame": null,
  "entityOperations": [],
  "constraintOperations": [],
  "presentation": {
    "requestedCount": null,
    "pageDirection": "next",
    "avoidSeen": true
  },
  "confidence": 0.96,
  "ambiguities": []
}
```

`dialogueAct` 至少支持：

```text
start_task
continue
request_more
request_less
next_page
previous_page
modify
compare
switch_task
confirm
reject
cancel
clarify
unknown
```

`taskRelation` 至少支持：

```text
new
continue
modify
switch
return
cancel
unknown
```

约束操作使用有限协议，不允许任意代码路径：

```json
{
  "operation": "set",
  "field": "rankFilter",
  "value": ["MASTER", "GRANDMASTER", "CHALLENGER"]
}
```

`operation` 仅允许：

```text
set
add
remove
replace
clear
```

实现要求：

- 提供 `createTurnDelta()`；
- 提供 `validateTurnDelta()`；
- 对 dialogue act、task relation、operation 做枚举校验；
- 对可修改字段使用现有领域约束或 allowlist；
- 非法字段和非法值不能进入 Reducer；
- LLM 输出无效时返回显式的低置信或未知状态，不得静默猜测；
- 不把最终工具名和完整工具参数放进 TurnDelta。

### 5.3 示例语义

| 当前输入 | 预期 dialogueAct | taskRelation | 关键变化 |
|---|---|---|---|
| 推荐几个赌狗阵容 | `start_task` | `new` | 创建阵容排行任务 |
| 可以多推荐几套吗 | `request_more` | `continue` | 请求更多结果 |
| 再来三个 | `request_more` | `continue` | `requestedCount=3` |
| 换一批 | `request_more` | `continue` | `avoidSeen=true` |
| 只看大师以上 | `modify` | `modify` | 设置 rankFilter |
| 不要赌狗阵容了 | `modify` | `modify` | 清除 specialMode |
| 换成九五阵容 | `modify` 或 `switch_task` | `modify` | 替换阵容条件 |
| 霞带什么装备 | `start_task` | `new` | 新建英雄出装任务 |
| 第二套呢 | `next_page` 或 `continue` | `continue` | 继承英雄和任务 |
| 如果没有轻语呢 | `modify` | `modify` | 排除轻语 |
| 换成卡莎 | `modify` | `modify` | 替换英雄 |
| 刚才的霞再说一下 | `continue` | `return` | 恢复最近兼容任务 |
| 算了 | `cancel` | `cancel` | 清除活动任务或待澄清 |

不要强制 LLM 在所有模糊情况下猜中。影响工具选择或关键参数且置信不足时，应进入现有统一澄清策略。

## 6. Turn Interpreter

优先扩展现有结构化语义解析链，而不是建立第二套独立 LLM 客户端。

建议新增：

```text
src/understanding/turn-interpreter.js
```

或在现有 semantic parser 中增加明确的 `TurnDelta` 解析入口，但不得让 `TaskFrame` 和 `TurnDelta` 的职责混在一个无版本对象里。

输入：

```json
{
  "currentMessage": "可以多推荐几套吗",
  "conversationState": {
    "activeTaskSummary": {
      "domain": "tft",
      "action": "rank",
      "goal": "comp_rankings",
      "constraints": {
        "specialMode": true
      }
    },
    "lastResultSummary": {
      "resultType": "comp_rankings",
      "returnedCount": 3,
      "totalCount": 3,
      "exhausted": true
    },
    "pendingClarification": null
  },
  "recentTurns": []
}
```

输出只能是 `turn-delta.v1`。

Prompt 要求：

- 解释“本轮相对当前任务的变化”，不是每次从零生成完整查询；
- 明确区分 `new`、`continue`、`modify`、`switch` 和 `return`；
- 当前消息的显式实体和条件优先；
- 不得臆造不存在的实体、条件、工具和数据；
- 请求更多不等于切换到英雄推荐；
- 若 `lastResult.exhausted=true`，仍然输出 `request_more`，是否放宽条件由 Reducer/响应策略决定；
- 输出严格 JSON；
- 解析失败必须可降级到确定性策略或澄清，不能导致服务崩溃。

上下文预算：

- 默认只发送活动任务摘要、上一结果摘要、待澄清状态和少量最近轮次；
- 不发送无限完整历史；
- 保持 system prompt、工具描述等稳定前缀，降低缓存失效；
- 状态摘要必须可观测，便于评估实际发送给模型的内容。

## 7. Context Reducer

建议新增：

```text
src/understanding/context-reducer.js
```

核心接口应接近纯函数：

```js
reduceConversationState({
  state,
  delta,
  defaults,
  domainPolicy
})
```

返回：

```js
{
  resolvedTaskFrame,
  nextState,
  decision,
  inheritedFields,
  changedFields,
  warnings,
  trace
}
```

`decision` 至少支持：

```text
execute
clarify
exhausted
cancelled
unsupported
invalid_delta
```

固定优先级：

```text
明确的新任务
  > 当前输入中的显式实体/条件
  > TurnDelta 的增删改操作
  > activeTask
  > 长期用户偏好
  > 系统默认值
```

Reducer 必须是确定性的：

- 相同 state + delta 必须得到相同结果；
- 负责继承、添加、删除、替换、恢复和清空；
- 负责验证修改是否仍构成可执行 TaskFrame；
- 不负责选择具体工具；
- 不调用远程数据；
- 不使用 LLM；
- 不根据完整自然语言句子做业务分支；
- 可以使用有限、可测试的领域策略验证字段和值。

### 7.1 “更多结果”决策

当：

```text
delta.dialogueAct = request_more
lastResult.exhausted = false
```

应生成继续同一任务的 TaskFrame，并附带下一页/增加数量的展示请求；工具层仍通过现有 Planner 和注册工具执行。

当：

```text
delta.dialogueAct = request_more
lastResult.exhausted = true
```

不得丢失活动任务，也不得切换到英雄澄清。返回：

```text
decision = exhausted
```

响应应表达：

```text
当前符合“赌狗阵容”条件的只有 3 套。可以放宽段位、样本或阵容类型条件继续推荐。
```

不能自动放宽会影响结果语义的条件，除非用户明确同意。

### 7.2 待澄清状态

`pendingClarification` 至少记录：

```json
{
  "reason": "missing_required_entity",
  "expectedFields": ["subject.champion"],
  "candidateTask": {},
  "askedAt": "2026-07-26T15:00:00.000Z"
}
```

用户下一轮补充实体时，应优先填充待澄清任务，而不是创建无关新任务。用户明确切换任务或取消时，应清除它。

## 8. 接入 recommendation-service

`src/core/recommendation-service.js` 最终入口目标：

```js
async function handleUserTurn(input, options) {
  const state = await loadConversationState(options);

  const delta = await interpretTurn({
    input,
    state,
    semanticProvider: options.semanticTaskProvider
  });

  const resolution = reduceConversationState({
    state,
    delta,
    defaults: options.preferences,
    domainPolicy: tftConversationPolicy
  });

  if (resolution.decision !== "execute") {
    return buildControlledConversationResponse(resolution);
  }

  const result = await executeExistingAgentChain(
    resolution.resolvedTaskFrame,
    options
  );

  await writeConversationState(
    updateConversationStateFromResult(resolution.nextState, result),
    options
  );

  return result;
}
```

实际改造必须适配现有函数边界，不要求机械照抄伪代码。

接入原则：

1. 新链只负责在现有 Phase 6.6 执行链之前形成完整 TaskFrame。
2. `ExecutionPlan` 仍是唯一可以命名工具和完整参数的主动执行协议。
3. TaskFrame 到 Capability Matcher 之后的执行语义不变。
4. 现有缓存 key、数据查询、排序、Evidence Validator 不因本阶段改变。
5. 结果完成后统一提取 `lastResult` 元数据并写回状态。
6. comp 与 unit 不应再各自决定“这是不是续问”。

## 9. 结果元数据与状态回写

新增统一的结果状态提取器，例如：

```text
src/understanding/conversation-result-state.js
```

接口：

```js
conversationResultStateFromResponse(result)
```

返回：

```json
{
  "resultType": "comp_rankings",
  "toolName": "comps_rankings",
  "shownIds": ["comp-a", "comp-b", "comp-c"],
  "returnedCount": 3,
  "totalCount": 3,
  "cursor": null,
  "exhausted": true,
  "appliedConstraints": {
    "specialMode": true
  }
}
```

要求：

- 从结构化结果计算，不从最终文案反向解析；
- `totalCount` 不存在时允许为 `null`；
- 只有在证据有效、结果类型明确时才写入成功结果；
- 澄清、拒绝、不支持和工具失败不能污染上一条成功任务；
- 工具失败可记录独立失败状态，但不能伪造 `exhausted=true`；
- 新任务成功后替换 activeTask；
- 续问成功后更新 activeTask 和 lastResult；
- `shownIds` 用于“换一批”去重，但最终去重必须由确定性代码完成。

## 10. 旧逻辑迁移

### 10.1 需要迁移的旧入口

重点检查：

- `inheritCompRankingFromSession()`
- `inheritParsedFromSession()`
- `isCompRankingFollowUp()`
- `resolveTaskFrameContext()` 内用完整输入正则触发继承的分支
- `chat-semantic-task-provider.js` 中将特定中文续问词直接写入核心语义的提示

### 10.2 迁移策略

分为四步：

1. **只读适配**：从旧 session value 生成 `ConversationState.v2`。
2. **影子运行**：旧路径继续回答，新路径记录 delta、reducer 结果和差异。
3. **按 action 切换**：先切阵容排行，再切英雄出装/装备比较。
4. **收敛清理**：达标后移除旧路径的生产决策权和领域专用续问函数。

影子期允许旧逻辑存在，但最终验收不允许：

- 新旧上下文结果同时参与合并；
- comp 和 unit 各自维护一份 active task；
- 一个请求先被 v2 reducer 合并，再被旧函数二次继承；
- 为修复回归继续增加完整句子正则；
- 保留没有调用者的兼容代码却不注明删除计划。

### 10.3 开关与回滚

使用现有配置风格增加有限开关，例如：

```text
TFT_AGENT_CONVERSATION_STATE_V2_MODE=off|shadow|on
```

语义：

- `off`：旧路径；
- `shadow`：旧路径回答，新路径只记录差异；
- `on`：新路径回答。

回滚只切换开关，不做数据迁移。读取状态时必须兼容缺少 v2 字段的旧 session。

## 11. 可观测性

每轮至少记录：

```json
{
  "conversationStateVersion": "conversation-state.v2",
  "turnDeltaVersion": "turn-delta.v1",
  "dialogueAct": "request_more",
  "taskRelation": "continue",
  "reducerDecision": "exhausted",
  "inheritedFields": ["activeTask", "constraints.specialMode"],
  "changedFields": ["presentation.pageDirection"],
  "legacyDecision": "clarify",
  "newDecision": "exhausted",
  "decisionEquivalent": false,
  "toolEquivalent": null,
  "parameterEquivalent": null
}
```

不要在日志中记录 API key、完整敏感用户数据或无限聊天历史。

建议将差异分类为：

```text
task_relation_difference
active_task_difference
clarification_difference
tool_difference
parameter_difference
result_state_difference
exhaustion_difference
```

## 12. 测试计划

### 12.1 协议单元测试

新增建议：

```text
test/conversation-state-v2.test.js
test/turn-delta.test.js
test/context-reducer-v2.test.js
```

覆盖：

- schema 正常化与校验；
- 旧 session 到 v2 的迁移；
- conversationId 隔离；
- TTL/清空行为；
- set/add/remove/replace/clear；
- 非法 operation、field、value 被拒绝；
- 相同输入产生相同 reducer 输出；
- 新任务覆盖旧任务；
- 显式实体覆盖会话继承；
- modify 不丢失未修改字段；
- cancel 清理状态；
- pending clarification 被正确补全或取消；
- exhausted 不被误认为工具失败；
- 工具失败不污染成功状态。

### 12.2 多轮集成测试

至少加入以下完整序列：

#### 阵容更多结果

```text
推荐几个赌狗阵容
可以多推荐几套吗
```

断言：

- 第二轮 `dialogueAct=request_more`；
- 保留 `comp_rankings`；
- 保留赌狗/特殊模式条件；
- 不询问英雄；
- 如果 3/3，则 decision 为 exhausted；
- 如果存在更多结果，则结果不重复。

#### 阵容条件修改

```text
推荐几个赌狗阵容
只看大师以上
不要赌狗了
换成九五阵容
再来三个
```

逐轮断言：

- action/goal 连续性；
- 条件来源；
- 删除与替换语义；
- 工具名称；
- 完整工具参数；
- 无错误澄清。

#### 英雄与装备

```text
霞带什么装备
第二套呢
如果没有轻语呢
换成卡莎
刚才的霞再说一下
```

断言：

- 实体继承；
- 条件追加/删除；
- 实体替换；
- return 语义；
- 不发生 comp/unit 错误切换。

#### 澄清

```text
比较一下这两个
```

无可用 antecedent 时必须澄清；存在最近两个装备候选时应继承候选。

#### 会话隔离

两个不同 conversationId 交错发送续问，不能互相继承。

### 12.3 回归分类

评估结果不能只报告一个“上下文准确率”，至少拆分：

```text
实体继承
意图/任务继承
条件追加
条件删除
条件替换
指代消解
跨轮澄清
任务切换
任务恢复
更多/分页
结果耗尽
工具切换
会话隔离
```

工具错误还应拆分：

```text
错误工具
不应调用却调用
工具正确但参数错误
本应澄清却调用
本应调用却文本回答
```

### 12.4 真实 LLM 测试

必须进行真实 LLM 测试，因为 `TurnDelta` 的价值在于覆盖未写入规则的自然表达。

要求：

- 确定性 reducer 单元测试不依赖真实 LLM；
- 使用当前生产 provider/model 运行独立改写集；
- 同一语义包含口语、礼貌句、错别字、数量省略和不同语序；
- 每个关键案例至少重复 3 次；
- 记录 provider fallback；
- 测试集不得复制进 prompt 或生产正则；
- 模型失败时验证确定性降级不会错误调用工具。

示例改写只用于评估，不得成为白名单：

```text
还能再给点吗
再整几套
就这些了吗
有没有别的
多来几个看看
换一批别重复
再给我三套
```

## 13. 验收门槛

必须同时满足：

1. `npm test` 零失败。
2. 新增 reducer 单元测试 100% 通过。
3. 目标多轮回归集 100% 通过。
4. 独立真实 LLM 上下文 Pass^3 不低于现有架构门槛 95%，目标不低于 98%。
5. 本阶段涉及的工具选择准确率不下降。
6. 完整工具参数语义准确率不下降。
7. 不支持能力仍然 100% 诚实降级。
8. 不出现跨 conversationId 状态泄漏。
9. 不出现“新 reducer 合并后又被旧继承函数二次修改”。
10. 生产主路径中不再依赖阵容/英雄专用续问判断。
11. 通用 Agent 代码中不加入具体英雄、装备、阵容实例。
12. 不通过完整句子正则、评估样本泄漏或 prompt 枚举测试句过关。
13. 新任务首轮在新旧路径中的业务结果等价率不低于 99%。
14. 影子差异报告包含任务、澄清、工具、完整参数和结果状态，不只比较最终文案。

## 14. 预期用户效果

### 场景 A：结果已经耗尽

```text
用户：推荐几个赌狗阵容
Agent：返回 3/3 套阵容
用户：可以多推荐几套吗
Agent：当前符合“赌狗阵容”条件的只有这 3 套。可以帮你放宽段位、样本或阵容类型条件继续推荐。
```

### 场景 B：还有更多结果

```text
用户：推荐几个热门阵容
Agent：返回前 3 套
用户：换一批
Agent：返回下一批且不重复前 3 套
```

### 场景 C：修改条件

```text
用户：推荐几个赌狗阵容
用户：大师以上呢
Agent：继续查询赌狗阵容，只把段位改为大师以上
```

### 场景 D：切换任务

```text
用户：推荐几个赌狗阵容
用户：霞带什么装备
Agent：明确切换到霞的装备任务，不继承阵容排行参数
```

### 场景 E：恢复任务

```text
用户：霞带什么装备
用户：卡莎呢
用户：刚才的霞再说一下
Agent：恢复最近的霞任务及其有效条件
```

## 15. 交付物

开发完成后必须提交：

- `ConversationState.v2` schema、校验和旧状态迁移；
- `TurnDelta.v1` schema、校验和解析；
- 确定性 `ContextReducer`；
- recommendation-service 接入；
- 结构化结果状态回写；
- off/shadow/on 开关；
- 影子差异遥测；
- 单元测试和多轮集成测试；
- 真实 LLM 独立改写评估；
- 开发报告，包含修改文件、测试命令、实际结果、已知限制和回滚方法；
- 删除或退出生产主路径的旧领域专用续问逻辑清单。

## 16. 完成定义

本阶段不是在以下案例上“返回正确答案”就算完成：

```text
可以多推荐几套吗
```

只有同时满足以下条件才算完成：

- 用户表达不需要命中特定句式也能被解释为任务变化；
- 活动任务、上一结果、待澄清状态具有清晰的数据所有权；
- LLM 只产生受约束的语义增量；
- 确定性 Reducer 负责状态合并；
- 现有 Phase 6.6 执行链保持唯一执行主权；
- comp、unit 等领域不再各自维护上下文继承事实；
- 多轮评估和真实 LLM 评估达到门槛；
- 架构中没有通过补丁继续堆积的第二套上下文系统。

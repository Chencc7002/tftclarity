# Agent Runtime、工具注册与最小评估

## 范围

阶段 1 按既定方案为现有固定推荐流程增加统一运行生命周期、工具注册/执行和离线评估底座。领域解析、统计、过滤、排序、Evidence Pack、ConclusionSpec、QuestionContract 和展示序列化仍由原模块负责。本阶段没有引入自主 Planner、ReAct、MCP、多 Agent、写工具或自动长期记忆。

## 请求生命周期

每个 `/api/recommend` 请求由 `AgentRuntime` 创建 `agent_run.v1`：

```text
received
→ resolving
→ planning
→ retrieving
→ assembling_evidence（需要语义检索时）
→ generating_conclusion
→ validating
→ responding
→ terminal
```

业务终态为 `clarification_required`、`completed` 或 `fallback`；系统终态为 `cancelled`、`timed_out` 或 `failed`。终态不可改写，超时或取消后的迟到结果不会覆盖终态。事件观察器失败不会改变推荐结果。

默认预算：

- deadline：10 秒
- steps：12
- tool calls：12
- 每工具重试：1
- events：100

服务端配置会被边界化；客户端不能提高预算。公开响应只附加安全的 `agent_run_public.v1` 摘要，不返回内部事件、原始输入或敏感配置。HTTP 客户端断开会触发取消信号。

查询事件新增可选 `runId`。JSON store 向后兼容；SQLite 启动时以可重复迁移增加 `query_events.run_id` 和索引，旧记录保持 `null`。

## Tool Registry 与 Executor

`ToolRegistry` 与 `StructuredRetriever` 从同一 `STRUCTURED_OPERATION_REGISTRY` 派生，不维护第二份操作白名单。阶段 1 注册：

- `unit_builds`
- `unit_comp_candidates`
- `comps_rankings`
- `comps_trends`
- `comps_analysis`
- `unit_details`
- `item_details`
- `trait_details`
- `semantic_search`

`RetrievalPlan` 仍决定调用哪个 operation；LLM 不能直接提交工具名。`ToolExecutor` 在 handler 前完成工具存在性、来源和严格参数校验，并统一处理 timeout、AbortSignal、有限重试、事件、错误归一化与敏感信息脱敏。只有可恢复、幂等且未超过预算的失败可重试。

新增工具时必须：

1. 先在共享结构化 operation 源中声明唯一名称、来源和允许参数。
2. 提供 `agent_tool.v1` 描述，明确用途、禁用场景、关键输入和返回内容。
3. 声明只读性、风险、超时、幂等、缓存与副作用字段。
4. 复用既有 handler，不复制统计、排序或业务规则。
5. 添加注册漂移、非法参数、来源不匹配、取消、超时和敏感错误测试。

当前没有公开任意工具执行 endpoint，也没有写操作。

## 生产兼容

- 现有推荐响应结构保持不变，只附加 `run`。
- 现有直接函数入口保留；没有 Runtime 上下文时仍可用于原测试和脚本。
- 结构化推荐、详情目录与语义召回均经过统一注册工具。
- 结论 Provider 仍只能生成受 Evidence/QuestionContract/validator 约束的表达，不能改写数字、排名或实体。
- refresh、clear、赛季切换、缓存和前端旧请求取消契约继续由现有模块处理。

## 离线评估

运行：

```powershell
npm run eval:agent
```

`core-agent-cases.v1` 含 50 条必选用例，报告写入 `.cache/eval/agent-eval.json` 和 `.cache/eval/agent-eval.md`。报告包含 total、passed、failed、skipped、任务成功率、意图/澄清/工具/参数准确率、fallback/timeout 比例以及平均/P95 时延。必选失败返回非零；默认运行无网络、无真实 LLM、无随机报告差异。

## 安全与隐私

- Run/Event 不保存 Chain-of-Thought，也不复制原始输入。
- 工具错误裁剪到 300 字符并脱敏 authorization、cookie、token 和 key。
- Registry 拒绝未知工具、未知字段和来源不匹配，且在 handler 前失败。
- 评估数据不含 API Key、Cookie、个人标识或第三方大体积响应。
- 语义工具只召回静态知识，不提供实时排行事实。

## 已知限制

- 阶段 1 仍使用固定流程和既有 IntentEnvelope；组合式 TaskFrame/影子解析属于阶段 2。
- 评估延迟使用注入时钟，适合验证确定性，不代表生产网络 SLA。
- 系统 Node 18.20.8 没有 `node:sqlite` 或 optional driver，因此全量测试中 20 项 SQLite/provider/obsolete 条件跳过；Node 24.14.0 已单独验证 SQLite 定向测试与真实文件 smoke。
- 固定 50 例是最小契约集，不替代阶段 0 的 300 条真实风格失败集，也不支持对外宣称 95% 领域覆盖率。

## 回滚

回滚阶段 1 时可移除 `src/agent/`、评估 runner/数据集/脚本和 `run` 附加字段，并恢复推荐服务的 `StructuredRetriever` 直接执行路径。SQLite 的 `run_id` 是可空附加列，旧版本会忽略它，无需破坏性迁移。回滚不改变任何统计、排序、产品规则或既有业务数据。

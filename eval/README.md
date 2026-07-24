# Core Agent Evaluation

阶段 1 的最小评估层使用 `core-agent-cases.v1`，固定包含 50 条离线必选用例。它复用生产 `AgentRuntime`、`ToolRegistry`、`ToolExecutor`、`handleRecommendRequest` 与仓库 fixture，不访问网络，也不要求 LLM Key。

运行：

```powershell
npm run eval:agent
```

输出写入 Git 忽略目录：

- `.cache/eval/agent-eval.json`
- `.cache/eval/agent-eval.md`

任一必选用例失败、数据格式无效、fixture 缺失或指标出现 `NaN` 时命令返回非零退出码。`skipped` 独立统计，不计入 `passed`。

数据集覆盖装备与阵容主查询、英雄/装备/羁绊详情、多轮继承和改口、澄清、低样本与空结果、stale、Embedding/LLM 失败、工具注册安全、Runtime 超时/取消/预算/迟到结果、赛季隔离和 LLM 事实越权。契约场景只断言结构化字段，不比较整段自然语言。

报告中的延迟为注入时钟下的确定性离线值，不代表生产网络延迟。真实请求延迟继续由现有 smoke 和运行观测衡量。

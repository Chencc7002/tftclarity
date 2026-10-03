# Jev 开发资料包

核对日期：2026-09-29。用途：为 TFTAgent 的意图分类离线实验准备材料；尚未接入生产运行时。

## 账号状态

已登录 TypeSafe，工作区为 `tftclarity`。用户充值 $5 后，Billing 显示充值 Paid、Auto-recharge Off。已创建 `tftagent-dev-intent-shadow`，状态 Active；密钥只保存于 Git 已忽略的 `.env.jev.local`。不要把文件内容粘贴到报告或提交。账号实际速率配额未压测。

## 接入契约

- HTTP：`POST https://api.typesafe.ai/v1/systemone`，Bearer API Key，JSON 请求。
- 请求包含 `model`、`state`、`questions`；返回 `model`、`answers`、`usage`。
- Choice 返回选项、概率分布和 confidence；Noul 返回 yes 的概率；Score 用有序标准评分。
- Choice 最多 255 个选项；Score 使用 2–10 个等级。
- 401 表示认证失败，422 表示请求不符合契约；429 / 529 应有限次退避重试并服从总 deadline。
- 这不是聊天补全接口，不应直接当成现有 LLM provider 的 chat-completions 替换品。

来源：[HTTP API](https://docs.typesafe.ai/api)。

## SDK 和模型

官方 JavaScript 包为 `@typesafe-ai/sdk`，要求 Node.js 20+，支持 ESM / CommonJS / TypeScript。环境变量为 `TYPESAFE_API_KEY`；客户端为 `TypeSafeClient`，调用方法为 `systemOne`。当前项目未安装新依赖；附带示例直接使用 Node fetch。

来源：[JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)。

本次终端默认 Node 为 v18.20.8；采用官方 SDK 前需切换到 Node 20+。本材料的无依赖 fetch 示例已通过离线 dry-run。沙箱阻止了 Node 直接解析脚本路径，验证使用 `Get-Content -Raw docs/jev-development-kit/intent-smoke.mjs | node --input-type=module`，没有网络请求。

后续开发已找到随应用提供的 Node v24.19.0，可使用 `C:/Users/Chencc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe` 执行本项目；不需要修改系统 Node 安装。

官方模型页目前列出 `jev-1.13.0`，`jev-latest` / `jev-preview` 当前均指向它。实验建议固定版本并记录响应中的实际 model。

文档标价为输入 $0.042 / 百万 token，输出免费。请求总上下文 64k，state 加最长问题不超过 32k。文档公开限额为 250,000 token/s、1,200 request/min，且明确会动态调整；这些不是已验证的本账号配额。

仅支持文本输入。英文是主要训练语言，中文需要单独评估。客户请求不用于训练，但这不等于所有账号默认零保留。

来源：[Models](https://docs.typesafe.ai/models)。

## 第一阶段实验建议（项目建议，不是已实现功能）

1. 在离线样本中只判断意图类别，并保留 unknown、复合请求和缺上下文分支。
2. 实体解析、指代消解、参数生成、工具执行和 Evidence 校验沿用原有机制。
3. Quick Task 保持确定性；TaskFrame / ExecutionPlan 与独立 ReAct 两条路径保持原边界，不增加第三套执行运行时。
4. shadow 先记录候选判断；阈值必须在中文独立测试集上校准后再决定，不能直接采用示例阈值。
5. 样本覆盖中文简称、否定、歧义、续问、复合请求、域外问题和提示注入。比较分类混淆矩阵、回退率、任务成功率、P50/P95 延迟与整体成本。

Choice 的 confidence 是从概率分布计算的集中程度，不等同于业务正确率或执行许可。同一批问题独立求值，不能假设一个问题读得到另一个问题的答案。

来源：[Intent routing](https://docs.typesafe.ai/patterns/intent-routing)、[Confidence](https://docs.typesafe.ai/confidence)、[Introduction](https://docs.typesafe.ai/introduction)。

官方已知弱点包括字面理解、多层推理、无关长上下文、提示注入以及算术/日期比较。计数、排序、时间比较和权限判断仍由代码负责。

来源：[Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)。

## 本地示例

`intent-smoke.mjs` 是独立材料示例，标签不是生产 TaskFrame schema，不能直接路由工具。默认只输出合成请求，不访问网络：

```powershell
node docs/jev-development-kit/intent-smoke.mjs
```

创建密钥后，在本地进程环境安全设置 `TYPESAFE_API_KEY`，再显式启用一次真实请求：

```powershell
node docs/jev-development-kit/intent-smoke.mjs --live
```

示例固定官方 HTTPS 端点、15 秒超时，关闭重定向，不自动重试，最多一次推理请求。只发送脚本内合成输入，不读取聊天历史、日志或项目数据；输出限于经过基本校验的模型、分类、概率与 token 用量。真实验证记录见本文末尾及后续接入记录。

密钥只放服务端环境或秘密管理器，不写入本资料包、源码、浏览器前端或提交记录。

## 官方材料索引

- [完整文档索引](https://docs.typesafe.ai/llms.txt)
- [Quickstart](https://docs.typesafe.ai/introduction/quickstart)
- [Choice](https://docs.typesafe.ai/primitives/choice)
- [State](https://docs.typesafe.ai/concepts/state)
- [Function calling cookbook](https://docs.typesafe.ai/cookbooks/function_calling)
- [Parallel questions cookbook](https://docs.typesafe.ai/cookbooks/parallel_questions)
- [官方 Agent Skill](https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md)（仅作材料索引，未安装）
- [API Keys 控制台](https://console.typesafe.ai/keys)
- [Billing 控制台](https://console.typesafe.ai/settings/billing)

开发密钥与合成请求连通验证已经完成。密钥存放在 Git 忽略的本地环境文件中；不得写入本资料包。账户已充值 $5，最近一次控制台检查自动充值为 Off。

## 开发进度：独立 shadow 适配器

已新增：

- `src/understanding/jev-intent-shadow.js`：固定 TypeSafe 端点，版本固定，off/shadow 两种模式。只输出 action、domain、context 分类与概率、用量、耗时和动作一致性。
- `scripts/run-jev-intent-shadow.mjs`：6 条合成 smoke 样本；默认 dry-run 零请求，`--live` 最多 6 次串行请求，服务错误立即停止。预期标签是人工 smoke 标签，不是旧 LLM 实测结果，也不是独立验收集。
- `test/jev-intent-shadow.test.js`：离线契约与故障注入测试。

```powershell
& 'C:/Users/Chencc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' --test test/jev-intent-shadow.test.js
& 'C:/Users/Chencc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' scripts/run-jev-intent-shadow.mjs
```

真实调用需要 `TYPESAFE_API_KEY`，脚本加 `--live`。脚本不自动加载项目 `.env`，不读取用户会话或工具数据。当前本地可以用 Node 24 的 `--env-file=.env.jev.local` 显式载入开发密钥：

```powershell
& 'C:/Users/Chencc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' --env-file=.env.jev.local scripts/run-jev-intent-shadow.mjs --live
```

适配器无自动重试，超时包含响应体解析，也支持调用者取消；错误不输出 provider 错误正文、密钥或原始用户文本。只投影明确提供的 input 和有长度上限的 conversationSummary；调用者负责选择允许发送的摘要。

独立适配器阶段只完成 provider 边界与连通性验证。后续已新增默认关闭的 ReAct 旁路接入，详见 [意图识别开发记录](../jev-intent-development-20260929.md)。尚未启用生产观测、替换 LLM、校准阈值或通过生产中文精度验收。

## 2026-09-29 验证记录

- 新增离线契约/故障测试：6/6 通过。
- 相关 Agent 测试：266/266 通过。
- integration：238 通过、1 跳过、0 失败。
- agent eval：50/50 通过。
- main 基线：1702 通过、7 失败、7 跳过；新增测试后：1708 通过、7 失败、7 跳过。失败名称集合一致，未改动无关失败项。失败涉及 miniprogram-contract、patch-note-history、release-config、season-context、small-window-ui。报告位于 `.cache/eval/jev-*.xml`、`.cache/eval/jev-focused.log`。
- 真实 API：6/6 成功返回并通过响应契约校验；动作分类 5/6 符合 smoke 标签，脚本因此退出码 1，不视为验收通过。
- 已观察失败：`明天天气怎样？` 的 action 为 search（confidence 0.67），domain 为 out_of_domain（confidence 0.99）。独立问题之间并不保证一致性；未来候选接受逻辑必须结合 domain/context 并保留 legacy 回退，不能只按 action 路由。
- 装备样本 action 正确，但 domain 为 unknown，context 为 missing。需要实际领域上下文和多轮独立测试集；不得为了 smoke 全绿直接调阈值或把错误当成通过。
- 本次真实调用仅发送 6 条脚本合成请求，没有读取或发送真实用户会话。完整密钥未输出到测试日志。

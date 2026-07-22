# Question Contract 与 ConclusionSpec Registry

更新日期：2026-07-22

## 阶段状态

| 阶段 | 状态 | 结果 |
| --- | --- | --- |
| 0 架构审计与基线 | 完成 | 重构前系统 Node 基线为 510 项测试、490 通过、20 个既有 skip、0 失败 |
| 1 Question Contract | 完成 | `question-contract.v1` 已进入 Evidence Pack、LLM 请求、缓存、Validator 与安全诊断 |
| 2 ConclusionSpec Registry | 完成 | Prompt、支持 Intent、requiredEvidence、回答维度、generationRules、验证与回退配置已收敛 |
| 3 生成、验证与回退 | 完成 | LLM 输出升级为 v2；错误反馈重写和确定性回退保持原链路 |
| 4 现有能力迁移 | 完成 | 全部既有结论 Intent 与 legacy 别名已迁移，详情/澄清/错误状态未注册 |
| 5 声明式扩展 | 完成 | 新增 `unit_item_rankings.item_performance`，结论引擎核心流程未为该变体增加分支 |
| 6 测试与交付 | 完成 | 系统/Node 24、SQLite、smoke、audit 与真实 LLM 硬门槛均已通过 |

## 架构对比

重构前，结论能力分别由 `SUPPORTED_TYPES`、`SUPPORTED_INTENTS`、Prompt `ROUTES`、Planner 的 `PROMPT_KEYS`/`REQUIRED_EVIDENCE` 和 Evidence 中的 `generationRules` 决定。这些表可以独立漂移，且输出只绑定 Evidence Pack，没有绑定用户本轮问题。

重构后链路为：

```text
已校验 Parsed Query + Query + IntentEnvelope
  -> 精确解析 ConclusionSpec
  -> 生成 question-contract.v1
  -> 确定性检索与计算
  -> 带 Contract/Spec 元数据的 Evidence Pack
  -> 基础 Prompt + Spec Prompt + 可选纠错 Prompt
  -> llm_conclusion.v2
  -> 服务端确定性 Validator
  -> 合格结果展示 / 结构化反馈重写 / 原确定性结果回退
```

LLM 仍不参与排名、筛选、胜负、样本门槛、指标计算、Query 修改或远程操作选择。`StructuredRetriever` 的操作白名单仍在代码中，不属于 Spec。

## Question Contract 字段

`src/llm/question-contract.js` 定义 `question-contract.v1`：

- `schemaVersion`、`fingerprintVersion`：结构和指纹算法版本。
- `contractId`：规范化稳定字段的 SHA-256。对象键顺序不影响结果。
- `originalQuestion`：本轮原始输入，最多 500 字。
- `intent`、`questionType`、`resultType`：精确问题身份。
- `targets`：`comps`、`units`、`items`、`traits` 的规范化目标。
- `constraints`：查询约束、指标、assumptions、来源和继承 origins。
- `requiredAnswerDimensions`：必须回答或明确声明证据不足的维度。
- `requiredEvidence`：逐维度证据要求。
- `forbiddenClaims`：例如无历史证据的变化、确定因果。
- `onMissingEvidence`：当前固定为 `insufficient_evidence`。
- `needsClarification`：Intent/实体/问题类型低置信度时阻断结论生成。
- `scope`：SeasonContext 明文 ID，以及用户、会话的不可逆短指纹。不同赛季、用户、会话不会共享 Contract 状态。
- `spec`：绑定的 Spec ID 和版本。

Contract 只能从通过结构验证的 IntentEnvelope 和未失败的 Query/validation 生成。新问题、赛季切换、用户或会话变化都会改变 `contractId`。继承字段保留 `source`、`origin` 和 `origins`。

## ConclusionSpec 字段与注册规则

`src/llm/conclusion-spec-registry.js` 是结论生成层的唯一能力配置入口。每个 `conclusion-spec.v1` 包含：

- `id`、`version`、`enabled`、`priority`。
- `match.intent`、`match.questionType`、`match.resultTypes`。
- `prompt.key`、`prompt.file`、`prompt.version`。
- `requiredAnswerDimensions` 和逐维度 `requiredEvidence`。
- `forbiddenClaims`、`validationRules`、`generationRules`。
- `fallback.renderer`，指向现有确定性渲染类型。

启动编译会拒绝重复 ID、同优先级歧义、缺失 Prompt、非法 evidence token、未知 validator rule 和不存在的 fallback。运行期只允许三元组精确匹配；没有模糊、前缀、相似度或跨 Intent 回退。禁用 Spec 不参加匹配。

迁移后的结论能力包括：

| Intent | questionType |
| --- | --- |
| `unit_build_rankings` | `default` |
| `unit_build_completion` | `default` |
| `unit_best_3_items` | `default`（legacy） |
| `unit_item_rankings` | `default`、`item_performance` |
| `unit_emblem_rankings` | `default` |
| `unit_item_comparison` | `default` |
| `comp_rankings` | `default` |
| `comp_trends` | `default` |
| `comp_analysis` | `meta_fit`、`cause_up`、`cause_down`、`popularity_drop`、`force`、`goal_fit`、`contested`、`viability` |

`unit_details`、`item_details`、`trait_details`、clarification 和错误结果保持 structured-only。

## LLM 输出 v2

`llm_conclusion.v2` 在既有 UI 字段上增加：

- `contractId`：必须逐字匹配本次 Contract。
- `addressedDimensions`：已回答维度。
- `reasons[].dimension`、`alternatives[].dimension`：每段内容绑定维度。
- `missingDimensions`。
- `missingEvidence[] = { dimension, requiredEvidence }`。
- `status = ok | insufficient_evidence`。

`ok` 必须覆盖全部必答维度且不得声明缺失。`insufficient_evidence` 必须把每个维度划分为已回答或缺失，并完整列出缺失证据；已有充分证据时不能虚假声明缺失。

## Validator v3

新增结构化错误类别：

- `contract_id_mismatch`
- `missing_answer_dimension`
- `unsupported_answer_dimension`
- `dimension_without_evidence`
- `wrong_target`
- `current_fact_used_as_history`
- `unsupported_causal_claim`
- `question_focus_mismatch`

现有数字、实体、Evidence ID、低样本、stale、未决胜负、核心装备信号和全候选覆盖校验继续生效。特别规则会拒绝用当前事实冒充历史、把相关性写成确定因果、把热度题答成强度题，以及把单件装备表现答成完整出装推荐。

Validator v3 在严格事实边界前增加确定性 Citation Enricher/Repair：

- `item-signal:*` 的 `buildEvidenceIds` 只在内部展开为验证作用域，不修改用户可见引用。
- 数字必须同时匹配指标语义、数值、当前 Evidence 家族和查询范围；不能用同值的其他指标冒充。
- 实体或数值只有唯一合法来源时才自动补充 Evidence ID，随后重新执行完整 Validator。
- 多个合法来源属于歧义，只允许一次带最佳候选和明确反馈的 LLM 纠错。
- Evidence Pack 中不存在的事实、关键维度遗漏、范围冲突和因果越界直接拒绝并使用确定性降级结果。

纠错请求只发送有限的类别、输出字段路径、缺失 Evidence ID 和允许值，不发送密钥、内部 URL、本地路径或完整隐藏证据。达到修正上限或反馈重复后，UI 继续显示原确定性结果，不显示未通过校验的 LLM 文本。

## 缓存与迁移

结论缓存指纹现在同时包含：

- `specId`、`specVersion`
- Question Contract schema 和 `contractId`
- base/spec/provider Prompt 版本（当前基础 Prompt 为 `base-conclusion.v3`）
- `conclusion-validator.v3`
- 完整 Evidence fingerprint
- model

因此旧缓存不会命中新协议；无需数据迁移或清空数据库。原查询缓存、会话缓存、PBE/SeasonContext 隔离保持不变。

原 `PROMPT_KEYS`、`REQUIRED_EVIDENCE` 和 Prompt route 的兼容导出仍存在，但只由 Registry 投影生成，不再是第二份配置。新增或修改能力不得编辑这些投影。

## 如何新增、审核、测试、禁用和升级 Spec

1. 确认需求只使用现有结构化/语义证据，不需要新的远程操作或指标计算。
2. 在 Registry 新增精确的 `intent + questionType + resultType` Spec；声明维度、证据、验证、Prompt 和确定性 fallback。
3. 如需新 Prompt，只在 `src/llm/prompts/conclusion-intents/` 增加静态审核文件，并登记文件名。不得从远端动态加载 Prompt 或 Spec。
4. 添加正向、答非所问、证据不足、歧义和缓存版本测试。
5. 运行全量测试、真实 SQLite、smoke、audit 和真实 LLM smoke。
6. 禁用时把 `enabled` 设为 false，并保留版本记录；运行期不会匹配禁用项。
7. 升级时递增 Spec 和 Prompt 版本。字段或验证语义变化时同步升级 validator/cache 版本。

当前不实现动态 Spec 管理、远端自动启用、管理后台人工审批或 LLM 自动修改生产代码。未来若实现，必须经过独立的权限、签名、审计、发布和回滚设计；在此之前 Spec 只能随代码审核发布。

## 声明式扩展示例

`unit_item_rankings.item_performance` 复用已有单件排名证据，仅新增 Spec 和测试。它要求：

- `target_item_performance`
- `ranking_context`
- `sample_risk`

专项测试展示生成的 Question Contract；正确输出覆盖三维；“证据正确但推荐完整三件套”被 `question_focus_mismatch` 拒绝；目标装备记录缺失时通过合法 `insufficient_evidence` 返回。

## 验证记录

- 系统 Node 18.20.8 全量：529 项，509 通过，20 个既有 skip，0 失败。
- bundled Node 24.14.0 全量：529 项，521 通过，8 个既有 skip，0 失败；真实 `node:sqlite` 用例已执行。
- 真实 SQLite smoke：通过，覆盖落盘、重开命中、清理和零意外远程调用。
- small-window、离线 comps parity、在线 MetaTFT、visual smoke：通过。visual 使用 Codex bundled Playwright 且未使用 `--allow-skip`。
- aliases、items、item-patch audit：通过；alias 覆盖 units 62/62、traits 104/104、items 169/169，缺失 0；本轮 patch audit 无缺失本地化。
- 在线 MetaTFT smoke 的 Explorer items 和 unit_builds 成功；可选 `/comps` context 返回非 JSON，脚本按其既有非强制规则记录 warning，核心 smoke 通过。
- 既有 skip 均为历史 obsolete 或运行时不具备 `node:sqlite`/可选真实服务的用例，未新增 skip。
- 真实 LLM smoke：通过本机显式代理调用 `gemini-3.6-flash`，首次生成即返回 `generated`，耗时 6634ms，未命中缓存、未使用 Mock、未触发纠错或 fallback。

## 仍需代码开发的问题边界

以下需求不能只加 Spec：需要新的可靠数据源、全新指标、StructuredRetriever 操作、确定性排名/筛选算法、前端复杂卡片，或新的实体解析协议。遇到这些需求必须先做数据与安全设计，不能让 Spec 或 LLM 绕过现有边界。

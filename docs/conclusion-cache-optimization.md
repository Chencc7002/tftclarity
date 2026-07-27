# LLM 结论缓存优化设计

## 1. 文档状态

- 状态：设计稿
- 范围：结论生成层缓存，不修改 MetaTFT 数据查询、排序算法或 Agent 工具语义
- 目标：当影响回答的数据和语义契约均未变化时，复用已经验证过的 LLM 结论
- 安全原则：宁可少命中，也不能返回目标错误、条件错误、跨会话泄漏或已经失效的结论

## 2. 背景

当前系统会先获取结构化数据，组装 Evidence Pack，再调用结论模型生成回答。对于热门棋子、热门阵容或相同统计口径，短时间内可能出现大量重复查询。如果底层数据、用户目标、回答维度和生成配置均未变化，重复调用 LLM 不会增加事实价值，只会增加：

- 首次响应延迟；
- LLM Token 和调用费用；
- 上游服务限流风险；
- 同一数据产生不同措辞或不同判断的随机性。

因此，结论生成适合采用“内容寻址缓存”：不是只按用户原始文本缓存，而是对影响结论的规范化输入生成稳定指纹。

## 3. 当前实现

当前项目已经具备保守版结论缓存，核心实现在：

- `src/core/conclusion-service.js`
- `src/llm/question-contract.js`
- `src/app/small-window-server.js`
- `src/data/cache-store.js`
- `src/data/sqlite-cache-store.js`

当前行为包括：

1. `makeConclusionCacheKey()` 对完整 Evidence、Question Contract、Prompt 版本、Validator 版本和模型生成 SHA-256 缓存键。
2. 只有通过 `validateConclusionOutput()` 的结论才会写入缓存。
3. 默认结论缓存 TTL 为 30 分钟。
4. 缓存命中后返回 `cached: true`，不会再次调用结论模型。
5. `body.refresh=true` 会通过 `bypassCache` 强制重新生成。
6. SQLite 生产缓存按 `seasonContextId` 隔离。

当前方案安全但命中范围较窄。`QuestionContract` 包含原始问题、用户指纹和会话指纹，因此下面两个语义等价问题通常不能共享缓存：

```text
霞最稳的三件套是什么？
霞现在推荐哪三件装备？
```

本设计不是重写当前缓存，而是在保留现有精确缓存的基础上，增加可验证的规范化结论缓存。

## 4. 目标与非目标

### 4.1 目标

1. 相同数据、相同目标、相同约束和相同生成版本可以复用结论。
2. 语义等价的不同自然语言表达可以在安全条件下命中同一结论。
3. 数据、Patch、模型、Prompt、Validator、Skill 或规则变化后自动失效。
4. 缓存命中后仍使用当前 Question Contract 重新校验。
5. 同一缓存键的并发未命中只产生一次 LLM 请求。
6. 提供足够的命中、失效、节省成本和安全指标。

### 4.2 非目标

1. 不改变结构化数据查询和数据缓存策略。
2. 不用缓存掩盖数据源不可用或过期状态。
3. 不缓存 Clarification、Provider Error 或 Validator 拒绝结果。
4. 不把多轮上下文、用户偏好或私有数据无条件共享给其他用户。
5. 不为了提高命中率删除会影响回答含义的条件。

## 5. 总体架构

建议采用两级结论缓存：

```text
当前请求
  → 结构化查询与 Evidence Assembly
  → L1：现有精确 Contract 缓存
      ├─ 命中：返回
      └─ 未命中
          → 计算 Data Fingerprint
          → 计算 Answer Fingerprint
          → L2：规范化结论缓存
              ├─ 命中：绑定当前 Contract → Validator → 返回
              └─ 未命中：Single Flight → 调用 LLM → Validator → 写入 L1/L2
```

### 5.1 L1 精确缓存

保持现有行为，不改变缓存键语义。它适合：

- 同一会话重复提交；
- 浏览器重试；
- HTTP 重发；
- 完全相同的 Question Contract。

### 5.2 L2 规范化结论缓存

L2 不使用用户原始文本作为主要键，而使用：

```text
Answer Fingerprint =
  hash(Data Fingerprint + Normalized Answer Contract + Generation Versions)
```

L2 缓存的是“待绑定的结论内容”，不缓存原请求的 `contractId`。命中后必须写入当前 `contractId` 并重新执行 Validator。

## 6. 指纹设计

## 6.1 Data Fingerprint

Data Fingerprint 表示所有允许影响结论的事实输入。

建议采用字段白名单，而不是先序列化完整对象再删除少数字段。建议至少包含：

```js
{
  seasonContextId,
  provider,
  providerVersion,
  effectivePatch,
  sourceRevision,
  queryScope: {
    days,
    rankFilter,
    queue,
    minSamples
  },
  structuredEvidence,
  semanticEvidenceContentHashes,
  derivedSignals,
  warningCodes,
  reasoningSkillVersion,
  reasoningRuleVersion
}
```

其中：

- `structuredEvidence` 必须先规范化对象键顺序、数字精度和数组排序语义；
- 有排名语义的数组不能随意排序；
- Semantic Evidence 使用内容哈希和权威级别，不依赖临时检索分数；
- 如果来源更新时间会出现在最终回答或参与新鲜度判断，必须进入指纹；
- Skill 和推理规则接入后，其快照版本必须进入指纹。

不应进入 Data Fingerprint 的运行元数据：

- Query ID；
- Trace ID；
- 网络耗时；
- 当前是否命中数据缓存；
- LLM Job ID；
- 临时任务时间；
- 不会进入回答或验证规则的诊断字段。

## 6.2 Normalized Answer Contract

Normalized Answer Contract 表示用户真正要求系统回答什么。

建议包含：

```js
{
  intent,
  questionType,
  resultType,
  targets,
  normalizedConstraints,
  requestedMetrics,
  requiredAnswerDimensions,
  allowedAnswerDimensions,
  requiredEvidence,
  forbiddenClaims,
  locale,
  onMissingEvidence
}
```

默认不包含：

- `originalQuestion`；
- `principal`；
- `conversation`；
- 当前 `contractId`。

但只有在 Parser 已经把原始问题的关键语义完整归一化后，才能删除 `originalQuestion`。如果存在未被结构化表示的修饰语、用户偏好或指代关系，该请求必须继续使用 L1，不得进入共享 L2。

## 6.3 Generation Versions

以下任一项变化都必须形成新缓存键：

```js
{
  evidenceSchemaVersion,
  questionContractSchemaVersion,
  conclusionSpecId,
  conclusionSpecVersion,
  basePromptVersion,
  intentPromptVersion,
  providerPromptVersion,
  validatorVersion,
  model,
  conclusionCacheSchemaVersion
}
```

未来接入游戏理解 Skill 后，还必须增加：

```js
{
  skillManifestVersion,
  ruleEngineVersion,
  activeRuleSnapshotHash
}
```

## 7. 缓存值设计

建议新增缓存 Schema：

```json
{
  "kind": "llm_conclusion_v2",
  "schemaVersion": "llm_conclusion_cache.v2",
  "answerFingerprint": "sha256",
  "dataFingerprint": "sha256",
  "contentTemplate": {
    "schemaVersion": "llm_conclusion.v2",
    "status": "generated",
    "addressedDimensions": [],
    "missingDimensions": [],
    "missingEvidence": [],
    "headline": "",
    "summary": "",
    "reasons": [],
    "alternatives": [],
    "nextAction": null,
    "riskNotice": null
  },
  "model": "model-name",
  "versions": {},
  "scope": "conversation|principal|public",
  "createdAt": "ISO-8601"
}
```

`contentTemplate` 不保存旧请求的 `contractId`。缓存命中后执行：

1. 写入当前 `QuestionContract.contractId`；
2. 使用当前 Evidence、Catalog、ConclusionSpec 和 Question Contract 调用 `validateConclusionOutput()`；
3. 校验通过后返回；
4. 校验失败则删除或忽略该缓存项，并转为正常 LLM 生成；
5. 记录 `conclusion_cache_revalidation_failed` 事件。

## 8. 缓存作用域与隐私

L2 必须明确区分三种作用域。

### 8.1 Conversation Scope

适用于：

- 使用了上一轮问题；
- 存在指代消解；
- “按刚才的条件”；
- 多轮追加、删除或覆盖条件。

缓存键必须包含会话指纹。

### 8.2 Principal Scope

适用于：

- 使用用户保存的偏好；
- 使用用户自定义过滤条件；
- 存在账号级设置。

缓存键必须包含用户指纹，但不包含明文用户标识。

### 8.3 Public Scope

仅适用于：

- 公开数据；
- 单轮完整问题；
- 不依赖用户偏好；
- 不依赖之前对话；
- 不包含管理员或私有证据；
- 所有答案语义都已进入 Normalized Answer Contract。

只有 Public Scope 可以跨用户共享。

作用域判定应由 Harness 的确定性代码完成，不应让 LLM 自行决定。

## 9. 缓存策略

### 9.1 可缓存结果

默认允许缓存：

- Validator 通过的 `generated` 结论；
- Validator 通过且完全由当前证据决定的 `insufficient_evidence` 结论。

`insufficient_evidence` 建议使用更短 TTL，因为新数据可能很快补齐证据。

### 9.2 不可缓存结果

不得写入 L2：

- `provider_unavailable`；
- `invalid_output`；
- `unsafe_state`；
- `intent_or_entity_error`；
- 需要用户澄清；
- 数据过期；
- 数据源失败；
- Validator 拒绝；
- 包含未归一化自由文本偏好；
- 包含私有或管理员证据但作用域被判定为 Public。

### 9.3 TTL

内容指纹负责主要失效，TTL 作为安全兜底。

初始建议：

- L1：保留当前 30 分钟；
- L2 Public：先使用 30 分钟，不立即扩大；
- L2 Principal/Conversation：不超过当前会话或偏好数据有效期；
- `insufficient_evidence`：短于正常结论；
- 生产观察命中率、数据刷新频率和误用情况后再调整。

第一版不应为了追求命中率直接设置无限 TTL。

### 9.4 强制刷新

保留 `body.refresh=true` 的语义：

- 跳过 L1；
- 跳过 L2；
- 不加入已有 Single Flight；
- 重新调用 LLM；
- Validator 通过后覆盖相同指纹的缓存项。

## 10. Single Flight

缓存不能阻止多个并发请求同时遇到同一个未命中。建议增加进程内 Single Flight：

```js
Map<answerFingerprint, Promise<ValidatedConclusion>>
```

流程：

1. 第一个请求创建 Promise 并调用 LLM；
2. 后续相同 Fingerprint 请求等待同一个 Promise；
3. 完成或失败后必须在 `finally` 中删除 Map 项；
4. 每个等待者使用自己的当前 Contract 再绑定和验证；
5. `refresh=true` 默认不加入普通 Single Flight。

当前单实例 Docker 部署可以先使用内存 Map。未来多实例部署时，再升级为 Redis Lock、数据库租约或专用分布式 Single Flight；第一版不引入新的外部服务。

## 11. 建议代码结构

建议新增：

```text
src/core/conclusion-cache.js
src/core/conclusion-singleflight.js
test/conclusion-cache.test.js
```

职责建议：

### `conclusion-cache.js`

- `normalizeConclusionData(evidence)`
- `makeConclusionDataFingerprint(evidence, versions)`
- `normalizeAnswerContract(questionContract)`
- `makeNormalizedConclusionCacheKey(input)`
- `resolveConclusionCacheScope(context)`
- `bindCachedConclusionToContract(template, contract)`
- `validateCachedConclusion(candidate, evidence, options)`

### `conclusion-singleflight.js`

- 管理同一 Answer Fingerprint 的进行中请求；
- 提供 join、leader、completed、failed 事件；
- 保证异常和超时后清理。

### `conclusion-service.js`

- 保留现有 L1；
- 在 L1 未命中后调用 L2；
- L2 未命中后通过 Single Flight 调用 Provider；
- 只缓存通过 Validator 的模板；
- 保持现有回退语义不变。

### `question-contract.js`

- 保留现有 `contractId` 算法；
- 新增独立的可复用 Answer Contract 归一化函数；
- 不得为了提高缓存命中率改变 Question Contract 的安全隔离语义。

## 12. 可观测性

建议增加以下事件或指标：

```text
conclusion_cache_lookup
conclusion_cache_l1_hit
conclusion_cache_l2_hit
conclusion_cache_miss
conclusion_cache_scope
conclusion_cache_revalidation_failed
conclusion_cache_bypassed
conclusion_singleflight_leader
conclusion_singleflight_join
conclusion_singleflight_failed
```

核心指标：

- L1/L2 命中率；
- 按 Intent、Question Type、SeasonContext 的命中率；
- 避免的 LLM 调用次数；
- 避免的输入/输出 Token；
- 估算节省费用；
- 缓存命中响应 P50/P95；
- 重新验证失败率；
- Single Flight 合并次数；
- 强制刷新后的结论差异率。

日志和指标不得记录：

- API Key；
- 原始用户问题全文；
- 明文用户标识；
- 私有证据内容。

## 13. 测试要求

## 13.1 单元测试

必须覆盖：

1. 完全相同的 Evidence 和 Contract 命中 L1。
2. 不同自然语言、相同规范化语义命中 L2。
3. 任一统计值变化必须 L2 miss。
4. Patch、SeasonContext 或 Provider Version 变化必须 miss。
5. Prompt、Spec、Validator 或模型变化必须 miss。
6. Skill 或规则版本变化必须 miss。
7. 相同数据但不同目标指标不能命中。
8. 相同数据但不同过滤条件不能命中。
9. 多轮上下文请求不能误进入 Public Scope。
10. 用户偏好不同不能跨 Principal 共享。
11. 缓存模板绑定当前 Contract 后能通过 Validator。
12. 旧模板验证失败时自动回源生成。
13. Provider Error 和 Validator Error 不写入 L2。
14. `refresh=true` 绕过 L1、L2 和普通 Single Flight。
15. 同一 Fingerprint 的并发请求只调用一次 Provider。
16. Single Flight 失败后 Map 不残留。

## 13.2 反事实测试

至少包含：

- “最稳”与“登顶率最高”使用相同数据但生成不同缓存键；
- “推荐三件套”与“为什么这样出装”使用相同数据但不同回答维度；
- 相同阵容在不同 Patch 不能共享；
- 同一问题在用户修改偏好后不能复用旧结论；
- 数据值未变化但 Skill 规则发生变化时不能复用；
- 只改变网络耗时、Trace ID 或 Query ID 时仍应命中。

## 13.3 HTTP/E2E 测试

验证：

- 第二次等价请求的 Provider 调用数不增加；
- HTTP Payload 正确返回 `cached=true` 和缓存层级；
- 强制刷新产生真实 Provider 调用；
- SQLite 重开后 L2 缓存仍可命中；
- 缓存项过期后正常回源；
- 线上回退输出与缓存关闭时兼容。

## 14. 验收门禁

上线前必须满足：

1. 全量现有测试保持通过。
2. 所有“数据或语义变化必须 miss”的测试通过率 100%。
3. 所有作用域和隐私隔离测试通过率 100%。
4. 缓存返回结论的 Validator 通过率 100%。
5. 同一 Fingerprint 并发请求 Provider 调用次数严格为 1。
6. Shadow 阶段中，L2 候选与真实重新生成结论不存在目标、条件、证据引用或 Status 冲突。
7. 不以固定命中率作为第一版上线门槛；先采集真实流量基线，再设定优化目标。

## 15. 分阶段实施

### 阶段 A：基线和模块抽取

- 记录当前 L1 命中率和结论调用成本；
- 将现有缓存读写封装到独立模块；
- 不改变生产行为。

### 阶段 B：双指纹 Shadow

- 实现 Data Fingerprint 和 Answer Fingerprint；
- 每次请求计算 L2 Key，但不返回缓存；
- 记录理论命中、作用域和冲突情况；
- 建立等价问题、反事实和隐私回归集。

### 阶段 C：会话内 L2

- 只在 Conversation Scope 内启用；
- 命中后重新绑定 Contract 并校验；
- 保留 L1 和强制刷新。

### 阶段 D：Public L2 与 Single Flight

- 只对明确无个性化、无多轮依赖的公共查询开放；
- 增加进程内 Single Flight；
- 监控命中率、重新验证失败率和节省成本。

### 阶段 E：TTL 和作用域优化

- 根据真实数据刷新周期调整 TTL；
- 按 Intent 分别配置；
- 如果未来采用多实例，再增加分布式 Single Flight；
- 不在缺乏数据的情况下提前引入 Redis。

## 16. 风险与缓解

### 风险一：错误地把不同问题视为等价

缓解：

- 使用字段白名单构造 Normalized Answer Contract；
- 原始语义未完全结构化时禁用 Public L2；
- 命中后重新执行 Validator；
- 建立反事实测试。

### 风险二：跨用户泄漏

缓解：

- 确定性 Scope Resolver；
- Public Scope 禁止用户偏好、历史上下文和私有证据；
- 使用哈希指纹，不写明文身份；
- 默认从 Conversation Scope 起步。

### 风险三：规则或 Prompt 更新后继续返回旧结论

缓解：

- 所有生成和规则版本进入缓存键；
- Schema 版本升级直接切换缓存命名空间；
- TTL 作为兜底。

### 风险四：缓存错误结论

缓解：

- 只缓存 Validator 通过结果；
- 缓存命中后重新验证；
- 强制刷新；
- 支持按缓存 Schema 或 Fingerprint 清理。

### 风险五：命中率提高但数据已经过期

缓解：

- 必须先获得当前 Evidence，再查询结论缓存；
- 不允许结论缓存绕过数据新鲜度检查；
- Stale Evidence 不进入 L2。

## 17. 回滚方案

建议增加独立开关：

```env
TFT_AGENT_CONCLUSION_CACHE_L2_MODE=off|shadow|on
TFT_AGENT_CONCLUSION_SINGLEFLIGHT_MODE=off|on
```

回滚顺序：

1. 将 `TFT_AGENT_CONCLUSION_CACHE_L2_MODE=off`；
2. 保留现有 L1 精确缓存；
3. 如有必要关闭 Single Flight；
4. L2 使用独立前缀，无需删除即可停止读取；
5. 不涉及业务数据迁移。

## 18. 预期效果

在热门查询重复度较高时，预计可以获得：

- 更低的结论生成延迟；
- 更少的 LLM 请求和 Token 成本；
- 更低的供应商限流概率；
- 相同数据下更稳定的用户结论；
- 热点请求并发时只生成一次；
- 在不牺牲 Question Contract、Evidence 和 Validator 安全边界的前提下提高缓存命中率。

该优化属于现有架构上的增量增强，不需要修改 Agent Runtime 主循环、工具注册或结构化统计逻辑。第一阶段应先完成 Shadow 指纹和真实命中率测量，再决定 Public L2 的开放范围与 TTL。

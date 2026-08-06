# LLM 结论缓存优化开发 Prompt

> 使用方式：将本文件中“Prompt 正文”完整交给负责开发的 Agent。设计依据见同目录下的 `conclusion-cache-optimization.md`。

---

## Prompt 正文

你现在负责在 `C:\Users\Chencc\Desktop\TFTAgent` 中实现“LLM 结论缓存优化”。请持续执行直到代码、测试、文档和验收证据全部完成；只有遇到无法从仓库、测试或现有配置中确定，并且不同选择会实质改变产品行为的阻塞问题时，才向用户提问。

你的任务不是新增一个简单的“原始问题字符串缓存”，而是在不破坏现有 Question Contract、Evidence、Validator、SeasonContext 和隐私边界的前提下，把当前保守的精确结论缓存升级为：

```text
L1 精确 Contract 缓存
+ L2 规范化结论缓存
+ 缓存命中重新验证
+ 确定性缓存作用域
+ Single Flight 并发合并
+ Shadow/On/Off 发布开关
+ 完整可观测性和回归测试
```

## 一、必须先阅读

开始修改前，完整阅读：

1. `docs/conclusion-cache-optimization.md`
2. `src/core/conclusion-service.js`
3. `src/llm/question-contract.js`
4. `src/llm/conclusion-validator.js`
5. `src/retrieval/evidence-assembler.js`
6. `src/retrieval/contracts.js`
7. `src/app/small-window-server.js`
8. `src/llm/conclusion-provider.js`
9. `src/data/cache-store.js`
10. `src/data/sqlite-cache-store.js`
11. `test/conclusion-service.test.js`
12. `test/conclusion-http.test.js`
13. `test/llm-pipeline-e2e.test.js`
14. 与 Runtime Status、Query Event、Conclusion Event、缓存 TTL 有关的现有实现和测试

阅读后先用简短文字记录：

- 当前 L1 缓存键包含哪些字段；
- 当前缓存值格式、TTL 和存储位置；
- `refresh` 如何绕过缓存；
- Question Contract 中哪些字段包含请求、用户或会话作用域；
- 当前 Validator 对 Contract ID、Evidence ID、目标和因果结论有哪些要求；
- 当前 SQLite 和内存缓存有哪些可复用接口。

不要在没有理解现有 L1 行为前开始重构。

## 二、工作区安全

1. 开始时执行 `git status --short`。
2. 工作区可能已有用户或其他 Agent 的未提交文件，包括文档；不得删除、覆盖、重命名、暂存或提交不属于本任务的更改。
3. 不得使用 `git reset --hard`、`git checkout --` 或其他破坏性清理命令。
4. 不得读取、输出或修改真实 `.env`、API Key、Cookie Secret、Admin Token。
5. 不得调用真实付费 LLM 完成测试；使用 fixture provider、fake provider 或 deterministic stub。
6. 不得推送、部署腾讯云、创建 PR 或修改生产配置，除非用户另行明确授权。
7. 默认不创建提交；完成后报告建议提交范围，等待用户决定。

## 三、不可破坏的架构约束

### 3.1 L1 必须保留

现有 `makeConclusionCacheKey()` 和精确 Contract 缓存语义必须保留。可以内部封装，但：

- 相同请求仍能命中；
- `cached: true` 兼容字段继续工作；
- 现有缓存测试保持通过；
- `body.refresh=true` 继续绕过现有缓存。

### 3.2 L2 不能绕过数据获取

每次请求必须先获得当前结构化结果并完成 Evidence Assembly，然后才能查询 L2。

禁止：

```text
只根据用户问题直接返回历史结论
```

否则无法判断数据、Patch、过滤条件、来源状态或规则是否已经变化。

### 3.3 Question Contract 不能为了命中率被削弱

不要修改现有 `contractId` 的安全语义，也不要从 Question Contract 中删除：

- 原始问题；
- principal scope；
- conversation scope；
- 目标、约束和回答维度。

应新增一个独立的、只用于 L2 的 Normalized Answer Contract。

### 3.4 L2 命中必须重新验证

L2 缓存不得直接保存并返回旧 `contractId`。命中流程必须是：

1. 取出无旧 `contractId` 的 `contentTemplate`；
2. 绑定当前 Question Contract 的 `contractId`；
3. 使用当前 Evidence、Catalog、Spec 和 Contract 运行现有 Validator；
4. 通过后返回；
5. 失败则忽略该缓存项并正常调用 Provider；
6. 记录安全事件和指标。

### 3.5 作用域必须由确定性代码决定

缓存作用域至少包括：

```text
conversation
principal
public
```

不得让 LLM 决定作用域。

Public Scope 只能用于：

- 公开数据；
- 单轮完整问题；
- 无上一轮指代；
- 无用户偏好；
- 无私有、管理员或受保护证据；
- 所有语义都已进入规范化 Contract。

任何无法证明可公开共享的请求，默认降级为 Conversation Scope。

### 3.6 不引入新基础设施

当前为单实例 Docker 部署。第一版 Single Flight 使用进程内 `Map`，不得为此新增 Redis、PostgreSQL、消息队列或新付费服务。

## 四、目标代码结构

优先新增：

```text
src/core/conclusion-cache.js
src/core/conclusion-singleflight.js
test/conclusion-cache.test.js
```

可以根据仓库现有风格调整文件名，但不得把全部逻辑继续堆入 `small-window-server.js`。

## 五、实现要求

## 5.1 缓存 Schema 和版本

定义明确版本，例如：

```js
export const CONCLUSION_CACHE_SCHEMA_VERSION = "llm_conclusion_cache.v2";
export const CONCLUSION_DATA_FINGERPRINT_VERSION = "conclusion_data_fingerprint.v1";
export const CONCLUSION_ANSWER_FINGERPRINT_VERSION = "conclusion_answer_fingerprint.v1";
```

L2 Key 必须使用独立前缀，例如：

```text
llm_conclusion_v2:<scope>:<sha256>
```

不得与现有 L1 Key 混用。

## 5.2 稳定规范化

实现稳定 JSON 规范化：

- 对象键排序；
- 明确定义数组是保持顺序还是集合化；
- 排名数组、回答维度和证据顺序不能被错误排序；
- 集合语义字段去重并稳定排序；
- 非有限数字不得进入指纹；
- 不以 `JSON.stringify()` 的偶然插入顺序作为契约。

优先采用字段白名单构建指纹，不采用“序列化整个 Evidence 后删除几个字段”的方式。

## 5.3 Data Fingerprint

至少覆盖：

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

以下运行字段不得导致无意义 miss：

- Query ID；
- Trace ID；
- Job ID；
- 网络耗时；
- 本次数据是否从缓存读取；
- 仅用于诊断且不进入回答的临时时间；
- 对结论无影响的对象插入顺序。

如果某个时间字段会进入回答或新鲜度判断，则必须保留，不能为了命中率删除。

## 5.4 Normalized Answer Contract

至少覆盖：

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

默认不进入：

- `originalQuestion`；
- `principal`；
- `conversation`；
- 当前 `contractId`。

但如果原始问题中存在未被 TaskFrame、IntentEnvelope、Query 或 Question Contract 结构化表达的重要修饰语，该请求不得进入 Public L2。实现一个保守的 Eligibility/Scope Resolver，而不是假设 Parser 永远完整。

## 5.5 Generation Versions

Answer Fingerprint 必须覆盖：

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
  conclusionCacheSchemaVersion,
  skillManifestVersion,
  ruleEngineVersion,
  activeRuleSnapshotHash
}
```

如果 Skill/Rule 字段当前不存在，使用稳定的 `null`，并为未来输入保留明确接口；不得扫描整个运行时对象猜测版本。

## 5.6 L2 缓存值

缓存值至少包含：

```js
{
  kind: "llm_conclusion_v2",
  schemaVersion,
  answerFingerprint,
  dataFingerprint,
  contentTemplate,
  model,
  versions,
  scope,
  createdAt
}
```

要求：

- `contentTemplate` 不含旧 `contractId`；
- 不保存原始问题全文；
- 不保存明文 principal/conversation；
- 不保存 API Key 或 Provider Header；
- 保持现有输出 Schema；
- 只有 Validator 通过的内容才能写入。

## 5.7 缓存模式

增加配置：

```env
TFT_AGENT_CONCLUSION_CACHE_L2_MODE=off
TFT_AGENT_CONCLUSION_SINGLEFLIGHT_MODE=off
```

允许值：

```text
L2: off | shadow | on
Single Flight: off | on
```

语义：

- `off`：完全保持当前行为；
- `shadow`：计算 Key、作用域、理论命中和冲突指标，但绝不使用 L2 改变返回结果；
- `on`：允许返回经过重新验证的 L2 结论。

生产默认必须是 `off`。不得因为本地测试通过就默认开放。

配置解析必须：

- 拒绝未知值；
- 在 Runtime Status 中仅暴露 mode、schemaVersion、enabled 等非敏感字段；
- 不暴露 Key、Endpoint 或任何密钥；
- 更新 `.env.production.example` 的安全默认值和注释。

## 5.8 TTL

继续使用现有 CacheStore。L2 TTL 默认先与当前结论 TTL 保持一致，不擅自延长为无限。

如增加独立 TTL：

```env
TFT_AGENT_CONCLUSION_CACHE_L2_TTL_MS=1800000
```

必须：

- 使用有界正整数；
- 写测试覆盖默认值、非法值和覆盖值；
- `insufficient_evidence` 如需单独 TTL，应使用更短值；
- 不允许 TTL 绕过 Data Fingerprint 和 Validator。

## 5.9 Single Flight

实现：

```js
Map<answerFingerprint, Promise<ProviderResult>>
```

要求：

1. 相同 Fingerprint 的首请求为 leader；
2. 后续请求 join 同一 Promise；
3. Provider 成功、失败、超时或 Validator 失败后都必须清理 Map；
4. 每个等待请求仍绑定自己的 Contract 并验证；
5. 不复用旧 HTTP Response 对象；
6. `refresh=true` 默认绕过普通 L1、L2 和普通 Single Flight；
7. 不同 Fingerprint 不互相阻塞；
8. Single Flight 不得吞掉 Provider Error 或改变现有 fallback。

## 5.10 可缓存与不可缓存结果

允许：

- Validator 通过的 `generated`；
- Validator 通过且完全由当前证据确定的 `insufficient_evidence`。

禁止写入 L2：

- Clarification；
- Provider Error；
- Invalid Output；
- Unsafe State；
- Intent/Entity Error；
- Stale Evidence；
- 数据源失败；
- Validator 拒绝；
- 无法证明作用域安全；
- 包含未结构化用户偏好或私人内容。

## 5.11 事件和指标

增加并测试：

```text
conclusion_cache_lookup
conclusion_cache_l1_hit
conclusion_cache_l2_hit
conclusion_cache_miss
conclusion_cache_shadow_hit
conclusion_cache_scope
conclusion_cache_revalidation_failed
conclusion_cache_bypassed
conclusion_singleflight_leader
conclusion_singleflight_join
conclusion_singleflight_failed
```

指标至少能统计：

- L1/L2 命中；
- 按 Intent、Question Type、SeasonContext 的命中；
- 避免的 Provider 调用；
- Single Flight join 数；
- 重新验证失败；
- 强制刷新；
- 理论节省 Token/费用时，不得伪造供应商价格。

不得记录原始问题、密钥或明文用户标识。

## 六、集成顺序

按以下阶段执行，并在每个阶段运行定向测试：

### 阶段 A：纯函数与契约

1. 新增缓存 Schema。
2. 实现稳定规范化。
3. 实现 Data Fingerprint。
4. 实现 Normalized Answer Contract。
5. 实现 Scope Resolver。
6. 实现缓存模板绑定和重新验证辅助函数。
7. 只写纯函数单元测试，不改线上路径。

### 阶段 B：Shadow 集成

1. 保留 L1 原路径。
2. L1 miss 后计算 L2 指纹。
3. `shadow` 模式记录理论命中，但返回结果必须与 `off` 完全一致。
4. 不增加额外 Provider 调用。
5. 增加 Runtime Status 和安全事件。

### 阶段 C：L2 On

1. 命中后绑定当前 Contract。
2. 重新运行 Validator。
3. 验证失败自动回源。
4. Provider 生成并通过验证后写入 L2。
5. 保持现有响应字段兼容；如增加 `cacheTier`，必须是可选非破坏字段。

### 阶段 D：Single Flight

1. 只包围真正的 Provider 生成工作。
2. 同一 Fingerprint 并发请求只能调用一次 Provider。
3. 覆盖成功、失败、刷新和不同 Fingerprint 并发测试。

### 阶段 E：SQLite 和 HTTP 验收

1. SQLite 重开后 L2 仍可命中。
2. TTL 到期后回源。
3. HTTP `refresh` 绕过全部缓存层。
4. `/api/runtime` 不泄露敏感配置。
5. Public/Principal/Conversation Scope 行为符合预期。

## 七、必须实现的测试

至少覆盖以下用例：

### 7.1 正向命中

1. 完全相同 Evidence 和 Contract 命中 L1。
2. 不同自然语言、相同规范化语义在安全作用域命中 L2。
3. 只改变 Trace ID、Query ID、网络耗时或对象插入顺序仍命中。
4. SQLite 关闭重开后仍命中。

### 7.2 必须 Miss

1. 任一可见统计值变化。
2. 排名顺序变化。
3. Patch 或 SeasonContext 变化。
4. Provider/Provider Version 变化。
5. Days、Rank、Queue、MinSamples 变化。
6. “最稳”与“登顶率最高”。
7. “推荐什么”与“为什么这样推荐”。
8. Prompt、Spec、Validator 或模型版本变化。
9. Skill 或规则版本变化。
10. 用户偏好变化。
11. 前一轮上下文变化。

### 7.3 安全与隐私

1. 多轮指代不能进入 Public Scope。
2. 不同 Principal 的个性化请求不能共享。
3. 管理员/私有证据不能进入 Public L2。
4. 缓存中不存在原始问题、密钥和明文身份。
5. 旧 Contract ID 不会从缓存返回。
6. L2 命中重新验证失败时不会把候选返回给用户。

### 7.4 状态与错误

1. Clarification 不缓存。
2. Provider Error 不缓存。
3. Invalid JSON 不缓存。
4. Validator 拒绝不缓存。
5. Stale Evidence 不缓存。
6. `refresh=true` 真实调用 Provider。

### 7.5 并发

1. 20 个相同 Fingerprint 并发请求只调用一次 Provider。
2. 20 个不同 Fingerprint 不被串行化。
3. Leader 失败后所有等待者收到兼容错误/回退，Map 被清理。
4. 失败后的下一次请求可以重新成为 leader。

## 八、验证命令

先确认：

```powershell
node --version
npm --version
```

运行：

```powershell
node --test test/conclusion-cache.test.js
node --test test/conclusion-service.test.js
node --test test/conclusion-http.test.js
node --test test/llm-pipeline-e2e.test.js
npm test
git diff --check
```

如果系统 Node 低于项目完整 SQLite 验收所需版本：

- 使用项目文档中已经验证的 Node 24；
- 或使用 Codex Workspace Dependencies 提供的 Node 24；
- 必须记录实际 Node 版本；
- 不得把因缺少 SQLite Driver 而 skip 的结果描述为“SQLite 已通过”。

不得因为某个定向命令的路径或测试名需要调整，就跳过相应测试；应先查明仓库实际测试入口。

## 九、验收门禁

完成必须同时满足：

1. L2 `off` 时，现有行为和响应结果保持兼容。
2. L2 `shadow` 时，不改变用户结果，不增加 Provider 调用。
3. L2 `on` 时，缓存返回结果 Validator 通过率 100%。
4. 所有“数据或语义变化必须 miss”用例通过率 100%。
5. 所有作用域与隐私隔离用例通过率 100%。
6. 同一 Fingerprint 并发 Provider 调用次数严格为 1。
7. 全量现有测试无新增失败。
8. SQLite 路径在真实支持的 Node/Driver 下验证。
9. `git diff --check` 无错误。
10. 不存在真实外部 LLM 调用、生产部署、秘密泄漏或无关文件修改。

不得用单一“缓存命中率”掩盖错误命中。第一版不设虚构的命中率目标，应先以 Shadow 数据建立真实基线。

## 十、文档更新

实现完成后：

1. 更新 `docs/conclusion-cache-optimization.md`，将实际实现与原设计差异写清楚。
2. 更新 `.env.production.example`，默认保持关闭。
3. 如仓库有 Runtime 配置或部署文档，补充：
   - 开关含义；
   - Shadow 观察方式；
   - On 的启用前置条件；
   - 回滚方法。
4. 新增一份简短验收报告，至少包含：
   - 实际文件列表；
   - 测试命令和结果；
   - Node 版本；
   - L1/L2/Single Flight 行为证据；
   - 已知限制；
   - 默认生产状态；
   - 回滚方式。

## 十一、回滚要求

必须支持只通过配置回滚：

```env
TFT_AGENT_CONCLUSION_CACHE_L2_MODE=off
TFT_AGENT_CONCLUSION_SINGLEFLIGHT_MODE=off
```

回滚后：

- 继续使用现有 L1；
- 不读取 L2；
- 不需要删除业务数据；
- 不影响 Query Cache、Session、Preferences 或 Agent Runtime；
- L2 独立 Key 前缀可以保留并等待 TTL 自动清理。

## 十二、最终交付格式

完成后向用户报告：

1. 结论：是否完成，默认是否影响生产。
2. 实现文件：新增和修改文件列表。
3. 架构结果：L1、L2、Scope、Revalidation、Single Flight 如何工作。
4. 测试结果：总数、通过、失败、跳过及跳过原因。
5. 安全结果：隐私隔离、强制刷新、错误不缓存、秘密检查。
6. 性能证据：fixture 下 Provider 调用减少和并发合并结果。
7. 已知限制：当前尚未覆盖的多实例或跨进程能力。
8. 工作区状态：明确哪些文件属于本任务，哪些既有更改被保留。
9. 不自动提交、不推送、不部署；等待用户下一步指令。

不要仅给出设计或伪代码。目标是完成可运行、可测试、默认关闭、可安全回滚的生产候选实现。

---

## 预期结果摘要

该 Prompt 执行完成后，项目应具备：

- 保持兼容的现有 L1 精确缓存；
- 基于数据和语义契约的 L2 缓存；
- Conversation/Principal/Public 三类隔离；
- 缓存命中后的 Contract 重新绑定和 Validator 校验；
- `off/shadow/on` 安全发布模式；
- 相同 Fingerprint 的进程内 Single Flight；
- SQLite 持久化复用；
- 完整测试、指标、文档和配置回滚能力；
- 默认不改变腾讯云生产行为。

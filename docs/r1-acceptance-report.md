# ReAct Agent R1 验收报告（真实验收进行中）

> **状态入口已迁移：** 本文是 2026-08-07 的历史 RA 验收记录，其中
> `RA-02 through RA-05 pending` 不再代表当前 release status。后续 G3、G4-A、G5 与 G5-O
> 的真实验收及 V2 Public Beta 当前边界统一见
> [R1 Release Readiness](r1-release-readiness.md)。本文不得再作为独立发布签字入口。

> 2026-08-07 复核：此前 UI-07D/E 的“通过”证据来自只对卡尔玛场景注入确定性决策和数据的 visual fixture。该证据只能证明契约回归，不能证明真实模型能够理解并处理任意英雄，因此不得用于产品功能验收。原 `R1 Product Functional Acceptance — PASSED` 结论已撤回。随后完成的真实修复与 RA-01 结果记录如下；R1 总体仍未签字。

验收时间：2026-08-07（Asia/Shanghai）

## 结论

R1 的契约与 fixture 回归已完成。真实模型、真实工具链已经通过 RA-00 来源证明、霞单例 remediation 和 RA-01 十英雄基础出装矩阵，但 RA-02～RA-05 尚未完成，因此当前正式状态仍为 `BLOCKED — RA-02 through RA-05 pending`，不得宣称 `R1 Product Functional Acceptance — PASSED`。

## 真实模型 / 真实工具验收进展

### RA-RMD-01：霞单例 remediation — PASS

- 运行源：正式 `small-window-server`、真实 `deepseek-v4-flash`、production registry/handlers、真实 MetaTFT、BrowserUse。
- 输入：`霞怎么做装备`；解析实体：`TFT17_Xayah`。
- 工具轨迹：`entity_catalog_query -> unit_builds_batch -> item_details_batch -> finish`。
- 结果：1 套稳定方案 + 2 套备选，聊天正文展示真实统计与轻语、海妖之怒、巨人杀手机制分析；结果区显示三张确定性卡片和 MetaTFT 数据源，无“查询失败”。
- 产品经理确认：可记为单例真实 E2E remediation PASS；不能抵扣 RA-01，也不能代表 R1 总体通过。

### failure-termination remediation — PASS

- `insufficient_evidence` 文案不合规时先允许一次受约束修复；再次失败则生成有明确原因的确定性用户可见答复。
- 模型 JSON 截断或 Action 无效时仅重试一次；仍失败但已有构筑 Evidence 时保留确定性卡片，不清空结果。
- `sufficient_evidence` 中出现 Evidence 不支持的统计时仍拒绝；允许模型基于拒绝原因修复一次，再失败则只保留确定性卡片和警告，不展示不可信数字。
- `0.745576 -> 74.6%`、`2.9973 -> 3.00` 视为同一 Evidence 数值的确定性格式化；伪造的 `80.0%` 仍拒绝。

### MetaTFT same-patch stale-if-error — implemented

- fresh cache TTL：30 分钟。
- stale-if-error retention：24 小时。
- 仅允许 `seasonContextId` 和实际 patch 同时相同的缓存；跨赛季或跨补丁不复用。
- 使用 stale cache 时在 source risks 和 UI 来源状态中显式披露，不伪装成实时数据。

### RA-00 / RA-01：真实十英雄矩阵 — PASS

RA-00 运行来源：`decisionProviderMode=real_model`、`model=deepseek-v4-flash`、`toolHandlerMode=production`、`dataMode=live_or_production_cache`、`fixtureMode=false`。

按 `SHA256(gitHEAD + seasonContextId)` 分层抽取 10 个 1～5 费正式英雄：伊泽瑞尔、佐伊、莎弥拉、锐雯、劫、蕾欧娜、格温、奥恩、卡尔玛、娑娜。

| 指标 | 最终结果 | 门槛 |
| --- | ---: | ---: |
| 合法用户可见终止 | 10/10 | 10/10 |
| 返回至少 1 套真实构筑 | 10/10 | ≥8/10 |
| `status=failed` | 0 | 0 |
| `invalid_finish` | 0 | 0 |
| 未知工具执行 | 0 | 0 |

完整证据：[RA-01 最终矩阵](../.artifacts/r1-acceptance/ra-01-real-hero-matrix-final.json)。首次冷运行数据可用率为 7/10；第二次缓存补全到 10/10，但发现奥恩 finish 统计不受 Evidence 支持并被拒绝；修复为“拒绝数字、修复回答、保留卡片”后，第三次矩阵达到上述最终门槛。三个阶段均保留，未跳过失败样本。

## 产品规则落地

- 调用链固定为 `unit_builds_batch -> DifferentiatingItemSelector -> item_details_batch -> grounded narrative -> finish`。
- 一次请求最多调用两个工具：一次出装统计、一次装备详情批量查询。
- 稳定方案排第一，备选方案按统计结果排第二、第三；样本不足时明确降级，不填充虚构方案。
- 差异装备由确定性选择器生成，只查询稳定方案与备选之间不同的装备；最多四件，优先保证每套备选至少有一组完整替换对。
- 装备机制结论绑定当前赛季 `evidenceId + claimId`。例如珠光护手支持“技能可以暴击”，莫雷洛秘典支持“施加重伤、降低治疗”。
- “对方回复能力较高时可考虑鬼书”只能以 `mechanism_based_advice` 和“基于装备机制推断”标签展示，不伪装成统计事实。
- 当前赛季证据缺失或赛季不匹配时返回 `mechanismStatus=unavailable`、`current_season_item_evidence_missing`，前端显示“缺少当前赛季装备机制证据，暂不做适用场景推断。”
- LLM 仍可输出用户可读说明，但每条统计、机制和条件建议都必须通过终止策略的证据校验；不合格叙述会被拒绝或降级。

## Fixture BrowserUse 契约回归（非产品验收）

| 场景 | 结果 |
| --- | --- |
| UI-07A：三套方案数量与顺序 | 通过：稳定方案 750 样本，备选 1 为 600，备选 2 为 500 |
| UI-07B：方案不足 | 通过：仅返回两套并标记 `insufficient_samples` |
| UI-07C：叙述边界 | 通过：无证据数字、排名矛盾和虚构引用均被拒绝 |
| UI-07D：差异装备机制 | 通过：备选卡展示珠光护手/鬼书与青龙刀/蓝霸符的机制差异；条件建议带推断标签 |
| UI-07E：证据缺失降级 | 通过：卡片和统计保留，不展示机制差异或适用场景；显示缺证据风险 |
| 浏览器控制台 | UI-07D、UI-07E 均无 `error`/`warn` |

截图证据：

- [UI-07D 装备机制差异](../.artifacts/r1-acceptance/ui07d-browser.png)
- [UI-07E 当前赛季证据缺失降级](../.artifacts/r1-acceptance/ui07e-browser.png)

## 自动化验证

聚焦测试：`differentiating-item-selector`、ReAct loop、R1 integration、small-window UI，共 63/63 通过。

最终 CI 连续三轮均通过，生产工具超时配置未放宽：

| 轮次 | 主测试 | 集成测试 |
| --- | --- | --- |
| 1 | 865 tests，852 pass，13 skip，0 fail | 222 tests，221 pass，1 skip，0 fail |
| 2 | 865 tests，852 pass，13 skip，0 fail | 222 tests，221 pass，1 skip，0 fail |
| 3 | 865 tests，852 pass，13 skip，0 fail | 222 tests，221 pass，1 skip，0 fail |

JUnit 证据位于 `.artifacts/r1-acceptance/ci-main-final-{1..3}.xml` 与 `.artifacts/r1-acceptance/ci-integration-final-{1..3}.xml`。

此前集成测试中一个旧阵容回归用例隐式访问真实客户端，单测耗时约 4.35 秒并在整条链路中触发 8 秒截止。该用例已改为显式本地夹具，耗时降至约 0.10 秒；生产截止时间保持不变。

## 已撤回的产品终审签字

产品经理曾于 2026-08-07 根据 fixture 验收摘要给出以下结论；由于证据方法不成立，该签字已撤回，不再代表当前状态：

- `R1 Product Functional Acceptance — PASSED`
- UI-07C、UI-07D、UI-07E 全部通过。
- 此前“有条件通过”正式解除，当前没有 R1 产品功能阻断项。
- Gate A–D、UI-01～UI-07E、ReAct Core、H1 Tool Coverage、Conversation Bridge 与 CI Stability 均为 `PASSED`。

产品经理同时说明：默认全量上线仍须经过常规灰度监控和回滚演练；这是独立的生产发布流程，不影响 R1 产品功能验收通过。

Current decision: BLOCKED. RA-00、RA-RMD-01 与 RA-01 已通过；RA-02 grounded explanation、RA-03 timeout/cache degradation、RA-04 true empty-data degradation、RA-05 完整 Browser E2E 仍是产品签字前的必需项。Fixture 结果只保留为契约回归证据。

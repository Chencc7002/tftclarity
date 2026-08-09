# R1 G3 真实验收结论

日期：2026-08-07

## 产品签核

产品经理已正式批准：

- `G3 Given Replacement Structural Evaluation`：PASS
- `G3 Invalid Target Handling`：PASS
- `G3 Existing-member Replacement Handling`：PASS
- `G3 Deterministic Trait / Breakpoint Delta`：PASS
- `G3 Qualitative Strength Conclusion`：NOT_EVALUATED / OBSERVE
- 批准进入 `G4-A Composition Item Contention Detection`

该签核不包含“自动寻找最佳替换”或“替换后强度评估”。

## 真实运行来源

- 决策模型：`deepseek-v4-flash`
- 工具处理器：production
- fixture：false
- grounding mode：observe
- 阵容来源：实时或生产缓存的 MetaTFT `comps_data + comps_stats`
- 棋子与羁绊事实：当前赛季官方目录

验收报告：`.artifacts/r1-acceptance/r1-real-g3-matrix.json`

## 依赖式工具链

```text
comps_rankings
  -> entity_catalog_query(target + replacement)
  -> unit_details(target)
  -> unit_details(replacement)
  -> composition_replacement_evaluation
```

最后一步依赖前面产生的 `compositionRef`、成员关系、实体解析结果和当前赛季棋子事实。羁绊数量与档位变化由确定性 evaluator 计算，不由模型心算。

## 动态三案例

动态抽样阵容为 `cluster:409008`，本轮显示名为“神谕者 · 厄运小姐”。正常替换样本为亚托克斯到阿卡丽。

### 正常替换

- 状态：`completed / evaluated`
- 成员校验：通过
- 堡垒卫士：`2 -> 1`，阈值 `[2,4,6]`，`breakpointChange=deactivated`
- 狂战士：`0 -> 1`，阈值 `[2,4,6]`，仍未激活
- `strengthConclusion=not_evaluated`
- 未出现“更强、最优、统计上更好”等无证据结论

### target 不属于阵容

- 状态：`completed / invalid_target`
- 原因：`target_not_member_of_composition`
- 前端明确说明被替换棋子不是该阵容成员，无法执行替换

### replacement 已属于阵容

- 状态：`completed / invalid_replacement`
- 原因：`replacement_already_in_composition`
- 前端明确说明替换棋子已经在阵容中，替换不成立

## 验收中发现并修复的问题

1. 官方 trait `levels` 被同名 catalog 记录覆盖，导致阈值为空。现采用字段保留合并，并兼容 `tierCounts`、`levels`、`effects`、`conditionalTraitSets`。
2. ReAct 前置校验曾阻止非成员 target 进入 evaluator，导致泛化 `no_progress`。现由 evaluator 返回结构化业务失败。
3. `invalid_replacement` 后模型曾误用 `direct_answer`，导致 `invalid_finish`。决策合同现要求引用结构化失败 Evidence，并使用 `sufficient_evidence`。
4. 模型曾在同一答案中先正确陈述“档位失活”，后又称“均无档位变化”。现增加通用确定性 breakpoint 矛盾校验，允许一次模型修复；若仍矛盾，则丢弃模型 prose，直接渲染确定性 delta 并保留 warning。

这里没有限制模型的定性判断自由；只拦截与确定性工具事实直接冲突的陈述。

## 前端最终可见结论

本地前端 `http://127.0.0.1:17335/` 已显示真实模型最终回答：

> 将亚托克斯替换为阿卡丽后，堡垒卫士数量从 2 个变为 1 个，激活档位由 2 档变为未激活；狂战士数量从 0 个变为 1 个，但未达到 2 个的激活阈值，仍为未激活。该评估未评价替换后的强度，因此不判断强弱。

## 回归

- G3 相关与架构聚焦测试：60/60 PASS
- 真实动态 HTTP 三案例：PASS
- Browser 正常案例最终结论：PASS
- Browser 中曾出现一次请求级“查询失败”，后续重试成功；该次没有产生错误结论，作为运行可靠性样本保留

## 下一步边界

进入 `G4-A` 时只验“同一阵容成员在真实构筑中是否竞争同一件装备”。不在本阶段回答“装备必须优先给谁”，也不得用模型猜测的 `primary_carry` 或 `primary_tank` 作为确定性工具参数。

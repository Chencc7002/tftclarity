# R1 G4-A 真实验收结论（进行中）

## 当前状态

- G4-A Case 1 — Partial Coverage / No Observed Contention：PASS
- G4-A Positive Case 2 — Available Contention / Complete Coverage：PASS
- G4-A Positive Case 3 — Available Contention / Complete Coverage：PASS
- G4-A Item Mechanism Grounding：PASS
- G4-A Allocation-priority Restraint：PASS
- G4-A Overall：PASS（产品已签）

## 运行来源

- 页面：`http://127.0.0.1:17335/`
- 前端 ReAct：enabled
- 决策模型：`deepseek-v4-flash`
- tool handlers：production
- data mode：live_or_production_cache
- fixture：false
- grounding mode：observe

## Case 1

用户原话：

> 在神谕者·厄运小姐阵容里，哪些有真实构筑数据的棋子会竞争同一件装备？只报告实际交集和官方装备机制，不判断装备必须优先给谁。

首次前端回答把厄运小姐、奥恩之间的无交集错误扩大为整个阵容不存在竞争，同时又承认维克托、茂凯请求超时。产品将其判为 coverage scope grounding failure。

修复后的前端模型原文：

> 在神谕者·厄运小姐阵容中，已成功获取构筑数据的棋子为厄运小姐和奥恩。根据这两名棋子的真实构筑选项，未检测到任何共享装备（无竞争关系）。具体来说，厄运小姐的构筑选项集中在物理输出装备（如杀人剑、无尽、巨人杀手、青龙刀、轻语），而奥恩的构筑选项集中在防御装备（如石像鬼、振奋、狂徒、日炎），两者没有交集。需要说明的是，维克托和茂凯的构筑数据因请求超时未能获取，因此整个阵容可能还存在未观察到的装备竞争，不能绝对断言不存在竞争。

产品复核后将 Case 1 更新为 PASS。

## 固化合同

- `status` / `contentionStatus`：`available | no_contention | insufficient_build_data`
- `coverageStatus`：`complete | partial`
- 显式记录 `eligibleUnits`、`successfulUnits`、`failedUnits`
- timeout 不得等价为 empty builds
- 局部 Evidence 可以证明存在一处竞争；负面全阵容结论必须具有完整 coverage
- partial coverage 必须披露失败成员，并明确无法判断整个阵容是否仍有其他冲突
- `priorityConclusion=not_evaluated` 时不得声称装备必须优先给某成员

## 回归

G4-A detector、composition resolution、ReAct loop、decision prompt 与 HTTP integration 聚焦套件：59/59 PASS。

## 动态 HTTP 与 Browser 正向矩阵

动态 HTTP 脚本：`scripts/run-r1-real-g4a-matrix.mjs`

真实产物：`.artifacts/r1-acceptance/r1-real-g4a-matrix.json`

- 动态候选尝试数：4
- `positiveCaseCount`：2
- `validPositiveCaseCount`：2
- `atLeastThreeDynamicCases`：true
- `acceptancePassed`：true

Browser Positive Case 2（挑战者·卑尔维斯）：

- 无尽：金克丝 / 卑尔维斯 / 阿卡丽
- 轻语：金克丝 / 卑尔维斯
- 血手：卑尔维斯 / 阿卡丽
- 羊刀：金克丝 / 卑尔维斯
- 官方机制可见；coverage complete；未判断装备优先级；console error 0

Browser Positive Case 3（神谕者·佐伊）：

- 鬼书：佐伊 / 维克托
- 电刀：佐伊 / 维克托
- 狂徒：蕾欧娜 / 莫德凯撒
- 日炎：蕾欧娜 / 莫德凯撒
- 官方机制可见；coverage complete；未判断装备优先级；console error 0

产品最终签核：

- `G4-A Item Contention Detection — PASS`
- `G4-A Item Mechanism Grounding — PASS`
- `G4-A Allocation-Priority Restraint — PASS`

## 下一步

不直接实现 G4-B。先完成：

1. G2-R Composition Role Evidence preflight；
2. G5 Given Constraint Re-query preflight；
3. 仅在 production 数据或查询 schema 确实支持时再进入实现与真实验收。

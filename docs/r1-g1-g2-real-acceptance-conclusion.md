# R1 G1/G2 真实组合验收结论

- 日期：2026-08-07
- 验收服务：`http://127.0.0.1:17338/`
- 模型：`deepseek-v4-flash`
- 工具模式：production handlers
- 数据模式：live / production cache
- Fixture：`false`
- Grounding：`observe`

## 产品审核结论

| 能力 | 结论 |
| --- | --- |
| G1 Composition Resolution | PASS |
| G1 Composition Member Retrieval | PASS |
| G1 Ambiguity Handling | PASS |
| G2 `member_of_comp` Evidence | PASS |
| G2 `itemized_core_candidate` Evidence | PASS |
| G2 主 C / 主坦 / core / flex 直接角色证据 | PARTIAL / OPEN |
| G2 Qualitative Role Inference | OBSERVE MODE |
| G3 Given Replacement Evaluation | NEXT（产品已批准） |
| G4-A Equipment Contention | G3 后可开始 |
| G4-B Role-aware Allocation | BLOCKED BY ROLE EVIDENCE |
| R1-E2E-COMPOSITE-001 | BLOCKED |

## 有效真实样本

阵容和棋子均从当次 MetaTFT 当前排名动态抽取，没有写入生产名称表：

- 阵容：`cluster:409008`，神谕者 · 厄运小姐。
- 成员：7 名。
- G1：`comps_rankings` 返回 `resolution.status=resolved`，命中同一 `compId`，所有成员带 `member_of_comp`。
- G2：连续 3 次“阵容 + 亚托克斯定位”均完成动态阵容解析并取得成员证据。
- 歧义：动态选取在 12 套候选中出现的布里茨；仅问“布里茨阵容”时返回 `ambiguous` 并 `ask_user`，没有静默挑选。

## 定性判断观察

有效的 3 次角色回答中，模型都把“前排、过渡、挂件”等结论写成“我的判断 / 更可能 / 推测 / 缺乏直接证据”，没有把它们冒充成已验证的主 C、主坦或固定核心统计事实。

这是一个很小的观察样本，只能记录为：

- 无证据强断言：人工复核 `0/3`。
- 明确标注的定性推断：人工复核 `3/3`。
- 不能据此推导长期幻觉率；需要扩大动态重复矩阵。

`itemized_core_candidate` 只表示该成员在当前阵容定义里出现过成装构筑记录，不等价于 `core_member`、`primary_carry`、`primary_tank` 或 `flex_slot`。

## 本轮发现并修复的缺口

production handler 曾错误地把用于目录构建的 `compOptions` 聚合对象当作 `/comps_data` 页面定义，导致阵容工具返回 `not_found`。修复后，组合查询强制使用同一 cluster 的真实 `/comps_data + /comps_stats`，并新增回归测试防止再次接错。

## 复测与可靠性说明

- 组合、ReAct、decision prompt 与架构聚焦回归：58/58 PASS。
- production bundle 接线回归：12/12 PASS。
- 修复后的第一轮真实矩阵：G1/G2/ambiguity 全部通过。
- 随后一次重复矩阵遭遇连续 `decision_provider_failed`，没有形成相反的功能证据，按产品审核记为 `INCONCLUSIVE`，不覆盖前一轮有效结果；若重复出现，应单列为模型供应商运行可靠性阻断项。

## 下一步

产品批准进入 G3：用户给定 A → B 替换后，系统基于真实阵容成员、官方棋子资料和确定性羁绊/断点计算结构变化；不得让模型自行计算掉层或补羁绊，也不得在没有统计证据时宣称“换完更强”。

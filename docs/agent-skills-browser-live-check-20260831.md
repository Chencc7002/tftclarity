# Skill 浏览器真实问答检查 — 2026-08-31

后续修复及实际 Prompt 注入复测见 `agent-skills-candidate-repair-20260831.md`。
本文保留修复前的历史结果，不以新的部分成功覆盖原始失败记录。

结论：Shadow 选择与排除边界可工作，真实页面可以同时显示装备与多个阵容卡片。
当前不能判定 Skill 1.3 完整行为验收通过：新指令没有注入模型，而且现有问答路径
在站位调用前的阵容解析处失败。此次没有修改生产代码、`.env`、工具权限或验证器。

## 测试方式

通过 Browser 技能操作真实本地页面，手动选择赛季、输入问题、发送和展开卡片。
独立服务绑定 `127.0.0.1:17432`，使用原有服务端、注册工具及已配置的真实模型
`deepseek-v4-flash`。没有替换模型动作或工具响应，没有使用上一轮固定卡片样本。
数据存储使用独立内存，历史文件位于本次临时目录，访问策略沿用现有配置。

本地服务只额外开启 `AGENT_SKILLS_SHADOW_V1` 等效观测选项，记录选择与完成投影。
当前 `.env` 已设置 `TFT_AGENT_REACT_TASK_FRAME_CONTROL_V1=true`，本次没有改变它。
**TaskFrame Control 与 Skill Control 不是同一开关。** 前者现有路径可以查询英雄详情、
装备和阵容；Skill 1.3 的 instructions 仍未进入模型输入。

此前交接文档关于 legacy 首答只查装备的说明仍适用于 legacy 分支，但不足以描述
这次本地配置下已启用的 TaskFrame Control 分支。不能因为模型调用了阵容工具，
就推断 Skill Prompt 已生效。以实际代码、配置和记录为准。

## 结果

| 输入 | 赛季 | Skill 选择 | 实际结果 |
| --- | --- | --- | --- |
| 努努怎么玩？ | Set 17 | 未选中 | `entity_catalog_query` 返回 not_found，要求澄清，约 4.2 秒 |
| 沃里克怎么玩？ | Set 18 | `unit_play_guidance@1.3.0`，Shadow | 4 个工具成功，2 次站位动作被拒绝，约 18.1 秒 |
| 只查询沃里克的推荐出装 | Set 18，新会话 | 未选中 | 仅实体目录和出装工具，约 4.2 秒，显示装备结果 |

第一项说明未解析英雄不会强行触发 Skill；它不证明 Set 17 不存在该英雄，
只证明本次加载的目录按这个输入没有找到结果，目录/别名问题需独立检查。
三次共记录 12 个成功模型决策、5 个模型修复重试，0 个 provider error。
单次浏览器检查不替代冻结语料 A/B、稳定性评估或上线门槛。

## 需要处理的问题

### 1. 站位查询缺少逐卡解析步骤

第二项实际成功调用：

`entity_catalog_query → unit_details → unit_builds → comps_rankings`

阵容工具返回 2 个候选，每个都有自己的 `tacticalDetailQueryPlan`，但结果是候选
查询，未满足战术详情验证器要求的 prior resolved composition。模型随后两次直接
尝试 `composition_tactical_details`，均被拒绝，没有发生站位工具执行。

首条拒绝原因是：`compositionId must reference prior resolved current comps_rankings evidence`。
其余计划、cluster、成员顺序及赛季校验随后也失败。下一步应验证模型能否先用
`comps_rankings` 解析各自身份，再使用对应计划查询；不应放宽验证器来掩盖问题。
1.3 指令已经描述了此步骤，但本次运行未使用这份指令，不能据此认定它有效或无效。

### 2. 回答结束与完整玩法目标仍有差距

该轮以 `completed / sufficient_evidence` 结束，返回装备、阵容概述与英雄特点。
没有站位 Evidence，没有逐卡解读，也没有“拿到推荐装备或来牌顺时考虑玩”的条件。
“什么时候玩”目前是 optional，因此缺少它不单独构成强制完成校验失败。

页面保留装备与 2 张阵容卡片；展开两张卡片都能看到“暂无可验证的站位数据”，
没有补造站位。这是缺失数据展示正确，不能算完整站位功能通过。

### 3. Shadow 事实适配器与真实返回字段尚未对齐

结束观测只计入 `composition_context`，完成投影为 rejected，诊断包括：

- `season_scope_missing`：实际出装已返回并在页面显示，但该结果缺少适配器要求的
  赛季字段，`equipmentStatisticsObserved=false`。这是证据范围契约/映射缺口，
  不能据此报告“出装工具没有执行”。
- `tool_not_allowed`：现有运行时合法调用了 `unit_details`，但该工具不在 Skill
  当前计入范围内。这不是未授权工具执行，后续需审视允许工具与事实映射契约。
- `stale_evidence`：实体目录时间被当前观测窗口判断过期。目录的版本有效期与
  统计的新鲜度是否应共用窗口，需要明确契约，不能直接去掉检查。

`answerCoverage` 是严格匹配来源句子的下界观测，并非语义回答评分；其空列表不能
解释为用户完全没收到有效回答。它也没有参与生产 finish 决策。

## 复核材料与后续

本轮原始材料保存在 `.cache/eval/skills-browser-20260831/`：

- `report.json`：三项结果、真实工具调用、拒绝原因、Shadow 投影和调用统计。
- `observations.jsonl`、`response-{1,2,3}.ndjson`：观测记录与原始页面响应。
- `warwick-dom.txt`、`equipment-dom.txt`、`warwick-browser.png`：页面文本和截图。
- `server.mjs`、`summarize.mjs`：临时测试入口与汇总脚本；不是生产路由。

临时服务在检查后停止。没有声称本次已完成 Skill 1.3 的真实 Prompt 测试。
后续应先补齐范围契约和逐卡解析流程，在独立候选入口使用 1.3 并明确替换原专业
指引，再进行相同浏览器用例和正式离线评估；保留现有验证器、预算和回退规则。

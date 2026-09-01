# Skill 真实候选修复与复测 — 2026-08-31

后续进展见 `agent-skills-deadline-recovery-20260831.md`：隔离候选已支持超时部分
结果与请求内原始数据复用；两套站位已能取得，完整交付仍被多阵容校验串用阻塞。

结论：已补齐真实工具返回的范围字段、逐卡身份解析指引，以及可以确认 Prompt
实际注入的隔离浏览器入口。真实模型已成功取得装备、阵容与其中一套阵容的站位。
**多个候选各自都有站位的端到端验收仍未通过，不能推广到生产 Skill Control。**

本文接续 `agent-skills-browser-live-check-20260831.md`。此前检查只有 Shadow，
本轮确实把候选 Skill 指令送入了已配置的 `deepseek-v4-flash`。

## 已实现

1. 默认 ReAct `unit_builds` 返回服务端确定的 `scope.seasonContextId/patch`；
   `entity_catalog_query` 同样补充服务端范围。保留原始 query 和来源时间，不用
   新的查询时间覆盖过期来源，也不接受模型指定的越权范围。
2. 未解析的阵容候选在 `tacticalDetailQueryPlan.resolutionPrerequisite` 中明确给出
   `comps_rankings` 和精确来源身份参数。`ready` 只表示参数完整，不能替代身份解析。
   `composition_tactical_details` 原有 resolved、cluster、完整成员及赛季校验不变。
3. 新增显式导出的 `UNIT_PLAY_GUIDANCE_SKILL_V1_4` 候选。允许工具仍取实际运行时
   catalog 的交集，补计现有官方详情工具，不注册新工具、不扩大运行时权限。
   指令明确逐卡解析、查询、绑定站位、保留初始候选引用，并给出一般选用条件。
4. 仅 1.4 的 Shadow 适配器识别官方 `unit_details.facts.role`。分类不是阵容主C、
   主坦；成员身份、技能文本和装备统计不能替代角色或机制依据。
5. 新增 `scripts/start-unit-play-skill-browser.mjs` 和
   `src/experiments/unit-play-guidance-browser/candidate.js`。入口复用同一次真实
   TaskFrame 解析，经确定性匹配后通过已有 `guidanceRenderer` 替换专业指引。
   在实际 provider 请求序列化之后校验内容、记录 hash、工具交集与 parseCount。
   并发请求隔离，未选中、未取得可信 TaskFrame 或主体不匹配时调用原 provider。

默认 `UNIT_PLAY_GUIDANCE_SKILL` **仍为 1.3**。1.4 只由隔离入口显式选择。
Quick Task 路由、工具 schema、Evidence 验证器、nextActionAffordance、预算、
审批策略和生产模型配置均未改变。没有修改 `.env`，没有增加 Skill Control 开关。
本地原有 TaskFrame Control 已开启，与 Skill Control 不同；隔离入口要求前者
原本可用，不自行开启。历史冻结实验、1.0 定义与既有 A/B 结果不改写。

## 浏览器实测

全部使用真实页面输入、现有服务端、注册工具和真实模型，没有替换模型动作或
工具返回。内存数据与历史目录隔离；每个配置先写 manifest 后才发起问答。
所有运行均维持 30 秒预算。不同配置、冷启动与重复查询不可视为冻结配对 A/B。

| 记录 | 问题/配置 | 结果 | 模型格式修复 |
| --- | --- | --- | --- |
| r1 | 沃里克怎么玩；初版 1.4 指令 | 4 个工具完成，3 次站位动作被拒；安全部分回答，23.9 秒 | 5 |
| r2 | 中文指令与明确前置解析字段 | 6 个工具完成，0 次动作拒绝；取得一套站位，29.1 秒 | 5 |
| r3 | 增加完整动作格式和候选引用要求 | 6 个工具完成，0 次动作拒绝；仍只引用一套阵容，27.6 秒 | 5 |
| r4 / response-1 | 扩展问句，列出装备、多阵容和站位 | 未选中 Skill，原路径完成；不能算候选成功 | 3 |
| r4 / response-3 | 基础问句；现有 legacy_full_state 布局 | 6 个工具完成，1 次动作拒绝后恢复；一套站位、两套候选和选用条件，27.8 秒 | 0 |
| r5 / response-1 | append_only + action 历史格式，冷启动 | 30 秒超时；5 个工具完成，第 6 个站位工具已启动 | 0 |
| r5 / response-2 | 同配置重复基础问句 | 30 秒超时；6 个工具完成，已取到第一套站位；第二套尚未执行 | 0 |
| r5 / response-3 | 只查询沃里克的推荐出装 | 未选中 Skill，仅实体目录和出装工具；正常完成，7.1 秒 | 0 |

r4 的另一次问答因浏览器连接中断，没有完整响应文件；保留其观测日志，不计为
成功，也不混入延迟比较。恢复后重新连接浏览器，复测使用新会话。

r4 在正文与引用中保留两个来源候选，但第二套未取得站位，且同时引用候选榜和
单阵容解析会产生重复展示组。当前仍按各查询独立保留范围与统计，没有为了消除
重复而跨查询合并数据。r2/r3 则存在只引用 resolved 单卡而丢失初始候选的问题。
这些都不符合完整的逐卡体验，不能只看 `completed` 就判定验收通过。

## 格式诊断的边界

默认 provider 的 append_only 布局把过去的 assistant 动作包装为
`react-transcript-event.v1`，但新输出要求 `react-action.v1`。这是格式重试的一个
可疑因素，不把未经配对验证的相关性写成确定根因。

隔离入口支持两个可记录的诊断维度：

- `--message-layout=legacy_full_state` 使用 provider 已有布局；本次未发生格式
  修复，但上下文显著增大，仍有一次未满足前置解析的动作。
- `--decision-messages=action` 只在候选发出的请求中把历史 assistant 事件还原成
  它原有的 action 对象。观察结果、运行时状态、工具目录、Skill 文本和预算不改。
  不修补新生成的动作，也不替模型选工具。两次问答格式修复为零，但仍超时。

以上均仅位于实验入口；默认仍是 append_only/event。每种配置记录在 manifest，
不能把消息格式变化带来的差异全部归因于 Skill 文本。
当前 1.4 内容 hash：
`f90997fb277a347a13794c8bbe7ae9d083aa5239b104f0caa1982c26ade8f9de`。

## 完成投影与剩余工作

完成的候选问答已经能够记录 `equipmentStatisticsObserved=true`，不再因为缺少
范围字段把真实出装遗漏。1.4 可覆盖 `unit_role`、`composition_context` 和
`positioning`。`equipment_logic` 仍保守缺失：统计不是装备机制或因果解释。
`answerCoverage` 仍是完整来源句子的下界匹配，不是语义质量分数。

超时返回只有错误，不带已收集的 Ledger；此时 Shadow 的空覆盖不代表工具没调用。
汇总应查看 stream 的 `tool_completed`，不能用超时 payload 的空 Evidence 计数。
本轮保留原有超时行为，没有延长预算或绕开终止规则。

上线前仍需依次处理：

1. 在现有 ReAct 预算内减少重复解析/格式修复与慢工具等待，保留可靠的超时部分
   结果；验证两套阵容都完成各自查询，不能仅提升模型调用上限。
2. 在不混合范围和统计的前提下处理候选榜与单卡解析的重复呈现，并确保初始候选
   不因 finish 引用缺失而消失；卡片必须明确标出自己缺少的站位。
3. 复核“怎么玩 + 装备 + 多阵容 + 站位”复合问句的 TaskFrame 分类。修复应进入
   原有解析链，不能在 Skill 入口增加原文关键词路由来掩盖漏选。
4. 明确装备统计解读与官方机制解释各自的完成契约，接入现有详情 Evidence，
   不把 Prompt 的自我声明视为已完成机制解释。
5. 冻结候选内容及 provider 配置，再进行正式配对评估、稳定性和上线门槛复核。

## 验证与材料

针对性测试覆盖服务端范围、源时间、冲突赛季/版本、历史证据排除、官方角色字段、
前置解析、独立候选上下文、并发隔离及非 Skill 原路径。
最终验证：

- 针对性套件：285 通过，0 失败。
- `test:ci:main`：1280 通过，7 跳过，0 失败。
- `test:ci:integration`：232 通过，1 跳过，0 失败。
- `eval:agent`：50/50 通过。
- `git diff --check`：通过（仅工作区原有 LF/CRLF 提示）。

CI 通过同名 `scripts/run-ci-test-lane.mjs` 入口与 Node 24 执行。主测试与集成
测试串行运行。测试数反映当前工作区，不能全部计为本轮新增；未改动其他任务的
现有变更。报告分别位于 `.cache/eval/skills-candidate-focused-final.xml`、
`skills-candidate-main-final.xml`、`skills-candidate-integration.xml` 与 `agent-eval.json`。
离线通过不替代以上真实模型失败结果。

原始材料：`.cache/eval/skill-candidate-20260831{,-r2,-r3,-r4,-r5}/`，包括 manifest、
观测日志、原始响应和 DOM；r5 另存纯装备查询截图。
汇总：`.cache/eval/skill-candidate-20260831-report.json`；生成脚本：
`.cache/eval/summarize-skill-candidate.mjs`。r4 中断记录只有日志，无完整响应。

复现入口（会使用已配置真实模型，只有显式 `--live` 才启动；启动后不自动提问）：

```powershell
node scripts/start-unit-play-skill-browser.mjs --live --output=.cache/eval/skill-browser-new-run
```

使用支持本项目的 Node 24。默认地址为 `127.0.0.1:17433`；不对外部署。
本轮临时服务与测试标签页已停止/关闭，所有原始成功和失败记录保留。

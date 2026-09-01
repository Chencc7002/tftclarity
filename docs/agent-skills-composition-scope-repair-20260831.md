# Skills 多阵容归属、卡片完整性与复合问句修复

日期：2026-08-31。承接 `agent-skills-deadline-recovery-20260831.md` 的前三项后续工作。
用户连续授权修复及真实浏览器验证；本批仍仅在独立 localhost 诊断服务开启候选行为。
不代表生产 Skill Control 上线，也不代表完整玩法 Skill 已达到完成标准。

## 实现与边界

### 站位校验按阵容归属

旧 `tacticalPositionGroundingErrors` 在整段回答里按英雄名取位置，再与每份 formation
分别比较，导致沃里克在两套阵容分别位于第三排、第一排时互相矛盾。

新增 `scopedTacticalPositionErrors`，仅在 `compositionCardScope` 开启时使用：

- 从本轮引用的阵容行及服务端 `tacticalDetailQueryPlan` 取得阵容名和身份，绑定
  `seasonContextId + clusterId + compositionId`；不使用模型提供的身份映射。
- 支持普通、Markdown、编号阵容标题，逐英雄坐标及逐排列举格式。列号按各英雄
  的子句检查，不拿一行中另一英雄的列号交叉验证。
- 同英雄跨阵容的合法不同位置可以通过；串排、错列、区域矛盾、未知/歧义标题、
  历史别名、跨赛季别名和同身份互相冲突的观测仍被拒绝。
- 检查“在后排输出”“放后排”等区域描述；不把“持续输出型前排战士”这种定位
  词组当作具体站位。未知格式未做通用自然语言理解，不据此声称所有解读均已验证。
- `positioning_validation_comparison` 同时记录旧、新校验错误；旧校验仍保留可选。

### 卡片完整性与展示回执

模型最终只引用单卡解析或装备时，本轮已取得的其他候选和站位曾从界面消失。
服务端现在在隔离开关开启时生成 `cardEvidenceIds`，复用当前证据的有效性、赛季、
历史和来源时效检查。它是展示回执，不是模型引用，不改变 Evidence Ledger，
也不把缺失的 Skill facet 标成完成。

前端将回执与模型引用一起用于卡片展示和身份绑定。只删除已保留候选榜的单行
身份解析副本：必须有对应解析前置、同查询范围、同来源时间和完全相同的行事实。
不合并不同统计，不改排序或成员；不同范围、来源时间、统计值仍独立保留。
缺站位的候选保留并显示缺口。后续引导按实际交付的证据判断，不把仅存在于 Ledger
中的未展示结果说成“已看过”。模型正文验证失败时仍可保留有效工具卡片。

### 复合问句仍走原 TaskFrame

根因是 `semantic-task-parser.js` 的旧规则遇到任何装备、阵容、站位词即排除
`recommend_unit_play`。新增默认关闭的 `compoundUnitPlayGuidance` 选项，仅在
明确独立的“怎么玩/玩法”分句同时带有装备和阵容要求时修正原 TaskFrame。

例如：“沃里克怎么玩？请给推荐装备和多个阵容，每个阵容带对应站位。”
修正后由原 Skill matcher 和已有 semanticAdvisory 选择 Skill，没有独立关键词路由、
额外解析、LLM 分类或新执行器。

窄查询、多英雄、未解析身份、视频/比较、转型/复盘/经济等请求保持原路径。
“只说装备和阵容”也不扩成完整玩法。当前规则保守，不保证识别所有无标点变体。
服务端仅从 runtime 配置传入选项；请求体伪造同名开关不能开启。
Quick Task 的入口及稳定参数化查询未改。

## 真实浏览器与回放记录

全部使用原注册工具、真实 `deepseek-v4-flash`，30 秒预算不变，Skill 1.4.0 内容未改。
内容 SHA256：`f90997fb277a347a13794c8bbe7ae9d083aa5239b104f0caa1982c26ade8f9de`。
仍启用上批隔离的 action 消息格式、超时证据保留和请求内原始阵容快照复用。

| 目录/请求 | 输入 | 当时结果 | 最终代码回放 |
| --- | --- | --- | --- |
| `skill-card-scope-20260831` / 1 | 沃里克怎么玩 | 22,509 ms，8 工具，模型完成 | 通过；旧校验交叉误报两条 |
| 同目录 / 2 | 沃里克怎么玩 | 26,256 ms，10 工具，模型完成 | 通过；旧校验交叉误报两条 |
| `skill-card-scope-20260831-r2` / 1 | 完整复合问句 | 29,396 ms，编号标题和逐排列举被误拒，证据回退 | 格式修复后通过 |
| `skill-card-scope-20260831-r3` / 1 | 同一复合问句 | 29,111 ms，当时接受 | 最终加严后拒绝真实错误：芸阿娜中排被解读成后排 |
| `skill-card-scope-20260831-r4` / 1 | 同一复合问句，最终代码 | 30,008 ms；先拒绝错误区域和无归属描述，重试耗尽预算 | 保留装备、两套阵容及各自站位，明确超时；无最终模型结论 |

两套来源站位分别包含 8、7 个单位。浏览器展开后验证各自站位，两个阵容标题各只
出现一张卡；r2 的正文回退也未丢弃候选或站位。r2/r3 的失败和加严记录不能改写成
端到端成功；离线回放不重新刷新时间、不替换模型回答、不模拟一次新的模型运行。
最终 r4 的 TaskFrame 日志确认 `recommend_unit_play`、`legacyBroadUnitPlayMatched=false`、
`taskFrameControlEligible=true`；Skill 注入仍只有一次解析。浏览器确认两张卡标题各一次、
展开后两个独立站位 group；超时后不出现完成式后续建议。每次响应都只有一次终止事件，
终止后没有新的流事件。r4 说明降级保留链路有效，不代表 30 秒内完整生成已稳定。

原始文件在对应 `.cache/eval/` 目录：manifest、observations.jsonl、response NDJSON、
DOM、截图及 report.json。汇总脚本 `.cache/eval/summarize-composition-scope.mjs`。
这是功能诊断与相同已保存答案的校验对比，**不是正式冻结配对 A/B 评估**。

## 验证

- 本批新增 12 项测试，覆盖阵容归属/错误拒绝、展示回执/去重、交付后续引导、
  复合问句边界、服务端开关及单次解析。
- 最终 `npm run test:ci:main`：1303 通过、7 跳过、0 失败。
- 最终 `npm run test:ci:integration`：234 通过、1 跳过、0 失败。
- 最终 `npm run eval:agent`：50/50 通过。
- `git diff --check` 通过。工作区有其他任务的改动，全部保留，未提交或部署。

日志为 `.cache/eval/composition-scope-main-verified.txt`、
`composition-scope-integration-verified.txt`、`composition-scope-agent-eval-verified.txt`。
全量数是共享工作区总量，不是本批新增数。
验证后已停止隔离服务并关闭本次创建的浏览器页面。

## 开关与复现

新增 `--composition-card-scope` 和 `--compound-unit-play` 均默认关闭，只有诊断脚本
设置 runtime 字段，没有修改 `.env`、生产默认 Skill 版本、工具 schema、权限、
确定性 nextActionAffordance 或批准策略。可分别撤去参数恢复旧行为。

```powershell
node scripts/start-unit-play-skill-browser.mjs --live --decision-messages=action --deadline-recovery --composition-snapshot-reuse --composition-card-scope --compound-unit-play --output=.cache/eval/skill-card-scope-new-run
```

`unit-play-guidance-control-experiment-contract.md` 仍约束正式离线配对评估。
后续用户授权的独立浏览器诊断不是该评估的替代，不能用这几次成功宣称推广门槛通过。

## 后续操作

2026-08-31 装备机制凭据、精简 Prompt 及真实复测已推进，见
`agent-skills-equipment-mechanism-20260831.md`。正式配对及回答语义验收仍未通过。

1. 收敛装备机制证据与完成契约：本批所有记录仍缺 `equipment_logic`；部分请求只
   有装备统计，另一些取得的装备详情被 shadow 判为旧证据。统计不能代替机制，
   不能通过刷新源时间、放宽工具参数或把影子状态改成完成来消除缺口。
2. 收敛最终解读长度与局部修正方式，减少重复描述站位造成的矛盾和耗时；不增加
   当前 30 秒预算，不修改来源站位。对齐实际回答与 facet 校验；尤其不能因为工具调用结束、正文通过通用 finish
   校验就声称专业解读已完整。保留当前源码对真正错误的拒绝行为。
3. 固定候选、provider 配置和工具响应，进行正式配对评估，再决定是否推广。
   本批未开启生产 Skill Control。

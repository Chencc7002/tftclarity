# Skill 隔离候选：超时部分结果与请求内数据复用

2026-08-31。接续 `agent-skills-candidate-repair-20260831.md`。

本批修复了隔离候选超时后丢失全部结果的问题，并减少逐卡解析时重复下载同一份
阵容源数据。真实浏览器确认 30 秒超时仍能交付部分证据；第二次请求在预算内取得
两套站位，但暴露了多阵容站位校验串用。**完整玩法回答仍未验收通过，不开启生产
Skill Control，也不是冻结配对评估通过。**

## 变更和边界

- `ChatAgent.deadlineRecovery` 默认关闭；只由隔离脚本显式设置
  `runtime.reactDeadlineRecovery`。复用现有 AgentRuntime 与 ReactLoop，无新运行时。
- 保留原有 30 秒预算。截止时取消传给模型和工具执行器的等待信号，停止接受后续
  模型动作、工具结果和事件。底层数据源若不支持 AbortSignal，已发出的网络请求
  仍受该数据源自己的超时约束；不能宣称所有网络请求都立即中断。
- 只在 `run_timed_out` 且已有当前可展示的已校验证据时返回部分结果。
  `run.status` 仍为 `timed_out`，结果为 `completed_with_warning` /
  `deadline_exceeded`，没有通过验证的模型结论，不能当作 Skill 完成。
- 没有证据时保留原超时错误；用户取消不转换成成功。默认关闭时旧路径不变。
- `currentDeadlineEvidence` 排除历史、过期、已知赛季冲突、无效或未来的源时间。
  普通证据最多 30 分钟，站位最多 5 分钟；缺失源时钟不补造。完整 Ledger 保留作
  溯源，只有筛选出的 evidenceIds 用于当前展示，不刷新任何源时间。
- 服务层不再用旧出装摘要覆盖超时声明；超时结果不生成“已经查完”的后续引导。
  UI 另加中英文超时说明，区别于“模型输出校验失败”。
- `runtime.reactCompositionSnapshotReuse` 同样默认关闭。仅在单个 ReAct 请求的
  注册 `comps_rankings` handler 内，复用同赛季、队列、版本、天数的原始
  comps_data/comps_stats；30 秒 TTL、最多 16 份、深复制，跨请求不共享。
  每次调用仍独立解析身份、过滤、排名并走原 Evidence 校验。cluster 不匹配不缓存。
  不复用模型生成的内容，不改变 Quick Task、工具 schema、权限或 nextActionAffordance。

Skill 内容仍是隔离候选 1.4.0，hash
`f90997fb277a347a13794c8bbe7ae9d083aa5239b104f0caa1982c26ade8f9de`。
生产默认 Skill 版本仍保持原配置；本批没有修改 `.env` 或部署。

## 真实浏览器结果

配置：deepseek-v4-flash，append_only，历史 decision action 格式诊断开关，
TaskFrame Control 沿用本地配置，两个本批开关均显式开启。输入均为 S18
“沃里克怎么玩？”，第二次刷新页面开始新请求。原始日志保留，不修改模型响应。

| 项目 | 第一次请求 | 第二次请求 |
| --- | --- | --- |
| 耗时 | 30,007 ms | 25,875 ms |
| 终止原因 | deadline_exceeded | finish_validation_fallback |
| Ledger / 当前引用证据数 | 11 / 8 | 8 / 1 |
| 工具取得的站位 | 422032：8 个单位；422043：7 个单位 | 同两套站位均 available |
| 最终交付 | 明示超时，出装与阵容证据保留 | 校验失败，退回单出装摘要 |
| 终止事件 / 之后事件 | 1 / 0 | 1 / 0 |

第一次浏览器直接确认超时说明、出装方案、候选两阵容、第一张展开的站位图保留。
候选榜和单卡解析还会重复呈现；第二张默认折叠，不能把 Ledger 中取得站位等同于
用户已看到两张独立完整卡片。

第一次三个 `comps_rankings` 耗时为 1222 / 45 / 32 ms，第二次为
2239 / 13 / 14 ms。单测验证同范围原始下载仅发生一次，后续逐卡解析依然执行。
这不是控制变量性能实验，不能据此报告整体提速比例。

第一次被排除的三条装备详情已有旧源时间，没有将它们刷新为当前证据。
仍出现 item_details_batch 缺少确定性选择计划、unit_builds_batch 多余 apiNames
参数的拒绝；校验按原规则生效，没有通过扩大权限使调用通过。

第二次的具体阻塞：`tacticalPositionGroundingErrors` 按英雄名在整段回答中找站位，
再分别与每份 formation 比较。同一英雄在两套阵容分别站第 3 排和第 1 排时，
两个正确的分段描述被交叉比较，产生相反的两条错误。校验失败后只引用出装，
阵容卡片消失，旧后续引导却仍说“装备和阵容已看过”。这不属于本批超时分支，
已记录为下一批卡片完整性修复的首要复现，不在本批放宽验证器。

## 验证

- 新增截止时间、迟到模型/工具响应、用户取消、历史与过期证据排除测试。
- 服务级测试使用真实注册工具 schema 和实体解析流程，验证超时提示不会被摘要
  覆盖，不生成完成式后续引导。时间测试用受控时钟，不改生产预算。
- 快照复用测试覆盖逐卡解析一致性、调用计数、对象变更隔离、筛选变化、跨请求、
  TTL 到期与默认关闭。
- Agent / Skill 相关回归：291 通过。
- 最终定向及 UI 回归：95 通过。
- 最终 `npm run test:ci:main`：1291 通过，7 跳过，0 失败。
- 最终 `npm run test:ci:integration`：234 通过，1 跳过，0 失败。
- 最终 `npm run eval:agent`：50/50 通过。`git diff --check` 通过。

最终日志：`.cache/eval/deadline-ci-main-verified.txt`、
`deadline-ci-integration-verified.txt`、`deadline-agent-eval-verified.txt`。

测试数是当前共享工作区总量，不能都算作本批新增。保留其他任务的未提交改动。
一轮主回归在装备条件相关文件被更新时出现失败，日志完整保留；单独复跑通过后
又执行全量确认，不能用先前通过覆盖中间失败记录。

原始材料：`.cache/eval/skill-deadline-20260831-r4/` 的 manifest、observations、
两份 response NDJSON、DOM、截图和 report.json。汇总脚本为
`.cache/eval/summarize-skill-deadline.mjs`。
早先 r2/r3 服务启动但浏览器连接拒绝，没有真实问题响应，不计为模型测试。
恢复后只使用当前内置浏览器，没有关闭防火墙或切换浏览器规避限制。
测试结束后已停止隔离服务并关闭成功连接的验证页面。

复现（启动不会自动提问，会使用已配置真实模型）：

```powershell
node scripts/start-unit-play-skill-browser.mjs --live --decision-messages=action --deadline-recovery --composition-snapshot-reuse --output=.cache/eval/skill-deadline-new-run
```

## 下一批操作

2026-08-31 后续执行记录见 `agent-skills-composition-scope-repair-20260831.md`。
前三项已在隔离候选中修复并验证；机制解读与正式配对评估仍待完成。

1. 先把站位陈述的校验范围绑定到具体阵容身份；加入同英雄跨两套阵容位置不同的
   成功案例，以及串位、错位、无明确阵容归属的拒绝案例，不能直接忽略矛盾。
2. 修复候选榜与单卡解析重复、有效候选遗漏、卡片缺站位提示，以及“未实际展示
   阵容却声称已看过”的后续引导。保持数据范围与原始统计独立，不让模型重排。
3. 修复复合问句的原 TaskFrame 分类和 Skill 漏选；不新增关键词旁路。
4. 收敛装备机制解读契约，再冻结候选、provider 配置和工具响应，进行正式配对
   评估。通过前不推广生产控制模式。

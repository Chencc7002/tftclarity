# 当前赛季俗称识别

日期：2026-09-06。实现与本地验证完成，默认关闭，生产先 shadow。

## 已实现的行为

自由聊天中，`entity_catalog_query` 无法在别名表找到名称时，把原问题、最近两条用户消息和当前赛季目录交给现有配置的 LLM。模型可以用语言知识识别“狐狸→阿狸”“牛头→阿利斯塔”等对应关系，不要求运营先按赛季标注这些称呼。

模型返回的是候选。服务器严格验证实体类型、ID、顺序、字段和显式筛选条件；仅从目录重新提取名称等事实。候选进入已有 `ambiguous` 确认流程，即使只有一个候选也需要确认。确认后使用正式名称重新查询当前目录，历史 Conversation Bridge 不直接成为当前 Evidence。

路径：现有 ReAct → 注册的 `entity_catalog_query` → 精确/已维护别名 → 已启用的错字候选 → 未命中俗称模型提议 → 校验 → 现有澄清与确认。未增加工具、Skill、执行运行时、数据库或网络事实来源。Quick Task 保留确定性路径。

已有俗称命中、人工模糊候选或错字候选已返回 `ambiguous` 时，不再调用俗称模型。模型不可绕开这类已存在的确认要求。用户原文中找不到的提取名称不会触发补充识别，避免模型改写名称后继续猜测。

## 模型输入与预算

- 当前工具加载的目录按实体类型、费用、装备类别、羁绊、可获得性等显式条件筛选，只保留当前实体。菜单包含 ID、显示名、中文正式名称、费用/羁绊或装备类别。
- 原问题最多 800 字符，最近两条用户消息各 400 字符；不使用助手回答推断用户的指代意图。
- 每次聊天请求最多新增一次模型调用，共享该请求的工具 handler；最多批处理 5 个未命中名称，每个名称 2–32 字符，不处理数字或内部 API ID。
- 菜单达到 200 条或序列化请求超过 24,000 字符时跳过，避免在截断目录中盲选。
- 默认 2,500 ms；程序化 `entitySlangTimeoutMs` 上限 3,000 ms。服从原有工具/请求取消信号和总期限，不重试。
- 输出上限 400 tokens，每个名称 0–3 个候选 ID；不接收模型自报置信度。错误 JSON、额外字段、目录外 ID、重复 ID、超时、取消和服务异常均回退原查询结果。

提议不写入共享别名词典或长期会话记忆。跨赛季请求重新使用该赛季目录，避免模型误判沉淀成永久规则。这次实现的是在线未知俗称补充识别；跨赛季稳定身份词典和自动发布别名表仍是独立工作。

## 点击候选确认（2026-09-06 补充）

Web 聊天和结果面板将 `clarificationContext.candidates` 显示为名字按钮。例如“娜美”“卡尔玛”，点击即发送，无需在输入框再次输入或按发送。聊天中的用户消息显示选中的名字，实际请求将原问题中的待确认名称替换为正式名称，保留原条件；没有原文字面片段时，把正式名称与原问题一起发送。因此即使没有启用 Conversation Bridge，点击也携带原问题，不依赖模型猜测一个孤立名字的意图。

有服务端待确认记录时，直接回复唯一匹配的候选正式名称也会确定性选中它，再查询当前目录。多候选下仅回复“是的”仍不选择任何一个；同名不同 ID 也不会靠名字自动二选一。原有单候选“是的”确认继续有效。

按钮点击复用自由聊天请求，保持相同会话和赛季；不提交 API ID 为当前事实，不保存别名。只接受当前请求对应的最后一条回复上的选项，请求进行中、旧回复、已切换会话或赛季的点击无效，避免重复请求及旧候选串入新问题。原有非确认类候选组件保留。

补充验证：`test/entity-confirmation.test.js` 执行实际 UI 适配、按钮渲染和点击处理函数，验证自动提交、原条件保留、名字显示、转义及过期点击；`test/entity-name-react.test.js` 使用内存 SQLite 会话存储和无会话存储两种配置验证多候选后的当前目录查询。相关回归 388/388；main 1437 passed / 7 skipped；integration 235 passed / 1 skipped；Agent 评测 50/50，无失败。日志为 `.cache/entity-choice-{focused,main,integration,agent-eval}.log`。未部署或重启现有服务。

## 配置、观测与回滚

服务端环境变量 `TFT_AGENT_ENTITY_SLANG_MODE`：

| 模式 | 行为 |
| --- | --- |
| `off`（默认，含非法值） | 不调用俗称模型，沿用原行为。 |
| `shadow` | 调用并验证模型，记录计数；返回的工具结果与 off 等价，不暴露提议。 |
| `suggest` | 验证通过的提议返回为待确认候选。 |

异步服务器工厂复用已启用的 structured parser 模型配置；未配置可用 provider 则跳过。没有新增密钥配置。代码可注入 `entitySlangProvider`，测试使用此入口；HTTP body 和工具参数不能开启该功能。

影子启用：

```powershell
$env:TFT_AGENT_ENTITY_SLANG_MODE = "shadow"
npm start
```

完成实际流量影子验证后，受控使用改为 `suggest`。回滚改为 `off` 并按既有方式重启。此次未修改持久环境或部署配置、未重启已有服务。

运行状态的 `routing.entitySlangMode`、`entitySlangProviderAvailable`、`entitySlangMetrics` 展示模式、配置可用性、调用/提议/未知/失败/跳过次数与累计耗时。计数为进程内数据，重启清零。`onEntitySlangObservation` 可接入既有采集；事件仅含模式、类型、赛季、数量、耗时和原因代码，不记录问题、俗称、候选 ID、密钥或响应体。观察器异常不影响执行。

## 验证

专项测试：`test/entity-slang.test.js` 与 `test/entity-name-react.test.js`，20/20 通过。覆盖未知俗称、严格输出校验、目录外 ID、装备类别、跨赛季隔离、off/shadow 等价、并发调用预算、超时和取消、真实服务器模型配置接入、ReAct 阻止跳过确认，以及确认后重新获取当前 Evidence。相关 TaskFrame / Phase5 / Phase66 / ReAct / 会话 / 名称测试 312/312 通过。

最终仓库回归（Node 24.18.0）：`test:ci:main` 1431 passed / 7 skipped；`test:ci:integration` 235 passed / 1 skipped；`eval:agent` 50/50；`eval:entity-names` 41/41，均无失败。日志保存于 `.cache/entity-slang-{focused,main,integration,agent-eval}.log`。25 条俗称样例的输入均通过注册工具 schema 校验。

真实模型试跑使用已配置的 `deepseek-v4-flash`，以及 2026-08-31 保存的 `set18-live` 历史完整目录。目录哈希 `b5c9086ac3b22022f170610f16a3b19e3521aebeea7aa129c281cf2dfe1125dd`，70 条单位记录、149 条装备记录。它不代表已校验的当天正式服目录。样例在 `eval/entity-names/slang.json`，不屏蔽原有别名，不把历史聊天当标签。

首轮 25 例中 24 例符合预期，“吸血剑”错误提议为科技枪。第二轮补充菜单正式名称，并修正评测脚本将 `category` 误写为单数的筛选字段；现在先执行注册工具 schema 校验，防止无效筛选被静默忽略。修正后的 25 例全部符合预期：19 个英雄俗称和 3 个装备俗称提出正确候选，2 个负例保持未命中，“大帽”1 例由既有别名直接解析。6 次模型调用耗时 802–1,421 ms，无超时。这两处调整同时发生，不能把改善单独归因于 Prompt。

报告分别保存为 `.cache/eval/entity-slang-live.json` 和 `.cache/eval/entity-slang-live-v2.json`。复跑会调用配置的模型：

```powershell
npm run smoke:entity-slang -- --live --snapshot=.cache/eval/entity-name-catalog-audit/snapshot.json --output=.cache/eval/entity-slang-live-repeat.json
```

25 条是精选 smoke 样例，不能估算线上错误率。首次模型误配说明即使 ID 合法也不能保证语义正确，因此保留确认；上线前仍需真实失败表达和实际赛季目录的影子观测。

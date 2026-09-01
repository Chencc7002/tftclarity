# Skills 回答条件与验收记录（2026-09-01）

本批接续装备机制诊断，仍为 localhost 隔离候选。生产默认 Skill 1.3.0、
旧 1.4/1.5.0/1.5.1/1.5.2 内容及既有正式配对资料不变。

## 已修正的合同

新增候选 1.5.3，内容 SHA256：
`2298e47c2f170342e3136c1374dac33c7d9b1a076498010d4b624fd507716f47`。
用 `--answer-contract --mechanism-evidence` 显式选择，去掉前者回到 1.5.2。
它只调整已有工具获取后如何解释：

- 分清常驻属性和条件效果，保留阈值、叠满要求、持续/衰减及作用对象。
- 与英雄技能的联系标为有依据的推论，不声称未经验证的收益幅度。
- 同时保留“拿到推荐装备”或“来牌/升星顺”的可选条件，不猜对局状态。
- 资料不足时遵循原 reasonCode、引用、预算与终止规则，不能固定充分证据。
- 精简正文，不重复卡片统计、全队格子及未请求的强化提示。

首次实测仍出现强化缺失提示。代码核查发现通用 ReAct system Prompt 要求：
formation **或** augmentRecommendations 不可用都必须说明，并要求把站位和强化
分成两个部分。它与 Skill 的展示要求冲突，仅增加 Skill 指令不能解决。

新增 provider 配置 `tacticalPresentationScope === true`，只替换这两条展示语句：
仍说明请求或实际使用字段的缺口，但不主动报告未请求的强化缺失；每套阵容保留
自己的站位。工具、解析前置、坐标依据、Evidence、权限和预算都未放宽。
对应 Prompt 版本为 `react-decision-contract.v5.tactical-presentation.v1`；默认
仍是原 v5，字节级旧消息测试保留。只有隔离脚本的
`--tactical-presentation-scope --answer-contract` 启用，HTTP 输入不能开关它。

诊断观察器现在保存原始解析后的模型动作，便于复查被拒正文，不修改模型动作。
首批服务在此记录功能加入前已启动，不能用新日志反推它当时被拒的正文。

新增记录后复现一处真实校验误判：
`墨菲特（第1排第4列）和雷克塞（第1排第3列）` 的两个列号被应用到两个单位。
隔离 `compositionCardScope` 校验现在将紧跟已验证英雄名的完整括号坐标单独绑定，
同时保留括号外共同断言的校验。例如两人括号坐标正确但随后声称“都在第4列”仍
会拒绝；未知单位、错列、共同错排及跨阵容混用仍拒绝。默认 legacy 校验未改。
旧 r2 第二份被拒答案用新代码回放通过坐标校验，但原始拒绝结果不改写为成功。

## 回答评审而非自动语义评分

新增 `eval/skills/unit-play-guidance-answer-review/rubric.v1.json`：10 项判据及正反例，
覆盖常驻/触发、阈值/衰减、推论边界、推荐装备绑定、时效、逐卡站位、两个可玩
条件、资料缺口、终止和展示范围。示例是历史评审用例，不是当前游戏知识源。

`scripts/prepare-unit-play-answer-review.mjs` 从已保存的响应和 manifest 生成评审包，
无需模型或网络。包内保留正文、Evidence 原值及原时钟、内容哈希、引用、终止和
拒绝动作。无终止或重复终止的流不会被选择性当成成功。输出目录必须新建，不覆盖
原始响应或已有评审标签。

`answerReview.semanticCorrectness=unassessed`、`completionEvaluated=false`，
标签初始为空。运行时 accepted 或 shadow complete 都不会使标签自动通过。
这些是不盲化的诊断材料；助手复核不得冒充独立人工盲审。

```powershell
node scripts/start-unit-play-skill-browser.mjs --live --decision-messages=action --deadline-recovery --composition-snapshot-reuse --composition-card-scope --compound-unit-play --mechanism-evidence --answer-contract --tactical-presentation-scope --output=.cache/eval/skill-answer-new-run

node scripts/prepare-unit-play-answer-review.mjs --run=.cache/eval/skill-answer-new-run --output=.cache/eval/skill-answer-new-review
```

## 正式配对准备边界

本批不运行旧 canonical runner 来宣称新版本通过。旧配置冻结的是 2026-08-18 的
Skill 内容、语料、观测和默认 Prompt 哈希，与当前候选不匹配。

下一轮正式评估需要在新版本目录完成：

1. 固定候选 1.5.3 或其后继版本、基线 professional guidance、共同 runtime/Prompt/
   Evidence 修复及原始来源观测。上层展示修复应两臂相同，不能只给 B 开启后把
   效果归因于 Skill。两臂仍只有专业指导来源不同。
2. 重新审阅 30 正例、20 负例、10 边界案例及同参同观测映射，包括复合玩法、装备
   部分缺失/过期、无出装、第二卡无站位及无资料结束。不把本批同英雄的几次诊断
   当成完整冻结语料，不把错误改写为成功观测。
3. 一次 TaskFrame parse、两臂独立可变状态、3 次重复/90 对、零非法动作和原代价
   门槛继续有效。先零 Provider 调用预检，再执行对应新 manifest 的正式配对。
4. 完成逐回答盲化、独立人工 facet 标签及分歧裁决；本批 rubric 是补充草案，不能
   替代既有 formal facet-label 契约。离线通过也只进入架构评审，不授权生产推广。

当前诊断已有超时，尚未满足稳定性门槛；不应在这里跳过失败、扩大预算或开启生产。

## 本批实测与回归

使用真实 deepseek-v4-flash，在浏览器输入复合问句
“沃里克怎么玩？推荐装备、多个阵容和各自站位，并解释原因。”及简短问句
“沃里克怎么玩？”。共 6 次，所有原始失败保留。

| 目录 / 请求 | 配置区别 | 毫秒 | 工具 / 拒绝动作 | 原始结果 |
| --- | --- | ---: | --- | --- |
| skill-answer-contract-20260831 / 1 | 1.5.3，旧通用展示 Prompt | 30007 | 11 / 1 | 站位被拒后超时；被拒正文未留存，不能判定其原始内容 |
| 同目录 / 2 | 同上 | 17655 | 11 / 0 | accepted，但仍写未请求的强化缺失，正文524字符 |
| skill-answer-contract-20260901-r2 / 1 | 加通用展示修正 | 30012 | 11 / 0 | 取得11份工具结果后，最终生成未能在预算内结束 |
| 同目录 / 2 | 同上，完整动作记录 | 27419 | 11 / 2 | 正确括号坐标误判，模型原始结论被拒，返回系统回退 |
| skill-answer-contract-20260901-r3 / 1 | 再加括号坐标绑定修正 | 29995 | 11 / 0 | completed / accepted，无 grounding 警告，504字符 |
| 同目录 / 2 | 同上，新页面独立会话 | 18369 | 11 / 0 | completed / accepted，无 grounding 警告，345字符 |

最后两次均取得三件推荐装备的详情和各卡站位，Evidence shadow 四个必需 facet
齐全，但 `answerCoverage.completionEvaluated=false` 仍保持。两份站位分别8和7个
单位，目标英雄分别为第3排第1列、第1排第3列；在浏览器逐张展开检查，两个独立
棋盘存在。每份流只有一个终止事件，终止后没有新增事件。

r3 两次复用同一个真实官方下载凭据，`fetchedAt=2026-08-31T16:10:17.364Z`，
内容 SHA256 `70b075744c74c41a37c3e944ee0da04276e92f2282edf2fc789ee81a590e2f3b`，
原发布时间 `2026-08-27 17:19:45` 不变。第二次服务缓存已预热，不能把它与第一次的
耗时差称为受控性能提升。

助手对照本次来源做的有限复核（不是独立盲审）：

- r3 两次都分开描述血手常驻属性与低生命护盾，泰坦保留“叠满25层”，不再出现
  本批要修正的两种条件误归；两个可玩条件均保留，未写强化缺失提示。
- r3 第一次仍漏掉血手衰减的“4秒”，正文超出目标长度，且追加“以某些羁绊为核心”
  等需要明确区分事实与解读的句子，因此**回答合同未完整达标**。
- r3 第二次保留60%生命值、40%最大生命值护盾、4秒衰减和25层条件，但仍重复
  样本/段位和前中排描述，“帮助更快施放技能”等联系未按 Prompt 独立标明推论。
  不能把运行时 accepted 宣称为所有专业语义均已通过。
- 29995 ms 只剩约5 ms预算余量，加上前两轮真实超时，稳定性仍需改进。

新增8项自动测试：5项评审包边界、1项新候选不改变 Evidence/Answer 分工及缺源
行为、1项通用展示开关仅改两条规则且不能从请求开启、1项括号坐标与共享断言。
定向 Agent/Skills 回归331通过；主回归1318通过、7跳过；集成回归234通过、1跳过；
离线 `eval:agent` 50/50。各项均0失败，`git diff --check` 通过。
使用 Node 24 执行与 `test:ci:main` / `test:ci:integration` 相同的仓库 lane runner，
没有使用会发现脏缓存测试副本的 `npm test`。

日志：`.cache/eval/skill-answer-{focused,main,integration,agent-eval}-20260901.txt`。
评审包分别在 `skill-answer-review-{baseline-20260831,initial-20260901,r2-20260901,final-20260901}`；
前缀均为 `.cache/eval/`。原始响应、manifest、DOM和截图在表中三个运行目录。
汇总脚本 `.cache/eval/summarize-skill-answer-contract.mjs` 的当前代码回放结果与原始
结果分开保存，评审索引 `skill-answer-review-materials-20260901/index.json` 包含
相关文件哈希。它只是诊断材料索引，不是完整工作区快照或正式配对 manifest。

本批下一步是缩短冗余解读、稳定保留条件并分解冷启动耗时，再冻结新配对语料和
工具观测；不得省掉证据、绕过解析前置或扩大预算来换取通过。未提交或部署，
未修改生产开关，测试服务和本批页面已关闭。

## 1.5.4 与模型输入投影（2026-09-01 续）

新增候选 1.5.4，内容 SHA256：
`066456060c905fdf898f36ffbc70b9077de16240ccbe19f7c71878f93ab44dc2`。
它继承 1.5.3 的工具、Evidence、来源时效和终止合同，只把正文目标收紧到
220—300 汉字：卡片已有的统计、成员、羁绊和完整棋盘不再由正文复述；每个来源
阵容只写目标英雄的精确行列并指向本卡棋盘；装备仍必须保留所描述效果的阈值、
持续/衰减、叠满要求和作用对象。Skill 本身仍不判断装备、阵容或站位。

隔离候选新增 `--model-observation-projection`。它只在 Provider 输入边界投影已验证
工具结果，不修改 ReAct 中的原观察、Evidence Ledger、来源凭据、工具卡片、站位
校验输入或最终引用：

- `unit_builds` 给模型保留首个来源方案、三件装备、必要统计和查询/来源范围；
- `comps_rankings` 保留所有来源候选、成员/羁绊、解析前置与精确战术查询计划；
- `composition_tactical_details` 给模型保留当前卡身份、状态及目标英雄坐标；完整
  阵容棋盘仍由原 Evidence 和卡片呈现；
- 英雄/装备官方详情保留机制事实和真实 retrieval 凭据；未知工具不做投影；
- append-only 与 legacy 两种 Provider 布局都覆盖，投影前后字节数由每次真实请求
  遥测记录。不开开关时原输入路径不变。

这个投影是运行时输入实验，不属于 Skill 效果。后续正式 A/B 若使用它，必须两臂
共同启用；不能只给候选臂减小上下文，再把延迟或质量变化归因于 Skill。

浏览器真实复测本轮未取得样本：本地隔离服务成功启动，manifest 正确记录 1.5.3、
30 秒预算和投影开关，但 Codex 应用内浏览器当时没有可用实例；按浏览器控制边界
没有换用另一套自动化冒充真实浏览器。空运行目录
`.cache/eval/skill-model-projection-20260901/` 只有 manifest，不是效果证据，也不能
用于声称输入节省或延迟改善。测试服务随后已停止。

自动测试验证：投影只保留允许字段、不会改写原对象、只影响 Provider 输入、两种
消息布局都记录严格减少的合成大对象字节数；1.5.4 与 1.5.3 的 Evidence/完成语义
完全相同。另修复三处离线 S17 夹具误用生产赛季可选性的问题，只注入仓库已有的
`createLegacySeasonFixture()`，不改变生产 S18 规则。

回归结果：聚焦 54/54；主 lane 1322 通过、7 跳过；集成 lane 234 通过、1 跳过；
`eval:agent` 50/50，均 0 失败。直接运行 `npm run test:ci:main` 会由本机系统 Node 18
在工作区父目录 `lstat` 处触发 EPERM；上述主/集成结果使用 Node 24 执行同一
`scripts/run-ci-test-lane.mjs` 和相同 lane 参数。集成完整日志为
`.cache/eval/skill-integration-20260901.log`。

下一步必须先恢复应用内浏览器实例，再依次运行两个隔离对照：1.5.3+投影用于单独
判断输入投影，1.5.4+同一投影用于判断回答精简；两组都使用独立会话，保存原始
流、逐轮投影字节数、工具/拒绝动作、终止后事件和逐卡棋盘。通过这一步后才能确定
候选冻结版本，并建立新的正式配对 manifest、语料/Observation 映射和盲审材料。

## 卡片承载阵容站位与 1.5.7 批量机制查询（2026-09-01 续）

用户远程连接期间无法打开应用内浏览器，后续真实 Provider 复测改为调用同一个
localhost `/api/react-chat/stream`。这能验证服务端工具、Evidence、模型动作、卡片
载荷和终止行为，但不是浏览器 DOM、布局或视觉验收；不得把 HTTP 结果写成浏览器
已检查。

候选按失败逐步收窄，生产默认仍为 1.3.0：

- 1.5.5 把阵容成员、羁绊、统计和站位交给来源卡片，正文只解释英雄机制、来源
  推荐装备机制和两个可玩条件；同时移除本任务不需要的 `semantic_search`。
- 1.5.6 明确首个 `comps_rankings` 必须使用 TaskFrame 已解析的
  `unit=resolvedId`。`mention` 只用于随后完整复制候选的精确 `compId`，避免模型用
  中文英雄名或模糊 mention 把两个来源候选缩成一个。
- 1.5.7 内容 SHA256
  `a71442c1b012d49f36ab14cabaf8810f4e2fe7689a498ebeaff5d3218047beb8`。
  `unit_builds` 在隔离开关下从首张来源装备卡生成
  `unit-play-item-mechanism-query-plan.v1`；Skill 必须原样复制其 apiName 顺序和赛季，
  只调用一次已有 `item_details_batch`。无计划时才回退到逐件 `item_details`。

批量计划不是模型建议，也没有新增工具或权限。ReAct 在执行前逐项校验模型参数与
服务端计划完全一致，禁止增删、改序和跨赛季；官方批量回执又对每个内嵌装备复用
单件官方来源、时效和完整公式校验。Evidence adapter 将三个装备效果绑定回首张
来源装备卡，批量 Evidence 仍须被最终答案引用。TaskFrame 已解析的同一英雄 ID
可供 `unit_builds` 复用；不同 ID 继续拒绝。

`--cards-only-answer-contract` 还启用隔离的完成校验：一旦正文出现明确排/列、
前中后排或原始 cell 标识，即使坐标与 Evidence 相符也拒绝，因为站位展示由每张
阵容卡负责。普通 ReAct 和生产默认不开启这个限制。正文可以说明“站位见卡片”，
也可以在用户明确问多个阵容时简短点名阵容；它不能复述或解释站位。

真实 HTTP 诊断保留了每次原始流：

| 目录 / 候选 | 请求 | 毫秒 | 工具 / 拒绝 | 结果 |
| --- | --- | ---: | ---: | --- |
| `skill-http-projection-20260901` / 1.5.3 | 复合、简短 | 30009、30009 | 未稳定结束 | 模型末轮输入分别减少约24.0%和26.4%，但两次均超时 |
| `skill-http-compact-20260901` / 1.5.4 | 复合、简短 | 30006、24896 | 11、10 / 0 | 复合超时；简短完成但只取得一张阵容卡 |
| `skill-http-cards-only-20260901` / 1.5.5 | 复合、简短 | 28012、17426 | 原始流保留 | 两次结束，但模糊候选查询只生成一张阵容卡 |
| `skill-http-exact-cards-grounded-20260901` / 1.5.6 | 复合、简短 | 30002、22311 | 10、10 / 0 | 两次均取得2套战术结果；复合在最终生成时超时 |
| `skill-http-item-batch-20260901` / 1.5.7 | 复合、简短 | 25164、18767 | 8、8 / 0 | 两次 completed；装备批量计划与结果完全一致 |

1.5.7 两次的工具序列均为：英雄详情、英雄出装、一次装备详情批量、初始阵容候选、
候选一精确解析及战术详情、候选二精确解析及战术详情。两份战术卡各自绑定自己的
compositionId/clusterId/赛季，formation 分别含 8 和 7 个单位；最终卡片回执含初始
候选和两份战术 Evidence。正文分别 219 和 173 个字符，均保留三件来源装备的阈值/
叠层机制及“推荐装备或来牌升星顺”两个条件，均未解释站位。第一份因用户显式要求
两个阵容而简短点名两套阵容，完整站位仍只在卡片 Evidence 中。

与 1.5.6 的同类样本相比，工具调用从 10 次降到 8 次，复合请求从最终生成超时变为
25.2 秒完成，简短请求从 22.3 秒降到 18.8 秒。样本只有各一次且缓存状态并非严格
受控，因此这是诊断上的正向结果，不能写成正式性能结论。它回答了当前产品选择：
不在正文解释站位、由阵容卡承载自己的棋盘，确实减少模型输出和校验负担；主要
延迟收益则来自把三次官方装备详情调用合并为一次受服务端计划约束的批量调用。

新增与更新的聚焦回归共 167 项，覆盖默认关闭、TaskFrame 身份复用、计划参数拒绝、
批量官方回执、Evidence facet 绑定、模型输入投影以及卡片独占站位正文；全部通过。
canonical 主回归 1328 通过、7 跳过；集成回归 235 通过、1 跳过；离线 Agent eval
50/50，均 0 失败。HTTP 服务已按两次请求自动关闭。

下一步是冻结新的正式 A/B 语料、两臂共同的 Observation 和盲审包，并先运行零
Provider 调用预检；恢复本地可视环境后还要补卡片 DOM/布局验收。在正式配对和
独立盲审前不推广到生产。

## v2 forward-evaluation 冻结与零调用预检

旧 PR1C/PR1D v1 是历史不可变档案，PR1D 已以无结论/未通过关闭。本批没有覆盖旧
corpus、Observation、config、manifest 或报告，而是建立独立实验
`unit-play-guidance-forward.2026-09-01.v2`。

先通过正式 ToolRegistry/ToolExecutor 捕获当前 Set 18 数据，没有调用模型。单位按
实验 ID 的 SHA-256 排序并按 1—5 费轮询，各取两名，共 10 名：韦鲁斯、慎、黛安娜、
婕拉、纳尔、洛、乐芙兰、卡西奥佩娅、阿木木和凯南。10/10 都取得：

- 英雄官方详情；
- 首张来源出装生成的三件装备批量计划及完全一致的官方批量回执；
- 两个不同的来源阵容候选；
- 每个候选各自的精确解析结果和完整 formation，单卡至少 5 个单位。

冻结 corpus 包含 30 个正例、20 个负例和 10 个边界例。每个英雄有两个中文问法和
一个英文问法；正例统一期望两张阵容卡，站位展示为 cards-only。语料元数据明确
披露冻结前已经看过两条沃里克非正式 HTTP 诊断，因此它只称为 formal paired
results 之前冻结的 forward evaluation，不称为 pristine pre-candidate corpus。

冻结身份：

| 输入 | 版本 / SHA-256 |
| --- | --- |
| Corpus | `unit-play-guidance-forward-corpus.2026-09-01.v2` / `b02792c1aa541048d7a56c0cfeacb8a6f7fa94c6124caf298d7d0aa0f6322ce6` |
| Observation | `unit-play-guidance-forward-observations.2026-09-01.v2` / `a947e591138a317dece306c0226e590f3278dbbd5e3bc85b0ccde7b6a9a54de5` |
| Skill | 1.5.7 / `a71442c1b012d49f36ab14cabaf8810f4e2fe7689a498ebeaff5d3218047beb8` |
| A guidance | `2c92d3db9898725d98acb303831fa9e863b045009a1bcfa6ba6e6b6f46b1182f` |
| B rendered context | `26283e7abff27244ee659db81de1e30211cef06e356d63106cee4e78497d7be7` |
| 默认 Provider messages | `c34df4d9955a853b69b4593a7a77290cfd36d000a15e72ade4ac361c72b9a19e` |

两臂共同固定 cards-only、精确阵容查询、装备批量、官方回执、模型输入投影和站位
卡片边界；A/B 唯一差异是专业 guidance。canonical replay 只允许读取冻结
Observation，禁用实时 Tool，并将验证时钟固定为 `Observation.frozenAt + 1ms`，避免
官方回执在未来回放日因自然时间流逝被错误标为过期。

零调用预检 18 个门槛全部通过：30/20/10 路由正确、90 对/180 个 Agent run 顺序
确定、装备计划篡改失败关闭、投影不改原 Evidence、Provider payload 只在 guidance
字段有差异、生产默认仍为 1.3.0、生产源码不导入 v2 实验模块。实际 Provider 模型
调用为 0，正式 paired run 和生产控制在 config 中均保持未授权。详细结果见
`docs/unit-play-guidance-forward-preflight-report-20260901.md`。

下一步不再改这批冻结输入。需要先实现并评审 v2 canonical runner、盲化输出包和
双人独立标注格式；完成另一轮零调用 runner 测试后，才可以单独请求 180 次正式
Provider run 的明确授权。远程状态下仍不能完成浏览器 DOM/布局验收。

## v2 canonical runner 与双盲格式

v2 canonical runner 已在实验目录实现，仍未接入生产。它使用正式 ToolRegistry、
ToolExecutor 和 ReAct loop，固定 `Observation.frozenAt + 1ms` 时钟，并在 A/B 两臂
共同启用 action-shaped transcript、模型 Observation 投影、tactical prompt、
cards-only 和官方装备批量回执。A/B 仍只允许 guidance 不同。

冻结重放处理器只接受 8 步精确序列：英雄详情、英雄出装、三件装备批量、初始阵容、
候选一精确解析及战术详情、候选二精确解析及战术详情。任何扩大参数、额外实体解析、
单件装备查询、未知阵容 mention 或战术参数漂移都会失败关闭。

全局执行控制固定为并发 1、最多 1800 个 Provider HTTP 请求和 1000 万 token。每次
请求在发出前预留输入与输出额度；响应缺少 usage、实际 usage 超过预留、熔断开启，或
Provider 的 model/system_fingerprint 在运行中漂移，都会中止实验。

完整脚本化演练结果：

| 项目 | 结果 |
| --- | --- |
| Agent runs | 180/180 completed |
| 每个 run 的冻结工具调用 | 8 |
| 本地脚本传输请求 | 1620 |
| 最大并发 | 1 |
| 真实 Provider 模型调用 | 0 |
| 盲化输出 | 180 条，每条 2 张带各自完整 formation 的阵容卡 |
| 双人标签模板 | 每人 1080 个 facet 槽 |

盲包条目不含 arm、repetition、pairId、Provider usage、guidance hash 或原始 Evidence
ID；映射 key 单独保存。评审协议要求两人先独立标注，保留两份原始结果，分歧再仲裁。
facet 包含英雄解读、装备逻辑、什么时候玩、阵容卡、站位卡和简洁度；关键词出现不能
单独算通过。

运行器 manifest 继续锁定 `realProviderPairedRun: false` 和
`productionControl: false`。即使同时提供命令行开关、环境变量、凭据、干净工作树和
commit SHA，也不能绕过冻结 config 的调用锁。当前结果只证明运行器与盲审流水线可用，
脚本化答案不能作为效果证据。

下一步只剩两个独立边界：其一，在代码评审和一次最终零调用回归后，由用户明确授权
180 次正式 Provider run，随后交给两名独立评审者；其二，恢复本地可视环境后补做
两张阵容卡及各自棋盘的 DOM/布局验收。正式配对、双人评审和安全门槛都通过前，生产
默认继续保持 Skill 1.3.0。

# Skills 装备机制证据与精简解读

日期：2026-08-31。承接 `agent-skills-composition-scope-repair-20260831.md`。
本批完成默认关闭的装备下载凭据、推荐装备机制绑定和候选 Prompt 调整。
最终候选 1.5.2 在两次真实浏览器请求中正常返回，证据层所需四个 facet 均齐全。
这不代表整段自然语言已通过专业语义审查，也不代表正式配对评估或生产推广通过。

## 原因与修复

之前 `item_details` 的内容更新时间是 `2026-08-27 17:19:45`，来源是官方装备表
`equip.js`。原 shadow 统一按 30 分钟检查 updatedAt，把内容发布时间当成了
缓存年龄。与此同时，工具每次读取 Map 都生成 source.retrievedAt，这个字段
不能证明刚刚发生下载。不能简单改时间或延长 TTL 来补齐机制。

新增 `official-item-retrieval.v1`，由已有官方装备网络加载器在成功读取 HTTP
响应后创建，记录 fetchedAt、原始内容 SHA256、来源 URL、源赛季、源版本和
原发布时间。缓存读取只能复制凭据，不能刷新；未有凭据的旧缓存会在隔离开关
开启后重新下载，并复用既有 Promise 合并并发读取。默认行为不变。

新增 `officialItemEvidenceFailure` 统一校验真实下载年龄（30 分钟）、官方工具
身份、来源 URL、原始时间一致性和当前正式服赛季，并优先拒绝历史、stale、过期、
未来时间、错误赛季及身份冲突。兼容实测官方 `2026.S18` 和既有 `TFT18` 字段，
不做任意字符串包含匹配。PBE 或无法确认的赛季不被自动接受。

发布时间仍原样保留。官方目录版本 `16.17` 和应用赛季补丁 `18.1` 分别记录，
不会把前者重写为后者。这是当前官方目录的观测凭据，不支持回推历史补丁机制。
没有新凭据的旧 NDJSON 不会因为新代码上线而自动变成当前证据。

Skill 1.5 系列允许已有 `item_details` 的完整官方效果覆盖 equipment_logic，
前提是：存在本轮有效的目标英雄主流出装，且该方案每件装备都有同赛季、同范围、
当前下载凭据、完整公式和无未解析 token 的官方详情。统计或单件无关装备不能
代替这组绑定；不新增工具、数据服务、权限或模型判断完成状态的调用。

隔离 finish 校验使用同一凭据政策；已取得详情、正文又提及该装备时，必须保留
对应引用。不能靠删掉被拒绝的装备引用、却继续描述它的效果绕过来源检查。
这仍是有限的身份/引用检查，不是通用自然语言语义证明。

## Prompt 版本与回退

- 1.4.0 和生产默认 1.3.0 保持不变。
- 1.5.0 增加装备机制依赖，说明逐件查主流方案，缩短正文。
- 1.5.1 强化单件装备查询和阵容解析前置；强调正文只保留目标英雄坐标。
- 1.5.2 明确普通玩法的解读放 answer，narrative=null，避免误填装备方案对比的
  optionId、mechanismDifference、suitableWhen 等独立契约字段。

各版本保留，不修改历史测试对应内容。最终内容哈希：
`c2e829930e2c6da42a95496926bf0516483fc1905d9e91bcdb33f5f3b9ff4cda`。

复现：

```powershell
node scripts/start-unit-play-skill-browser.mjs --live --decision-messages=action --deadline-recovery --composition-snapshot-reuse --composition-card-scope --compound-unit-play --mechanism-evidence --output=.cache/eval/skill-mechanism-new-run
```

去掉 `--mechanism-evidence` 即恢复原 1.4 诊断候选。没有修改生产环境变量或默认
Skill，也没有放宽批量工具的确定性查询计划、阵容解析前置、权限、30 秒预算或
历史 Bridge 规则。Quick Task 未引入 Skill 路由。

## 真实浏览器结果

使用真实 deepseek-v4-flash，保留原始模型动作、失败记录、下载时间和 source hash。

| 目录 / 请求 | 版本 | 耗时 | 工具 / 拒绝动作 | 结果 |
| --- | --- | --- | --- | --- |
| `skill-mechanism-20260831` / 1 | 1.5.0 | 13,851 ms | 4 / 3 | 连续跳过阵容解析，no_progress 回退 |
| 同目录 / 2 | 1.5.0 | 29,870 ms | 11 / 3 | 当时不识别官方赛季格式，后续删引用仍保留解读；最终代码回放会拒绝 |
| `skill-mechanism-20260831-r2` / 1 | 1.5.0 | 30,009 ms | 11 / 2 | 四个 facet 的证据已齐，模型重试后超时 |
| `skill-mechanism-20260831-r3` / 1 | 1.5.1 | 29,463 ms | 11 / 0 | 回答返回，但误填对比 narrative，四项 grounding 警告 |
| `skill-mechanism-20260831-r4` / 1 | 1.5.2 | 25,110 ms | 11 / 0 | 复合问句正常完成，正文 337 字符，无 grounding 警告 |
| 同目录 / 2 | 1.5.2 | 21,519 ms | 11 / 1 | 简短玩法问句正常完成，正文 321 字符；一次跳过前置被拒后改正 |

最终两次均引用三件装备的详情、装备统计、英雄资料和两份对应站位，shadow
missingFacets=[]。两份阵容站位分别包含 8、7 个单位。浏览器结果区展开后有两份
独立站位棋盘，未出现重复的阵容卡片。小窗口下正文和工具卡片通过结果区切换。

三件装备、两次请求复用的真实下载时间都是 `2026-08-31T15:36:57.221Z`，原始内容
SHA256 是 `70b075744c74c41a37c3e944ee0da04276e92f2282edf2fc789ee81a590e2f3b`。
调用后的新 validatedAt / retrievedAt 没有改变它。第二次是同服务内的新对话请求，
缓存已预热，因此不能用这两个耗时计算受控性能提升。

每份响应只有一次终止事件，终止后无新流事件。中间版本的失败不能计入最终成功，
也不能把最终代码的历史回放冒充当时的端到端结果。

## 验证与材料

- 新增 7 项测试：HTTP 凭据与缓存、旧/错/历史凭据拒绝、引用省略、服务端开关与
  并发复用、完整推荐机制绑定及反例。既有合同测试保持原预期。
- Agent / Skill 定向回归：306 通过。
- 最终主回归：1310 通过，7 跳过，0 失败。
- 最终集成回归：234 通过，1 跳过，0 失败。
- `eval:agent`：50/50。`git diff --check` 通过。

最终日志为 `.cache/eval/skill-mechanism-*-verified.txt`。原始材料在上述四个目录，
包含 manifest、observations、response NDJSON、DOM、截图和 report.json。
汇总脚本 `.cache/eval/summarize-skill-mechanism.mjs`；评审索引
`.cache/eval/skill-mechanism-review/materials.json` 保存候选配置、输入/输出哈希和
相关代码及旧评估素材哈希，没有复制密钥或环境文件。

这些是诊断评审材料，不是完整工作区快照或正式 A/B manifest。既有 30 正例、
20 负例、10 边界的正式评估资料与冻结候选仍针对旧版本，本批未篡改或覆盖。
共享工作区的其他改动保留；本批未提交、部署或开启生产 Skill Control。
验证后已停止隔离服务并关闭本次创建的浏览器页面。

## 下一步与尚未通过的门槛

1. 先补回答层 rubric 和条件归属反例，再固定下一版 Prompt。第二个最终回答把
   血手的常驻攻击力与低生命护盾混在一句中，容易让人误认为攻击力也仅在低生命
   时获得；“收益明显”等语句也需要明确标注推论。第一轮漏写装备到手这一可玩
   条件，两轮仍有未请求的强化提示。这些没有被身份/数字/站位校验完全覆盖。
2. 完整失败场景要明确资料不足时仍按原 reasonCode 政策结束，不能把 Prompt 中
   的充分证据示例当成无条件 sufficient_evidence。过期、空结果和部分机制缺失
   的回答层也须纳入 rubric；证据齐全只说明有解释依据。
3. 为 1.5 系列固定新语料、工具观测与 rubric，在 A/B 两边共享本批 runtime / Evidence
   修复，只改变专业指导来源；执行正式配对和代价门槛检查，再评审是否推广。

两次最终返回不满足“零非法动作尝试”的正式门槛：第二次仍有一次被拒绝的阵容
前置跳过。`answerCoverage.completionEvaluated=false` 保持不变，不能将证据层
complete 误读为整份专业回答已自动验收通过。

后续条件归属、回答 rubric 和通用 Prompt 冲突修正见
[回答合同记录](agent-skills-answer-contract-20260901.md)。本记录中历史测试结论保持不变。

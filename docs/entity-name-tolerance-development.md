# 英雄、装备与羁绊名称容错

日期：2026-09-06。阶段：实现与离线验证；生产默认关闭。

后续全目录压力测试及历史验收回放已完成，详见 [全目录验证报告](entity-name-catalog-validation-20260906.md)。真实用户准确率仍未建立，自动纠错继续关闭。

未知俗称的 LLM 补充识别已独立实现，详见 [俗称识别说明](entity-slang-resolution-development.md)。下文“不增加 LLM 调用”仅描述本文件的确定性错字模块；俗称开关独立控制，默认关闭。

## 实施计划与边界

1. 审计名称解析和聊天实体查询入口，记录现有基线。
2. 从当前赛季目录的正式名称和已验证别名自动建立拼音索引，生成错字和同音候选。
3. 在已有 `entity_catalog_query` 工具内部接入，提供 off / shadow / suggest 三种服务端模式。
4. 验证当前目录约束、歧义确认、确认后重查及影子结果等价性。
5. 运行专项测试、离线评测和仓库 CI 两条回归；真实流量先 shadow，自动接受继续保持关闭。

这次处理名称容错，不增加 Skill、LLM 调用、网络来源、工具或输入参数。Quick Task 和推荐链继续使用原路径；只在默认 ReAct handler 的最终赛季目录查询中启用实验。不会自动把用户错字或模型猜测写入共享别名词典。

## 审计发现

- `entity-catalog-query.js` 原有 `filters.names` 只做精确规范化匹配，以及已人工维护的 `fuzzyAliases` 候选。后者必须确认，原有优先级保留。
- `pinyin-aliases.js` 是按 ID 维护的拼音字符串映射，并非任意中文输入的拼音转换。
- 旧 `entity-candidate-retriever.js` 的编辑距离分支不处理两字及以下别名；旧 `high-confidence-entity-resolver.js` 自动接受要求至少八位字母数字。没有降低这些旧阈值。
- `entity-linker.js` 虽列有 `pinyin_fuzzy`、可选 LLM 重排，但自由聊天的目录工具并不调用它。不能以该枚举推断所有聊天名称已经具备汉字同音纠错。
- 现有 ReAct 已确定性拦截目录返回的 `ambiguous`，并通过 Conversation Bridge 保留确认信息；单候选的“是的”会重新查询正式名称。新路径复用这一行为。
- 早期 `task-frame-shadow-parser.md` 描述的是旧阶段，不作为本功能的入口判断依据。

## 候选策略

模块：`src/domain/tft/entity-name-candidates.js`。

- 使用锁定版本 `pinyin-pro@3.29.3` 在本地转换读音，无运行时网络请求。API 依据：[pinyin](https://pinyin-pro.cn/use/pinyin.html)、[polyphonic](https://pinyin-pro.cn/use/polyphonic.html)。
- 保留正式名称、别名及人工模糊候选的既有结果，仅为 `not_found` 生成候选。
- 候选同时覆盖无声调同音、多音字、单音节平翘舌/前后鼻音变化、单次增删替换/相邻交换、完整拼音输入及拉丁名称单次编辑。
- 输入名称限 2–32 字；单字、数字 ID、API ID 不做模糊替换。输入应是模型已提取的名称，不对整个问题进行全局文本替换。
- 使用传入的当前目录和实体类型，进一步遵守显式费用、类别、羁绊、current、obtainable 筛选；不从其他赛季补候选。
- 对每个实体合并多种别名匹配，按启发式分数排序，最多返回 5 个候选。分数不是正确概率。
- 多候选不会直接选第一名。截断会携带真实 candidateCount 和 candidatesTruncated。
- 索引使用 WeakMap，签名包含实体 ID、名称和别名；同一目录被别名覆盖层修改后会重建，防止旧别名残留。
- 不把普通装备和光明版本自动合并；同音候选冲突保留确认。

## 模式与回滚

服务端环境变量：`TFT_AGENT_ENTITY_NAME_RESOLUTION_MODE`。程序化对应 `createSmallWindowRuntime({ entityNameResolutionMode })`。模型工具参数及用户 HTTP body 均不能设置它。

| 模式 | 行为 |
| --- | --- |
| `off`（默认，含未知配置值） | 不计算新候选，原查询行为不变。 |
| `shadow` | 计算候选并记录观测；返回给模型、Evidence 和用户的工具结果与 off 深度等价。 |
| `suggest` | 未命中时返回 `ambiguous` 及候选，复用现有确认流程；所有新候选均要求确认。 |

影子启用示例，在使用 Node >= 20 的终端执行：

```powershell
$env:TFT_AGENT_ENTITY_NAME_RESOLUTION_MODE = "shadow"
npm start
```

受控试用候选确认，把值改为 `suggest` 后重新启动服务；回滚改为 `off`，不涉及数据迁移。这次交付没有修改本机持久环境、部署配置或重启已有服务。

自动接受**没有执行开关**。影子观测中的 `autoAcceptEligible` 只是待评测假设：至少三字、一个字的改动、主读音相同且候选分差满足要求。它不进入工具响应，不影响执行；两字同音名和多音字猜测不满足这一假设。

## 观测

运行时 `routing.entityNameResolutionMode` 和 `routing.entityNameResolutionMetrics` 展示模式和进程内计数：完成、失败、发现候选、自动接受假设命中、累计计算耗时。重启归零，不持久化。

可注入 `onEntityNameResolution(event)` 接入现有运维采集。事件包含版本、模式、实体类型、赛季、目录指纹、候选数量、匹配类型、原因、耗时和新增 LLM 调用数（恒为零）。不记录用户原句、名称、候选 ID 或别名原文；不把 shadow 内容写入模型 Prompt、Evidence 或 Conversation Bridge。同步异常或异步拒绝的 observer 不影响结果。

## 验证与后续验收

数据集：`eval/entity-names/typos.json`，使用冻结的合成目录和人工指定的 41 条输入，29 条正向/歧义候选，12 条单字、未知、错类型、旧实体及错误 API ID 等负例。

```powershell
npm run eval:entity-names
npm run test:ci:main
npm run test:ci:integration
npm run eval:agent
```

专项测试：`test/entity-name-candidates.test.js` 和 `test/entity-name-react.test.js`。实际使用默认聊天 handler、注册工具和 ReAct 验证：候选生成、拒绝越过确认、确认后重新获取当前目录证据、服务端开关权限、完整 shadow/off 输出等价、索引变更及候选碰撞。

基线（修改前）：main 1357 passed / 7 skipped；integration 235 passed / 1 skipped；均无失败。

专项测试（含现有目录查询）：58/58 通过。报告写入 `.cache/eval/entity-name-candidates.json`，分别记录 Top-1、全部期望候选 Top-5、负例无候选、shadow/off 等价、自动执行纠错次数和自动接受假设数量。

最终验证（Node 24.18.0）：

- 相关 TaskFrame / ReAct / 会话 / 实体回归：347/347 通过。
- `test:ci:main`：1410 passed / 7 skipped，0 failed。
- `test:ci:integration`：235 passed / 1 skipped，0 failed。
- `eval:agent`：50/50 通过。
- `eval:entity-names`：41/41 通过，正例 Top-1 和全部期望候选 Top-5 均为 29/29；负例无候选 12/12；shadow/off 等价 41/41；自动执行纠错 0 次，自动接受假设 8 条。

这些是有限的合成契约样本，**不能当作线上准确率或上线自动纠错的依据**。后续先用真实失败表达和更密集的完整赛季目录做独立 holdout，分别统计候选召回、自动接受假设的错配率和澄清率，并覆盖来源目录不全、模型提前改写原始名称、方言/生僻读音与同名棋子形态。LLM 对未知俗称的生成、上下文重排、稳定跨赛季身份别名层属于后续独立工作。

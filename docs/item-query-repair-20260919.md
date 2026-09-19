# 具名特殊装备查询、携带者工具选择与历史追问修复

状态：本地实现和离线验证完成，尚未部署。生产仍为排查时的 `7e67a7fd4a5aae55c3fba0b7b976530aac1e9bf2`；本次修复阶段未修改线上代码、配置或数据库。

## 问题与修复

2026-09-18 15:26–15:29 的鱼骨头查询暴露了三类问题：具名神器目标与 ordinary_only 参数同时生效、ReAct 把神器交给纹章工具、后续回答把历史摘要省略误说成原结果没有数据。排查记录见 `output/fishbones-incident-20260918.md`。

### 具名装备范围

- ReAct 根据同一条已验证的当前实体目录 Evidence 中的精确实体解析及类别，为当前用户明确提及的 performanceItem 绑定匹配范围。
- 神器使用 include_artifact，光明装备使用 include_radiant，纹章等特殊类别使用 include_special。该规则没有硬编码英雄名、装备名或完整问句。
- 用户明确提出的类别约束优先，冲突会被拒绝并提示澄清，不自动放宽。
- unit_builds 的默认参数构建也从已解析的 performanceItem 类别推导策略，避免缺省 itemCategories 时退回普通装备。
- 通用查询校验阻止目标装备被自身策略或类别过滤掉；“已持有特殊装备、剩余槽位只要普通装备”的规则保持通过。

### 携带者工具

- 使用当前目录的 category 区分 artifact（神器）与 emblem（转职纹章）。
- emblem_carriers / emblem_rankings 对已解析的非纹章目标在执行前返回可修复的 decision_rejected，包含类别冲突原因和正确工具提示。实体未解析或只有历史 Evidence 的请求仍不能通过原有校验。
- 提示词和工具说明区分“工具选择错误”与“数据源不可用”，不再把纹章排行描述为神器排行。
- 不自动执行额外工具，不更改严格 schema、server-scoped 参数、工具注册、预算或既有 nextActionAffordance 顺序。
- 完成适配性回答仍需当前携带者证据及同装备的官方详情；games 表述为样本，不表述为去重使用人数。

### 历史追问

- 新写入的携带者历史摘要保留有限的英雄名及字段是否存在，不注入原始数值或完整响应。
- 以“这／那 + 谓语”表达的结果追问可以关联上轮成功结果；不是为单一句话加特例。
- 提示词明确 displaySummary 是节选，省略字段不证明原始结果缺少该字段。已有旧快照不会回填名单或数值。
- 完整性、作用域、有效期、900-token 上限和历史身份保持原有校验。查询当前统计仍需重新调用工具，历史 Evidence 不升级为当前 Evidence。

## 验证

采用 Node 24.19.0。系统 PATH 首位的 Node 18 在沙箱中因 EPERM 无法加载文件，不计作代码失败；实际验证使用 bundled Node 并完成相应执行审批。

| 检查 | 结果 |
| --- | --- |
| 修改前相关专项 | 148/148 通过 |
| 新增回归：修复前源文件只读覆盖 | 0/11 通过，11 项复现失败 |
| 新增回归：候选修复 | 11/11 通过 |
| 扩展专项：TaskFrame、Phase 5/6.6、ReAct、Conversation、装备 | 273/273 通过 |
| `npm run test:ci:main` | 1643 项：1632 通过、7 跳过、4 项既有失败 |
| `npm run test:ci:integration` | 239 项：238 通过、1 跳过、0 失败 |
| `npm run eval:agent` | 50/50 通过 |
| 本次涉及已跟踪文件的 `git diff --check` | 通过 |

主回归的四项失败已通过只读模块覆盖加载修复前保存的源文件再次复现：

- miniprogram-contract：仍预期 2026-09-09，而公告已更新为 2026-09-14。
- patch-note-history：两项仍预期旧日期或旧时间线末节点。
- release-config：README 缺少测试要求的发布就绪链接。

本次没有修改这些公告文件、README 或对应断言。旧实现与候选实现的离线对照不访问外部服务；运行记录保留在 `.cache/fishbones-{baseline-focused,regression-before,regression-after,expanded-focused,main,integration,agent-eval,existing-failures-baseline}.log`。

实际模型复测脚本已准备，但没有执行：自动审批拒绝将包含用户历史查询和回答的本地样本发送到配置的外部模型端点，理由是缺少该次数据发送的明确授权。使用离线回放完成验证，不能把上述结果描述为真实模型或真实上游数据验收。

## 审查与发布边界

工作区已有大量无关改动。本次开始前保存了所涉及文件的工作区版本，独立补丁 `.cache/fishbones-repair-only.patch` 只包含本次增量，基线位于 `.cache/fishbones-repair-baseline/`。补丁针对当时工作区，并非直接针对线上提交，不应不经检查直接应用到生产。

本轮以旧实现与候选实现的离线只读对照进行影子验证，尚未发布行为变更。上线前应将独立增量应用到隔离的生产基线、验证相同回归及线上数据契约，再灰度启用；保留旧镜像及部署配置用于回滚。不得连同当前工作区的其他未提交改动一起发布。本次不涉及数据库迁移、Skill 控制、第三运行时或新数据契约。

架构文档中的历史 `npm test` 基线已按 AGENTS.md 的当前要求使用两条 CI lane 和 `eval:agent`；代码中的独立 ReAct 与确定性 Quick Task 路径分别保留。

## 2026-09-19 发布候选验证

用户已明确要求上线。候选分支 `codex/item-query-repair-20260919` 从生产 `7e67a7fd4a5aae55c3fba0b7b976530aac1e9bf2` 隔离构建，仅移入本次修复；两处 Provider 补丁按线上现有函数签名适配，未引入主工作区的其他功能。

- 专项：280/280 通过。
- 主回归：1589 项，1582 通过、7 条件跳过、0 失败。
- 集成：239 项，238 通过、1 条件跳过、0 失败。
- Agent：50/50 通过。
- 生产备份：`/root/tftclarity/backups/item-query-repair-20260919`，PostgreSQL custom dump 7,528,093 字节，已通过 `pg_restore --list` 检查；原环境配置受限权限保存，旧镜像标签为 `tftclarity-app:pre-item-query-repair-20260919`。
- 镜像构建后在无外网容器内运行四个核心修复套件；激活仅替换 app，验证其他容器身份不变、ready/health/runtime 与源码哈希。激活失败自动恢复旧镜像和提交。

本节记录切换前候选状态；实际激活结果以服务器备份目录下的 `status.json` 和本地发布记录为准。未上传用户历史查询快照，也未执行被自动审批拒绝的外部模型复测。

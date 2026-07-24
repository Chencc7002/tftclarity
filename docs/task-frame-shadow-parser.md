# TaskFrame 与影子语义解析

## 协议

阶段 2 新增 `task-frame.v1`，用稳定动作、实体类型和组合字段表达任务。`IntentEnvelope` 保留为生产执行与兼容协议，并可迁移为 TaskFrame；新协议尚不接管工具选择、统计、排序、证据或结论。

稳定动作：

`search`、`recommend`、`compare`、`rank`、`explain`、`analyze`、`summarize`、`find_video`、`unknown`。

稳定实体类型：

`champion`、`item`、`trait`、`composition`、`augment`、`patch`、`game_concept`、`video`、`player_context`。

TaskFrame 同时记录 `understandingStatus`，区分：

- `understood_and_supported`
- `understood_but_missing_context`
- `understood_but_unsupported`
- `ambiguous`
- `out_of_domain`

缺少当前工具不会被表示为无法理解。

## 影子执行

`recommendForInput` 会启动新语义解析，同时继续运行旧解析。新结果只用于内部 `semantic_shadow_completed` 事件；旧解析仍是唯一生产执行输入。影子解析失败只记录 `semantic_shadow_failed`，不会改变旧链路结果或错误语义。

影子事件不保存用户原文，只记录：

- TaskFrame 版本、动作、领域、理解状态和置信度
- 新旧动作、领域和澄清状态是否不同
- 缓存输入、未缓存输入和输出 Token
- 解析耗时与预算
- 命中的少样本示例 ID
- 结构化状态栏

## 上下文与预算

固定系统规则和核心工具索引始终位于前缀；检索到的少样本随后注入；版本、时间、用户状态、会话摘要和状态栏只追加到动态末尾。

默认解析预算：

- 输入 Token：1200
- 输出 Token：300
- 延迟：1500ms
- 少样本：最多 4 条

上下文压缩由消息数或字符数阈值触发。压缩结果必须保留任务目标、未完成事项、工具完成状态、关键证据、未解决歧义、失败原因和来源引用，不使用简单滑动窗口。

## 回滚

回滚 `2d16226` 即可移除影子解析。`IntentEnvelope`、旧解析和生产数据协议未迁移，不需要数据回滚。

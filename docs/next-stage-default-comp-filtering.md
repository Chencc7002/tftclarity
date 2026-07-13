# 下一阶段目标：默认 Comp 补全与 MetaTFT 检索语义对齐

> 历史设计说明：自 2026-07-13 起，本文件中的“自动 Comp”方案不再是当前产品行为。单英雄查询只有在用户显式输入阵容时才应用 Comp；未指定阵容时不请求候选、不附加 Comp `sf`，也不产生“系统补全”或“无稳定 Comp”状态。现行规则以 `docs/current-stage-requirements.md` 顶部的 2026-07-13 覆盖条款为准。

> 实施状态（2026-07-12）：已完成端到端实现。真实请求契约与 A–E 证据见 `docs/metatft-data-explorer-comp-contract.md`，离线 fixture 见 `test/fixtures/comp-filter/metatft-data-explorer-comp-contract.json`。现行语义版本为 `metatft-explorer-sf-units-traits-v1`。

更新时间：2026-07-12

## 1. 目标与优先级

本阶段要把单英雄装备查询从“自动补一组羁绊”改为“自动补一个 MetaTFT Comp 条件”。最终检索语义必须尽可能与 MetaTFT Data Explorer 中用户主动添加 `Comps` 条件时保持一致。

本文件在默认阵容补全这一范围内，**覆盖**此前文档中以下旧行为：

- 从 `/tft-comps-api/comp_options` 选择 cluster 后，将其拆成 `traitFilters` 传给 `unit_builds`。
- 没有达到稳定门槛时采用低样本 Comp、其他特殊 Comp 或澄清作为自动降级。
- 因 `/comps` 没有验证 days/rank 支持，而把未过滤的阵容羁绊作为严格装备筛选条件。

本阶段只改变“自动补 Comp 与最终装备检索的口径”；不改变装备八桶统计、装备名称目录、聊天 UI 的基础能力。

## 2. 不可变产品规则

### 2.1 最终查询必须使用 Comp 条件

当用户显式输入 Comp，或系统成功自动选择了稳定 Comp 时，最终装备查询必须带 MetaTFT Data Explorer 所使用的 **Comp 条件**。不得把该 Comp 静默改写成一组 trait 参数，也不得把所有次要羁绊拼成过度严格的替代筛选。

```text
英雄 + Comp + days + rank + patch + queue + 星级/件数/装备约束
```

其中 `Comp` 的参数名、值格式、是否为 cluster id、是否包含变体等，必须以实际抓取到的 MetaTFT Data Explorer 请求为准，不能猜测。

### 2.2 用户未输入 Comp 时的唯一自动补全规则

```text
用户未输入 Comp
    -> 在同一 hero / days / rank / patch / queue 口径中找候选 Comp
    -> 仅当候选达到稳定门槛时，选择样本最多者
    -> 将该 Comp 带入最终装备查询
```

没有稳定 Comp 时，唯一允许的行为是：

```text
不带 Comp 查询：英雄 + days + rank + patch + queue + 其他用户条件
```

**禁止**以下自动降级：

- 使用低样本 Comp；
- 使用全局/未按当前 days/rank 过滤的 Comp；
- 使用“特殊玩法”Comp 作为替代；
- 因 Comp 候选接近而阻断并追问；
- 将候选 Comp 拆成 trait 过滤；
- 因没有稳定 Comp 而丢弃英雄、段位、时间等已明确条件。

### 2.3 数据口径必须可见

每个回答都必须显示 Comp 条件的真实状态：

- 用户指定：`[Comp 名称 · 用户指定]`
- 系统补全：`[Comp 名称 · 系统补全，样本 N]`
- 未补 Comp：`[未限制 Comp · 当前条件下没有稳定 Comp]`

未补 Comp 时必须明确说明：

> 当前条件下未找到达到稳定门槛的 Comp；以下是该英雄在当前段位和时间范围内、未限制 Comp 的装备统计。

不要称“未限制 Comp”结果为某一套阵容的推荐。

## 3. 要先完成的抓取与语义验证

开发实现前必须实际检查 MetaTFT 网站 Data Explorer。目标不是猜 API，而是建立可审计的请求契约。

### 3.1 最小抓取矩阵

在同一英雄、patch、queue 下，记录完整 URL、查询参数、响应摘要和时间：

| 试验 | 固定条件 | 唯一变化 | 需比较的证据 |
|---|---|---|---|
| A | 英雄 + 默认 days/rank | 不加 Comp | endpoint、参数、`filter_adjustment.sample_size`、返回行 |
| B | 与 A 相同 | 添加一个 Comp | Comp 参数名/值、样本和返回行是否变化 |
| C | 与 B 相同 | 改为另一个 Comp | Comp 是否是 cluster/变体/条件展开，返回差异 |
| D | 固定一个 Comp | 修改 days | 请求参数和样本是否共同变化 |
| E | 固定一个 Comp | 修改 rank | 请求参数和样本是否共同变化 |

抓取产物必须脱敏后保存为离线 fixture，并在文档中记录：

- 页面 URL 和抓取日期；
- 实际 API endpoint；
- Comp 参数名和值格式；
- `days`、`rank`、`patch`、`queue` 与 Comp 是否出现在同一请求；
- Comp 选择是否按 cluster、允许变体还是单位/羁绊展开；
- 任何响应中可用于候选样本排序的字段。

若网站要求登录、接口受 Cloudflare 或无法稳定捕获，不得伪造结论；记录阻塞原因，并把线上调用保持为人工发布检查。

### 3.2 验收判断

只有在 D/E 证明同一个 Comp 请求随 days/rank 改变而改变，才可宣称“默认 Comp 与最终装备结果使用相同 days/rank 口径”。

如果 Data Explorer 的 Comp 条件无法直接用于 `unit_builds`，必须实现一个能复现其条件语义的受控适配器；不能退回 traitFilters 假装等价。

## 4. 目标请求流程

### 4.1 用户显式指定 Comp

```text
自然语言解析
    -> 解析 hero、Comp、days、rank、patch、queue、装备条件
    -> 验证 Comp 可用且与 hero 不冲突
    -> 最终 Data Explorer 装备查询带 Comp
```

显式 Comp 的 `source=current_input`。用户后续只修改 days/rank 时，Comp 可安全继承；用户明确换 Comp、排除该 Comp、换英雄或清空会话时才移除或重新解析。

### 4.2 用户未指定 Comp

```text
自然语言解析
    -> 解析 hero、days、rank、patch、queue、装备条件
    -> 使用相同口径加载“包含 hero 的 Comp 候选”
    -> 过滤无效、非目标英雄、样本不足的候选
    -> 按样本数降序，稳定且并列时使用确定性 tie-break
    -> 有稳定候选：最终查询带 Comp
    -> 无稳定候选：最终查询不带 Comp
```

自动 Comp 的 `source=system_default`（或现有 schema 等价来源），且必须保存候选样本、稳定门槛和抓取 endpoint。它不是用户长期偏好。

### 4.3 会话与条件失效

自动 Comp 依赖以下输入，任一变化都必须重新选择：

- hero；
- days；
- rank；
- patch；
- queue；
- 可能改变 Data Explorer Comp 样本口径的模式条件。

用户显式 Comp 不因 days/rank 改变而消失，但最终统计必须重新请求。未补 Comp 不能被写成可继承的“默认 Comp”。

## 5. 数据模型与缓存

### 5.1 统一约束模型

在现有 `intent/constraints` 中引入或规范化：

```json
{
  "comp": {
    "value": {
      "id": "<网站实际 Comp 标识>",
      "name": "<可读名称>",
      "sampleCount": 0,
      "selection": "explicit | automatic"
    },
    "source": "current_input | conversation | system_default",
    "confidence": "high | default",
    "status": "applied | not_available"
  }
}
```

`status=not_available` 表示已尝试自动选择但不存在稳定候选；`value` 必须为 `null`，最终请求不能带 Comp 参数。

### 5.2 缓存键

Comp 候选缓存必须至少包含：

```text
hero + days + rank + patch + queue + Comp 语义版本 + 稳定门槛
```

最终装备查询缓存必须包含实际 Comp 参数值（或明确的 `comp=none`），避免带 Comp 与不带 Comp 的数据互相复用。

新抓取到网站 Comp 参数语义时，应提升 `Comp 语义版本`，使旧缓存失效。

## 6. 当前代码迁移范围

后续 agent 应重点检查并替换下列链路：

- `src/core/default-context-builder.js`：不再输出用于 `traitFilters` 的默认阵容；改为输出网站 Comp 条件及其可审计来源。
- `src/core/query-planner.js`：在确认的参数格式下，把 `query.comp` 写入最终 Data Explorer 请求；不要把自动 Comp 映射为 `params.trait`。
- `src/core/recommendation-service.js`：将“获取稳定 Comp”变为最终查询前置步骤，保证与最终查询共享 days/rank/patch/queue。
- `src/data/metatft-client.js` / `CompsContextClient`：按抓取结果新增最小适配器；保留 timeout、重试、cache/stale 标记。
- `src/app/small-window-server.js` 与 `src/app/small-window-ui`：展示 Comp 的 applied/not_available 状态、来源、样本和最终 endpoint/参数范围。
- 会话合并、cache key、HTTP schema、文案与 fixture：删除或迁移“默认 trait 过滤”和“低置信 Comp 自动采用”的旧假设。

不要删除阵容排行榜 `comp_rankings` 功能；它使用 MetaTFT 页面同源的 `/comps_data` 与 `/comps_stats`，并继续与单英雄装备查询基于 `exact_units_traits2` 的默认 Comp 补全解耦。

## 7. 测试要求

默认测试必须离线、稳定、不可依赖实时 MetaTFT。

### 7.1 必须新增或迁移的单元测试

1. 显式 Comp 会作为最终请求参数透传，且不转为 traits。
2. 没有显式 Comp 时，候选查询与最终查询的 days/rank/patch/queue 完全一致。
3. 稳定 Comp 中样本最多者被选中，tie-break 确定。
4. 无稳定 Comp 时，最终请求没有 Comp 参数，也没有 trait 替代参数。
5. 自动 Comp 在 days/rank/hero/patch/queue 变化后失效并重新计算。
6. 显式 Comp 可跨“近一天呢”追问继承，最终统计会更新。
7. 带 Comp 与 `comp=none` 的缓存键隔离。
8. HTTP response 显示 applied/not_available、source、sampleCount、实际 endpoint 和 stale 风险。
9. 原有单装备排行、三件套、补齐和比较在带/不带 Comp 两种口径下都只消费结构化 `placement_count`，不由 LLM 生成数字。

### 7.2 离线 fixture

至少包括：

- Data Explorer 不带 Comp 的响应；
- 两个不同 Comp 的响应；
- 同一 Comp 在不同 days/rank 下的响应；
- 有稳定 Comp；
- 全部 Comp 低于稳定门槛；
- 用户显式 Comp；
- 远端失败时可用的 fresh/stale cache。

### 7.3 HTTP 与视觉 smoke

HTTP smoke 至少覆盖：

```text
“大师以上霞什么三件装备最强？”
  -> 自动稳定 Comp -> 最终请求带 Comp

“近一天呢？”
  -> days 覆盖 -> 自动 Comp 重新选择

“霞在 <Comp 名> 里什么装备最强？”
  -> 用户指定 Comp -> 最终请求带同一 Comp

“当前条件下没有稳定 Comp 的英雄”
  -> 最终请求不带 Comp，响应明确未限制 Comp
```

视觉 smoke 至少覆盖：自动 Comp 标签、用户 Comp 标签、未补 Comp 标签、stale cache、长对话下 days/rank 改变后 Comp 更新。

## 8. 完成定义

只有同时满足以下条件，本阶段才可标记完成：

1. 已保存并审阅 MetaTFT Data Explorer 的 Comp 请求契约与离线 fixture。
2. 用户显式 Comp 与系统自动 Comp 都使用同一网站语义的最终 Comp 过滤。
3. 自动 Comp 的候选选择和最终装备统计使用相同 hero/days/rank/patch/queue 口径。
4. 无稳定 Comp 时，最终查询不带 Comp，且没有其他自动降级路径。
5. 不再将自动 Comp 静默改写为 traitFilters。
6. 条件来源、样本、最终 Comp 状态和数据范围在 HTTP/UI 中可见。
7. 离线测试、HTTP smoke 和视觉 smoke 覆盖上述规则；未执行的实时检查不能报告通过。

## 9. 外部风险

- MetaTFT 是非官方服务，页面与 API 参数可能变化。
- Comp 的页面标签、cluster id、变体和 Data Explorer 过滤语义必须以每次抓取证据为准。
- 真实网站抓取只能作为发布前人工验证；自动回归必须使用保存的离线 fixture。
- 如果网站的 Comp 语义无法稳定复现，应显示该能力不可用并保留不带 Comp 的英雄统计，不能伪造等价的 trait 查询。

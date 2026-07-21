# 结论 Prompt 注册表

运行时组合顺序：

```text
base-conclusion.md
+ intent 对应的专用 Prompt
+ Evidence Pack（user message）
+ 可选 conclusion-correction.md 与 validationFeedback
```

Prompt 路由由服务端根据已校验的结果类型或意图执行，模型不得自行选择。

| 结果类型或意图 | 专用 Prompt | Prompt 版本建议 |
|---|---|---|
| `unit_build_rankings` | `conclusion-intents/unit-build-rankings.md` | `unit-build-rankings.v1` |
| `unit_build_completion` | `conclusion-intents/unit-build-rankings.md` | `unit-build-rankings.v1` |
| `unit_best_3_items` | `conclusion-intents/unit-build-rankings.md` | `unit-build-rankings.v1` |
| `unit_item_rankings` | `conclusion-intents/unit-item-rankings.md` | `unit-item-rankings.v2` |
| `unit_item_comparison` | `conclusion-intents/unit-item-comparison.md` | `unit-item-comparison.v1` |
| `unit_emblem_rankings` | `conclusion-intents/unit-emblem-rankings.md` | `unit-emblem-rankings.v1` |
| `comp_rankings` | `conclusion-intents/comp-rankings.md` | `comp-rankings.v1` |
| `comp_trends` | `conclusion-intents/comp-trends.md` | `comp-trends.v1` |

实现时，结论缓存键至少包含：Evidence Pack 版本、基础 Prompt 版本、专用 Prompt 版本、模型名称。任一版本变化都必须使对应缓存失效。

未命中注册表的意图不得静默使用某个相似业务 Prompt，应跳过结论模型并返回确定性模板，或者使用明确注册的通用只读说明 Prompt。

`unit_details`、`item_details`、`trait_details`、`unit_item_availability` 当前明确不注册结论 Prompt：它们只做结构化查询和前端资料展示。相关静态文本可以参与意图与实体语义检索，但不触发 LLM 数据解读。

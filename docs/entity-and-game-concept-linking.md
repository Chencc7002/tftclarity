# 实体与游戏概念链接

## 分层

阶段 3 将实体提及抽取、动作解析和规范实体链接拆成三个独立步骤：

```text
Semantic action parsing
→ Entity mention extraction
→ Entity / game-concept linking
```

动作解析不再承担规范 ID 选择。链接结果只进入影子 TaskFrame，旧 `IntentEnvelope` 和旧生产解析仍是执行权威。

## 统一输出

每个链接结果使用 `entity-link-result.v1`，至少包含：

- `rawText`
- `resolvedId`
- `canonicalName`
- `expectedType`
- `version`
- `candidates`
- `source`
- `confidence`

当候选置信度或间隔不足时，`resolvedId` 保持 `null`，并保留多个候选。候选重排器只能重排已检索 ID，不能创造新实体。

## 固定解析顺序

```text
exact
→ normalized_alias
→ current_patch_catalog
→ pinyin_fuzzy
→ semantic_retrieval
→ llm_candidate_rerank
```

当前目录会过滤明确的旧版本记录；若旧记录声明 `supersededBy` 且替代实体当前可用，则旧记录不会与现实体竞争。

## 可复用游戏概念

`game-concepts.v1` 首批包含：

- 九五 / 95 / 速九
- 赌狗 / 赌牌 / D牌 / 追三
- 运营 / 拉人口
- 连败 / 卖血
- 前排装 / 肉装 / 坦装

这些是版本化概念和别名，不是完整句子的特殊分支。

“巨九”由当前装备别名目录链接到 `TFT_Item_Artifact_TitanicHydra`。“炼刀”在当前可验证目录与检索证据中没有唯一规范 ID，因此保留为未解析装备提及；这符合“不确定时不得强行命中”的约束。

## 回滚

回滚 `fe84785` 可移除阶段 3 链接器、概念目录和评估层。链接结果只在影子 TaskFrame 内使用，没有生产数据迁移或业务规则变更。

# 完整静态语义索引构建

语义索引默认从小窗口已经持久化的当前版本目录构建，不再默认使用
`createCatalog()` 的少量种子实体。种子目录只允许通过
`--allow-seed-catalog` 显式启用，用于测试和故障诊断。

默认数据源：

- `.cache/small-window-cache.json`
  - 当前版本英雄目录
  - 当前版本装备目录
  - 当前版本羁绊目录
- `.cache/comps-data-current-inspect.json`
  - 当前阵容的 cluster 身份、名称和别名
- 腾讯官方 TFT 当前目录
  - `chess.js`：当前棋子技能说明
  - `race.js`、`job.js`：当前羁绊说明和激活档位
  - `equip.js`：当前装备效果和合成信息
- `src/retrieval/semantic-corpus.js`
  - 人工维护的意图样例

阵容快照进入语义索引前会被裁剪。只保留 cluster ID、规范名称和别名，
不会保存样本数、平均名次、前四率、登顶率、登场率或趋势字段。
这些实时指标仍然只能从结构化数据源读取并由本地确定性逻辑处理。

## 构建命令

正常的向量构建要求 `.env` 中已经配置可用的 Embedding Provider：

```powershell
npm run semantic:index
npm run semantic:audit
```

未传 `--input` 时，构建器默认读取腾讯官方当前静态目录；正式目录不可用时构建失败，
避免把缺少技能、羁绊或装备说明的身份索引误报为完整索引。只有明确的离线诊断才可使用：

```powershell
npm run semantic:index -- --no-official-details --no-embeddings
```

若允许降级但仍希望尝试官方目录，可使用 `--allow-missing-official-details`；报告会写入
`descriptionWarning`。显式 `--input` 默认信任输入已经包含说明，若仍需用官方目录补全，
增加 `--refresh-official`。

也可以显式指定目录快照：

```powershell
npm run semantic:index -- --catalog-cache .cache/small-window-cache.json --comps-input .cache/comps-data-current-inspect.json
```

只构建静态文档、不调用 Embedding Provider（仍会读取官方公共目录）：

```powershell
npm run semantic:index -- --no-embeddings
```

`--no-embeddings` 是明确的维护模式。它会更新 SQLite 文档和内容哈希，
但向量健康审计会报告 `missing_embedding`，运行时将使用 TF-IDF 降级。
它不能作为生产向量构建成功的替代证明。

显式的独立输入文件仍受支持：

```powershell
npm run semantic:index -- --input ./semantic-catalog.json --patch current --locale zh-CN
```

输入可以包含 `units`、`items`、`traits`、`comps`、`descriptions` 和
`documents`。增量构建按 `contentHash` 和 `embeddingModel` 判断变化，
只重新生成新增、内容变化、向量缺失或模型变化的文档，并清理同一
patch/locale 下已经移除的文档。

## 2026-07-17 本地构建结果

当前版本完整目录生成 644 条文档。运行时目录中的敌方测试单位、PVE 单位和
召唤物会在语义装载层排除，不参与玩家实体识别：

| 文档类型 | 数量 |
| --- | ---: |
| 可查询棋子 | 62 |
| 棋子技能说明 | 62 |
| 普通及特殊装备 | 162 |
| 装备效果与合成说明 | 162 |
| 纹章说明 | 19 |
| 羁绊 | 42 |
| 羁绊说明与档位 | 42 |
| 阵容身份 | 69 |
| 意图样例 | 24 |

正式目录覆盖率为：棋子 `62/62`、装备（含 19 个纹章）`181/181`、羁绊
`42/42`。连续第二次构建结果为 `unchanged=644`，证明当前输入下增量构建稳定。
本地租户策略不允许把工作区语料发送到外部 AIHubMix Endpoint，因此
本次只完成了 644 条本地文档索引；真实向量仍必须在允许该数据出口的
部署环境中构建并通过 `semantic:audit`。

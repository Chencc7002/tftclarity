# MetaTFT Data Explorer Comp 请求契约

更新时间：2026-07-12（Asia/Shanghai）

## 结论

MetaTFT Data Explorer 当前没有独立的 `comp=<cluster id>` 查询参数。页面中的一个 Comp 是 `exact_units_traits2` 返回行里的 `units_traits` 变体签名；最终 `unit_builds` 请求通过一个结构化 AND 组复现该签名：

```text
sf[0][and][0][unit_unique]=<unit>-1
sf[0][and][1][unit_unique]=<unit>-1
...
sf[0][and][N][trait]=<trait-tier-token>
```

因此，Comp 不是 `/tft-comps-api/*` 的 cluster id，也不能等价改写为一组顶层 `trait` 参数。TFTAgent 将完整单位与羁绊变体签名作为 Comp id，并使用语义版本 `metatft-explorer-sf-units-traits-v1` 隔离缓存。

## 实际检查

检查页面：`https://www.metatft.com/explorer`

检查时间：`2026-07-12T03:25:28.7739951+08:00`

当时页面脚本：`https://www.metatft.com/assets/Explorer-CwdoQ3ps.js`

共同条件：Xayah、queue `1100`、patch `current`、Platinum+。候选请求为：

```text
/tft-explorer-api/exact_units_traits2
  ?formatnoarray=true
  &compact=true
  &queue=1100
  &patch=current
  &days=3
  &rank=CHALLENGER,DIAMOND,EMERALD,GRANDMASTER,MASTER,PLATINUM
  &permit_filter_adjustment=true
  &unit_unique=TFT17_Xayah-1
```

候选响应 `filter_adjustment.sample_size=6,418,795`，返回 250 行。选取的两个真实变体分别为：

- Comp A：样本 9,065，包含 `TFT17_Stargazer_Serpent_1`。
- Comp B：样本 7,247，单位相同但包含 `TFT17_Stargazer_Shield_1`。

## A–E 请求矩阵

| 场景 | days / rank | 最终请求 Comp | `filter_adjustment.sample_size` | 行数 | 首个装备组合八桶计数 |
|---|---|---:|---:|---:|---|
| A 不带 Comp | 3 / Platinum+ | 无 `sf` | 6,418,795 | 600 | 12,939 / 9,624 / 8,332 / 7,569 / 6,894 / 6,284 / 5,022 / 3,196 |
| B Comp A | 3 / Platinum+ | Comp A 的完整 AND 签名 | 6,418,795 | 600 | 1,531 / 1,207 / 923 / 543 / 301 / 170 / 77 / 30 |
| C Comp B | 3 / Platinum+ | Comp B 的完整 AND 签名 | 6,418,795 | 600 | 1,286 / 861 / 631 / 359 / 226 / 98 / 56 / 17 |
| D Comp A 改 days | 1 / Platinum+ | 同一 Comp A | 1,998,441 | 363 | 507 / 408 / 289 / 189 / 112 / 67 / 31 / 12 |
| E Comp A 改 rank | 3 / Master+ | 同一 Comp A | 599,465 | 236 | 191 / 164 / 161 / 99 / 67 / 38 / 23 / 5 |

矩阵证明：Comp 的结构化 `sf`、hero、days、rank、patch、queue 位于同一最终请求中；切换 Comp、days 或 rank 都会改变返回统计。`filter_adjustment.sample_size` 是当前基础筛选口径的样本范围，不等同某个 Comp 行自身的八桶样本和。

## 离线证据

脱敏 fixture：`test/fixtures/comp-filter/metatft-data-explorer-comp-contract.json`

fixture 保留页面和脚本版本、完整查询参数、两个变体签名、`filter_adjustment.sample_size`、行数和响应行摘要；不包含 Cookie、认证头或其他会话信息。默认自动测试只读取该 fixture，不依赖实时 MetaTFT。

其中 `finalRequestEncoding` 使用无损规范化形式保存 A–E 的完整参数：每个请求由 `sharedParams + compParams[compProfile] + overrides` 合并得到。测试会实际还原五个请求，并验证无 Comp、Comp A、Comp B、days=1 和 Master+ 的所有差异键。

## 外部风险

- MetaTFT endpoint 与前端脚本均为第三方非公开契约，参数结构可能无通知变化。
- 页面若改变 `sf` 序列化或 Comp 变体定义，必须提升语义版本并使旧候选/最终查询缓存失效。
- 实时抓取可能受 Cloudflare、频控、网络和区域差异影响；失败时只能回退同口径 stale 缓存，或以 `not_available` 执行不带 Comp 的查询，不能改用 trait、低样本或全局 Comp。

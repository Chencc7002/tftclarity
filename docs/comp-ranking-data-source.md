# 阵容排行榜数据来源与口径

更新时间：2026-07-11

## 已验证来源

阵容统计使用 MetaTFT 非官方 Explorer 接口：

```text
GET https://api-hc.metatft.com/tft-explorer-api/exact_units_traits2
formatnoarray=true
compact=true
queue=1100
patch=current
days=3
rank=CHALLENGER,DIAMOND,EMERALD,GRANDMASTER,MASTER,PLATINUM
```

2026-07-11T06:05:30.0264699Z 的实际响应证据包含 250 行，`filter_adjustment.override_applied=false`、`rank_filter` 与请求一致、`sample_size=6339248`。每行包含 `units_traits`、`placement_count` 和可选 `avg_unit_N_tier`。最小脱敏证据保存在 `test/fixtures/comp-rankings/exact-units-traits2-minimal.json`；完整实时响应只保存在被 Git 忽略的 `.cache`。同日最终人工发布 smoke 再次成功，实时样本范围更新为 6,446,912；该变化只作为外部状态证据，不回写离线 fixture。

`placement_count` 必须是八个非负名次桶，统计统一复用本地 `calculatePlacementStats`：

```text
games = sum(placement_count)
top4Rate = sum(placement_count[0..3]) / games
winRate = placement_count[0] / games
avgPlacement = sum((index + 1) * placement_count[index]) / games
```

没有完整八桶分布的行不会生成前四率或登顶率。`avg`、`score`、样本数和 LLM 输出都不会用于反推这些指标。

## 阵容定义与异常过滤

稳定阵容定义优先匹配：

```text
GET https://api-hc.metatft.com/tft-comps-api/latest_cluster_info
queue=1100
patch=current
```

同日实际响应为 TFTSet17、cluster id 409，共 69 个 cluster。匹配成功使用稳定 `cluster:<id>`；否则使用排序后的英雄与基础羁绊指纹。只有同一稳定 id/指纹的细微变体才合并，并逐桶求和。

实时数据中确实观察到 PvE ElderDragon、单英雄、重复英雄、召唤物/小兵等异常形态。本地默认规则会：

- 去掉明确的召唤物/小兵 token；
- 排除 PvE、重复英雄、少于 6 或多于 10 个可购买英雄的棋盘；
- 排除 cluster 名称明确标记的英雄强化/专属玩法；
- 仅在玩家显式请求特殊玩法时放宽上述棋盘规则。

最低样本阈值以内的数据只进入“低样本参考（不进入排名）”，不会获得 S/A 等等级标签。

## 图标来源

英雄、装备和羁绊图标 manifest 来自 Riot Data Dragon `16.13.1` 的 `tft-champion.json`、`tft-item.json`、`tft-trait.json`。生成文件只提交 apiName/filterId、版本、来源和版本化 CDN URL，不提交整套图片。后端仅允许 `https://ddragon.leagueoflegends.com`；未知或不合规 URL 返回固定尺寸 fallback。`npm run refresh:assets` 本地缓存优先，缓存缺失时获取固定版本官方源；`npm run audit:assets` 忽略生成时间，仅检查版本、来源和 662 条资产内容漂移。

## 缓存与风险

查询缓存键包含 intent、指标、limit、patch、queue、days、rank、minSamples、specialMode 和数据版本。实时请求失败时允许回退过期缓存，但 API/UI 必须显示更新时间和 stale warning。

MetaTFT 是非官方接口，结构、限流和可用性都可能变化。默认测试只使用离线 fixture；人工发布前可运行 `npm run smoke:comps:live`，该命令不会加入默认测试。

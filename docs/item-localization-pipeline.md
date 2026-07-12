# 装备官方中文本地化与 patch 审计

更新时间：2026-07-11

## 当前版本与来源

当前项目的 TFT patch 是 `17.6`。Riot 官方 17.6 版本公告发布时间为 `2026-06-23`；腾讯《英雄联盟》官网装备目录在同一周期声明：

```text
version = 16.13
season = 2026.S17
time = 2026-06-23 16:38:05
```

简中 canonical 名称来源：

```text
https://game.gtimg.cn/images/lol/act/img/tft/js/equip.js
```

该目录由腾讯《英雄联盟》官网 CDN 提供，装备记录的 `englishName` 是 Riot/MetaTFT API ID，`name` 是国服简中名称。当前原始响应 SHA-256：

```text
9945729e7390d7942f58097e1136f98b42801480408794d0fbe410c4def73163
```

缺失简中时的英文回退来源是 Riot Data Dragon 固定版本：

```text
https://ddragon.leagueoflegends.com/cdn/16.13.1/data/en_US/tft-item.json
```

当前英文原始响应 SHA-256：

```text
f39331327bdb96021210016a3a9683d0fc111fcc9c36e2b84c1fe1c73aa80d83
```

Riot Data Dragon 的 `zh_CN/tft-item.json` 及 CommunityDragon 对应 `zh_cn/zh_my` 客户端提取在此版本的名称字段实际为 `????` 占位符，因此不作为简中名称来源。它们不能通过“文件名是 zh_CN”这一点获得可信状态。

## 合并优先级

同一个 `apiName` 的字段职责如下：

1. 腾讯官网装备目录的有效 `name` 写入 canonical `zhName/displayName`，并记录 URL、source patch、TFT patch、时间、置信度和追溯状态。
2. `item-alias-overrides.js` 继续负责 `shortName`、俗称、缩写、历史称呼和人工明确例外；这些入口会与官方中文名、Riot 英文名合并到 aliases。
3. 官方 canonical 名与人工旧 canonical 名冲突时，官方名优先；旧名保留在 aliases 和 `manualNameCandidate`，不会静默丢失。
4. 官方简中缺失或为 `????` 时，canonical 展示回退到 Riot 英文名，并写入 `official_en_fallback_pending_zh_cn` / `nameNeedsReview=true`。人工中文候选不能覆盖该状态。
5. 装备是否在当前版本可用仍只由 `item-availability-overrides.js` 的显式规则裁决；MetaTFT 是否返回某个 token、或该 token 是否从新快照消失，都不会自动改变可用性。

`TFT_Item_Artifact_CappaJuice` 在当前腾讯官方目录中的简中名为“帽子饮品”；Riot Data Dragon 英文名为 `Cappa Juice`。因此当前快照使用“帽子饮品”作为 canonical 中文名，并保留 `Cappa Juice` 英文别名。

## 当前 ID 复用规则

同一个 Riot API ID 可能跨赛季复用，不能靠旧人工名称推断当前身份。当前目录已确认：

```text
TFT_Item_RapidFireCannon  -> 红霸符
TFT_Item_RunaansHurricane -> 海妖之怒（普通、当前、可用）
TFT_Item_MadredsBloodrazor -> 巨人杀手
```

“火炮”“分裂弓/飓风”“红叉/麦瑞德”只作为历史别名。人工 availability override 必须绑定明确 patch 和 season；`npm run audit:items` 会拒绝 `patch: current`、`patch: *` 或缺少 season 的规则。官方目录优先于人工 canonical 名，手工配置只维护俗称、拼音、缩写和经过审核的版本例外。

## 刷新流程

离线 fixture 或预先下载的源文件：

```text
npm run refresh:item-localization -- --cn <equip.json> --en <tft-item-en.json> --items <metatft-items.json>
```

可选实时拉取（不进入单元测试）：

```text
npm run smoke:item-localization
```

该命令的 `--check` 会重新构建实时快照，并与仓库中的生成文件逐字段比较（仅忽略 `generatedAt`）。数据源、范围、哈希、元数据或装备记录发生漂移时会返回失败，必须显式刷新并审核 diff。

刷新脚本会拒绝 source patch、season、Data Dragon version 或 TFT patch 与 `item-localization-sources.js` 配置不一致的输入。输出写入：

```text
src/data/generated/item-localization.zh-CN.json
```

离线刷新以传入的 MetaTFT items fixture 为范围；`--remote` 会同时读取实时 MetaTFT `/items`，而不再沿用本地 `.probe`。2026-07-11 的最终快照为 179/179 官方简中、待审 0；相对 178 行 `.probe` 新增 `TFT17_AnimaSquadItem_Tier4_Omniweapon`，官方名为“幻灵合体至尊炮”。后续数量以每次刷新输出为准，缺失项必须进入待审列表。

## Patch 审计

当前默认审计会把 `.probe/meta_items_expanded.json` 当作上一份 MetaTFT 观察快照，把最新生成的本地化快照当作当前 ID 集：

```text
npm run audit:item-patch
```

版本更新时提供上一版快照：

```text
npm run audit:item-patch -- \
  --previous-items <previous-metatft-items.json> \
  --current-items <current-metatft-items.json> \
  --previous-localization <previous-localization.json> \
  --current-localization <current-localization.json>
```

报告包括：新增 API ID、从 MetaTFT 快照消失的 API ID、缺失简中和 canonical 名称变化。消失项标记为 `REMOVED_OBSERVATION`；只有显式命中 `item-availability-overrides.js` 时才显示 `explicit_override`，否则必须人工复核。

离线 fixture 测试覆盖刷新脚本和审计脚本，不发起网络请求。

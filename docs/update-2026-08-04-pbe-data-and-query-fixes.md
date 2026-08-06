# TFTClarity 更新公告｜2026-08-04

## 对外发布稿

今天完成了一轮查询体验修复。Set 18 PBE 大更新仍在等待结构化数据源确认，本次不将候选数值写入正式查询数据。

### 查询修复

- 修复“神器/装备定阵”无法使用“巨九”的问题。快捷查询现在直接从结构化输入解析装备，不再依赖二次理解文案；S17 会解析为 `TFT_Item_Artifact_TitanicHydra`，PBE 会解析为 `DA_Artifact_TitanicHydra`。“巨九”“九头蛇”“巨型九头蛇”均可识别；聊天区只输入一个明确装备名时，默认查询其适合携带者。
- 修复聊天区“阿狸神器排行”“霞的神器排行”等查询失败的问题。系统现在会把英雄识别为查询主体，把“神器”识别为装备类别，并只返回该英雄的神器表现排行。
- 英雄 + 特殊装备类别的明确排行查询现在走确定性解析，不再等待语义模型；同时为 `unit_builds` 统计请求使用完整的排行超时预算，减少上游响应稍慢时的误超时。
- 同步加强了光明装备、纹章/转职排行的确定性解析，避免类别词被误当成某一件具体装备。
- 增加语义校验：英雄装备排行必须包含具体英雄，“神器/光明装备/纹章”等类别词不能进入具体装备比较槽。
- 修复失败结果“重试”按钮丢失原查询内容的问题。重试会复用上一轮输入和快捷查询参数，但不会强制刷新缓存。
- PBE `/items` 返回空结果时，装备目录会由当前 `TFTSet18` lookup 补齐；不再因为持久化目录缺少 `DA_Artifact_TitanicHydra` 而无法识别“巨九”，也不会跨赛季回退到 S17 装备目录。

### Set 18 PBE 数据核验（暂未上线）

已重新拉取并核验 Set 18 PBE 的棋子目录、装备目录、棋子数值和羁绊数据。由于上游各结构化来源尚未一致反映本轮大更新，下面内容仅作为候选变更记录，不属于本次正式数据更新。

当前在羁绊源中观察到的候选变化：

- 灵魂莲华：7 灵魂莲华的攻击力/法强加成由 45% 调整为 40%；9 灵魂莲华由 60% 调整为 50%。
- 月蚀骑士：4 月蚀骑士的攻击速度/法强由 15% 调整为 14%；5 月蚀骑士由 20% 调整为 18%。
- 迅捷射手：修正高档位说明中的攻击速度图标，数值未发生变化。
- 宿敌：补充卡兹克进化、雷恩加尔金币奖励和全队攻击力成长机制的完整说明。

### 数据时效说明

8 月 3 日的 PBE 大型平衡调整已经出现社区汇总，但截至本次核验时，棋子 Team Planner 和 MetaTFT Set Lookup 的结构化文件仍与上一版一致；因此未把这些棋子或羁绊候选数值写入正式查询结果。待来源上线且通过完整性校验后再单独发布数据更新。

参考来源：

- [CommunityDragon PBE 棋子目录](https://raw.communitydragon.org/pbe/plugins/rcp-be-lol-game-data/global/zh_cn/v1/tftchampions-teamplanner.json)
- [CommunityDragon PBE 羁绊数据](https://raw.communitydragon.org/pbe/plugins/rcp-be-lol-game-data/global/zh_cn/v1/tfttraits.json)
- [MetaTFT Set 18 PBE Lookup](https://data.metatft.com/lookups/TFTSet18_pbe_zh_cn.json)
- [8 月 3 日 PBE 改动社区汇总](https://www.reddit.com/r/CompetitiveTFT/comments/1veicr4/set_18_pbe_patch_83_tons_of_changes/)

---

## 维护核验记录

- 核验时间：2026-08-04（Asia/Shanghai）。
- Set 18 Team Planner：远端与 2026-08-02 本地快照哈希一致。
- MetaTFT Set Lookup：远端与 2026-08-03 本地快照哈希一致。
- Set 18 羁绊数量：刷新前后均为 36；变更记录为 4 个，无新增或删除。
- CommunityDragon `cdragon/tft` 聚合文件目前只暴露 19 个 Set 18 champion 记录，缺少大部分 `DA_18_*` 棋子，暂不作为完整棋子目录的替代源。
- 本地正式查询数据未采用本轮候选数值。
- Browser Use 实测：S17 聊天“巨九”和“神器/装备定阵”均返回 8 个正向提升携带者；S17“霞神器排行”正确返回单件神器排行。
- Browser Use 实测：PBE 聊天“巨九”和“神器/装备定阵”均正确识别为“巨型九头蛇”，当前统计源明确返回无正向提升样本；PBE“阿狸神器排行”正确进入单件神器排行，并明确返回当前无神器样本。

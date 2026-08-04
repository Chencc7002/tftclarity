# Set 18 PBE 更新源评估（2026-08-04）

## 结论

目前没有一个同时满足“最快、完整、稳定、官方、可机器解析”的 Set 18 PBE 静态数据源。更可靠的方案不是直接更换为某个社区站点，而是采用分层来源和完整性门禁：

1. 棋子身份、费用、羁绊归属和羁绊档位优先使用 CommunityDragon 镜像的 Riot 客户端 PBE JSON。
2. 棋子基础属性和技能数值暂时继续使用 MetaTFT Set Lookup，但必须展示更新时间并进行过期检测。
3. CommunityDragon 的聚合 TFT JSON 只在 Set 18 棋子覆盖率达到门槛后，才能替代 MetaTFT 数值。
4. tactics.tools PBE 和补丁图集只作为“发现有更新”的漂移信号，不能直接覆盖正式目录。
5. 任一来源发生变化后，先通过实体覆盖率、ID 一致性和数值完整性校验，再提升为正式数据。

## 实测结果

| 来源 | 2026-08-04 实测状态 | 优点 | 风险 | 建议用途 |
| --- | --- | --- | --- | --- |
| Riot Data Dragon PBE Realm | 最后修改时间 2026-07-28；Realm 仅列 LoL champion/item 等版本，没有 TFT Set 18 静态目录 | Riot 官方、稳定 | 官方文档也说明 Data Dragon 是人工更新，不保证紧随补丁；当前没有需要的 TFT PBE 数据 | 不作为 Set 18 数值源 |
| CommunityDragon Riot Client `tftchampions-teamplanner.json` | 71 条 Set 18 相关棋子记录；最后修改时间 2026-07-30 | 接近客户端原始目录，ID/名称/费用/羁绊归属可靠 | 不包含完整技能和面板数值 | 主实体目录 |
| CommunityDragon Riot Client `tfttraits.json` | 36 个 Set 18 羁绊；最后修改时间 2026-08-03 20:47 UTC；已出现本轮 4 个羁绊变化 | 本轮更新最快，包含羁绊常量和说明 | 某些技能/机制仍可能只有模板变量 | 羁绊主数据源 |
| CommunityDragon `cdragon/tft/zh_cn.json` | 最后修改时间 2026-08-03 20:48 UTC，但 Set 18 聚合结果只有 19 个 champion，普通 `DA_18_*` 可用棋子仅 2 个 | 包含技能变量和基础属性，更新时间快 | Set 18 新引擎数据提取不完整；CommunityDragon 文档明确聚合 JSON 是由其团队从 Riot 文件生成，并非 Riot 直接发布 | 仅作交叉验证；覆盖率达标后再考虑升级 |
| MetaTFT `TFTSet18_pbe_zh_cn.json` | 内容完整，但最后修改时间仍为 2026-07-31 15:55 UTC，本轮远端哈希与旧快照一致 | 当前最完整的 Set 18 棋子技能/面板数值目录 | PBE 大改时有明显同步延迟 | 暂时作为棋子数值源，并标记陈旧状态 |
| tactics.tools PBE Changes | 页面标注 8 月 3 日 23:00 更新 | 能很快发现数值变化 | 站点声明只捕获数值变化、不捕获机制和 Bug，并可能混入已上线变化；没有稳定完整快照协议 | 更新漂移告警，不直接入库 |
| Riot/TFT Discord 补丁图、社区汇总 | 本轮大改最早可见 | 最快、有人类语义说明 | 图片/帖子不可稳定解析，不是完整实体快照，可能随后撤回 | 公告参考和人工复核 |

## 推荐的数据提升门禁

候选来源只有同时满足以下条件，才允许覆盖正式 PBE 目录：

- 可玩棋子覆盖率不低于 Team Planner 的 95%。
- 每个棋子都有稳定 ID、费用、羁绊、生命值、攻击力、攻速、护甲、魔抗、法力值和技能记录。
- 关键 ID 能与 Explorer/统计接口中的 `DA_18_*` 标识对齐。
- 羁绊数量和 Team Planner 归属关系没有大规模孤儿记录。
- 新快照通过数值范围校验和旧版差异审计；异常大改进入隔离区而不是静默覆盖。
- 保存 `Last-Modified`、ETag、内容哈希和抓取时间，并在 UI 中区分“源更新时间”和“抓取时间”。

## 后续实现建议

- 给 PBE 目录增加 `sourceFreshness`：分别记录 roster、trait、unitStats、items 的上游更新时间。
- 当 CommunityDragon 已更新而 MetaTFT 超过 24 小时未更新时，显示“棋子数值源等待同步”，避免宣称全部最新。
- 每 15–30 分钟执行轻量 HEAD/ETag 检查；只有变更时才下载大文件。
- 对 CommunityDragon 聚合 JSON 执行覆盖率门禁。当前 19/71 的覆盖结果必须拒绝提升。
- 保留人工补丁说明作为独立 Evidence，不与结构化数值目录混写。

## 参考

- [Riot Data Dragon 文档](https://developer.riotgames.com/docs/lol#data-dragon)
- [CommunityDragon TFT/Arena 数据说明](https://github.com/communitydragon/docs/blob/master/assets.md)
- [CommunityDragon CDTB 提取工具](https://github.com/CommunityDragon/CDTB)
- [CommunityDragon PBE Team Planner](https://raw.communitydragon.org/pbe/plugins/rcp-be-lol-game-data/global/zh_cn/v1/tftchampions-teamplanner.json)
- [CommunityDragon PBE Traits](https://raw.communitydragon.org/pbe/plugins/rcp-be-lol-game-data/global/zh_cn/v1/tfttraits.json)
- [CommunityDragon PBE TFT 聚合数据](https://raw.communitydragon.org/pbe/cdragon/tft/zh_cn.json)
- [MetaTFT Set 18 PBE Lookup](https://data.metatft.com/lookups/TFTSet18_pbe_zh_cn.json)
- [tactics.tools PBE Changes](https://tactics.tools/info/pbe)

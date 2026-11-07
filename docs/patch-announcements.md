# 版本公告

## 当前内容

当前维护版本为 18.6，国服公告发布时间为 2026-11-04 19:45:27（北京时间），
维护日期为 2026-11-05。默认公告展示当前赛季各版本的数值修订链；独立版本查询只返回指定版本。
18.1 至 18.5 的版本、修订 ID 和前后数值继续保留。

18.6 数值清单包含 21 项调整：2 项羁绊、10 项弈子、6 项强化符文、3 项自然仙灵。
国服公告注明约德尔人和朋友的远程加成 15/28/33% → 15/30/38% 暂未生效，
因此该项只保留在修订摘要的待生效说明，不作为当前已生效数值返回。
暗影狼使用国服与英文一致的 65/100/160 → 65/100/180 物理加成。

英文公告的 11 月 6 日/10 日客户端修复说明包含已推送和计划推送内容，
不得将整个章节描述为已上线；其中没有新增战斗平衡数值。国服还注明 /Deafen 暂未生效。
客户端、装饰内容与无完整前后值的错误修复通过摘要和官方原文说明，不混入战斗数值清单。

国服 10 月 29 日热更中的树怪、卡兹克、正义之手和六项自然仙灵费用调整，
对应 18.5 已收录的国际服修订。它们是同一批最终数值，不应因国服公布日期不同而再次叠加。

## 来源

- [腾讯国服 18.6 公告](https://lol.qq.com/gicp/news/662/37101298.html)
- [腾讯国服 10 月 29 日热更](https://lol.qq.com/news/detail.shtml?docid=10092991669911780595)
- [Riot 英文 18.6 公告](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-6/)
- [Riot 繁中 18.6 公告](https://teamfighttactics.leagueoflegends.com/zh-tw/news/game-updates/teamfight-tactics-patch-18-6/)

繁中暗影狼端点与国服/英文不同，不能用繁中名称或数值覆盖国服记录。

## 数据与发布

`src/app/small-window-ui/patch-18-6.js` 保存来源明确的双语数值修订。
`patch-history.js` 构建修订链，`patch-notes.js` 提供公告与默认版本；
`src/data/official-patch-evidence.js` 和 `official-patch-facts.js` 向注册工具提供官方证据。
棋子身份使用当前目录 API ID，不能用别的地区译名推断身份。

小程序展示数据通过 `node scripts/sync-miniprogram-patch-notes.mjs` 同步，
`--check` 检查生成数据一致性。维护源文件不等于已在微信平台发布。

应用使用 published 静态知识模式时，源公告和向量库必须一同通过构建、审计门禁。
部署前核对当前运行镜像和源文件，保留一致性索引备份；先在候选索引核验，
再发布向量并切换应用。运行模式、模型和向量健康以实际 runtime 状态为准。
参见 [静态知识发布](static-knowledge-publication.md)。

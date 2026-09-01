# Player Pool 管理与对比

Player Pool 是用户自行定义的玩家样本边界。Pool 名称只用于展示，不参与服务器、赛季或数据源推断。

## V1 约束

- 每个用户最多 2 个 Pool。
- 每个 Pool 必须保持 1–15 名角色。
- 创建 Pool 时必须同时添加并验证首名角色。
- 最后一名角色不能单独移出；不再需要时应删除整个 Pool。
- 同一角色可以加入用户的两个 Pool，比赛事实和上游缓存会复用。
- PBE 角色通过 MetaTFT PBE1 与 S18 对局证据验证；正式服角色继续使用 OP.GG。
- `pbe-player-pool-seed.json` 逐人验证后导入，解析失败或没有 S18 PBE 对局的角色不会强制加入。

## 小数据与对比

单个 Pool 输出成员与对局覆盖、Patch、平均名次、前四率、吃鸡率、阵容/主羁绊使用率及英雄使用趋势。阵容使用率同时提供：

- 对局加权：每场对局权重相同。
- 玩家等权：先在每名有效玩家内部计算，再让每名玩家权重相同。

用户可对自己的两个 Pool 发起对比。系统根据实际赛季、Patch 与样本覆盖判断兼容性；Pool 名称不参与判断。任一 Pool 少于 30 场或少于 3 名有效玩家时仅并列展示，禁止生成优劣或因果结论。

## API

- `GET/POST /api/player-pools`
- `DELETE /api/player-pools/:poolId`
- `POST /api/player-pools/:poolId/players`
- `DELETE /api/player-pools/:poolId/players/:playerId`
- `POST /api/player-pools/:poolId/import-seed`
- `GET /api/player-pools/:poolId/stats`
- `GET /api/player-pools/compare?pool=:left&pool=:right`

## 更新对局与样本补丁

- 趋势页、成员页、阵容对局页和单 Pool 看板的「更新对局」调用 `POST /api/opgg/pools/:poolId/refresh`。只能更新公开池或当前用户拥有的池。
- 手动更新通过既有 `list_matches` 工具的 `forceRefresh: true` 触发 MetaTFT 上游刷新，等待完成后读取；仍保留环境/赛季校验、限流及请求预算。排队超限、空返回或失败不会将旧样本标记为更新成功。
- 返回成功/失败成员及新增 player-match 数；比赛时间与采集时间分别展示。更新完成不意味着该玩家在所选赛季一定有新比赛。
- 页面显示的是**样本补丁**，由最新有效对局决定；客户端版本与 TFT 补丁在入库时统一归一化，不能将历史样本称为当前线上补丁。
- 阵容卡片展示样本中的代表终局及对应比赛引用，不是推荐阵容；缺失数据明确标记，不通过批量展开单局补齐。
- 发布此更新需同时部署 Web 和 Player Match MCP 服务。详见 `docs/player-pool-bugfix-delivery-2026-08-30.md`。

正式服 Pool 默认采集赛季跟随服务端 DEFAULT_SEASON_CONTEXT_ID（当前 set18-live）；明确固定赛季的已有自定义 Pool 保留原范围，统计按 set_number 隔离。新正式服池通过 MetaTFT 校验当前赛季；旧 OP.GG 采集路径保留。PBE 种子导入只允许 PBE 池。

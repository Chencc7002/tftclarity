# 管理端、迁移与赛季运维说明

## 管理端入口与鉴权

- 设置强随机环境变量 `TFT_AGENT_ADMIN_TOKEN` 后启动服务；未配置 token 时管理入口不会放行。
- 浏览器打开 `/admin`。HTTP Basic 用户名可任意填写，密码填写 `TFT_AGENT_ADMIN_TOKEN`；服务端使用常量时间比较验证。
- 调用管理 API 时使用 `Authorization: Bearer <TFT_AGENT_ADMIN_TOKEN>`。未授权的读请求返回 404，写请求返回 403，权限由服务端强制执行。
- 不要把 token 放进 URL、前端配置、长期偏好、日志或版本库。

主要管理能力：

- `/api/admin/seasons`：只读查看注册表中的赛季空间。
- `/api/admin/aliases*`：按 `seasonContextId` 创建、修改、启停、删除、匹配测试、批量审核、导入、导出与备份别名。
- `/api/admin/comp-profiles*`：按赛季维护七字段 Profile、查看当前阵容、绑定/重绑、设置绑定级策略覆盖、导入、导出与备份。
- `/api/admin/item-catalog-audit`：按赛季审查装备目录。
- `/api/admin/cache/clear`：只清理指定赛季的查询历史与运行时目录缓存。
- `/api/admin/audit`：查看管理员写操作审计记录。

别名或 Profile 写入成功后会立即进入对应 SeasonContext 的有效覆盖层，不需要修改基础 JSON/YAML 或重启服务；其他赛季不会受到影响。

### 阵容策略覆盖

- `difficulty` 等七个 Profile 字段仍只描述难度画像；`strategyOverride` 单独保存在已验证绑定上，不属于 Profile。
- 只有 `clusterId` 与 `lineupSignature` 同时匹配且绑定状态有效时，`fast8`、`fast9` 或 `reroll` 覆盖才会生效。
- 签名漂移、低置信、多个候选或多个 Profile 冲突时，服务端撤销覆盖并回到自动推导。
- 管理端选择“使用自动推导”会保存显式 `automatic`，可覆盖种子中的人工策略默认值。

## 存储与迁移

- 默认仍可使用 JSON store；生产环境若需要并发安全、完整审计和可靠持久化，建议固定 Node 22.5+/24 并选择 SQLite。
- SQLite 可通过 `TFT_AGENT_CACHE_STORE=sqlite` 和 `TFT_AGENT_CACHE_PATH=<absolute-path>` 配置，也可使用 Windows 启动器的 `-CacheStore sqlite -CachePath <path>`。
- SQLite store 初始化时自动执行复合键迁移。旧版没有 `season_context_id` 的查询缓存、会话、默认阵容、趋势、别名、装备、英雄、羁绊和语义文档行统一迁入 `set17-live`。
- 迁移为增量 schema migration，不会用同名新赛季记录覆盖旧记录；同一 API ID、别名或 Profile key 可以在不同赛季共存。
- 迁移前先停写并备份数据库；现有 SQLite 可运行 `npm run backup:sqlite`。迁移后运行 `npm test` 和 `npm run smoke:sqlite`。
- 当前系统 Node 18.20.8 没有 `node:sqlite`，且本工作区未安装可选 `better-sqlite3`，所以系统 Node 的 `smoke:sqlite` 会明确跳过。本轮已使用 bundled Node 24.14.0 完成真实文件库 smoke（229,376 字节）和全量 SQLite 迁移/持久化测试。发布时应固定 Node 22.5+/24，或为 Node 18 安装并固定兼容的 `better-sqlite3`。

## SeasonContext 运维边界

- 普通用户只提交稳定的 `seasonContextId`；`patch`、`queue`、provider 和 URL 始终由服务端注册表决定。
- 当前默认空间仍是 `set17-live`。`set18-pbe` 已开放选择和查询，固定使用 `queue=PBE`、`TFTSet18_pbe_zh_cn` lookup，并与 Set 17 缓存和目录严格隔离。
- 跨赛季切换必须使用全新会话。浏览器会按旧赛季清理原 `conversationId`，后续每个查询携带新赛季 ID。
- 缓存、目录、别名、语义文档、趋势快照、Profile 与绑定都必须带 `season_context_id`；禁止直接复制 provider 事实或查询缓存。
- `buildSeasonContentPromotionPlan` 目前仅生成 `design_only` 的 PBE→Live 审核计划，不执行写入。真实提升流程必须在受保护管理端中增加显式审批、逐项预览和审计后才能开放。

## PBE 上线状态

`set18-pbe.selectable` 已于 2026-08-02 开放。上线验证覆盖：

1. MetaTFT Explorer 的 `items`、`units_unique`、`traits`、`unit_builds` 在 `queue=PBE` 下返回 Set 18 数据。
2. `/tft-comps-api/comps_data` 与 `/comps_stats` 在 `queue=PBE` 下返回 `tft_set=TFTSet18`，且 cluster 身份一致。
3. `https://data.metatft.com/lookups/TFTSet18_pbe_zh_cn.json` 提供 Set 18 英雄、羁绊和装备的简中 lookup。
4. PBE 目录禁用 Set 17 静态 seed 回退；远端不可用时只允许使用同一 `season_context_id` 的持久化目录。
5. Set 18 主题、小屏交互和 PBE 数据波动提示保持启用。

PBE 内容仍可能高频调整。每次版本切换后应运行全量测试、SQLite smoke、small-window/comp/MetaTFT/visual smoke 及目录 audit；如 MetaTFT 契约变化，应把 `set18-pbe` 临时标记为不可用，而不是回退 Set 17 数据。

任一目录为空、健康检查失败或来源不可验证时，应继续返回 `unavailable`，不得以 Set 17 数据兜底。

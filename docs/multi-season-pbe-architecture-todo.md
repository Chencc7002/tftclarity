# 多赛季、PBE 与返场模式架构待办

> 状态：阶段 1-8 已完成；真实 PBE 数据接入等待上游上线与人工验证
>
> 目标读者：后续负责前端、后端、数据与管理端的开发 Agent。
>
> 本文定义 tftclarity 从单一 Set 17 页面演进为可同时支持正式赛季、下一赛季 PBE 与返场模式的目标架构和验收标准。

## 1. 背景与结论

当前产品的页面标题、赛季文案、壁纸和部分内容仍固定为 Set 17；普通用户也没有赛季切换入口。底层 MetaTFT 请求、运行时目录和部分查询缓存已经有 `patch` / `queue` 参数，但它们不足以代表一个完整赛季，也不能作为产品层的切换模型。

不要把 PBE 当作“当前 patch 的另一个值”，也不要在 PBE 上线时直接将全站改名为 Set 18。应引入**赛季空间（Season Context）**：它是用户选择、数据隔离、会话隔离与主题切换的唯一单位。

### 已确认的产品范围

**普通用户只切换大版本/赛季空间，不提供 17.7、17.6 等小版本或历史 patch 选择。** 每个赛季空间始终查询其数据提供者的最新 patch（内部使用 `patch: "current"` 或提供者等价参数）。小版本号可以作为结果元数据、缓存失效依据和运维诊断信息保留，但不得出现在普通用户的切换菜单、设置或管理流程中。

```text
赛季空间 = 赛季（set） + 运行环境（live/pbe） + 游戏模式 + 数据版本 + 视觉主题 + 数据提供者
```

## 2. 产品阶段

| 阶段 | 可选择赛季空间 | 默认空间 | 要求 |
| --- | --- | --- | --- |
| A：下一赛季 PBE | `set17-live`、`set18-pbe` | `set17-live` | PBE 标为 Beta/预览，不能与正式服数据混用 |
| B：新赛季正式上线 | `set18-live`，可选保留 `set18-pbe` 一段时间 | `set18-live` | PBE 被归档或隐藏；Set17 变为历史数据或下线 |
| C：返场模式 | `set18-live`、`set16-revival`（示例） | `set18-live` | 返场是独立可选空间，不伪装为旧正式赛季 |

所有阶段都应允许运营者控制：是否可见、是否可选择、是否默认、是否只读/归档、是否显示风险提示。

## 3. 赛季注册表（唯一配置入口）

新增后端维护的赛季注册表。前端不得自行拼接 MetaTFT URL、`queue` 或 `patch`。

示例：

```js
{
  id: "set18-pbe",
  label: "Set 18 · PBE 预览",
  season: 18,
  environment: "pbe", // live | pbe | revival
  mode: "standard",
  status: "coming_soon", // coming_soon | preview | live | archived
  visible: true,
  selectable: false,
  isDefault: false,
  catalogNamespace: "set18-pbe",
  source: {
    provider: "metatft-pbe",
    pageUrl: "https://www.metatft.com/pbe-comps",
    queue: "PBE",
    patchPolicy: "latest"
  },
  themeId: "set18",
  notices: ["PBE 数据仍在测试，可能随时变化。"]
}
```

### 约束

- `id` 永久稳定；不能用显示名称、patch 或 URL 充当 ID。
- `set18-pbe` 与 `set18-live` 是不同空间，即使共用 Set18 美术和部分名称。
- `patch` 只表示某个数据提供者的内部补丁参数，不代表赛季；本项目固定使用最新 patch，不支持用户选择历史 patch。
- `queue` 只表示数据统计口径，不由浏览器直接决定。
- PBE 尚未提供可验证数据时，保持 `coming_soon` 与 `selectable: false`；不得回退为正式服数据。

## 4. 数据提供者抽象

为正式服、PBE 和未来 Riot 聚合数据定义统一接口：

```js
provider.getAvailability(context)
provider.getCatalog(context)
provider.getCompRankings(context, query)
provider.getUnitBuilds(context, query)
provider.getPatchStatus(context)
```

实现建议：

- `MetaTftLiveProvider`：封装现有正式服 MetaTFT 调用。
- `MetaTftPbeProvider`：封装 PBE 调用，配置来源页面为 `https://www.metatft.com/pbe-comps`。
- `RiotAggregateProvider`：未来切换官方聚合数据时使用，不改变上层业务与 UI。

### PBE 上线后的接入流程

1. 在浏览器网络面板确认 PBE 页面实际调用的 API、请求参数、返回字段、限流和更新频率。
2. 不解析网页 HTML；该页面是 JavaScript 应用壳，必须使用已验证的网络接口或经允许的数据来源。
3. 实现并测试 `MetaTftPbeProvider`，验证同一英雄/阵容查询返回的是 PBE 而非正式服数据。
4. 同步完整目录并完成人工审核后，再把 `set18-pbe.selectable` 设为 `true`。
5. 若接口不可用、目录为空或校验失败，向用户返回 `unavailable` / “PBE 数据准备中”，不得静默使用 `set17-live`。

## 5. 数据模型、缓存与迁移

### 必须解决的问题

现有持久化目录以单独的 `api_name` / `filter_id` 作为唯一键；同名实体写入另一赛季时可能覆盖先前赛季记录。这阻止了多赛季共存。

### 目标隔离键

所有与游戏数据有关的存储和检索必须以 `season_context_id` 为第一个命名空间：

```text
season_context_id + entity_type + api_name
season_context_id + entity_type + filter_id
season_context_id + cache_key
season_context_id + alias
season_context_id + conversation_id
```

查询缓存的完整指纹至少包含：

```text
seasonContextId + providerVersion + effectivePatch + queue + rank + days + 查询条件
```

### 迁移任务

- 为 `item_catalog`、`units`、`traits`、别名表、语义文档/索引增加 `season_context_id`。
- 将主键/唯一索引改为复合键，保留旧数据并迁移至 `set17-live`。
- 所有读取、写入、清除、审计接口强制接收赛季空间。
- 内存目录、SQLite/JSON 缓存、默认阵容缓存、查询缓存、会话追问和 LLM 证据缓存均按赛季空间隔离。
- 赛季切换后不得继承上一赛季会话的英雄、装备、阵容或默认上下文。

## 6. 名称、俗称与内容运营

每个赛季空间需要独立维护以下内容：

- 英雄、羁绊、装备的标准 ID、标准中文名和显示名；
- 中文俗称、简称、常见错别字和社区叫法；
- 新增/删除/改名差异与人工审核状态；
- 快捷问题、赛季公告、风险提示；
- 语义检索文档与索引。

建议目录：

```text
season-content/
  set17-live/
    aliases.zh-CN.json
    theme.json
    patch-notes.json
    wallpapers/
  set18-pbe/
    aliases.zh-CN.json
    theme.json
    patch-notes.json
    wallpapers/
  set18-live/
    aliases.zh-CN.json
    theme.json
    patch-notes.json
    wallpapers/
```

`set18-pbe` 可继承 Set18 的基础主题/别名，但其 PBE 差异必须可单独覆盖。Set18 正式上线时，经过审核的内容应从 PBE 提升或复制至 `set18-live`，不要直接共用可变文件。

### 别名的日常维护模型

当前修改棋子、装备或羁绊俗称需要直接修改 JSON 文件。目标是将 JSON 降级为可版本控制的初始/兜底词典，并把日常运营修改放入持久化覆盖层：

```text
基础 JSON 词典（随代码发布）
  + 已启用的数据库别名覆盖层（管理端维护）
  = 查询使用的有效词典
```

管理端保存一条别名时，必须写入可持久化的数据库，而不是修改部署目录下的 JSON。记录至少包含：

```text
season_context_id
entity_type          // unit | item | trait
api_name             // 精确指向的实体
alias
enabled
source               // seed | admin | user-candidate
updated_at
updated_by
```

同一俗称可在不同赛季空间指向不同实体；例如 Set17 与 Set18 的同名/复用称呼不能冲突。需要提供导入 JSON 初始词典、导出当前有效词典和备份能力，但 JSON 不再是日常修改入口。

## 7. 普通用户前端

### 顶部赛季切换器

在品牌区域新增赛季按钮和下拉面板：

```text
tftclarity   [ Set 17 · 正式服 ▾ ]

              当前可用赛季
              ● Set 17 · 正式服
                Set 18 · PBE 预览  Beta
              ──────────────────
                Set 16 · 返场
```

每个选项显示名称、状态徽标、可用性与简短数据提示；不可用的 PBE 入口显示“即将开启/数据准备中”，并禁止选择。

### 前端状态与切换流程

前端只保存 `seasonContextId`，不保存或信任 `patch`、`queue`、provider URL。

```text
GET  /api/season-contexts
POST /api/season-contexts/select { seasonContextId }
POST /api/recommend { input, seasonContextId, preferences }
```

切换成功后必须：

1. 清空结果和会话追问上下文，显示“已切换至 {赛季名称}，当前对话已重置”。
2. 更新页面标题、顶部文案、主题色、壁纸、粒子效果、快捷任务和公告。
3. 重新加载该赛季的目录/别名状态。
4. 后续请求统一附带 `seasonContextId`。

### 主题系统

主题属于赛季空间，而不是硬编码在 `wallpaper-catalog.js`。后端返回已批准的主题配置，前端仅使用白名单的本地/受信资源路径，应用 CSS 变量：

```js
document.title = `tftclarity · ${context.label}`;
document.documentElement.dataset.season = context.id;
root.style.setProperty("--season-primary", context.theme.primary);
root.style.setProperty("--season-accent", context.theme.accent);
```

Set18 需要重新设计主题、壁纸、默认背景和小屏适配；PBE 可使用 Set18 预览主题，但必须保留 Beta 徽标和提示。

## 8. 管理端

当前只有设置抽屉中的装备目录审查与别名审核等 `admin-only` 功能；没有独立赛季管理端。本项目需新增受保护的管理模块。管理端应优先于 PBE 数据接入开发，以立刻解决日常修改俗称必须编辑 JSON 的问题，并为 PBE 上线时的内容运营准备工具。

### 第一期最小可用管理端（优先实现）

- 独立受保护入口（建议主站 `/admin`），服务端管理员鉴权。
- 别名 CRUD：新增、编辑目标实体、启用、停用、删除；按赛季、实体类型、来源和状态筛选。
- 别名匹配测试：输入俗称后显示将命中的实体与赛季，防止误配。
- 导入基础 JSON、导出有效词典、备份数据库覆盖层；所有写入保留操作记录。
- 延续现有装备目录审查、候选别名审核、缓存查看/刷新能力，并改为按赛季空间工作。
- 单赛季时也可使用：初始只显示 `set17-live`，但所有表单和数据均保存 `season_context_id`。

第一期明确不做：账号注册体系、多角色审批流、拖拽页面编辑器、任意第三方数据源 URL 编辑、复杂运营报表。

### 管理端能力

- 创建、编辑、启用、停用、归档赛季空间；设置唯一默认空间。
- 管理 `visible`、`selectable`、`status` 与 PBE 风险提示。
- 绑定数据 provider、队列、目录命名空间；数据源始终使用最新 patch。管理端只显示当前生效 patch 供诊断，不提供历史 patch 配置；显示健康状态与最后同步时间。
- 为赛季配置主题、壁纸、公告和默认快捷问题。
- 按赛季审核英雄/羁绊/装备目录、别名和候选别名。
- 新增、编辑、启用、停用、删除正式别名；管理端修改应即时进入有效词典，不要求改 JSON 或重新部署。
- 导入基础词典、导出有效词典、备份/恢复别名覆盖层；记录管理员操作审计。
- 触发数据同步、目录差异检查、缓存刷新和语义索引构建。
- 查看每个赛季的数据源错误、空目录、缓存状态和审计结果。

### 阵容增强与 Comp Profile 管理

后续自然语言阵容推荐需要在 MetaTFT 实时事实之后增加 `CompEnrichment`。该层包含两部分：

- 自动推导：根据阵容、升级路线和 Roll Timing 推导 `strategy`（例如 `reroll`、`fast8`、`fast9`），保存推导依据和算法版本。审核确认自动分类不适用时，可在通过 cluster 与 lineupSignature 双重校验的绑定上设置策略覆盖。
- 人工 Profile：只维护 `difficulty`、`beginnerFriendly`、`pivotDifficulty`、`positionDifficulty`、`contestTolerance`、`econDifficulty`、`notes` 七个字段。

MetaTFT 继续作为阵容事实和实时统计的唯一来源。TFTClarity 不建立自己的阵容统计库，但管理端可持久化人工 Profile、阵容绑定和审计记录。基础 YAML/JSON 作为种子和兜底，数据库覆盖层用于即时编辑：

```text
MetaTFT 实时阵容事实
  + 自动推导 strategy
  + 已验证绑定的可选 strategyOverride
  + 基础 Comp Profile
  + 已启用的数据库 Profile 覆盖层
  = Comp Enrichment
```

Profile 不得直接以阵容展示名称或 MetaTFT `clusterId` 作为永久主键。目标模型至少包含：

```text
comp_profiles:
  season_context_id + profile_key + 七个 Profile 字段 + enabled + 审计字段

comp_profile_bindings:
  season_context_id + profile_key + provider + cluster_id
  + lineup_signature + strategy_override + match_confidence + match_status + last_verified_at
```

`profile_key` 是 TFTClarity 在一个赛季空间内的稳定 ID；`cluster_id` 是可变化的当前数据绑定；`lineup_signature` 由规范化核心棋子和主要羁绊生成。管理端需要：

- 列出当前 MetaTFT 阵容、自动推导/有效策略、Profile 覆盖率和匹配状态。
- 新增、编辑、启用、停用、删除 Profile，并即时进入 Enrichment。
- 将 Profile 绑定/重新绑定到当前阵容，按需设置绑定级策略覆盖，并预览指纹与命中结果。
- 将低置信、未匹配、cluster 变化和来源已消失的记录放入待审核队列。
- 导入基础 Profile、导出有效 Profile、备份数据库覆盖层和保留操作审计。
- PBE 内容审核完成后，将 Profile 显式复制/提升到正式服；不同赛季空间不能隐式共享可变 Profile。

普通用户仍只使用最新 patch，不提供小版本切换。为了回答“为什么突然强了/弱了”，Agent 内部可以获取上一 patch/B Patch 作为证据；该能力属于数据提供者和证据层，而不是用户版本选择器。若上游无法查询历史 patch，必须先明确采用轻量快照方案，不能让 LLM 猜测历史变化。

阶段 4 已在上述 Enrichment 之后接入版本化自然语言条件协议。`strategy/reroll/goal/contested/difficulty/beginnerFriendly/count` 随查询和会话携带；LLM 只允许输出协议字段。服务端从当前 SeasonContext 的完整阵容候选池执行确定性过滤、Profile/同行证据校验、样本门槛、可靠性排序与数量截断。缺少已验证 Profile、缺少指标、仅有低样本或零匹配时必须返回显式状态，不允许跨赛季借用 Profile，也不允许用 LLM 猜测缺失证据。

### 权限边界

- 普通用户只能读取后端标为 `visible` 的内容，并只能选择 `selectable: true` 的赛季。
- 管理员身份必须由服务端验证；不得只依赖前端的 `admin-only` CSS 类。
- 管理端对 provider/URL/文件路径的修改必须有白名单校验和审计记录。

## 9. 推荐实施顺序

1. 定义 `SeasonContext` 领域模型、注册表、默认空间及服务端管理员鉴权。
2. 完成数据库复合键迁移；将现有数据迁移至 `set17-live`，并实现基础 JSON 词典与数据库覆盖层合并。
3. 优先实现最小管理端：别名 CRUD、审核、导入/导出/备份、装备目录审查和按赛季缓存刷新。
4. 实现 Comp Enrichment、七字段 Comp Profile、稳定阵容绑定和管理端 Profile CRUD/审核；不复制 MetaTFT 阵容事实。
5. 改造查询、目录、语义索引、缓存和会话，使其全程携带 `seasonContextId` 并完成隔离。
6. 实现赛季列表 API、选择 API、普通用户顶部切换器和会话重置。
7. 将标题、壁纸、补丁公告和样式改造成按主题配置渲染。
8. 预置 `set18-pbe` 为不可选的 `coming_soon` 配置。
9. PBE 真正上线后，验证数据接口、实现 PBE provider、同步目录、审核俗称、Profile 和 Set18 UI/壁纸，再开放入口。
10. Set18 正式上线后创建/激活 `set18-live`，切换默认空间，并按策略归档 PBE 与 Set17。

## 10. 验收标准

- `set17-live`、`set18-pbe`、返场空间能在同一部署中并存，任一空间写入不会覆盖另一空间的目录或缓存。
- 选择 PBE 后，每个查询结果都能明确显示“Set 18 · PBE 预览”和数据风险提示。
- 从 Set17 切到 Set18 后，不会继承 Set17 的会话条件、别名解析、默认阵容或缓存结果。
- 设置默认赛季、隐藏/禁用 PBE、归档返场均无需改代码或重新部署。
- 同一季节空间切换能同时更新数据、名称、壁纸、主题、标题和公告。
- PBE 数据不可用时明确报不可用，不返回正式服结果。
- 管理端权限由服务端强制校验；非管理员不能修改赛季、来源、主题或词典。
- 管理员新增或修改 Set17 俗称后，无需编辑 JSON、重新部署或重启服务；该俗称立即在 `set17-live` 查询中生效，并且不会影响其他赛季空间。
- 管理员新增或修改 Comp Profile 后，无需编辑 YAML 或重新部署即可进入对应赛季的 Enrichment；cluster 变化不会错误套用低置信 Profile。
- 自动推导字段和人工 Profile 字段来源清晰，Evidence Pack 不把人工评价伪装成 MetaTFT 事实。
- 为上述隔离、切换、迁移、PBE不可用、主题渲染和权限边界提供自动化测试。

## 11. 2026-07-22 实施结果

- `SeasonContext` 已成为查询、目录、缓存、会话、别名、语义文档与 Comp Profile 的隔离键；旧 SQLite/JSON 数据按迁移规则归入 `set17-live`。
- `/admin`、管理员别名 CRUD/导入导出/备份、Comp Profile CRUD/绑定/审核、审计和按赛季缓存清理已实现，并由服务端 `TFT_AGENT_ADMIN_TOKEN` 强制鉴权。
- Comp Enrichment、七字段 Profile、版本化 `lineupSignature`、低置信审核和三层来源证据已经接入完整候选池。
- 自然语言阵容条件协议与确定性筛选/排序已经接入；LLM 只能解析条件和解释结果，不能选择或重排阵容。
- 阶段 5 游戏分析已实现当前五项指标、版本快照、官方公告关联和分类型 Evidence Pack。上游无法验证历史 patch 时会明确降级，不把当前数据冒充历史数据。
- 普通用户顶部赛季选择器、服务端选择校验、切换后会话重置、按赛季标题/配色/壁纸/粒子/公告/快捷问题已经接入桌面与小屏布局。
- `set18-pbe` 保持 `coming_soon`、不可选择和不可查询；Provider 与健康状态只有 `not_verified/not_synced` 占位，不会请求或回退到 Set 17。
- PBE→Live 提升仅提供 `design_only` 的显式快照复制计划，要求审核和审计，不复制 provider 事实或查询缓存，也不共享可变内容。

真实 PBE 上线后仍需完成：浏览器网络接口验证、真实 PBE Provider、Set 18 目录与中文名称审核、Set 18 Comp Profile、正式主题/壁纸，以及完成审核后才把入口改为可选择。

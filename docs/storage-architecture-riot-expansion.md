# 存储架构升级与 Riot API 扩展设计

> 项目：tftclarity / TFTAgent
>
> 文档状态：实施设计
>
> 更新日期：2026-08-05

## 1. 文档目的

本文定义 tftclarity 下一阶段的存储架构、运行环境、迁移顺序和验收标准，并确保未来取得 Riot Production API Key 后，可以在现有架构上增加官方数据采集与聚合能力，而不需要重写推荐引擎、网站或小程序。

本文同时区分两类配置：

- **当前配置**：仓库代码已经识别，可以直接使用。
- **规划配置**：需要随存储升级实现，当前仅写入 `.env` 不会生效。

本文不是 Riot API 申请材料，也不假设 Riot 一定批准 Production Key。存储升级对网站本身同样有价值，因此不依赖小程序或 Riot API 的上线结果。

## 2. 结论

目标架构采用：

- **PostgreSQL**：业务持久数据和未来 Riot 聚合数据的事实来源。
- **Redis**：会话、查询缓存、AI 结论任务、流式分片、限流、配额和分布式锁。
- **SQLite**：第一阶段只保留为本地开发后备和只读型语义索引文件，不再承担生产业务主库职责。
- **S3 兼容对象存储**：取得 Riot API 并开始保存原始对局后再启用，用于压缩后的原始响应和可回放样本。
- **统一数据提供者接口**：MetaTFT、未来 Riot 聚合仓库和其他合法数据源均通过 Provider 接入。

升级不是简单把 SQL 方言从 SQLite 改成 PostgreSQL。需要先拆分存储职责、把接口改为异步，并给所有游戏数据加入来源、赛季、版本、地区和抓取时间等追踪字段。

## 3. 当前架构与主要问题

### 3.1 当前状态

当前生产部署是：

```text
Caddy
  → 单个 Node.js app
      → SQLite: .cache/tft-agent.sqlite
      → SQLite: .cache/semantic-index.sqlite
      → 进程内 Map: conclusionJobs、限流窗口和部分运行时缓存
      → MetaTFT 外部接口
      → 可选 OpenAI-compatible LLM
```

当前 SQLite 业务库包含：

- 用户偏好和会话状态；
- 查询缓存和默认阵容上下文；
- 英雄、装备、羁绊目录；
- 中文别名；
- 查询、反馈和管理审计事件；
- 阵容档案与数据源绑定；
- 阵容趋势历史；
- 匿名 AI 日额度。

### 3.2 当前风险

1. `conclusionJobs` 保存在 Node.js 进程内，应用重启后任务立即丢失。
2. 多个应用实例之间无法共享 AI 任务、分钟限流、反馈限流和部分缓存。
3. SQLite 适合当前单机规模，但会限制多实例写入、后台采集 Worker 和长期统计仓库的发展。
4. 当前 `CacheStore` 同时承担缓存、会话、目录、事件和运营数据，职责过宽。
5. 当前存储方法大量为同步调用，而 PostgreSQL 和 Redis 客户端是异步接口。
6. 当前 MetaTFT 客户端和响应适配虽然已分文件，但尚未形成完整的 `StatsProvider` 边界。
7. 如果直接按 MetaTFT 返回字段设计 PostgreSQL，将来接入 Riot 原始对局时仍需重做数据库。

## 4. 目标运行拓扑

```text
                       ┌─────────────────────────┐
Web / 小程序 ──HTTPS──→│ Caddy / API 应用实例 × N │
                       └────────────┬────────────┘
                                    │
                    ┌───────────────┼────────────────┐
                    │               │                │
                    ▼               ▼                ▼
              PostgreSQL          Redis         外部 Provider
              持久业务数据      临时状态/队列    MetaTFT / Riot
                    ▲               │                │
                    │               ▼                │
                    └──────── AI/采集 Worker ────────┘
                                    │
                                    ▼
                         S3 兼容对象存储（后续）
```

应用角色分为：

- `web`：处理 HTTP 请求，不持有只能在本机访问的任务状态。
- `worker`：执行 AI 结论任务，以及未来 Riot 对局采集和聚合任务。
- `all`：本地开发或单机过渡期，同时运行 Web 与 Worker。

正式环境即使暂时只有一台服务器，也应使用相同的存储边界。以后增加应用实例时不再改业务逻辑。

## 5. 存储职责划分

| 数据 | 目标存储 | 原因与规则 |
| --- | --- | --- |
| 用户偏好 | PostgreSQL | 需要持久保存和可审计迁移 |
| 中文别名及审核状态 | PostgreSQL | 运营数据，必须有唯一约束和审计 |
| 英雄、装备、羁绊标准目录 | PostgreSQL | 标准化后的领域数据，按赛季和版本隔离 |
| 阵容档案及 Provider 绑定 | PostgreSQL | 人工运营资产，不能因缓存过期丢失 |
| 查询事件 | PostgreSQL | 按保留期清理，支持反馈关联和统计 |
| 反馈事件 | PostgreSQL | 需要唯一约束、状态管理和审计 |
| 管理审计 | PostgreSQL | 只追加，禁止放入短期缓存 |
| 阵容趋势和未来聚合统计 | PostgreSQL | 需要历史查询、版本隔离和可复算 |
| 会话上下文 | Redis | 有明确 TTL，需要跨实例共享 |
| 查询缓存 | Redis | 可重建、访问频繁、有明确 TTL |
| 默认阵容上下文缓存 | Redis | 可重建、按 Provider 和版本隔离 |
| AI 结论任务状态 | Redis | 需要跨实例读取、TTL 和原子状态变更 |
| AI 流式分片 | Redis | 短期数据，任务结束后自动过期 |
| 分钟限流 | Redis | 必须跨实例原子计数 |
| 匿名 AI 日额度 | Redis | 在线判定使用原子计数；需要时异步汇总到 PostgreSQL |
| 分布式锁 | Redis | 防止相同目录、版本或抓取批次重复刷新 |
| 语义索引 | 独立 SQLite | 第一阶段继续作为可重建的部署产物，不与业务主库混合 |
| Riot 原始对局 JSON | 对象存储 | 压缩保存、成本低，可供重放和重新聚合 |
| Riot 原始对象索引 | PostgreSQL | 保存对象键、校验值、采集批次和处理状态 |

### 5.1 不应进入 Redis 的数据

- 人工维护的别名和阵容档案；
- 用户反馈和管理审计；
- 未来 Riot 对局的唯一去重记录；
- 任何无法从其他来源重建的数据。

### 5.2 不应继续保存在进程内的数据

- AI 任务及其完成结果；
- 用户会话；
- 公共环境的限流和配额；
- 需要跨实例一致的目录刷新锁。

进程内 Map 只允许保存可随时丢弃的短时热点副本，并且不得成为正确性的唯一依据。

## 6. 代码边界

### 6.1 拆分当前 CacheStore

不要继续扩展一个包含全部方法的 `CacheStore`。目标接口建议拆分为：

```text
PreferenceRepository
CatalogRepository
AliasRepository
CompProfileRepository
EventRepository
FeedbackRepository
AuditRepository
StatsRepository

SessionStore
QueryCacheStore
ConclusionJobStore
RateLimitStore
DistributedLockStore
```

所有目标接口统一使用 `Promise`。迁移初期 SQLite 实现也用异步包装，以便上层代码不依赖某种驱动的同步特性。

禁止出现以下耦合：

- 业务服务直接访问 `store.database`；
- 业务服务直接拼 PostgreSQL SQL 或 Redis Key；
- Provider 原始响应直接写入推荐结果；
- Web 路由直接操作 Redis 客户端；
- 测试通过伪造 SQLite Statement 来代表所有存储实现。

### 6.2 事务边界

以下操作需要 PostgreSQL 事务：

- 反馈写入及其查询事件关联；
- 阵容档案和 Provider 绑定的联合更新；
- 目录版本发布和活动版本切换；
- Riot 采集批次状态与去重记录更新；
- 聚合版本发布。

Redis 不参与 PostgreSQL 分布式事务。跨存储操作采用以下原则：

1. PostgreSQL 先写入不可丢失的事实。
2. Redis 只保存可重建状态或任务状态。
3. 缓存失效失败通过短 TTL、版本化 Key 和后台修复解决。
4. Worker 必须幂等，允许任务至少执行一次。

## 7. AI 结论任务迁移

### 7.1 目标状态机

```text
queued → running → complete
                 ↘ fallback
                 ↘ failed
```

任务至少包含：

```text
job_id
owner_scope_hash
access_token_hash
status
payload_version
request_payload
model
attempts
created_at
started_at
updated_at
expires_at
result
error_code
```

### 7.2 执行方式

1. Web 实例生成可序列化的 `ConclusionJobPayload`。
2. Web 将任务写入 Redis 队列并返回 `jobId`、`statusUrl` 和 `streamUrl`。
3. Worker 从环境变量构建 LLM Provider，不能把函数或客户端对象放入任务载荷。
4. Worker 使用原子状态变更取得任务所有权。
5. Worker 将增量分片和最终结果写入 Redis。
6. Web 任意实例均可读取任务状态或转发流式分片。
7. 最终结论异步更新 PostgreSQL 中对应的查询事件。

第一版可采用 Redis 支持的任务队列库；无论使用何种库，业务代码只依赖 `ConclusionJobQueue` 和 `ConclusionJobStore` 接口。

### 7.3 一致性与降级

- `jobId` 是幂等键，同一任务重试不得生成重复查询事件。
- Worker 崩溃后任务可重试，但必须设置最大尝试次数。
- Redis 不可用时，公开环境的 AI 增强应关闭并返回可恢复错误，不能退回不受限制的进程内配额。
- 基础数据查询可在无会话的只读模式降级，但响应必须明确标记会话/AI 暂不可用。
- 任务结果 TTL 到期后返回统一的“任务不存在或已过期”。

## 8. Redis Key 与 TTL 设计

Redis Key 必须带命名空间和结构版本：

```text
tft:v1:session:{season_context_id}:{visitor_scope_hash}:{conversation_id_hash}
tft:v1:query:{season_context_id}:{provider_version}:{fingerprint_sha256}
tft:v1:default-context:{season_context_id}:{provider_version}:{fingerprint_sha256}
tft:v1:conclusion:{job_id}
tft:v1:conclusion-chunks:{job_id}
tft:v1:rate:request:{ip_hash}:{minute}
tft:v1:rate:feedback:{subject_hash}:{minute}
tft:v1:quota:llm:{subject_type}:{subject_hash}:{utc_date}
tft:v1:lock:catalog:{season_context_id}:{provider_version}
```

规则：

- Key 中不得出现原始 IP、Cookie、用户输入、API Key 或 Riot PUUID。
- 查询条件使用稳定序列化后再计算 SHA-256，不能直接拼接原始文本。
- Key 必须包含 `season_context_id`、`provider_version` 和有效版本/patch 指纹。
- 会话默认 TTL 沿用当前 30 分钟；查询缓存默认 5 分钟；默认阵容上下文默认 6 小时。
- AI 任务 TTL 必须覆盖模型超时、客户端重连和用户查看结果的合理窗口，并通过环境变量配置。
- 限流与配额使用原子自增和首次写入 TTL，不能使用“先读后写”。

## 9. PostgreSQL 数据模型原则

### 9.1 保留并迁移的业务表

现有以下逻辑表需要迁入 PostgreSQL：

```text
user_preferences
entity_aliases
item_catalog
units
traits
query_events
feedback_events
admin_audit_events
comp_profiles
comp_profile_bindings
comp_trend_history
```

`session_state`、`query_cache` 和 `default_context_cache` 改由 Redis 承担，不作为 PostgreSQL 首批主路径。SQLite 中仍未过期的这些数据无需迁移，可以在切换时自然失效。

### 9.2 公共字段

所有游戏数据或统计数据至少包含：

```text
season_context_id
provider
provider_version
effective_patch
region_or_platform
queue
fetched_at
created_at
updated_at
```

不是每张表都必须将全部字段直接平铺；可以通过版本表或批次表关联，但查询结果必须能够还原这些来源信息。

### 9.3 主键与唯一约束

- 不使用显示名称、URL 或 patch 作为永久主键。
- 目录唯一键至少包含 `season_context_id + provider + external_id`。
- 标准化实体需要内部稳定 ID，并用映射表关联不同 Provider 的外部 ID。
- 查询事件使用应用生成的 UUID。
- 反馈 `feedback_id` 保持唯一。
- Riot 对局以路由区域和 `match_id` 组成唯一键。
- 聚合表必须包含算法/口径版本，避免新旧统计被覆盖。

### 9.4 JSONB 使用边界

JSONB 适合：

- 仍在演进的附加元数据；
- 可回放的标准化快照；
- 不参与主要过滤和关联的 Provider 扩展字段。

经常用于过滤、排序、唯一约束和关联的字段必须建成类型明确的列。不得把全部 Riot 对局塞进单个 JSONB 表后直接在线扫描。

## 10. 数据提供者与 Riot 扩展

### 10.1 Provider 接口

上层查询和推荐服务只依赖统一接口：

```js
provider.getAvailability(context)
provider.getCatalog(context)
provider.getCompRankings(context, query)
provider.getUnitBuilds(context, query)
provider.getPatchStatus(context)
```

目标实现：

```text
StatsProvider
├── MetaTftLiveProvider
├── MetaTftPbeProvider（确认合法且稳定的数据来源后）
└── RiotAggregateProvider（Production API 获批并完成自建聚合后）
```

Provider 返回统一数据和来源信封：

```js
{
  data,
  provenance: {
    provider: "metatft",
    providerVersion: "metatft-live.v1",
    seasonContextId: "set17-live",
    effectivePatch: "current",
    region: null,
    queue: "1100",
    fetchedAt: "...",
    sourceRequestId: "..."
  }
}
```

推荐引擎不得读取 MetaTFT 或 Riot 的专有字段，只读取标准化模型。

### 10.2 数据源切换

数据源切换必须按能力执行，而不是只有一个全局开关。例如：

```text
catalog       → official_static
comp_rankings → metatft
unit_builds   → metatft
match_history → riot
```

当 Riot 聚合能力逐步成熟时，可以只切换已经通过验收的能力。禁止把新旧来源的数据无标记混合为一个统计样本。

### 10.3 影子运行

Riot API 接入后先运行影子链路：

1. 用户仍看到当前主 Provider 的结果。
2. 后台同时查询 Riot 聚合结果。
3. 保存口径、样本量、排名和关键指标差异。
4. 不把影子结果写入用户可见缓存。
5. 达到覆盖率、延迟和差异阈值后，再按能力灰度切换。

### 10.4 Riot 原始数据链路

Riot API 提供原始对局数据，不直接提供当前产品使用的成品阵容榜和装备统计。未来链路为：

```text
种子玩家
  → 对局 ID 发现
  → 对局详情拉取
  → 去重和原始响应归档
  → 标准化参与者、英雄、装备、羁绊和排名
  → 阵容识别
  → 版本化指标聚合
  → 发布聚合版本
  → RiotAggregateProvider 查询
```

建议预留以下表或等价模型：

```text
data_sources
ingestion_runs
raw_payload_objects
matches
match_participants
participant_units
participant_traits
aggregate_versions
comp_aggregates
unit_item_aggregates
provider_shadow_comparisons
```

原始载荷与标准化记录都必须记录采集批次。聚合结果必须能够追溯到数据窗口、patch、区域、队列、样本过滤规则和算法版本。

### 10.5 Riot 限流与密钥

- Riot API Key 只存在于 Worker/后端环境，不能进入网站、小程序、日志或任务载荷。
- 按 Riot 返回的限流响应头和实际获批额度动态控制请求，环境变量只提供更保守的本地安全上限。
- 按路由区域、接口类型和密钥维度计数，不能用多个 Key 绕过限制。
- 对 `429`、`5xx` 和网络超时采用带抖动的指数退避。
- 对明确的永久错误进入死信/人工检查，不无限重试。
- 采集任务必须支持断点续跑和幂等去重。

## 11. 环境要求

### 11.1 本地开发

最低要求：

- Windows、macOS 或 Linux；
- Node.js 满足当前 `package.json` 的 `>=18`；
- npm；
- Docker Engine 或 Docker Desktop；
- Docker Compose 插件；
- 足够运行 app、PostgreSQL 和 Redis 的本地内存与磁盘。

项目生产镜像当前使用 Node.js 24。落地时应固定 Node、PostgreSQL 和 Redis 的明确镜像主版本，并在升级依赖前运行完整测试，不使用漂移的 `latest` 标签。

建议新增的 Node.js 依赖：

```text
pg                 PostgreSQL 客户端和连接池
redis              Redis 客户端
任务队列库          Redis 后台任务和重试；实施时选定并锁版本
数据库迁移工具      也可使用仓库内版本化 SQL，但必须有迁移历史表
```

### 11.2 生产环境

需要：

- HTTPS 反向代理；
- Node Web 实例和 Worker 进程；
- PostgreSQL 16 或更高的受支持版本；
- Redis 7.2 或更高的受支持版本；
- 持久卷或云数据库；
- 自动备份与恢复验证；
- 日志、资源和外部 API 额度告警。

当前服务器若同时运行 Caddy、应用、PostgreSQL、Redis 和 Worker，需要先进行资源压力测试。不能仅根据空闲状态判断内存足够；资源不足时应优先拆分托管 PostgreSQL/Redis 或升级服务器。

### 11.3 网络和安全

- 公网只开放 80/443；SSH 按运维策略限制来源。
- PostgreSQL 5432 和 Redis 6379 不得直接暴露到公网。
- 跨主机连接必须使用私有网络或 TLS。
- PostgreSQL 使用独立的最小权限应用账号和迁移账号。
- Redis 启用认证/ACL；托管 Redis 使用 TLS 地址。
- 生产密钥放在服务器 Secret 或未跟踪的 `.env.production`，不得提交 Git。
- 数据库 URL 中的特殊字符必须进行 URI 编码。

### 11.4 数据库和 Redis 初始化

PostgreSQL 首次初始化建议：

```text
encoding: UTF8
timezone: UTC
database: tftagent
application role: tftagent_app
migration role: tftagent_migrator
```

PostgreSQL 首次落地阶段（本文阶段 3）不要求安装 PostgreSQL 扩展。语义向量仍使用独立 SQLite；只有未来确定迁移到 `pgvector` 时才新增扩展和对应迁移，不能把它作为核心业务库上线的前置条件。

容器初始化变量建议与应用连接变量分开：

| 变量 | 用途 |
| --- | --- |
| `POSTGRES_DB` | 首次创建的数据库名 |
| `POSTGRES_USER` | 首次初始化管理/迁移账号 |
| `POSTGRES_PASSWORD` | 初始化密码，只在 Secret 中保存 |
| `REDIS_PASSWORD` | Redis ACL 或 requirepass 使用的密码 |

注意：PostgreSQL 官方容器的初始化变量通常只在空数据目录首次启动时生效。修改 `.env.production` 不会自动修改已有数据库内的账号密码，密码轮换必须执行数据库命令并同步更新应用 Secret。

Redis 同时承载任务队列和缓存时，优先使用 `noeviction`，避免内存压力静默删除任务、配额或限流 Key；通过 TTL、容量监控和写入背压控制内存。如果缓存规模明显增长，应把可淘汰缓存与任务/配额拆到不同 Redis 实例，而不是仅拆成不同逻辑 DB，因为淘汰策略和内存上限是实例级配置。

## 12. 环境变量

### 12.1 当前已经支持并继续保留

| 变量 | 用途 |
| --- | --- |
| `DOMAIN` | Caddy 使用的公开域名 |
| `HOST` / `PORT` | Node 监听地址与端口 |
| `TFT_AGENT_PUBLIC_MODE` | 开启公开匿名访问控制 |
| `TFT_AGENT_VISITOR_SECRET` | 匿名访客签名密钥，至少 32 字符 |
| `TFT_AGENT_ADMIN_TOKEN` | 管理接口 Bearer Token |
| `TFT_AGENT_SECURE_COOKIES` | 生产环境安全 Cookie |
| `TFT_AGENT_TRUST_PROXY` | 信任反向代理的来源 IP 头 |
| `TFT_AGENT_VISITOR_DAILY_LLM_LIMIT` | 单访客 AI 日额度 |
| `TFT_AGENT_IP_DAILY_LLM_LIMIT` | 单 IP AI 日额度 |
| `TFT_AGENT_GLOBAL_DAILY_LLM_LIMIT` | 全站 AI 日额度 |
| `TFT_AGENT_REQUESTS_PER_MINUTE` | 请求分钟限流 |
| `TFT_AGENT_FEEDBACK_VISITOR_PER_MINUTE` | 单访客反馈限流 |
| `TFT_AGENT_FEEDBACK_IP_PER_MINUTE` | 单 IP 反馈限流 |
| `TFT_AGENT_QUERY_EVENT_RETENTION_DAYS` | 查询快照保留天数 |
| `TFT_AGENT_CACHE_STORE` | 当前存储选择；升级完成前生产值为 `sqlite` |
| `TFT_AGENT_CACHE_PATH` | 当前 SQLite 业务库路径 |
| `TFT_AGENT_SEMANTIC_INDEX_PATH` | 独立语义索引 SQLite 路径 |
| `TFT_AGENT_LLM_*` | 可选结构化解析模型配置 |
| `TFT_AGENT_CONCLUSION_*` | AI 结论模型配置 |
| `TFT_AGENT_EMBEDDING_*` | 语义索引模型配置 |

### 12.2 存储升级后新增的规划变量

以下变量需要代码实现后才生效：

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `TFT_AGENT_PERSISTENT_STORE` | `postgres` | 生产持久存储；本地可为 `sqlite` |
| `TFT_AGENT_EPHEMERAL_STORE` | `redis` | 会话、缓存、任务和限流存储 |
| `DATABASE_URL` | `postgresql://app:***@postgres:5432/tftagent` | PostgreSQL 连接串 |
| `TFT_AGENT_DATABASE_SSL` | `disable` / `require` | 同机私网可关闭；云数据库通常要求 TLS |
| `TFT_AGENT_DATABASE_POOL_MAX` | `10` | 每个进程最大连接数 |
| `TFT_AGENT_DATABASE_IDLE_TIMEOUT_MS` | `30000` | 空闲连接回收时间 |
| `TFT_AGENT_DATABASE_CONNECT_TIMEOUT_MS` | `5000` | 建连超时 |
| `TFT_AGENT_DATABASE_STATEMENT_TIMEOUT_MS` | `10000` | 普通在线查询超时 |
| `REDIS_URL` | `redis://:***@redis:6379/0` | Redis 连接串 |
| `TFT_AGENT_REDIS_PREFIX` | `tft:v1` | Key 命名空间和结构版本 |
| `TFT_AGENT_REDIS_CONNECT_TIMEOUT_MS` | `5000` | Redis 建连超时 |
| `TFT_AGENT_PROCESS_ROLE` | `web` / `worker` / `all` | 当前进程职责 |
| `TFT_AGENT_WORKER_CONCURRENCY` | `2` | 当前 Worker 并发任务数 |
| `TFT_AGENT_CONCLUSION_JOB_TTL_MS` | `1800000` | AI 任务和结果 TTL |
| `TFT_AGENT_CONCLUSION_JOB_ATTEMPTS` | `2` | 最大执行次数 |
| `TFT_AGENT_CONCLUSION_JOB_BACKOFF_MS` | `1000` | 首次重试退避 |
| `TFT_AGENT_STORAGE_ALLOW_MEMORY_FALLBACK` | `false` | 生产必须为 `false`，防止出现分裂状态 |

连接池总数按以下公式检查：

```text
Web 实例数 × 每实例连接池上限
+ Worker 实例数 × 每实例连接池上限
+ 运维/迁移保留连接
≤ PostgreSQL max_connections 的安全预算
```

### 12.3 Provider 与未来 Riot 的规划变量

| 变量 | 初始值 | 说明 |
| --- | --- | --- |
| `TFT_AGENT_STATS_PRIMARY_PROVIDER` | `metatft` | 当前用户可见的主统计来源 |
| `TFT_AGENT_STATS_SHADOW_PROVIDER` | `off` | 影子来源；Riot 验证阶段设为 `riot` |
| `TFT_AGENT_PROVIDER_FALLBACK` | `off` | 默认禁止静默跨来源降级 |
| `METATFT_BASE_URL` | 当前已验证地址 | MetaTFT Provider 地址；只在后端配置 |
| `RIOT_API_ENABLED` | `false` | 未获批并完成实现前保持关闭 |
| `RIOT_API_KEY` | 空 | Riot 后端密钥，不得进入 Web/小程序 |
| `TFT_AGENT_RIOT_ROUTING_REGIONS` | 空 | 实际支持的路由区域列表 |
| `TFT_AGENT_RIOT_PLATFORMS` | 空 | 实际支持的平台列表，不包含未提供的地区 |
| `TFT_AGENT_RIOT_REQUEST_TIMEOUT_MS` | `5000` | 单次请求超时 |
| `TFT_AGENT_RIOT_MAX_CONCURRENCY` | `4` | 本地安全并发上限，不替代官方限流头 |
| `TFT_AGENT_RIOT_RAW_RETENTION_DAYS` | `30` | 原始载荷保留期，需结合用途和成本确定 |
| `TFT_AGENT_RIOT_SHADOW_SAMPLE_RATE` | `0` | 影子对比采样率，范围 0～1 |

### 12.4 对象存储规划变量

只有开始保存 Riot 原始响应时才需要：

| 变量 | 说明 |
| --- | --- |
| `TFT_AGENT_RAW_OBJECT_STORE` | `off` 或 `s3` |
| `S3_ENDPOINT` | 云厂商或自建 S3 兼容地址 |
| `S3_REGION` | Bucket 地区 |
| `S3_BUCKET` | 原始数据 Bucket |
| `S3_ACCESS_KEY_ID` | 最小权限访问账号 |
| `S3_SECRET_ACCESS_KEY` | 访问密钥 |
| `S3_FORCE_PATH_STYLE` | 部分兼容服务需要开启 |

Bucket 默认私有，禁止公开读取。对象键不直接包含 PUUID 等用户标识，使用内部 ID 或哈希命名。

### 12.5 目标生产配置示例

该示例仅表示升级完成后的目标，不是当前可直接运行的配置：

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=17317
DOMAIN=tft.example.com

TFT_AGENT_PUBLIC_MODE=true
TFT_AGENT_SECURE_COOKIES=true
TFT_AGENT_TRUST_PROXY=true
TFT_AGENT_VISITOR_SECRET=REPLACE_WITH_RANDOM_SECRET
TFT_AGENT_ADMIN_TOKEN=REPLACE_WITH_DIFFERENT_RANDOM_SECRET

TFT_AGENT_PERSISTENT_STORE=postgres
TFT_AGENT_EPHEMERAL_STORE=redis
DATABASE_URL=postgresql://tftagent:REPLACE_ME@postgres:5432/tftagent
TFT_AGENT_DATABASE_SSL=disable
TFT_AGENT_DATABASE_POOL_MAX=10
REDIS_URL=redis://:REPLACE_ME@redis:6379/0
TFT_AGENT_REDIS_PREFIX=tft:v1
TFT_AGENT_STORAGE_ALLOW_MEMORY_FALLBACK=false

TFT_AGENT_PROCESS_ROLE=all
TFT_AGENT_WORKER_CONCURRENCY=2
TFT_AGENT_CONCLUSION_JOB_TTL_MS=1800000

TFT_AGENT_STATS_PRIMARY_PROVIDER=metatft
TFT_AGENT_STATS_SHADOW_PROVIDER=off
TFT_AGENT_PROVIDER_FALLBACK=off
RIOT_API_ENABLED=false

TFT_AGENT_SEMANTIC_INDEX_PATH=.cache/semantic-index.sqlite
TFT_AGENT_QUERY_EVENT_RETENTION_DAYS=30
```

实际生产应为 PostgreSQL、Redis、应用账号分别生成不同密码，不得复用访客签名密钥、管理令牌或 LLM/Riot API Key。

### 12.6 规划中的运维命令

存储实现阶段应在 `package.json` 增加等价命令；以下名称是本文建议，当前仓库尚未实现：

| 命令 | 作用 |
| --- | --- |
| `npm run db:migrate` | 把 PostgreSQL Schema 升级到目标版本 |
| `npm run db:status` | 显示当前和待执行迁移 |
| `npm run migrate:sqlite-to-postgres` | 幂等迁移现有 SQLite 持久数据 |
| `npm run verify:storage-migration` | 输出行数、唯一值、JSON 和抽样校验报告 |
| `npm run smoke:postgres` | 验证 PostgreSQL Repository 契约 |
| `npm run smoke:redis` | 验证缓存、会话、限流和任务 TTL |
| `npm run worker` | 单独启动 Worker 进程 |
| `npm run smoke:multi-instance` | 验证跨实例任务、会话和配额 |

升级完成后的本地启动流程应收敛为：

```powershell
npm ci
docker compose up -d postgres redis
npm run db:migrate
npm run smoke:postgres
npm run smoke:redis
npm start
```

在实际 Compose 和脚本落地前，不应照抄执行这组命令。

## 13. 容器与部署变化

目标 Compose 至少包含：

```text
app
worker
postgres
redis
caddy
```

单机过渡期可以让 `app` 使用 `TFT_AGENT_PROCESS_ROLE=all`，但仍通过 Redis 队列执行任务。验证稳定后再拆成独立 `worker` 服务。

PostgreSQL：

- 使用持久卷；
- 容器健康检查使用 `pg_isready`；
- 数据库密码不写入 `compose.yaml`；
- 定期执行逻辑备份并复制到主机卷之外；
- 大版本升级使用官方升级流程，不直接更换镜像标签后启动旧数据目录。

Redis：

- 只监听容器/私有网络；
- 配置认证；
- AI 队列阶段建议启用 AOF；
- 设置内存上限和明确淘汰策略；
- 任务、配额和会话 Key 必须有 TTL；
- 不把 Redis 备份当成不可丢失业务数据的唯一备份。

## 14. SQLite 到 PostgreSQL 的迁移

### 14.1 迁移原则

- 先备份，再迁移；原 SQLite 文件在验收完成前只读保留。
- 使用版本化迁移文件创建 PostgreSQL Schema。
- 数据迁移脚本可重复执行，使用 upsert 或迁移批次表保证幂等。
- 时间统一保存为 UTC；应用展示时再转换时区。
- JSON 字段迁移后进行可解析校验。
- 自增 ID 不作为跨系统业务标识；迁移后校正 sequence。

### 14.2 不迁移的数据

- 已过期查询缓存；
- 已过期会话；
- 已过期默认上下文缓存；
- 进程内 AI 任务；
- 可重新生成的临时目录缓存。

### 14.3 推荐迁移流程

1. 运行现有 SQLite 一致性备份。
2. 记录每张持久表的行数、最小/最大时间和关键唯一值数量。
3. 部署 PostgreSQL Schema，但暂不切换流量。
4. 运行 SQLite → PostgreSQL 幂等迁移脚本。
5. 比对表行数、唯一约束、随机样本和 JSON 可解析性。
6. 在维护窗口停止写入。
7. 执行最后一次增量迁移和校验。
8. 切换 `TFT_AGENT_PERSISTENT_STORE=postgres`。
9. 执行健康检查、主流程和管理端回归。
10. 保留旧 SQLite 备份，达到观察期后再归档。

第一轮不建议实现复杂双写。当前单站点可以使用短维护窗口换取更清晰的回滚边界。

### 14.4 回滚

如果切换后发生严重错误：

1. 停止新版本写入。
2. 保存 PostgreSQL 故障现场和迁移批次信息。
3. 恢复上一版本应用和只读保留的 SQLite 快照。
4. 明确处理切换后新增的数据，不能直接丢弃而不记录。
5. 修复迁移或兼容问题后重新执行验收。

## 15. 分阶段实施顺序

### 阶段 0：建立基线

- 备份当前 SQLite。
- 固化现有 Store 行为测试和主要 HTTP 契约测试。
- 记录现有表、行数、TTL 和保留策略。
- 明确语义索引不在首轮迁移范围。

### 阶段 1：存储接口异步化

- 拆分 Repository/Store 接口。
- 为现有 Memory、JSON 和 SQLite 实现适配器。
- 上层代码统一 `await` 存储操作。
- 删除业务层对 `cacheStore.database` 的依赖。

完成条件：仍使用 SQLite 时，网站功能和现有测试不回退。

### 阶段 2：引入 Redis

- 增加 Redis 连接生命周期和健康检查。
- 迁移会话、查询缓存和默认上下文缓存。
- 迁移请求/反馈限流和匿名 AI 配额。
- 迁移 AI 任务状态与执行队列。
- 增加 Worker 角色。

完成条件：重启 Web 实例后任务仍可查询；两个 Web 实例可以读取同一任务、会话和配额。

### 阶段 3：引入 PostgreSQL

- 建立版本化 Schema 和连接池。
- 实现各 PostgreSQL Repository。
- 实现 SQLite → PostgreSQL 迁移脚本和校验报告。
- 切换持久业务数据。
- 更新备份、恢复和部署文档。

完成条件：生产业务不再依赖 `.cache/tft-agent.sqlite`。

### 阶段 4：Provider 标准化

- 把当前 MetaTFT 访问封装为 `MetaTftLiveProvider`。
- 增加标准化领域模型和 provenance。
- 缓存键强制包含 Provider、赛季、版本和查询口径。
- 增加禁止静默跨来源降级的测试。

完成条件：推荐引擎和前端不读取 MetaTFT 原始字段。

### 阶段 5：Riot API 获批后扩展

- 增加 Riot 客户端、限流器和采集 Worker。
- 增加原始对象归档、去重、标准化和聚合表。
- 运行影子采集和口径对比。
- 按能力灰度启用 `RiotAggregateProvider`。

这一阶段不要求修改网站/小程序 API 契约。

## 16. 健康检查与可观测性

健康检查拆分：

- **liveness**：Node 进程仍能响应，不访问外部依赖。
- **readiness**：PostgreSQL、Redis和必要 Schema/迁移版本可用。
- **dependency status**：MetaTFT、LLM、Riot 等外部依赖单独展示，不直接等同于进程死亡。

日志至少包含：

```text
request_id
job_id
instance_id
process_role
provider
provider_version
season_context_id
effective_patch
region
cache_status
duration_ms
error_code
```

日志不得包含：

- 数据库密码、Redis 密码、Riot/LLM API Key；
- 完整匿名 Cookie 或小程序身份令牌；
- 原始 IP；
- 未经脱敏的 PUUID；
- 完整第三方鉴权响应头。

需要监控：

- PostgreSQL 连接池等待、慢查询、事务失败和磁盘空间；
- Redis 内存、淘汰、命中率、连接数和队列积压；
- Worker 成功率、重试数、任务等待时间和执行时间；
- Provider 的延迟、错误率、429 次数和数据新鲜度；
- 影子 Provider 的覆盖率和指标差异。

## 17. 备份和保留策略

PostgreSQL：

- 至少每日逻辑备份；
- 备份复制到数据库主机之外；
- 加密保存并限制访问；
- 定期执行恢复演练，而不是只检查备份文件存在；
- 根据查询事件保留天数执行批量清理，避免大事务长时间锁表。

Redis：

- 主要数据应可从 PostgreSQL、队列重试或 Provider 重建；
- 队列阶段启用适当持久化以降低重启丢任务概率；
- 不承诺永久保留已过期会话、缓存和 AI 结果。

对象存储：

- 原始 Riot 响应压缩后保存；
- 配置生命周期自动删除过期对象；
- PostgreSQL 元数据与对象删除流程保持可审计；
- 重新聚合所需的最小保留期在真正启用 Riot 采集前确定。

## 18. 验收标准

### 18.1 存储与多实例

- Web 重启不会丢失已经入队的 AI 任务。
- 任意 Web 实例都能读取另一实例创建的任务状态。
- 两个实例并发占用同一访客额度时不会突破限额。
- 同一反馈 ID 并发提交时只有一条成功写入。
- Redis 缓存过期后可以从 Provider 或 PostgreSQL 正确重建。
- PostgreSQL 不可用时 readiness 失败，生产环境不得静默写入本机内存。
- Redis 不可用时 AI 和公共配额 fail closed，基础查询按定义降级。

### 18.2 数据迁移

- 所有必须迁移的表都有行数和抽样校验报告。
- 唯一约束、外键和 JSON 数据全部通过校验。
- 旧 SQLite 备份可恢复。
- 迁移脚本重复执行不会产生重复数据。

### 18.3 Provider 与 Riot 扩展

- 每个用户可见统计结果均可追踪 Provider、赛季、版本和抓取时间。
- MetaTFT 与 Riot 的外部字段不会泄漏到推荐引擎接口。
- 主 Provider 故障时不会静默混用影子 Provider 数据。
- 影子运行不改变用户结果和主缓存。
- Riot 任务在重试、Worker 重启和重复投递时保持幂等。
- Riot API Key 不出现在浏览器、小程序包、日志、数据库任务载荷和错误响应中。

## 19. 与小程序适配的关系

本次存储升级不依赖小程序上线，但会为小程序解决以下基础问题：

- 会话和 AI 任务可跨请求、跨实例保持；
- 配额和限流不依赖单个 Node 进程；
- 显式访客令牌接入后，可以复用同一 Redis 会话和任务归属模型；
- 网站和小程序共用标准化 API，不需要分别维护数据源逻辑。

存储升级完成后，小程序仍需单独实现服务端签名的显式访客令牌，不能假设 `wx.request` 等同于浏览器 Cookie。该身份改造属于接入层，不应改变本文定义的数据库和 Provider 边界。

## 20. 最终决策清单

- [ ] PostgreSQL 是生产持久业务数据的事实来源。
- [ ] Redis 是生产跨实例临时状态和任务的事实来源。
- [ ] 生产环境禁止自动回退到进程内存存储。
- [ ] 语义索引首轮继续使用独立 SQLite。
- [ ] 当前 MetaTFT 通过统一 Provider 接口接入。
- [ ] 所有游戏数据带来源、赛季、版本和时间信息。
- [ ] Riot API 获批前不启用 Riot Provider 和采集任务。
- [ ] Riot 接入先影子运行，再按能力灰度切换。
- [ ] 原始 Riot 数据进入私有对象存储，PostgreSQL 保存索引和处理状态。
- [ ] 迁移必须包含备份、幂等脚本、校验报告和回滚流程。

## 21. 相关仓库文档

- [2 核 2GB / 100 人在线 Web 容量测试计划](web-capacity-test-plan-2c2g-100-users.md)
- [Riot Production API 申请与数据架构评估](riot-production-api-readiness.md)
- [多赛季、PBE 与返场模式架构待办](multi-season-pbe-architecture-todo.md)
- [记忆系统与大模型框架设计](memory-llm-architecture.md)
- [腾讯云上线指南](deploy-tencent-cloud-v1.md)

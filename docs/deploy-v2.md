# V2 Public Beta 部署、恢复与回滚手册

本手册是 V2 production 的唯一部署 runbook。它适用于仓库根目录的
`compose.yaml`，不适用于 V1 单机 SQLite 部署。执行任何生产操作前，先阅读
[R1 Release Readiness](r1-release-readiness.md)，并确认 Final Release Image Gate
使用的是准备发布的最终 Git SHA 和镜像。

本文只使用占位符。`.env.production`、数据库密码、Redis 密码、访客密钥、管理令牌、
模型 endpoint/model/API key 和真实域名不得提交到仓库、工单或验收报告。

## 1. 当前生产拓扑

| Compose service | 职责 | 网络与持久化 |
| --- | --- | --- |
| `caddy` | 唯一公网入口、TLS、安全响应头、反向代理 | 仅加入 `edge`；发布 80/443；证书在 `caddy_data` |
| `app` | Node 24 Web/API，`TFT_AGENT_PROCESS_ROLE=web` | 加入 `edge`、`backend`、`bilibili_mcp`；只 `expose` 17317，不发布宿主机端口 |
| `worker` | 异步 AI conclusion job worker | 仅加入 `backend` |
| `migrate` | 使用迁移账号执行 PostgreSQL forward migration | 一次性任务，仅加入 `backend` |
| `postgres` | V2 production 持久业务事实源 | 仅加入 `backend`；数据在 `postgres_data`，不发布 5432 |
| `redis` | 会话、查询缓存、限流/额度、锁和短期 job/queue | 仅加入 `backend`；AOF 在 `redis_data`，不发布 6379 |
| `embedding` | 内部 Ollama 0.32.5 向量服务，运行 `bge-m3` | 仅加入 `backend`；无宿主端口；模型在 `ollama_models` |
| `embedding-model` | 一次性确认/拉取固定 embedding 模型 | 仅加入 `backend`；成功后退出 0，`app` 等待它完成 |
| `bilibili-mcp` | 只读 Bilibili 搜索/详情 sidecar | 仅加入 `bilibili_mcp`；无 `ports`/`expose`，无生产 secret |

`app` 通过 `tft_semantic` volume 持久化 `/app/.cache/semantic-index.sqlite`。它是
可重建的独立语义检索索引，不是 PostgreSQL 业务库，也不能替代 PostgreSQL 备份。

## 2. 发布前准备

1. 在受控服务器安装 Git、Docker Engine 和 Docker Compose plugin。
2. 检出准备发布的明确 Git SHA，不使用未记录的工作区或浮动分支状态。
3. 从模板创建本机专用配置：

   ```powershell
   Copy-Item .env.production.example .env.production
   ```

4. 替换模板中的所有 `CHANGE_ME`、`replace-me`、示例 endpoint/model 和域名；为每个
   PostgreSQL 角色、Redis、访客签名和管理入口生成不同 secret。不要打印或提交配置。
5. 确认 V2 Beta 需要的 real model provider 已配置，且 `TFT_AGENT_REACT_CHAT_MODE=on`、
   `TFT_AGENT_REACT_TASK_FRAME_CONTROL_V1=on`、Conversation Bridge 与 trust proxy 保持开启；
   `TFT_AGENT_REACT_TASK_FRAME_SHADOW_V1=on` 用于发布观测。`app` 必须仍是 Caddy 后唯一可信的内网 upstream。
6. 记录发布身份：

   ```powershell
   git rev-parse HEAD
   docker compose config
   ```

`docker compose config` 必须成功，并人工确认 PostgreSQL、Redis、app 和 MCP 没有新增公网端口，
真实 secret 没有进入日志或版本控制。不要把该命令的完整渲染结果粘贴到公开报告。

## 3. 语义索引发布物

Docker build context 会排除 `.cache` 和 `*.sqlite*`，因此镜像本身不包含生产语义索引；
Compose 只负责提供持久 volume，不会自动构建完整索引。若 Public Beta 要启用知识检索，
Final Release Image Gate 必须同时准备并审计一个与当前 patch/locale 匹配的
`semantic-index.sqlite` 发布物。

Compose 默认使用内部 `embedding` 服务和 `bge-m3`。它不声明 `ports`/`expose`，目录正文只在
Docker `backend` 网络中处理，不发送给远程 embedding provider。先启动服务并确认模型：

```powershell
docker compose up -d embedding
docker compose run --rm embedding-model
docker compose exec -T embedding ollama show bge-m3
```

使用与本地应用相同的当前目录快照，在 `tft_semantic` volume 中原地重建并审计：

```powershell
docker compose stop app
docker compose run --rm --no-deps `
  --volume "${PWD}/.cache/small-window-cache.json:/seed/small-window-cache.json:ro" `
  --volume "${PWD}/.cache/comps-data-current-inspect.json:/seed/comps-data-current-inspect.json:ro" `
  app npm run semantic:index -- `
    --catalog-cache /seed/small-window-cache.json `
    --comps-input /seed/comps-data-current-inspect.json `
    --catalog-key "season:set17-live|current" `
    --season set17-live `
    --patch 17.8 `
    --db /app/.cache/semantic-index.sqlite
docker compose run --rm --no-deps app npm run semantic:audit
docker compose up -d app
```

`--catalog-key` 选择本地缓存中的赛季快照，`--patch` 使用 `/api/runtime` 返回的实际正式服补丁；两者必须分别核对，禁止把 PBE 的 `current` 快照写入正式服索引。构建报告和 audit 必须显示同一个 `bge-m3`、1024 维，且 `missing_embedding=0`。目录缓存更新后
重复执行同一命令；构建器按内容哈希更新、删除已不属于当前 patch/locale 的文档，从而让向量索引
与本地数据保持一致。

如果索引是在其他受控环境构建的，在 Caddy 尚未启动、app 尚未公开时，把已审计发布物写入 volume：

```powershell
docker compose up -d app
docker compose cp .cache/semantic-index.sqlite app:/app/.cache/semantic-index.sqlite
docker compose exec --user root app chown node:node /app/.cache/semantic-index.sqlite
docker compose restart app
docker compose exec -T app npm run semantic:audit
```

索引可以从受控目录与知识源重建。更新或回滚时保留与 release SHA 对应的索引副本，
但灾难恢复的首要资产仍是 PostgreSQL dump。

## 4. 首次部署

先构建最终镜像，再单独启动依赖并执行迁移：

```powershell
docker compose build app worker migrate bilibili-mcp
docker compose up -d postgres redis embedding
docker compose run --rm embedding-model
docker compose ps postgres redis embedding
docker compose run --rm migrate
docker compose run --rm migrate npm run db:status
```

迁移成功后启动内部服务。此时尚不启动 Caddy，因此没有公网流量：

```powershell
docker compose up -d bilibili-mcp app worker
docker compose ps
docker compose exec -T app npm run smoke:postgres
docker compose exec -T app npm run smoke:redis
docker compose exec -T app npm run smoke:bilibili:mcp:compose
```

按上一节安装并审计语义索引，然后启动公网入口：

```powershell
docker compose up -d caddy
docker compose ps
```

## 5. Readiness 与发布冒烟

Final Release Image Gate 至少检查：

```powershell
docker compose exec -T app node -e "fetch('http://127.0.0.1:17317/api/health').then(async r=>{console.log(r.status,await r.text());if(!r.ok)process.exit(1)})"
docker compose exec -T app node -e "fetch('http://127.0.0.1:17317/api/ready').then(async r=>{console.log(r.status,await r.text());if(!r.ok)process.exit(1)})"
docker compose exec -T app node -e "fetch('http://127.0.0.1:17317/api/runtime').then(async r=>{console.log(r.status,await r.text());if(!r.ok)process.exit(1)})"
docker compose run --rm migrate npm run db:status
```

随后从公网入口检查 `https://<production-domain>/api/health`、`/api/ready` 和浏览器矩阵。
`/api/runtime` 必须显示 real model、预期模型、`fixture=false`、ReAct on、Bridge on，且
storage 为 PostgreSQL + Redis。还要确认 HTTPS 证书、安全响应头、真实客户端 IP 限流、
匿名额度、AI 声明、中英文 UI、MCP 正常/停机降级和恢复。

只有 [R1 Release Readiness](r1-release-readiness.md) 中的 Final Release Image Gate 被记录为
PASS 后，才能把该 SHA/镜像作为 Public Beta release。

## 6. PostgreSQL 备份

每次更新和 migration 前必须创建 custom-format dump。下面的 `$ReleaseId` 只用于本机文件名，
不得包含 secret：

```powershell
$ReleaseId = "pre-update-YYYYMMDD-HHMM"
New-Item -ItemType Directory -Force backups
docker compose exec -T postgres sh -c 'pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --file=/tmp/tftagent.dump'
docker compose exec -T postgres sh -c 'pg_restore --list /tmp/tftagent.dump >/dev/null'
docker compose cp postgres:/tmp/tftagent.dump "./backups/tftagent-$ReleaseId.dump"
docker compose exec -T postgres rm -f /tmp/tftagent.dump
```

把 dump 加密复制到独立存储，记录 Git SHA、镜像 digest、迁移状态、创建时间和校验和。
定期在隔离环境执行恢复演练；“生成了文件”不等于备份可恢复。

## 7. PostgreSQL 恢复

以下操作会改写当前数据库，只能在维护窗口、确认目标 dump 和再次创建安全备份后执行。
先在隔离环境演练。生产恢复时停止入口和所有写入者：

```powershell
docker compose stop caddy app worker
docker compose cp "./backups/<verified-backup>.dump" postgres:/tmp/tftagent-restore.dump
docker compose exec -T postgres sh -c 'pg_restore --list /tmp/tftagent-restore.dump >/dev/null'
docker compose exec -T postgres sh -c 'pg_restore --clean --if-exists --no-owner --exit-on-error --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" /tmp/tftagent-restore.dump'
docker compose exec -T postgres rm -f /tmp/tftagent-restore.dump
```

灾难恢复到当前应用版本时，再用当前 release image 执行 forward migration、状态检查并启动：

```powershell
docker compose run --rm migrate
docker compose run --rm migrate npm run db:status
docker compose up -d app worker bilibili-mcp caddy
```

完成 `/api/ready`、PostgreSQL/Redis smoke、关键业务查询和浏览器矩阵后才能解除维护。
如果恢复是为了回滚到旧应用版本，遵循下一节的兼容性判断，不要自动运行新版本 migration。

## 8. 更新与回滚

### 更新

1. 记录旧 Git SHA、旧镜像 digest、当前 `db:status` 和语义索引发布物版本。
2. 按第 6 节备份 PostgreSQL并验证 dump。
3. 获取并检出目标 SHA，审阅新 migration。运行两个正式 CI lane 和 release contract。
4. 构建目标镜像；先迁移，再启动 app/worker/MCP；最后启动或恢复 Caddy 流量。
5. 执行第 5 节 smoke 和 Browser Release Matrix，观察错误率、资源、Redis 和模型额度。

示例命令：

```powershell
git rev-parse HEAD
git pull --ff-only
docker compose config
docker compose build app worker migrate bilibili-mcp
docker compose run --rm migrate
docker compose up -d app worker bilibili-mcp caddy
docker compose ps
```

### 回滚

当前 migration runner 只支持按文件名顺序执行 forward migration、记录 checksum 和拒绝被修改的
已应用 migration。仓库没有 down migration 命令，也没有自动 schema rollback。不得编造任何
数据库降级命令或假设旧应用能读取新 schema。

- 如果新 migration 与旧应用确认向后兼容：检出旧 SHA/使用已记录的旧 image digest，重建或恢复
  app/worker/migrate 镜像，只回滚应用和对应语义索引；不要删除 `schema_migrations` 记录。
- 如果 schema 不向后兼容或兼容性未知：立即停止 Caddy、app 和 worker；保留失败现场 dump；
  恢复升级前已验证的 PostgreSQL dump，再启动与该 dump 匹配的旧 release image。该做法会丢失
  备份时间点之后的写入，必须事先确认业务影响。
- 如果只有 MCP 故障：保持主应用运行，回滚固定的 Bilibili MCP 上游 commit/image，并重新执行 MCP gate。

回滚完成后必须重新运行 readiness、storage smoke、关键用户流程和 Browser Matrix，并在 readiness
文档记录结论；不能因为容器处于 running 就判定回滚成功。

## 9. Redis 持久化边界

Compose 为 Redis 启用 AOF、`redis_data` volume 和 `noeviction`。Redis 保存可过期/可重建的会话、
查询与默认上下文缓存、限流和 LLM 配额、分布式锁，以及有 TTL 的 conclusion job、队列和 chunk。
它不是用户偏好、反馈、审计、目录或趋势等持久业务数据的唯一事实源；这些属于 PostgreSQL。

Redis 丢失后，缓存和会话可重新生成，限流/额度窗口会重置，排队或执行中的短期 job 可能需要用户
重试。恢复 Redis 不能代替 PostgreSQL 恢复。Redis 不可用时 production 不允许 memory fallback；
readiness/AI/公共配额应按既定策略失败或降级，而不是静默绕过限制。

## 10. Bilibili MCP 边界

`bilibili-mcp` 只在专用 Compose 网络中监听，不能增加 `ports`、`expose` 或公网 endpoint。
`app` 不以 MCP 健康作为启动依赖，worker/migrate 也不注入 MCP endpoint；因此 sidecar 故障应只让
Bilibili 工具返回明确的可见失败原因，不阻塞主页、PostgreSQL readiness 或其他工具。

升级 sidecar 只能修改 Dockerfile 中固定的完整上游 commit SHA，重建后执行真实 MCP smoke、端口/网络
检查、停机降级和恢复调用。不能跟随浮动 `main`。

## 11. 故障排查

先收集不含 secret 的状态和最近日志：

```powershell
docker compose ps
docker compose logs --tail 200 app
docker compose logs --tail 200 worker
docker compose logs --tail 200 postgres
docker compose logs --tail 200 redis
docker compose logs --tail 200 embedding
docker compose logs --tail 200 bilibili-mcp
docker compose logs --tail 200 caddy
```

| 症状 | 检查与处理 |
| --- | --- |
| `app` 不 ready | 查 `/api/ready`、PostgreSQL/Redis health、`db:status`；production 不得开启 memory fallback |
| `worker` 不消费 job | 查 worker role、Redis queue/连接、provider 配置与额度；确认 app/worker 使用同一 Redis prefix |
| PostgreSQL 失败 | 查磁盘、连接、健康检查、migration checksum；写操作恢复前不要反复重启掩盖现场 |
| Redis 失败 | 查 AOF、内存、`noeviction`、认证和连接；接受短期会话/job 可丢失边界，不从 Redis 恢复业务主数据 |
| Embedding 失败 | 查 `embedding` health、`ollama show bge-m3`、`ollama_models`、backend 网络与内存；不得临时改用公网 endpoint |
| Bilibili 工具失败 | 查 sidecar health、固定 commit、私网 endpoint；主应用仍应 ready，禁止临时开放公网端口 |
| Caddy/TLS 失败 | 查 DNS、80/443、防火墙、证书日志和 Caddyfile；不要把 app 17317 暴露为临时公网绕过 |
| 语义检索为空 | 查 `tft_semantic` volume、文件属主、patch/locale 和 `semantic:audit`；从可信发布物恢复或重建 |

## 12. V1 边界

[V1 腾讯云指南](deploy-tencent-cloud-v1.md) 只保留为历史单机部署参考。V1 的
`npm run backup:sqlite`、SQLite 文件复制和对应 restore 步骤不适用于 V2 production 主数据库。
V2 的业务恢复必须使用 PostgreSQL `pg_dump`/`pg_restore`；独立语义 SQLite 只按可重建索引管理。

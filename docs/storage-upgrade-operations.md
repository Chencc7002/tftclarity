# 存储架构升级 0–4 阶段运维手册

实现范围为阶段 0–4；Riot 采集、原始对象存储和 Riot 聚合 Provider 仅预留 Schema，不会在 `RIOT_API_ENABLED=false` 时运行。

## 本地与生产启动

本地可继续使用 `TFT_AGENT_PERSISTENT_STORE=sqlite`、`TFT_AGENT_EPHEMERAL_STORE=sqlite`。生产必须设置 `postgres`、`redis` 和 `TFT_AGENT_STORAGE_ALLOW_MEMORY_FALLBACK=false`。

Windows 首次准备环境：

1. 以管理员身份运行 `wsl --install` 和 `wsl --update`，重启后完成 Ubuntu 用户初始化。
2. 安装 Docker Desktop，启用 “Use the WSL 2 based engine”，并在 WSL integration 中启用 Ubuntu。
3. 启动 Docker Desktop，运行 `docker version` 与 `docker compose version` 确认客户端和 Engine 均可用。
4. 复制 `.env.production.example` 为 `.env.production`，为迁移账号、应用账号和 Redis 分别生成不同密码，并同步填写两个数据库 URL。URL 中的特殊字符需要 URI 编码。

```powershell
npm ci
docker compose up -d postgres redis
docker compose run --rm migrate
docker compose run --rm app npm run smoke:postgres
docker compose run --rm app npm run smoke:redis
docker compose run --rm app npm run smoke:multi-instance
docker compose up -d app worker caddy
```

PostgreSQL 和 Redis 只加入 Compose 私有网络，不映射宿主机端口。因此迁移和冒烟命令应在 Compose 容器中运行。`POSTGRES_*` 和初始化应用账号脚本只会在空的 `postgres_data` 卷首次启动时执行；已有数据卷的密码轮换需要执行数据库命令，修改环境文件本身不会更新数据库账号。

`/api/health` 只检查进程存活；`/api/ready` 检查 PostgreSQL Schema 和 Redis；`/api/dependencies` 单独报告 Provider 状态。

## 迁移

1. 停止旧版本写入并运行 `npm run backup:sqlite`。
2. 运行 `npm run storage:baseline -- <sqlite-path> <report-path>`。
3. 运行 `npm run db:migrate`。
4. 运行 `npm run migrate:sqlite-to-postgres -- <sqlite-path>`；脚本按源指纹记录批次，重复执行不会重复插入。
5. 运行 `npm run verify:storage-migration -- <sqlite-path>`。
6. 切换生产变量并检查 readiness、查询、反馈和管理端。

会话、查询缓存、默认上下文缓存与进程内 AI 任务不迁移。语义索引继续使用独立 SQLite。

## 回滚

停止新版本写入，保留 PostgreSQL 和 `data_migration_batches` 故障现场，恢复上一版本与只读 SQLite 快照。切换后新增数据必须先导出并登记，不能直接丢弃。修复后重新执行幂等迁移与校验。

## 备份

PostgreSQL 至少每日逻辑备份并复制到数据库主机外；定期执行恢复演练。Redis 开启 AOF、使用 `noeviction`，但不作为不可丢失业务数据的唯一备份。端口 5432/6379 不映射到公网。

# 存储架构升级 0–4 阶段现场验收

- 验收时间：2026-08-06（Asia/Shanghai）
- Docker Desktop：4.85.0
- Docker Engine：29.6.2，Linux/amd64，WSL 2 内核 `6.18.33.2-microsoft-standard-WSL2`
- PostgreSQL：16.14 (`postgres:16-alpine`)
- Redis：7.4.10 (`redis:7.4-alpine`)
- Node.js 基础镜像：`node:24-bookworm-slim`

## 迁移

已执行并登记以下版本化迁移：

- `001_business_schema`
- `002_provider_and_riot_reservations`

PostgreSQL 首次初始化创建了独立迁移账号和最小权限应用账号。应用账号没有 Schema 创建权限，仅具有迁移后业务表的运行权限。

## 冒烟结果

- PostgreSQL Repository：通过；Schema 版本就绪，应用账号偏好读写/清理成功。
- Redis：通过；连接、会话、原子限流及 TTL 契约成功。
- 多实例：通过；会话共享、并发配额原子性、AI 任务跨实例创建/领取/完成/读取成功。
- Web/Worker：通过；Web readiness 健康检查成功，独立 Worker 以 `worker` 角色启动。

## 运行拓扑

现场运行容器：

- `tftagent-app-1`：healthy
- `tftagent-worker-1`：running
- `tftagent-postgres-1`：healthy
- `tftagent-redis-1`：healthy

PostgreSQL 5432 与 Redis 6379 仅在 Compose 私有网络中暴露，没有发布到宿主机或公网。Redis 已启用 AOF 与 `noeviction`。

## 代码回归

完整 Node 测试：633 项；619 通过，14 项按运行时条件跳过，0 失败。新增架构契约测试 8 项全部通过。

本机 `.env.production` 被 `.gitignore` 排除；本报告不包含数据库、Redis、访客、管理或 Provider 凭据。

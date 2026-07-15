# TFTAgent V1 腾讯云上线指南

V1 采用免登录公共网站：每位访客通过安全 Cookie 获得独立匿名会话；设置与对话上下文相互隔离。LLM 按设备、IP 和全站三层限额，额度耗尽时仅关闭 AI 增强，基础查询继续工作。

## 1. 推荐购买组合

- 腾讯云轻量应用服务器：中国香港地域，Linux Ubuntu 24.04，建议从 2 核 2 GB、40 GB SSD 起步。腾讯云 2026-06 官方刊例中的“中国香港入门型”2 核 2 GB / 40 GB SSD / 20 Mbps / 512 GB 月流量为 38 元/月；购买页活动价和续费价可能不同，以结算页为准。
- 腾讯云域名：优先 `.com`；购买后完成域名实名认证。
- 第一版不购买云 PostgreSQL、Redis 或负载均衡。匿名额度和临时缓存保存在服务器 SQLite 数据卷中。
- 中国香港服务器不要求 ICP 备案；未来迁入中国内地服务器时再办理备案。

服务器和数据库以后可以独立扩展。出现下面任一情况时，再迁移到 CVM + PostgreSQL + Redis：需要登录/支付、需要多台应用服务器、匿名日活明显增长，或需要跨实例共享额度。

## 2. 创建服务器

在腾讯云轻量应用服务器控制台创建实例：

1. 地域选择“中国香港”。
2. 镜像选择 Ubuntu 24.04 LTS。
3. 套餐建议至少 2 核 2 GB。
4. 防火墙开放 TCP 22、80、443；不要开放 17317。
5. 设置 SSH 密钥登录，并妥善保存私钥。

## 3. 注册和解析域名

1. 在腾讯云域名注册中搜索并购买域名。
2. 完成域名实名认证。
3. 在 DNS 解析中添加一条 A 记录：主机记录 `tft`，记录值填写轻量服务器公网 IP。
4. 最终访问地址类似 `https://tft.example.com`。

建议先使用子域名 `tft.example.com`，根域名以后可用于官网或文档站。

## 4. 安装运行环境

SSH 登录服务器后安装 Docker Engine 和 Compose 插件。安装完成后确认：

```bash
docker --version
docker compose version
```

把项目上传或从 Git 仓库克隆到服务器，然后进入项目目录。

## 5. 配置生产环境

复制模板：

```bash
cp .env.production.example .env.production
```

编辑 `.env.production`：

- 把 `DOMAIN` 改为实际域名。
- 使用 `openssl rand -base64 48` 生成 `TFT_AGENT_VISITOR_SECRET`。
- 第一轮灰度建议保持两个 LLM 模式为 `never` / `off`，先验证基础查询和外部数据源。
- 准备开放 AI 时，再填写服务商地址、模型和密钥，并从较低的全站日额度开始。

不得提交 `.env.production`，也不要通过聊天或截图公开其中的密钥。

## 6. 启动

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f --tail=100
```

DNS 生效且 80/443 已放行后，Caddy 会自动申请并续期 HTTPS 证书。

验证：

```bash
curl https://你的域名/api/health
```

预期返回 `{"ok":true}`。

## 7. 更新版本

```bash
git pull
docker compose up -d --build
docker image prune -f
```

更新前先备份数据卷。第一版最重要的数据是匿名额度和缓存，即使丢失也不会影响账号或订单，因为 V1 没有这些数据。

## 8. 日常检查

```bash
docker compose ps
docker compose logs --tail=200 app
docker compose logs --tail=200 caddy
docker stats
```

同时在腾讯云控制台设置 CPU、内存、磁盘和月流量告警。LLM 服务商侧还应设置余额告警或硬预算，不能只依赖应用额度。

## 9. 上线顺序

1. 先关闭 LLM，邀请少量用户验证查询链路。
2. 开放每设备每天 1 次 AI，观察真实调用量和单次成本。
3. 再提升到 3～5 次，并设置全站每日硬上限。
4. 确认用户确实需要历史同步或付费额度后，再开发登录和 PostgreSQL。

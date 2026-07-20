# Riot 法律页面生产部署与验收

> 当前状态：Privacy Policy、Terms of Service 与首页法律入口均已上线；本手册用于后续法律文案或生产配置更新。
> 公网域名：<https://tftclarity.cn/>  
> 更新日期：2026-07-20

## 1. 发布前必须确认

- [ ] 当前工作分支已与最新 `origin/main` 对齐。
- [ ] 本次法律页面改动已应用到最新主线版本，而不是直接从落后版本覆盖生产站。
- [ ] `tftclarity@outlook.com` 已配置并完成实际收信测试。
- [ ] Privacy Policy 中的运营地区、数据保留期、Cookie 和第三方 LLM 描述与生产配置一致。
- [ ] `.env.production` 中 `TFT_AGENT_QUERY_EVENT_RETENTION_DAYS=30`。
- [ ] Terms of Service 中的非商业定位、适用法律和联系方式已由运营者最终确认。
- [ ] `.env.production`、API Key、Cookie Secret 和 Admin Token 未进入提交或截图。

## 2. 最新主线需要包含的文件与接入点

新增静态文件：

```text
src/app/small-window-ui/privacy.html
src/app/small-window-ui/terms.html
src/app/small-window-ui/legal.css
```

服务器接入：

- `/privacy` 与 `/privacy/` 映射到 `privacy.html`。
- `/terms` 与 `/terms/` 映射到 `terms.html`。
- 页面以 `text/html; charset=utf-8` 返回。

首页接入：

- 固定法律页脚增加 `Privacy`、`Terms` 链接。
- 设置面板的完整 Riot 声明区域增加 `Privacy Policy`、`Terms of Service` 链接。
- 保留当前已经上线的 Riot 英文声明和开发者政策入口。

测试接入：

- `test/legal-routes.test.js`
- `test/legal-http.test.js`
- `test/small-window-ui.test.js` 中的可见入口与页面内容断言

## 3. 腾讯云服务器发布

登录服务器并进入项目目录后，先备份 SQLite：

```bash
docker compose exec app npm run backup:sqlite
docker compose exec app ls -lh /app/.cache/backups
```

确认工作区干净并拉取已经合入法律页的主线：

```bash
git status --short
git pull --ff-only origin main
git rev-parse HEAD
grep '^TFT_AGENT_QUERY_EVENT_RETENTION_DAYS=' .env.production
```

`grep` 应输出 `TFT_AGENT_QUERY_EVENT_RETENTION_DAYS=30`。如果仍为旧值，应先备份 `.env.production` 并改为 `30`，再重建容器。

重建应用容器：

```bash
docker compose up -d --build app
docker compose ps
docker compose logs --tail=100 app
docker compose exec -T app printenv TFT_AGENT_QUERY_EVENT_RETENTION_DAYS
```

最后一条命令应输出 `30`。

Caddy 已将全部请求反向代理到 `app:17317`，不需要为 `/privacy` 或 `/terms` 增加单独规则。

## 4. 服务器本机验收

生产 Compose 使用 `expose: 17317`，应用端口只在 Docker 网络内可见，并未映射到宿主机。因此不要在宿主机直接请求 `127.0.0.1:17317`；应从 `app` 容器内部验收：

```bash
docker compose exec -T app node -e "fetch('http://127.0.0.1:17317/api/health').then(async r => { const body = await r.text(); console.log(body); if (!r.ok) process.exit(1); }).catch(error => { console.error(error); process.exit(1); })"
docker compose exec -T app node -e "fetch('http://127.0.0.1:17317/privacy').then(async r => { const body = await r.text(); if (!r.ok || !body.includes('<title>Privacy Policy')) process.exit(1); console.log('Privacy Policy · tftclarity'); }).catch(error => { console.error(error); process.exit(1); })"
docker compose exec -T app node -e "fetch('http://127.0.0.1:17317/terms').then(async r => { const body = await r.text(); if (!r.ok || !body.includes('<title>Terms of Service')) process.exit(1); console.log('Terms of Service · tftclarity'); }).catch(error => { console.error(error); process.exit(1); })"
```

预期：

```text
{"ok":true}
Privacy Policy · tftclarity
Terms of Service · tftclarity
```

## 5. 公网验收

```bash
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" https://tftclarity.cn/
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" https://tftclarity.cn/privacy
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" https://tftclarity.cn/terms
```

三个地址都应返回：

```text
200 text/html; charset=utf-8
```

继续检查：

- [ ] 首页底部可直接看到独立项目声明、Privacy、Terms。
- [ ] 设置面板可看到完整 Riot 英文声明、Privacy、Terms、Developer policy。
- [ ] Privacy 与 Terms 页面导航可以互相跳转并返回产品首页。
- [ ] 桌面宽度和手机宽度均无横向滚动。
- [ ] 无痕窗口中同样可访问。
- [ ] 页面没有管理入口、API Key、内部错误或调试数据。
- [ ] `tftclarity@outlook.com` 的 `mailto:` 链接正确。

## 6. 失败回滚

如果新容器无法通过健康检查，不要删除 SQLite 数据卷。查看：

```bash
docker compose ps
docker compose logs --tail=200 app
docker compose logs --tail=100 caddy
```

使用部署前记录的提交哈希切回上一个已知正常提交，再重建 `app`：

```bash
git switch --detach 上一个正常提交哈希
docker compose up -d --build app
```

回滚完成后重新检查首页和 `/api/health`。恢复主线开发前，再切回 `main`。

## 7. 审核材料拍摄

公网验收全部通过后，再按 [Riot 审核截图与录屏清单](riot-review-capture-checklist.md) 拍摄。不要使用本地地址截图，避免 Riot 审核人员无法复现。

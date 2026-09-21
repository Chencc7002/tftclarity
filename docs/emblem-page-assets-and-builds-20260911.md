# 转职页面图片与携带者配装修复

日期：2026-09-11。当前为本地完成并验证，尚未部署生产。

## 原因

转职排行榜和配方使用官方装备目录的 `game.gtimg.cn` 图片。官方图片请求返回 200，但生产 Caddy 的 `img-src` 白名单遗漏该域名。2026-09-11 读取公网响应头确认仍有此遗漏（站点不支持 HEAD，返回 405，但包含实际 Caddy 安全策略）。本地应用允许 HTTPS 图片，之前的本地验证未覆盖生产白名单。

公共缩略图组件同时使用内联 `onerror`，与生产 `script-src 'self'` 冲突，因此失败后也无法隐藏破图或使用备用地址。

## 修改

- Caddy 只增加官方图片域名，保留脚本限制。
- 缩略图改为外部脚本注册的捕获事件，支持动态插入图片；备用地址只尝试一次，全部失败则显示现有文字占位。
- 常见携带者展示已有统计返回的、含当前转职的最常见三件套。保留原始 `build.items` 和统计数据，额外提供中文名称、英文名称、图标和目标装备标记供展示。
- 携带者样本与搭配样本分开标注；没有完整三件套时说明缺少数据。装备组合换行适配手机。
- 不修改排序、工具参数、执行计划、Agent 路由或统计聚合，不增加装备统计查询。

## 验证

- 聚焦测试：90 通过，0 失败。
- main：1,554 通过、7 跳过、1 失败；唯一失败为原工作区 README 缺少 `发布就绪状态` 链接，不属于本次文件修改，未改写 README。
- integration：235 通过、1 跳过、0 失败。
- Agent 评估：50/50。
- 真实查询：转职排行和携带者均 HTTP 200，21 个转职、16 个可合成。裁决使携带者为婕拉、德莱文、阿狸，均有含裁决使的三件套。
- 浏览器使用本次真实返回数据及原始渲染组件，并施加完整 Caddy CSP：展开第一张裁决使卡片，15 张图片 naturalWidth 均大于 0，控制台无错误。
- 390 × 844 手机验证：document scrollWidth 为 390，三件套自动换行，无破图。

日志：`.cache/emblem-page-focused.log`、`.cache/emblem-page-main.log`、`.cache/emblem-page-integration.log`、`.cache/emblem-page-eval.log`；真实响应为 `.cache/emblem-integration-20260907/live-smoke.json`。临时浏览器验证服务为 `.cache/verify-emblem-page.mjs`，使用捕获样本，仅用于第一张裁决使卡片的携带者展示验证，不代表其他转职的携带者数据。

## 发布边界

应用文件：`src/app/small-window-server.js`、`src/app/small-window-ui/app.js`、`src/app/small-window-ui/emblem-rankings.js`、`src/app/small-window-ui/emblem-rankings.css`、`src/app/small-window-ui/i18n.js`。

部署配置：`deploy/Caddyfile`，需要同步并重新加载 Caddy；只更新应用镜像不能修复生产白名单。无依赖或数据库变更。主工作区已有大量其他修改，发布时应从生产基线只移入本次增量，不能整体覆盖。回退只撤销这些增量。

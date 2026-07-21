# tftclarity 微信小程序

这是与 `https://tftclarity.cn` 共用查询后端的原生微信小程序前端。首版包含：

- ChatGPT 式单页聊天区；
- 热门阵容、阵容趋势、英雄出装、更新公告四个快捷入口；
- 查询完成后通过回答卡进入独立结果页；
- 原生页面栈返回，返回聊天页后保留聊天记录和结果；
- 结构化查询结果优先返回；
- LLM 结论使用 NDJSON 分块逐字显示，并在分块能力不可用时自动轮询最终结论。

## 微信开发者工具

1. 用微信开发者工具导入仓库根目录，工具会读取根目录的 `project.config.json`。
2. 将 `project.config.json` 中的 `touristappid` 换成正式小程序 AppID。不要把私钥或 AppSecret 写入前端仓库。
3. 在小程序管理后台把 `https://tftclarity.cn` 配置为 request 合法域名。
4. 把当前结果中使用的图片域名加入 downloadFile 合法域名；首版至少覆盖 `https://cdn.metatft.com`、`https://ddragon.leagueoflegends.com` 和 `https://game.gtimg.cn`。如果后端资源源发生变化，需要同步维护该列表。
5. 如需本地联调，可临时修改 `miniprogram/config.js` 的 `API_BASE_URL`，并在开发者工具中关闭“校验合法域名”。
6. 真机预览前检查后端已部署本分支中的 `/api/conclusion/stream` 和 `/api/conclusion/status`。

外部英雄与装备图片均来自 HTTPS 数据源。正式发布前还需要在小程序后台完成隐私保护指引、服务类目及 Riot 粉丝项目声明页面配置。

## 交互约定

- `/api/recommend` 传入 `deferConclusion: true`，只等待确定性的查询和排序。
- 返回值中的 `answer.generatedConclusion.status` 为 `pending` 时，结果页连接 `streamUrl`。
- 服务端先完成证据校验，再逐字发送可展示结论，避免把未通过校验的模型原始 JSON 暴露给用户。
- 若客户端或代理不支持分块响应，客户端使用 `statusUrl` 轮询；两条链路最终得到相同的 `generatedConclusion` 结构。

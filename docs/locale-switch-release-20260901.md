# 英文切换修复

- 发布版本：`8737b0b782df549ed1ac77373ee7ece2029b9a40`，前版 `395b5c2a28c9379d4c4fd7b8a1f8169b6b81cfd8`。
- 根因：语言点击委托只监听 `#title-bar`。窄屏隐藏顶部按钮并在设置面板展示第二组按钮，但后者位于监听范围外，点击没有触发 `setLocale`。
- 修复：`TitleBar` 接收 `localeRoot`，由 `#app-shell` 统一监听两组 `[data-locale]`；仍保留单一监听、当前语言去重和既有切换回调。
- 回归测试覆盖设置与顶部按钮双向切换、重复点击去重、嵌套元素点击及非语言区域忽略。UI 70/70；隔离发布树 main 1163 通过 / 7 跳过，integration 234 通过 / 1 跳过。
- 本地 Browser 验收覆盖桌面顶部、390×844 手机设置：中文→英文→中文→英文均成功；刷新后英文仍保留。赛季选择保持 S18，S17 仍显示不可用。
- [CI 33417453586](https://github.com/Chencc7002/tftclarity/actions/runs/33417453586)：main、integration、Bilibili runtime gate 全部成功。
- 生产只重建 app，worker 未切换；数据库、依赖、额度、工具和其他服务均未修改。app healthy、worker running。
- 公网 `app-shell.js`、`app.js` 与发布树逐字一致。生产页面已切换为英文；健康、就绪均为 200，S17 的选择与查询拦截仍通过。
- 回退镜像：`tftclarity-locale-switch-rollback-app:20260901`，旧 SHA 与镜像记录在服务器 `backups/locale-switch-20260901/`。未执行回滚演练。

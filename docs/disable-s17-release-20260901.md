# S17 临时停用

- 用户要求：仅临时禁用 S17，暂不修复其数据源。
- 生产版本：`395b5c2a28c9379d4c4fd7b8a1f8169b6b81cfd8`；前版 `ffdde3dc186cbe4d8a4dd4f9d3c2adc391755f44`。
- 唯一运行代码变更为赛季注册表：S17 `selectable=false`、`status=unavailable`，显示“Set 17 · 暂不可用”；S18 仍为默认可用赛季。S17 目录、缓存与历史数据未删除。
- 复用现有服务端赛季校验与前端选项禁用、刷新后默认赛季回退。不修改工具、模型或运行时路径。
- 发布树 `.cache/disable-s17-release-20260901` 隔离本次变更，没有携带主工作区其他改动。
- 冻结 S17 数据集的旧业务测试显式注入测试赛季服务，保持既有业务断言；生产注册表和禁用请求测试不使用该 fixture。初次测试因默认 S17 停用被拦截，调整测试上下文后 main 1162 通过 / 7 跳过，integration 234 通过 / 1 跳过，Agent eval 50/50，均无失败。
- [CI 33414842314](https://github.com/Chencc7002/tftclarity/actions/runs/33414842314) 的 main、integration、Bilibili runtime gate 全部成功。
- 仅重建并切换 app、worker，app healthy、worker running。未改数据库 schema、额度、依赖或其他服务。
- 生产验证：健康与就绪端点 200；公开注册表 S17 不可选、S18 可选。S17 选择与普通查询返回 409；两个流式查询返回 `season_context_not_selectable` 错误事件，没有工具完成事件。S18 选择返回 200。脚本输出 `DISABLE_S17_PRODUCTION_PASSED`。
- 浏览器实测：原先选中 S17 的页面刷新后切到 S18，S17 显示“Set 17 · 暂不可用”且 option disabled。
- 回退镜像：`tftclarity-disable-s17-rollback-app:20260901`、`tftclarity-disable-s17-rollback-worker:20260901`；旧 SHA 与镜像记录在服务器 `backups/disable-s17-20260901/`。本次无数据迁移，未执行数据库恢复或回滚演练。
- 恢复方式：数据源修复并验证赛季隔离后，将 S17 注册表恢复为可选/live，并恢复相应文字；不能只取消前端禁用。

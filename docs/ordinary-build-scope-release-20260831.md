# 三件套普通装备范围追问修复

后续发现“已携带特殊装备、仅待补装备普通”的需求与整套普通不同；本文件记录当次发布行为。后续修正已于 `ffdde3d` 发布，见 [待补装备范围修复](remaining-item-policy-fix-20260831.md)。

## 发布范围

- 发布版本：`529b13e27501680f4ce6f077988658c02e4c1d96`。
- 前版本：`0e4714fb71c6ef0f41b826f0c9c6bb4b78e9d0a2`。
- 使用隔离发布目录 `.cache/ordinary-build-release-20260831`，仅纳入本次 10 个文件；保留主工作区的其他未发布改动。
- 只重建并切换 Web app；不改数据库 schema、依赖、MCP、worker、流量入口或额度配置。

## 根因与修复

1. 旧 `parseItemPolicy` 看到“特殊”就设置 `include_special`，缺少通用“特殊装备”的否定范围解析。“不含特殊装备”可能反向开启特殊范围。
2. ReAct 类别提示此前仅对非普通类别生效；普通装备追问缺少对旧类别的明确替换约束。服务端也可能信任模型残留的 `itemCategories`，把三件套范围修改转换为单件类别榜。
3. 显式仅普通装备与已锁定特殊装备冲突时，context builder 可能自动扩大范围。现在保留显式限制并由现有 validator 报告冲突，不静默放宽。

修复后由确定性代码覆盖装备范围，保留完整出装操作，重新查询当前工具 Evidence；prompt 提示仅用于辅助模型保持条件。没有新增运行时、工具、权限或 Skill 控制路径。

## 验证

- 独立发布树：main 1158 通过 / 7 跳过；integration 232 通过 / 1 跳过；Agent eval 50/50；均无失败。
- [CI 33361018287](https://github.com/Chencc7002/tftclarity/actions/runs/33361018287)：main、integration、Bilibili runtime gate 全部成功。
- 此前本地 BrowserUse 四轮真实模型实测通过，条件与卡片同步切换，无 console error。
- 生产版本、容器镜像和 healthy 状态已核对；公网 `/api/health`、`/api/ready`、`/api/runtime` 均返回 200。
- 生产真实模型四轮：“三件套包含特殊装备” → “不含特殊装备” → “加入特殊装备，仍然查询三件套” → “修改为只包含普通装备”，均完成且保留厄斐琉斯与三件套。
- 生产 QuickTask 三件套查询使用 `include_special` 偏好起步，随后自然语言追问“不含特殊装备”和“修改为只包含普通装备”，均完成；全部卡片逐件分类通过，最终脚本输出 `PRODUCTION_CHECK_PASSED`。
- 逐件使用生产目录分类校验：仅普通范围的所有结果均为 `ordinary_completed`；原先的纹章、金币收集者已过滤。生产审计目录通过既有受保护管理员接口只读获取，没有放开公共访问。
- 当前测试会话及响应报告存于忽略目录 `.cache/ordinary-build-production-report.json`，不提交访客凭据或原始生产会话。

## 回退与备份

- 备份：`/root/tftclarity/backups/ordinary-build-20260831-133744`。
- PostgreSQL dump 已通过 `pg_restore --list` 与 SHA256 验证；SHA256：`f14d43e29be475eb6e51ab59a989e41541b25e08394f5c94cc2f7a3bc7a016a0`。
- 回退镜像：`tftclarity-ordinary-build-rollback-app:20260831`。
- 新 app image config digest：`sha256:2e9a2f4275c4559853d18bbaceae2775299fc205fcb416f9e18e9c73128f3e03`。
- 本次未执行数据库恢复演练或生产回滚演练；不将备份验证写作恢复演练通过。

## 环境记录

`r1-release-readiness.md` 的 8 月 11 日域名未就绪状态已过时；本次以现有生产状态、用户本次上线授权及最终提交的 CI/健康验证为依据。SSH 最初受本地虚拟网卡路径影响，使用已有物理网卡源地址恢复连接；未修改代理、路由、防火墙或主机密钥校验。

# tftclarity Riot Production Key 申请流程

> 更新日期：2026-07-20
>
> 产品站点：<https://tftclarity.cn/>
>
> 目标：申请 Teamfight Tactics Production API Key

## 1. 流程总览

```text
准备公开产品与合规页面
→ 登录 Riot Developer Portal
→ 注册公开 TFT 产品
→ 填写并提交 Production Application
→ 部署 riot.txt 完成域名验证
→ 等待 Riot 审核并补充材料
→ 获得 Production Key
→ 建设 Riot 官方数据聚合链路
→ 与 MetaTFT 双数据源对比后逐步迁移
```

Personal Key 不是 Production Key 的强制前置步骤。登录 Portal 后自动获得的 Development Key 已可用于本地或私有环境验证，但不能作为公开站点的生产密钥。

## 2. 第一步：准备公开产品

### 申请前检查项

- [x] `https://tftclarity.cn/` 可从外网正常访问。
- [x] 站点使用 HTTPS。
- [x] Riot 指定的英文法律声明可见。
- [x] 阵容、趋势、英雄装备、AI 数据解读和连续查询等主要用户流程可演示。
- [x] Privacy Policy 已部署至 `https://tftclarity.cn/privacy`，公网 GET 返回 200。
- [x] Terms of Service 已部署至 `https://tftclarity.cn/terms`，公网 GET 返回 200。
- [x] 英文产品说明和用户流程说明已整理至 [Riot Production Application Package](riot-production-application-en.md)。
- [x] 截图与录屏步骤已整理至 [Riot 审核截图与录屏清单](riot-review-capture-checklist.md)；待人工拍摄。

产品不需要开发完整英文版。tftclarity 可以明确定位为面向中文 TFT 玩家的中文产品。英文申请材料只需要让审核人员理解产品用途、功能和政策边界。

英雄、羁绊和装备的英文名称尚未维护不会阻止申请。审核期间可以保持中文为正式语言，将未完成审核的英文界面标记为 Beta 或暂时隐藏语言切换。

## 3. 第二步：登录 Riot Developer Portal

访问 <https://developer.riotgames.com/>，使用 Riot 账号登录。

登录后会自动获得 Development Key：

- 每 24 小时过期。
- 可用于本地开发和私有测试。
- 可用于验证 `tft-match-v1`、`tft-league-v1` 等接口。
- 不能让 `tftclarity.cn` 的公开功能长期依赖该密钥。

如果官方数据开发需要较长时间，可选择申请 Personal Key 减少每日更新密钥的成本；但 Personal Key 不是 Production 申请的必要步骤，也不允许支持公开产品。

## 4. 第三步：注册产品

在 Developer Portal 中选择 `Register Product` 或 `Register Project`。Portal 文案可能更新，但选择原则不变：

- 选择面向大型社区或公开互联网的产品。
- 不选择 Personal Project。
- 游戏选择 Teamfight Tactics。
- 密钥类型选择 Production。
- 一个产品使用一个密钥，不使用多应用规避限流。

## 5. 第四步：填写产品申请

### 基本信息

| 申请字段 | 建议内容 |
| --- | --- |
| Product name | `tftclarity` |
| Website | `https://tftclarity.cn/` |
| Game | Teamfight Tactics |
| Target users | Chinese-speaking TFT players |
| Product type | Public web analytics and decision-support tool |
| Current data | Third-party aggregated statistics used by the working prototype |
| Planned Riot data | Official match and league data used to build first-party aggregates |

### 产品用途

申请材料应说明：

- 支持中文自然语言和中文俗称查询。
- 展示阵容和英雄装备的聚合统计。
- AI 只解读经过校验的数据，不改写底层统计。
- 提供多个静态选择、样本量和风险边界。
- 用于赛前静态参考、赛后学习和版本趋势理解。

### 计划使用的 Riot 接口

建议列出：

- `tft-league-v1`：获取高段位玩家种子。
- `tft-match-v1`：获取对局 ID 和对局详情。
- Data Dragon：获取英雄、装备和羁绊等静态目录与资源。

目标区域应根据实际首期范围填写，例如 TW2、SG2、JP1 或 KR。Riot 公开 API 没有中国大陆服务器路由，申请中不应承诺中国大陆对局覆盖。

### 政策边界

必须清楚说明产品：

- 不根据用户当前对局状态动态调整建议。
- 不提供实时操作指令。
- 不侦察对手棋盘、阵容或下一步行为。
- 不分析被隐藏或无法合理识别的玩家。
- 不为玩家生成非官方 MMR 或 ELO。

### 数据源说明

不应隐瞒当前原型使用 MetaTFT 已处理聚合数据的事实。可说明：

> The current working prototype uses third-party aggregated statistics to demonstrate the complete user experience. Production API access will be used to build first-party aggregates from Riot-supported TFT match and league data and to migrate the product away from its current dependency.

Riot 的产品批准不代表 Riot 授权使用 MetaTFT 数据。MetaTFT 接口的长期使用权和稳定性是独立风险，不应将其作为获批后的唯一生产数据方案。

## 6. 第五步：提交 Production Application

提交前再次确认：

- 站点可从公网访问。
- Privacy Policy 和 Terms of Service 链接可见且内容与实际数据处理一致。
- 法律声明可见。
- 申请中的产品功能与站点实际功能一致。
- 未承诺实时、对手侦察或中国大陆数据能力。
- 申请联系方式可正常收取 Riot 邮件或 Portal 通知。

Production Key 申请本身目前没有官方公布的申请费或按请求计费。

## 7. 第六步：完成网站所有权验证

提交 Production Application 后，Riot 会提供一段验证字符串。

1. 使用纯文本编辑器创建 `riot.txt`。
2. 文件中只保留 Riot 提供的字符串，前后不留空格或其他文本。
3. 将文件部署到站点根路径。
4. 在浏览器中确认 `https://tftclarity.cn/riot.txt` 可直接访问。
5. 在 Developer Portal 中提交域名或验证地址。
6. 等待状态变为已验证。
7. 验证完成后，按 Riot 官方建议删除文件或隐藏其公开访问。

不要在 Riot 尚未确认验证完成时提前删除文件。

## 8. 第七步：等待 Riot 审核

Riot 将重点检查：

- 产品用途是否符合 TFT 政策。
- 公开站点和用户流程是否可正常体验。
- Privacy Policy 和 Terms of Service 是否存在。
- 是否提供对手侦察、实时动态指令或其他禁止功能。
- API Key 是否有服务端安全保护方案。
- 产品是否对 TFT 玩家有清晰价值。

官方 FAQ 表示申请通常按周审阅，高峰期最长可能需要约三周。如 Riot 需要更多材料，将通过 Developer Portal 消息或支持渠道联系申请人。

## 9. 第八步：审核期间的开发边界

审核期间可以继续使用 Development Key：

- 验证请求参数、区域路由和返回字段。
- 拉取少量对局数据验证标准化逻辑。
- 开发英雄装备聚合原型。
- 验证阵容特征和分类思路。
- 进行本地、私有测试或录制演示。

不可以：

- 将 Development Key 写入前端、仓库或公开二进制。
- 让公开站点将 Development Key 作为长期数据密钥。
- 为避开限流创建多个应用或账号。

## 10. 第九步：审核通过

获得 Production Key 后：

- 将密钥保存在服务端环境变量或密钥管理服务中。
- 只允许后端采集服务访问密钥。
- 对日志、错误信息和健康接口做脱敏。
- 处理应用级、方法级和服务级限流。
- 收到 `429` 时遵守 `Retry-After`。

标准 Production Key 初始应用级限额为每个区域：

```text
500 次 / 10 秒
30,000 次 / 10 分钟
```

更高限额不是付费升级项。产品需要先稳定运行，证明社区价值并确实超出标准限额后，再向 Riot 申请扩容。

## 11. 第十步：正式数据迁移

获批后不需要立即关闭现有 MetaTFT 数据链路。建议分阶段迁移：

1. 建立 Riot 对局采集 Worker、限流器和去重机制。
2. 建立原始对局、标准化记录和聚合统计数据库。
3. 优先实现相对简单的英雄装备聚合。
4. 实现版本化阵容定义、分类或聚类。
5. 使用相同口径与 MetaTFT 结果做影子对比。
6. 校验样本量、平均排名、前四率、胜率和选择率。
7. 确认稳定后按功能逐步切换数据源。
8. 保留回滚开关和数据源标记，避免一次性全量切换。

建议迁移顺序：

```text
英雄装备聚合
→ 基础阵容分类
→ 阵容排行
→ 阵容趋势
→ 多区域与历史数据
```

## 12. 最终提交清单

- [x] `/privacy` 页面与无扩展名路由已实现。
- [x] `/terms` 页面与无扩展名路由已实现。
- [x] 首页固定法律声明、Privacy 与 Terms 入口已实现。
- [x] 设置面板中的完整 Riot 英文声明与开发者政策入口已实现。
- [x] `https://tftclarity.cn/privacy` 可访问。
- [x] `https://tftclarity.cn/terms` 可访问。
- [x] 英文产品说明初稿已完成。
- [ ] 英文产品说明已由运营者最终审核。
- [ ] 主要用户流程截图或视频已准备。
- [ ] `tftclarity@outlook.com` 已配置并完成收信测试。
- [x] 当前数据源和迁移计划已如实说明。
- [x] 所需 Riot API 和目标区域已列出。
- [x] 实时、对手侦察和隐藏玩家边界已声明。
- [ ] Production Application 已提交。
- [ ] `riot.txt` 已部署并完成验证。
- [ ] 验证完成后已删除或隐藏 `riot.txt`。
- [ ] Production Key 已安全保存于服务端。
- [ ] Riot 官方数据迁移已进入影子对比阶段。

生产发布与验收命令参见 [Riot 法律页面生产部署与验收](riot-legal-production-deploy.md)。

## 13. 官方参考

- [Riot Developer Portal 与 API Key 类型](https://developer.riotgames.com/docs/portal)
- [Production Application 与网站验证 FAQ](https://developer.riotgames.com/docs/faqs)
- [Riot 网站所有权验证步骤](https://developer.riotgames.com/how-to-verify-site.html)
- [Riot Teamfight Tactics 开发政策](https://developer.riotgames.com/docs/tft)
- [Riot 通用开发者政策](https://developer.riotgames.com/policies/general)
- [Riot API Reference](https://developer.riotgames.com/apis/)

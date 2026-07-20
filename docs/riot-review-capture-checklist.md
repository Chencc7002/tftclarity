# Riot 审核截图与录屏清单

> 你需要自行完成本文件中的截图或录屏。  
> 截图是建议必备材料；录屏不是硬性前置，但一段完整短视频会显著降低审核人员理解中文界面的成本。

## 1. 拍摄前必须完成

- [ ] 已将本次代码部署到 `https://tftclarity.cn/`。
- [ ] `https://tftclarity.cn/privacy` 返回 200，并显示 Privacy Policy。
- [ ] `https://tftclarity.cn/terms` 返回 200，并显示 Terms of Service。
- [ ] 首页底部始终能看到独立项目声明以及 Privacy、Terms 链接。
- [ ] 设置面板中能看到完整 Riot 英文声明。
- [ ] `longyuyanchen@gmail.com` 已配置并实际完成一次收信测试。
- [ ] 使用无痕窗口重新检查所有页面，避免截图中出现管理入口、调试数据或旧缓存。
- [ ] 关闭浏览器收藏栏、下载栏、开发者工具和无关标签页。
- [ ] 不展示 API Key、Cookie 值、IP、后台日志、个人账号、邮箱或其他敏感信息。

## 2. 建议提交的 7 张核心截图

所有截图建议使用 1440×900 或 1920×1080，PNG 格式。中文 UI 可以保留，但文件名和说明使用英文。

### 01-public-product-and-legal.png

- 打开首页。
- 保证底部法律声明、Privacy、Terms 同时可见。
- 页面中不要有错误提示。
- 英文说明：

> The public tftclarity interface. The persistent footer identifies the project as independent and links to the Privacy Policy and Terms of Service.

### 02-champion-item-recommendation.png

- 查询：`霞当前版本最稳的三件装备是什么？`
- 截图中同时包含：用户问题、首选方案、至少一个备选、样本量、平均名次、前四率、吃鸡率、数据来源或风险提示。
- 英文说明：

> A Chinese natural-language champion query converted into a scoped result with complete builds, alternatives, samples, performance metrics, data source, and risk warnings.

### 03-item-comparison.png

- 在同一英雄上下文中比较两件当前版本确实存在的普通装备。
- 优先选择能显示“共同样本”“互斥样本”或“证据不足不判断胜者”的结果。
- 英文说明：

> A two-item comparison using mutually exclusive complete-build samples. The product declines to name a winner when the difference or evidence is insufficient.

### 04-composition-rankings.png

- 查询：`当前版本热门阵容排行`
- 显示阵容列表、统计范围、样本或表现指标。
- 英文说明：

> Non-player-specific composition aggregates for the selected patch, rank, and time window.

### 05-patch-trend.png

- 打开或查询阵容趋势。
- 如果历史不足，保留“历史不足”提示；这反而能证明产品不会编造趋势。
- 英文说明：

> Patch-level aggregate trend information. Missing or insufficient history is labeled rather than inferred.

### 06-multi-turn-refinement.png

- 第一轮先完成一个英雄或阵容查询。
- 第二轮使用类似：`保持同一阵容，只看大师以上` 或 `保持其他条件，比较另一件装备`。
- 保证截图中能看到两轮消息和条件来源。
- 英文说明：

> A follow-up query that preserves short-lived context and shows the source of each applied condition.

### 07-legal-and-data-transparency.png

- 打开设置面板并滚动到 About & legal。
- 显示完整 Riot 英文声明、Privacy、Terms、Developer policy 链接。
- 如果同一画面能带到数据与运行状态更好。
- 英文说明：

> The settings panel shows the full Riot disclaimer, policy links, runtime/data status, and public legal pages.

## 3. 建议追加的 2 张合规页面截图

### 08-privacy-policy.png

- 打开 `https://tftclarity.cn/privacy`。
- 截图包含页面标题、生效日期、摘要和导航。

### 09-terms-of-service.png

- 打开 `https://tftclarity.cn/terms`。
- 截图包含页面标题、生效日期、摘要和导航。

## 4. 可选录屏：75–90 秒

建议录制 1080p、30 fps、MP4/H.264，无需真人出镜。可以不录声音，后期加英文字幕；如果录声音，使用下面的英文旁白。

### 录屏顺序

1. **0–8 秒：首页与法律入口**  
   缓慢移动鼠标指向底部独立声明、Privacy、Terms。
2. **8–30 秒：英雄装备查询**  
   输入 `霞当前版本最稳的三件装备是什么？`，等待结果，停留展示指标、样本、备选和风险提示。
3. **30–45 秒：连续追问或装备对比**  
   输入一个保持上下文的比较问题，展示条件继承和证据边界。
4. **45–60 秒：阵容排行或趋势**  
   查询热门阵容或打开趋势结果。
5. **60–75 秒：设置中的 Riot 声明**  
   打开设置，滚动到完整英文声明和政策链接。
6. **75–90 秒：Privacy 与 Terms**  
   分别打开两页，停留在标题、生效日期和摘要。

### 英文旁白

> tftclarity is a public, non-commercial TFT analytics tool for Chinese-speaking players. It converts Chinese natural-language questions into deterministic queries for aggregate composition and champion-item statistics. Results show multiple choices, sample sizes, performance metrics, data freshness, and risk warnings. Optional AI explains validated evidence but cannot change the underlying numbers. The product supports short-lived follow-up context, but it does not read live game state, scout opponents, provide dynamic instructions, or create an unofficial player rating. The public footer and settings panel disclose that tftclarity is independent and not endorsed by Riot Games, and link to the Privacy Policy and Terms of Service.

## 5. 文件整理

建议目录：

```text
riot-production-application/
├─ product-description-en.pdf
├─ screenshots/
│  ├─ 01-public-product-and-legal.png
│  ├─ 02-champion-item-recommendation.png
│  ├─ 03-item-comparison.png
│  ├─ 04-composition-rankings.png
│  ├─ 05-patch-trend.png
│  ├─ 06-multi-turn-refinement.png
│  ├─ 07-legal-and-data-transparency.png
│  ├─ 08-privacy-policy.png
│  └─ 09-terms-of-service.png
└─ tftclarity-review-walkthrough.mp4
```

## 6. 提交前最终复核

- [ ] 截图和录屏中的功能与申请文案完全一致。
- [ ] 不声称已覆盖中国大陆服务器。
- [ ] 不使用“实时指挥”“根据当前棋盘动态推荐”“侦察对手”等表述。
- [ ] 清楚说明当前原型使用第三方 MetaTFT 聚合统计。
- [ ] 清楚说明 Production API 用于建设 Riot 官方数据聚合并逐步迁移。
- [ ] 页面和材料都说明当前不使用 RSO、不展示特定玩家数据。
- [ ] 所有公开链接在无痕窗口、手机网络下均可访问。

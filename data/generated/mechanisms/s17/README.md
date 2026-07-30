# S17 机制案例数据（A1）

本目录保存阶段 A1 可版本化的小规模标准案例，不保存 MetaTFT 的完整原始响应。

## 文件与不可变快照

- `index.v1.json`：快照索引和最新快照指针。
- `<officialPatch>/<snapshotId>/standard-cases.v1.jsonl`：官方文本完整、且只包含可玩候选棋子的标准三件套案例。
- `<officialPatch>/<snapshotId>/partial-official-cases.v1.jsonl`：官方接口仍缺少运行时值的隔离案例。
- `<officialPatch>/<snapshotId>/auxiliary-cases.v1.jsonl`：召唤物、PVE 或其他辅助实体案例。
- `<officialPatch>/<snapshotId>/replacement-comparisons.v1.jsonl`：双方最小样本不少于 400 的观察性替换对照。
- `<officialPatch>/<snapshotId>/mechanism-only-replacement-comparisons.v1.jsonl`：低样本对照，仅用于机制文本分析。
- `<officialPatch>/<snapshotId>/capture-report.v1.json`：固定口径、来源哈希、质量分层和完整采集状态。

已发布快照不可覆盖；重复的 `snapshotId` 会使采集器失败。完整第三方响应保存在 `.cache/s17-mechanisms/<snapshotId>/`，派生的 gzip 全量案例按生成时间另存于其 `derived/` 子目录。

## 固定口径

- 赛季：S17
- 官方静态资料版本：由 `chess.js` 与 `equip.js` 的共同 `version` 冻结
- 队列：`RANKED_TFT`（MetaTFT 参数 `1100`）
- 时间窗：30 天
- 段位：CHALLENGER、GRANDMASTER、MASTER
- 星级：2 星
- 装备数：3

MetaTFT 当前接口只接受 `patch=current`，所以统计请求原值、抓取时间、请求指纹和响应哈希会被同时保存。案例的 `patch` 来自同次抓取的官方 S17 静态资料版本；报告不会把第三方的 `current` 别名伪装成可重放的历史补丁。

报告分别记录 `sourceCapturedAt` 与 `generatedAt`。离线重建必须显式提供原始快照时间和 `replayedFromSnapshot`，不会伪装成新抓取。

## 追溯规则

英雄技能、基础属性和装备效果来自腾讯游戏《金铲铲之战》静态资料接口。每个实体同时保存：

- 官方 URL；
- 官方版本；
- 实体内容 SHA-256；
- 整份官方响应 SHA-256；
- 数值原子的单位、条件、来源引用和版本哈希。

官方接口没有提供的动态值或技能缩放系数不会被猜测。案例使用 `sourceQuality` 和 `numericFormulaComplete` 显式标记；含未解析官方值的案例进入 `partial-official-cases.v1.jsonl`。

三件套样本、平均名次、前四率和登顶率来自 MetaTFT Explorer，是观察性统计，不是官方机制事实。每条案例和对照均保存样本证据等级；`<100` 只用于机制文本，`100–399` 为弱证据，只有双方均 `>=400` 的对照才进入标准表现对照文件。所有对照均标注 `causalClaimAllowed=false`。

## 复现

```powershell
npm run capture:s17
```

可用 `--standard-limit`、`--comparison-limit`、`--concurrency` 和 `--request-delay-ms` 调整公开样本数量与离线请求预算。采集器保留每个可查询 S17 标识的状态，包括没有三件套数据的召唤物或 PVE 单位。

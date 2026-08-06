# YouTube Hybrid 真实端到端测验报告

- 测试日期：2026-07-28（Asia/Shanghai）
- 测试工作区：`C:\Users\Chencc\Desktop\TFTAgent`
- 测试结论：**有条件通过，不建议立即全量启用模型生成式 Coach**
- 数据隔离：所有真实视频知识仅写入 `.cache/youtube-live-test.sqlite`，未写入正式语义索引

## 1. 结论摘要

真实 YouTube 元数据和字幕抓取、DeepSeek 知识抽取、KnowledgeDocument 校验、SQLite 入库、重复导入、TF-IDF 检索、赛季/补丁隔离和 Hybrid 权威顺序均已实际执行。

可确认通过的部分：

1. `youtube-transcript-api` 真实依赖可用，两个公开视频均成功取得元数据和完整字幕。
2. 当前 Set 17 视频成功抽取 5 条知识；历史 Set 3 / Patch 10.11 视频成功抽取 10 条知识。
3. 15 条知识可写入真实 SQLite；当前视频重复导入时为 `inserted=0, unchanged=5`。
4. 当前和历史知识共存时，按赛季与补丁检索未发生串库；交叉补丁检索为 0。
5. MetaTFT 当前霞装备接口返回真实数据，核心 `items` 与 `unit_builds` 链路通过。
6. 当 Coach 模型返回非法协议时，校验器成功拒绝模型结果；降级答案仍坚持 MetaTFT 第一名，YouTube 仅作为条件性解释。
7. 全量 Node 测试 764 项：744 通过、20 跳过、0 失败；Python 测试 6 项全部通过。

仍需处理的发布阻断项：

1. DeepSeek 知识抽取存在明显非确定性：同一短视频第一次得到 0 条，重试得到 5 条；历史长视频默认分段第一次发生 `JSONDecodeError`，调整为单分段后才成功。
2. DeepSeek Coach 连续返回不符合 `coach_answer.v1` 的 JSON。安全降级有效，但“模型生成式 Hybrid 答案”当前未通过真实测验。

因此建议：知识抓取、人工审核、入库和检索可进入受控试运行；在增加抽取重试/诊断以及修复 Coach 严格结构化输出前，不要把生成式 Coach 作为默认生产路径。

## 2. 测试环境

| 项目 | 实际值 |
| --- | --- |
| 系统 Node.js | v18.20.8 |
| 工作区内置 Node.js | v24.18.0 |
| Python | 3.12.4（Anaconda） |
| `youtube-transcript-api` | 1.2.4 |
| 模型 API | OpenAI-compatible DeepSeek |
| 模型 | `deepseek-v4-flash` |
| SQLite | Node v24 内置 `node:sqlite` |
| 向量策略 | 本次真实隔离库使用本地 TF-IDF，未调用远程 embedding |

API Key 已确认配置，但本报告和命令输出均未记录或展示密钥。

## 3. 真实测试数据

### 3.1 当前赛季样本

- 视频：[Your Carry is Useless Without These Items | TFT Fundamentals](https://www.youtube.com/watch?v=BpFL4kmfp1Q)
- 作者：dpei
- 发布日期：2026-02-14
- 时长：290.88 秒
- 字幕片段：134
- 测试标签：`season=set17-live`、`patch=17.7`、`locale=en`
- 外部交叉核对：[TFT Ninja 的 Set 17 视频摘要](https://tft.ninja/guides/creators/dpei/shred-sunder-anti-heal)

该视频适合验证装备优先级、主副 C 装备分配、减抗/破甲与重伤等通用策略。补丁值由导入命令人工提供，详见风险项 R3。

### 3.2 历史版本隔离样本

- 视频：[Shredder Guide - Patch 10.11](https://www.youtube.com/watch?v=ag_FVgVScMk)
- 作者：BaracudaOfficial
- 发布日期：2020-05-22
- 时长：1243.13 秒
- 字幕片段：564
- 测试标签：`season=set3-historical`、`patch=10.11`、`locale=en`
- 外部交叉核对：[原攻略发布帖](https://www.reddit.com/r/TeamfightTactics/comments/govfgx)

该样本明确属于 Set 3 / Patch 10.11，包含旧版霞装备、站位、搜牌和后期转换，适合验证旧攻略不会污染 Set 17。

## 4. 测试结果

| ID | 测试项 | 结果 | 关键证据 |
| --- | --- | --- | --- |
| T01 | 真实 Python 依赖 | 通过 | Python 3.12.4；`youtube-transcript-api` 1.2.4；6 个单元测试通过 |
| T02 | 当前视频元数据与字幕 | 通过 | 标题、作者、日期、134 个字幕片段、290.88 秒均成功取得 |
| T03 | 当前视频模型抽取 | 部分通过 | 第一次 0 条且返回 `no_actionable_tft_knowledge_extracted`；第二次成功 5 条 |
| T04 | 时间戳边界过滤 | 通过 | 诊断调用中模型给出两个超过 290.88 秒的主张，规范化器将其拒绝，只保留边界内记录 |
| T05 | 当前视频 SQLite 入库 | 通过 | 首次 `inserted=5`；第二次 `inserted=0, unchanged=5` |
| T06 | 当前知识检索与来源字段 | 通过 | 检出 5 条；保留视频 ID、标题、作者、发布日期、补丁、起止时间戳和 URL |
| T07 | 历史视频默认分段抽取 | 失败 | 两个默认分段处理约 101 秒后报 `JSONDecodeError` |
| T08 | 历史视频单分段重试 | 通过 | `chunk-seconds=1800`、`chunk-characters=30000` 后成功抽取 10 条 |
| T09 | 赛季/补丁隔离 | 通过 | Set 17 只返回当前视频；Set 3 / 10.11 只返回历史视频；交叉补丁返回 0 |
| T10 | 真实 MetaTFT 当前数据 | 部分通过 | `items=181`、`unit_builds=600`，核心推荐通过；可选 comps 上下文接口返回非法 JSON |
| T11 | 真实 Hybrid Coach | 模型生成失败、安全降级通过 | DeepSeek 连续返回非 `coach_answer.v1` JSON；校验器拒绝并保持 MetaTFT 第一名 |
| T12 | Node 全量回归 | 通过 | 764 项，744 通过、20 跳过、0 失败 |
| T13 | YouTube SQLite smoke | 通过 | 使用 Node v24：新增、幂等、检索全部通过 |

## 5. 关键实测明细

### 5.1 当前视频抽取结果

第二次抽取生成 5 条 KnowledgeDocument：

1. 减抗/破甲应在 Stage 4、最迟 Stage 5 准备。
2. 每局准备一件重伤装备。
3. 先完整装备一个主 C 和一个主坦，再装备副 C。
4. 后期装备溢出时，将团队功能装转移给副 C。
5. 围绕击杀敌方主坦安排伤害装备。

所有记录均带有：

- `source=youtube`
- `sourceId=BpFL4kmfp1Q`
- `author=dpei`
- `publishedAt=2026-02-14`
- `season=set17-live`
- `patch=17.7`
- `claimType=creator_advice`
- 时间戳、条件和源 URL

### 5.2 历史视频抽取结果

单分段重试后生成 10 条 KnowledgeDocument，覆盖：

- 旧版霞核心装备与备选装备
- 嘉文四世前排装备
- 对刺客/潜行者站位
- 3-1 搜牌条件
- 8/9 级后期转换
- 被多家同行时的风险

这些记录均标记为 `set3-historical / 10.11`。

### 5.3 同库版本隔离

使用查询 `What items and positioning should Xayah use?`：

| 检索上下文 | 返回数 | 唯一视频来源 |
| --- | ---: | --- |
| `set17-live / 17.7` | 5 | `BpFL4kmfp1Q` |
| `set3-historical / 10.11` | 8（topK=8） | `ag_FVgVScMk` |
| `set3-historical / 17.7` | 0 | 无 |

历史结果中的前几条确实是旧版霞的装备和站位，但不会出现在 Set 17 检索中。

### 5.4 真实 MetaTFT

真实 smoke 查询：`2星霞，3观星，携带哪三件普通装备最好？`

- 物品行：181
- 霞 `unit_builds` 行：600
- `items` 延迟：2636 ms
- `unit_builds` 延迟：1749 ms，低于 2000 ms 目标
- 第一名：杀人剑 + 杀人剑 + 红霸符
- 样本：133
- 前四率：70.7%
- 吃鸡率：22.6%
- 平均名次：3.57
- 风险标记：低样本，仅供参考

可选 `/comps` 上下文请求中的 `latest_cluster_info` 返回非法 JSON。当前 smoke 设计为非强制上下文，因此核心装备统计测试仍通过。

### 5.5 真实 Hybrid Coach

输入证据：

- 当前 MetaTFT 第一名：`stats:build:1`
- 当前视频知识：减抗/破甲、重伤和功能装转移

DeepSeek 实际返回的 JSON 只有：

- `currentRecommendation`
- `creatorAdvice`

缺少 `schemaVersion`、`status`、`headline`、`text`、`reasons`、`alternatives`、`citations` 和 `warnings`，而且 `currentRecommendation` 使用 `items`，未使用协议要求的 `label`。

`validateCoachAnswer` 正确拒绝该响应并触发确定性降级。降级结果：

- `currentRecommendation.evidenceId=stats:build:1`
- 主推荐仍为 `Deathblade + Deathblade + Red Buff`
- YouTube 只作为条件性解释
- 同时引用统计和视频 evidence ID
- 带有 `coach_answer_validation_failed` 警告

权威顺序安全测试通过，但生成式 Coach 本身未通过。

## 6. 缺陷与风险

### R1 — P1：Coach 输出协议未被真实模型遵守

当前 provider 默认只要求 `response_format=json_object`；模型知道要返回 JSON，却没有稳定产出 `coach_answer.v1` 的完整字段。真实调用连续失败，导致系统只能降级。

建议：

1. 在模型明确支持时启用 JSON Schema。
2. 在 system/user prompt 中完整列出必填字段和一个最小合法示例。
3. 对非法响应进行一次带校验错误反馈的结构修复重试。
4. 增加真实 provider 合约测试，不能只用注入的合法 mock。

验收标准：同一固定 EvidenceBundle 连续 10 次调用，至少 9 次直接通过 `validateCoachAnswer`；未通过时仍必须安全降级。

### R2 — P1：知识抽取缺少稳健重试与可观测性

观察到三种结果：

1. 合法但为空的 `knowledge=[]`。
2. 非 JSON / 空内容导致 `JSONDecodeError`。
3. 合法且有 5 或 10 条知识。

目前合法空数组会被当作成功文件写入，非法分段会让整条长视频失败，而且没有记录分段级错误、模型完成原因、拒绝数量或拒绝原因。

建议：

1. 对空知识、JSON 解析失败和临时时间戳越界分别重试。
2. 分段独立容错，成功分段不应被单个失败分段全部回滚。
3. 在 envelope 中增加 `extractionAttempts`、`rejectedClaims`、`segmentErrors` 和模型 usage。
4. 对越界时间戳可先裁剪到字幕段范围并标记警告，或进行一次修复重试；不得静默丢弃而不计数。
5. 为长视频提供可配置并有文档说明的分段策略。

### R3 — P2：补丁标签完全信任人工输入

当前视频发布于 2026-02-14，本次为测试隔离而人工标记为 `17.7`。系统不会根据标题、发布日期、视频描述或当前赛季自动核对该标签。

这不是本次版本隔离逻辑的失败，但运营误标可能让旧知识合法进入当前补丁。

建议：

1. 导入前显示视频发布日期、标题和目标补丁，要求人工确认。
2. 标题明确含其他 patch/set 时拒绝或要求 `--force-patch-mismatch`。
3. 没有明确补丁证据时标记为赛季级通用知识，不直接声明为当前补丁事实。

### R4 — P2：MetaTFT 可选 comps 上下文接口不稳定

核心装备接口通过，但 `latest_cluster_info` 返回非法 JSON。需要保留现有非强制降级，并增加响应状态、内容类型和短摘要诊断。

### R5 — P3：系统 Node 与工作区 Node 行为不一致

`npm run smoke:youtube` 通过系统 Node v18 在当前沙箱触发 `EPERM: lstat C:\Users\Chencc`；使用工作区 Node v24 直接运行同一脚本则通过。该问题属于运行环境/启动器差异，不是知识逻辑失败。

建议统一开发和 CI Node 至 v24，或确保 npm 使用工作区内置 Node。

## 7. 回归测试

### Node 全量

```powershell
npm test
```

结果：

```text
tests 764
pass 744
fail 0
skipped 20
duration 10.77s
```

跳过项主要与系统 Node v18 不提供 `node:sqlite` 有关；真实 SQLite 测试使用工作区 Node v24 单独通过。

### Python

```powershell
C:\Users\Chencc\anaconda3\python.exe -m unittest services\youtube-ingestion\test_ingestion.py
```

结果：6/6 通过。

### YouTube SQLite smoke

```powershell
.\.cache\runtime\node-v24.18.0-win-x64\node.exe scripts\smoke-youtube-knowledge.mjs
```

结果：

```json
{
  "ok": true,
  "inserted": 1,
  "duplicateUnchanged": 1,
  "retrieved": 1
}
```

## 8. 复现命令

### 当前视频抽取

```powershell
C:\Users\Chencc\anaconda3\python.exe services\youtube-ingestion\cli.py `
  "https://www.youtube.com/watch?v=BpFL4kmfp1Q" `
  --season set17-live `
  --patch 17.7 `
  --locale en `
  --output ".cache\youtube-live-test\BpFL4kmfp1Q.json" `
  --force
```

### 历史视频抽取

```powershell
C:\Users\Chencc\anaconda3\python.exe services\youtube-ingestion\cli.py `
  "https://www.youtube.com/watch?v=ag_FVgVScMk" `
  --season set3-historical `
  --patch 10.11 `
  --locale en `
  --chunk-seconds 1800 `
  --chunk-characters 30000 `
  --output ".cache\youtube-live-test\ag_FVgVScMk.json" `
  --force
```

### 隔离 SQLite 入库

```powershell
.\.cache\runtime\node-v24.18.0-win-x64\node.exe scripts\import-youtube-guide.mjs `
  --input ".cache\youtube-live-test\BpFL4kmfp1Q.json" `
  --db ".cache\youtube-live-test.sqlite" `
  --season set17-live `
  --no-embeddings
```

## 9. 测试产物

- 当前视频抽取：`.cache/youtube-live-test/BpFL4kmfp1Q.json`
- 历史视频抽取：`.cache/youtube-live-test/ag_FVgVScMk.json`
- 隔离测试数据库：`.cache/youtube-live-test.sqlite`
- 本报告：`docs/youtube-hybrid-real-e2e-test-report-2026-07-28.md`

`.cache` 下产物用于本地复核，不应提交为正式知识库。

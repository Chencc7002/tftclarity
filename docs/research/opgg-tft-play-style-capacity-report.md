# OP.GG MCP `tft_get_play_style` 单次返回容量探测报告

## 1. 结论摘要

`tft_get_play_style` 连续三次调用均稳定返回 **3 场唯一对局**，且每场字段完整（placement / level / traits / units / unit items 全部齐备），Match ID 集合与排序三次完全一致。

工具 Schema 只声明 `region` 与 `puuid` 两个必填参数，**不声明 count / limit / offset / page / cursor / before / after / start / hasMore / nextCursor 中任何字段**。因此：

- 不支持主动请求 20 场；
- 不支持分页；
- 单次固定返回 3 场，少于 5 场，按任务判定标准只适合作为**玩法风格预览或辅助数据源**，不适合作为正式复盘主数据源。

Match ID 是稳定的 `NA1_*` 对局 ID，理论上具备本地增量积累的基础，但单次数量低于“5—9 场可定期抓取并本地累计”的阈值，本报告按任务标准将 `suitableForIncrementalCollection` 判为 `false`（详见第 10 节说明）。

## 2. 测试信息

| 项目 | 值 |
| --- | --- |
| 测试账号 | chencc#1215 |
| 区服 | NA（`region: "na"`） |
| 测试日期 | 2026-08-01 |
| 端点 | `https://mcp-api.op.gg/mcp`（MCP Streamable HTTP，协议 `2025-06-18`） |
| 调用次数 | `lol_get_summoner_profile` × 1，`tft_get_play_style` × 3 |
| 调用间隔 | 每次 1.5 秒 |
| 客户端 | 复用项目现有原始 JSON-RPC/SSE 探测客户端（无生产 MCP 接入），一次性脚本 `scripts/probe-opgg-tft-play-style.mjs` |

## 3. 工具 Schema

### `tft_get_play_style`

- 必填参数：`region`（string）、`puuid`（string）
- 可选参数：无
- 分页/数量相关字段：**无**（`count`、`limit`、`offset`、`page`、`cursor`、`before`、`after`、`start`、`hasMore`、`nextCursor` 均未声明）
- `outputSchema`：null

### `lol_get_summoner_profile`

- 必填参数（按 Schema）：`game_name`、`tag_line`、`region`、`desired_output_fields`（array）
- 可选参数：`lang`（默认 `en_US`）
- `outputSchema`：null

### `tools/list` 结果

- 成功返回 30 个工具，其中 6 个 `tft_*` 工具；
- 本次未出现因其他工具非法 `outputSchema` 导致 MCP SDK 整体校验失败的问题。本次使用原始 JSON-RPC 客户端，不执行 SDK 级 `outputSchema` 校验；若后续接入 `@modelcontextprotocol/sdk`，仍需留意该风险点。

## 4. 身份解析

- 首次尝试**不带** `desired_output_fields` 即成功（虽然 Schema 将其标为必填），请求耗时约 1.47 秒；
- 成功获得唯一 PUUID（未在终端、日志、报告中输出，原始响应仅保存在操作系统临时目录并已删除）；
- 无需回退 `region: "na1"`。

## 5. 三次调用汇总

每轮统计（字段与任务模板一致）：

| 轮次 | rawArrayLength | detectedMatchObjects | uniqueMatchCount | duplicateCount | completeMatchCount | newestMatchTime | oldestMatchTime | payloadKB | matchArrayPath |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 3 | 3 | 3 | 0 | 3 | 2026-07-17T10:41:07.535Z | 2026-07-15T15:58:54.206Z | 24.69 | `items.data` |
| 2 | 3 | 3 | 3 | 0 | 3 | 2026-07-17T10:41:07.535Z | 2026-07-15T15:58:54.206Z | 24.69 | `items.data` |
| 3 | 3 | 3 | 3 | 0 | 3 | 2026-07-17T10:41:07.535Z | 2026-07-15T15:58:54.206Z | 24.69 | `items.data` |

单轮原始 Payload 约 **24.69 KB**，三轮合计约 **74.07 KB**。

工具实际名称：`tft_get_play_style`；请求耗时：988 ms / 754 ms / 589 ms；未出现限流、未出现响应截断、无解析警告。响应无缓存相关 HTTP 头（`x-cache` / `cf-cache-status` / `age` 均无），**是否命中缓存无法判定**。

## 6. 稳定性比较

```json
{
  "observedMinimum": 3,
  "observedMaximum": 3,
  "completeMinimum": 3,
  "completeMaximum": 3,
  "stableCounts": true,
  "sameMatchIdSets": true,
  "paginationDetected": false
}
```

- 三次 Match ID 集合与顺序完全一致：`NA1_5603228956`、`NA1_5603212379`、`NA1_5602018874`；
- 未出现随机截断、未出现新增对局；
- 排序稳定（新→旧，均为最新对局在前）。

## 7. 对局识别与字段完整度

响应包装路径：MCP `result.content[0].text` 为 JSON 字符串，对局数组位于 `items.data`（`play_style_comments` 与 `action` 是评论模板与生成任务，不是对局数据）。每场对局对象同时包含 `metadata`、`info`、`summary` 三个子对象。

每场均具有稳定 Match ID（`NA1_*`），无需使用时间+名次+等级+棋子的组合去重键；**不存在“没有稳定 Match ID”的可靠性问题**。

逐场字段情况（仅对局 ID 与字段计数，不含任何其他玩家身份信息）：

| Match ID | placement | level | traits | units | unit items | gameDatetime | goldLeft | lastRound | playersEliminated | augments | companion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NA1_5603228956 | 8 | 8 | 12 个 | 8 个 | 8/8 有 itemNames | 2026-07-17T10:41:07.535Z | 0 | 27 | 0 | 缺失（null） | 有 |
| NA1_5603212379 | 7 | 8 | 11 个 | 7 个 | 7/7 有 itemNames | 2026-07-17T09:22:24.126Z | 0 | 27 | 0 | 缺失（null） | 有 |
| NA1_5602018874 | 1 | 9 | 11 个 | 11 个 | 11/11 有 itemNames | 2026-07-15T15:58:54.206Z | 2 | 34 | 3 | 缺失（null） | 有 |

复盘必需字段（placement、level、traits、units、unit items）三次共 9 场次全部完整；可选字段中 `augments` 字段槽位存在但值恒为 `null`，属于 OP.GG 侧数据缺口，复盘中如需增强符文信息需另取数据源。

最老对局距今约 **16.5 天**（2026-07-15T15:58:54Z → 2026-08-01）。

## 8. count / 分页能力

- 是否支持 `count`：**否**（Schema 未声明，未猜测传入未声明字段）；
- 是否支持 `limit`：**否**；
- 是否支持分页（offset/page/cursor/before/after/start）：**否**；
- 响应中是否存在 `hasMore` / `nextCursor`：**否**；
- 20 场测试：**未执行**（任务要求仅在 Schema 声明支持时才测试）。

## 9. 错误与兼容性问题

1. `lol_get_summoner_profile` 返回**非 JSON 的 Python repr 文本**（形如 `LolGetSummonerProfile(Data(Summoner("...","chencc","1215")))`），而非 `structuredContent` 或 JSON 字符串；接入适配器需要兼容该格式（可用引号内长 token 提取 PUUID）。
2. `desired_output_fields` 在 Schema 中标为必填，但服务端实际接受省略该参数的调用，且返回内容与带过滤字段时一致（仅含 puuid/game_name/tagline）。
3. `tft_get_play_style` 的 `augments` 字段槽位存在但恒为 `null`。
4. 两个工具的 `outputSchema` 均为 null；本次原始客户端未触发 SDK 校验失败。若使用 MCP SDK 且其他工具的 outputSchema 非法，可能整体校验失败，届时需按任务约定记录兼容性问题并改用已知工具名直接调用，不应在代码中永久关闭 Schema 校验。
5. 响应无缓存头，缓存命中与否无法观测；三次返回完全一致，不能排除服务端缓存的可能。

## 10. 最终判断

```json
{
  "suitableFor10MatchReview": false,
  "suitableFor20MatchReview": false,
  "suitableForIncrementalCollection": false,
  "recommendedRole": "play_style_preview_auxiliary"
}
```

判定依据：

- 稳定返回 **3 场**（< 5 场），`completeMinimum = 3`；
- 按任务标准，“少于 5 场”只适合作为玩法风格预览或辅助数据源，不适合作为正式复盘主数据源；
- Match ID 稳定且字段完整，若未来 OP.GG 增加 count/分页参数或提高单次返回数量，本地增量累计才具备可操作性；当前 3 场/次不足以支撑 10 场复盘所需的最低积累频率，故 `suitableForIncrementalCollection` 判为 `false`。

## 11. 隐私清理

- 原始响应（`profile.json`、`play-style-run-1/2/3.json`、`call-arguments.json`）仅写入 `%TEMP%\opgg-play-style-probe\`，任务完成后已全部删除；
- 项目内未提交、未写入任何真实 PUUID；本报告不含其他玩家 Riot ID；
- 仓库历史遗留的 `.cache\opgg-*-probe` 原始探测产物（同样含测试账号原始响应）已一并删除，`.cache` 本身在 `.gitignore` 中，未进入 Git 追踪。

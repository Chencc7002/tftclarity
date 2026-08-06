# OP.GG MCP `tft_get_play_style` 单次返回容量探测报告（Broseph#LAB / NA）

## 1. 结论摘要

`tft_get_play_style` 对 Broseph#LAB 连续三次调用均稳定返回 **3 场唯一对局**，三次 Match ID 集合与排序完全一致；其中每轮 **2 场**满足复盘必需字段（placement / level / traits / units / unit items），另 1 场为第 1 回合即被淘汰的对局，OP.GG 未返回棋子与羁绊数据。

工具 Schema 与上次探测一致：只声明 `region` 与 `puuid`，**不声明任何 count / 分页字段**。单次固定 3 场、少于 5 场，按任务判定标准只适合作为**玩法风格预览或辅助数据源**，不适合作为正式复盘主数据源。

## 2. 测试信息

| 项目 | 值 |
| --- | --- |
| 测试账号 | Broseph#LAB |
| 区服 | NA（`region: "na"`） |
| 测试日期 | 2026-08-01 |
| 端点 | `https://mcp-api.op.gg/mcp`（MCP Streamable HTTP，协议 `2025-06-18`） |
| 调用次数 | `lol_get_summoner_profile` × 1，`tft_get_play_style` × 3 |
| 调用间隔 | 每次 1.5 秒 |
| 客户端 | 复用 `scripts/probe-opgg-tft-play-style.mjs`（原始 JSON-RPC/SSE 客户端，支持命令行指定账号） |

## 3. 工具 Schema

与首次探测完全一致：

### `tft_get_play_style`

- 必填参数：`region`（string）、`puuid`（string）
- 可选参数：无
- 分页/数量相关字段：**无**（`count`、`limit`、`offset`、`page`、`cursor`、`before`、`after`、`start`、`hasMore`、`nextCursor` 均未声明）
- `outputSchema`：null

### `lol_get_summoner_profile`

- 必填参数（按 Schema）：`game_name`、`tag_line`、`region`、`desired_output_fields`（array）
- 可选参数：`lang`（默认 `en_US`）
- `outputSchema`：null

### `tools/list`

- 成功返回 30 个工具，其中 6 个 `tft_*` 工具；
- 未出现因其他工具非法 `outputSchema` 导致 SDK 整体校验失败的问题（本次使用原始 JSON-RPC 客户端，不执行 SDK 级校验）。

## 4. 身份解析

- 首次尝试**不带** `desired_output_fields` 即成功，请求耗时约 1.64 秒；
- 成功获得唯一 PUUID（未在终端、日志、报告中输出，原始响应仅保存在操作系统临时目录并已删除）；
- 无需回退 `region: "na1"`。
- 注意：本次 profile 返回的是完整 Python repr（约 10.52 KB），其中 `summoner_id`/`acct_id`（47 位）排在 `puuid`（78 位）之前；提取时必须选择 **78 位 URL-safe token**，不能取第一个长 token（探测脚本已按此规则修复）。

## 5. 三次调用汇总

| 轮次 | rawArrayLength | detectedMatchObjects | uniqueMatchCount | duplicateCount | completeMatchCount | newestMatchTime | oldestMatchTime | payloadKB | matchArrayPath |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 3 | 3 | 3 | 0 | 2 | 2026-07-28T12:03:47.845Z | 2026-07-18T22:46:18.979Z | 18.80 | `items.data` |
| 2 | 3 | 3 | 3 | 0 | 2 | 2026-07-28T12:03:47.845Z | 2026-07-18T22:46:18.979Z | 18.80 | `items.data` |
| 3 | 3 | 3 | 3 | 0 | 2 | 2026-07-28T12:03:47.845Z | 2026-07-18T22:46:18.979Z | 18.80 | `items.data` |

单轮原始 Payload 约 **18.80 KB**，三轮合计约 **56.40 KB**。

工具实际名称：`tft_get_play_style`；请求耗时：2408 ms / 1125 ms / 765 ms；未出现限流、未出现响应截断、无解析警告。响应无缓存相关 HTTP 头，**是否命中缓存无法判定**。

## 6. 稳定性比较

```json
{
  "observedMinimum": 3,
  "observedMaximum": 3,
  "completeMinimum": 2,
  "completeMaximum": 2,
  "stableCounts": true,
  "sameMatchIdSets": true,
  "paginationDetected": false
}
```

- 三次 Match ID 集合与顺序完全一致：`NA1_5610386840`、`NA1_5610384299`、`NA1_5604142769`；
- 未出现随机截断、未出现新增对局；排序稳定（新→旧）。

## 7. 对局识别与字段完整度

响应包装路径与首次探测相同：`result.content[0].text` 为 JSON 字符串，对局数组位于 `items.data`。每场均具有稳定 Match ID，无需组合去重键。

逐场字段情况（不含任何玩家身份信息）：

| Match ID | placement | level | traits | units | unit items | gameDatetime | goldLeft | lastRound | playersEliminated | augments | companion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NA1_5610386840 | 4 | 9 | 10 个 | 9 个 | 9/9 有 itemNames | 2026-07-28T12:03:47.845Z | 1 | 31 | 1 | 缺失（null） | 有 |
| NA1_5610384299 | 1 | 1 | **0 个（缺失）** | **0 个（缺失）** | **无** | 2026-07-28T11:29:44.796Z | 1 | 1 | 0 | 缺失（null） | 有 |
| NA1_5604142769 | 2 | 9 | 13 个 | 10 个 | 10/10 有 itemNames | 2026-07-18T22:46:18.979Z | 0 | 34 | 1 | 缺失（null） | 有 |

`NA1_5610384299` 为第 1 回合即被淘汰的对局（level 1、lastRound 1），OP.GG 未返回 traits / units / unit items，因此不计入完整对局。该字段缺失是 OP.GG 侧数据问题，不是解析问题。

可选字段中 `augments` 槽位存在但恒为 `null`（与 chencc#1215 探测一致）。最老对局距今约 **13.3 天**（2026-07-18T22:46:18Z → 2026-08-01）。

## 8. count / 分页能力

- 是否支持 `count`：**否**（Schema 未声明，未猜测传入未声明字段）；
- 是否支持 `limit`：**否**；
- 是否支持分页（offset/page/cursor/before/after/start）：**否**；
- 响应中是否存在 `hasMore` / `nextCursor`：**否**；
- 20 场测试：**未执行**（任务要求仅在 Schema 声明支持时才测试）。

## 9. 错误与兼容性问题

1. `lol_get_summoner_profile` 返回**非 JSON 的 Python repr 文本**；本次完整 profile 中 `summoner_id`/`acct_id` 长 token 先于 `puuid` 出现，提取 PUUID 必须按 78 位 URL-safe 特征选择，而不是取第一个长 token。
2. `desired_output_fields` 在 Schema 中标为必填，但服务端实际接受省略该参数的调用。
3. `tft_get_play_style` 的 `augments` 字段槽位存在但恒为 `null`。
4. 极早淘汰局（lastRound ≤ 1）可能返回空的 traits / units，导致该局不可用于复盘，接入时需要按局过滤。
5. 两个工具 `outputSchema` 均为 null；原始客户端未触发 SDK 校验失败。若使用 MCP SDK，仍需留意其他工具非法 outputSchema 可能导致整体校验失败。
6. 响应无缓存头，缓存命中与否无法观测。

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

- 稳定返回 **3 场**（< 5 场），`completeMinimum = 2`；
- 按任务标准，“少于 5 场”只适合作为玩法风格预览或辅助数据源；
- Match ID 稳定且 2/3 对局字段完整，但单次数量不足以支撑 10 场复盘，`suitableForIncrementalCollection` 判为 `false`。

## 11. 隐私清理

- 原始响应（`profile.json`、`play-style-run-1/2/3.json`、`call-arguments.json`）仅写入 `%TEMP%\opgg-play-style-probe\`，任务完成后已全部删除；
- 项目内未写入任何真实 PUUID；本报告不含其他玩家 Riot ID；
- 与首次探测相同，仓库 `.cache` 中不保留任何原始响应。

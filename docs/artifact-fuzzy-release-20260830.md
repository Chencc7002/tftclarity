# 神器范围与模糊别称修复上线记录

## 发布

- 日期：2026-08-30。
- 生产代码：`0e4714fb71c6ef0f41b826f0c9c6bb4b78e9d0a2`。
- 前一生产代码：`ece5e13c1bb47c8b481088a83fe8faacaf45cd97`。
- 发布使用独立干净目录 `.cache/artifact-fuzzy-release-20260830`；未提交主工作区其他开发改动。
- 只重建 Web app，无数据库迁移、MCP/worker 更新或 Skills 控制路径变更。
- CI：<https://github.com/Chencc7002/tftclarity/actions/runs/33305251802>，main、integration、Bilibili runtime gate 全部通过。
- 本地发布树：focused 125 通过；main 1152 通过 / 7 跳过；integration 232 通过 / 1 跳过；Agent eval 50/50。

## 修复边界

- 神器/Artifact 才表示 artifact 类别；奥恩单独出现保持英雄语义。
- 保留独占神器榜与“加入神器”混合范围的区别。
- `厄飞流斯`拼写归一到厄斐琉斯。
- 月男、efls 保留模糊确认；肯定答复使用服务端待确认上下文，重新查询当前实体目录并继承原神器范围。
- 历史证据不升级为当前证据；工具 schema、预算、权限、确定性后续动作约束保持不变。

## 生产验收

- `/api/health`、`/api/ready`、`/api/runtime` 均返回 HTTP 200；部署版本与健康容器已核对。
- `查询厄飞流斯的神器`：completed，DA_18_Aphelios，include_artifact，10 件神器。
- `查询月男的神器` → 确认标准名称 → `是的`：completed，10 件神器。
- `查询efls的神器` → 确认标准名称 → `是的`：completed，10 件神器。
- `查询奥恩的装备`：completed，DA_18_Ornn，ordinary_only。
- 对以上三组神器榜逐行校验 category，全部为 artifact。
- BrowserUse 正式页面：实际提交“查询月男的神器”和“是的”，确认标准名提示、神器条件保留、聊天回答及结果区 10 件榜单；后续按钮为厄斐琉斯阵容/视频，无重复推荐出装。
- 本地实测工件：`.cache/artifact-fuzzy-production-report.json`、`.cache/artifact-fuzzy-production-check.mjs`。

## 额度操作（用户明确授权）

初次生产实测遇到 `llm_quota_exceeded`，无工具调用；核查为全站当日 50/50 已耗尽，并非此次发布代码异常。经用户授权只将当日全站计数重置为 0，未重置个人/IP 计数。

随后用户明确要求全站每日额度改为 5000。仅修改生产 `.env.production` 的 `TFT_AGENT_GLOBAL_DAILY_LLM_LIMIT` 从 50 到 5000，并重新创建 Web 容器。容器内读取实际配置确认：

| 范围 | 每日上限 |
| --- | ---: |
| 全站所有用户合计 | 5000 |
| 单用户 | 50 |
| 单 IP | 50 |

生产健康检查通过。日期计数仍遵循现有 UTC 日界，不更改额度制度。

## 回退资料

- 数据库与前版本备份：`/root/tftclarity/backups/artifact-fuzzy-20260830-180056`，SHA256 校验通过。
- app 回退镜像：`tftclarity-artifact-fuzzy-rollback-app:20260830`。
- 额度配置备份：`/root/tftclarity/backups/global-quota-5000-20260830-211603/env.production`，目录 0700、文件 0600；包含生产敏感配置，不提交仓库或输出内容。

## 未纳入本次范围

验收可见结果区摘要仍显示原始 Markdown 标记；个别模型指标解释仍可能将装备称为“阵容”。本次确认的是分类、英雄身份、模糊确认续接及结果完整性，不宣称已解决所有排版和解读问题。

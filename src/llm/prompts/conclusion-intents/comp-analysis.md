# 指定阵容数据分析

当前任务是基于当前统计、可核验历史快照、官方版本公告、自动推导和人工 Profile 分析一个指定阵容。

1. 输出按“结论 → 原因 → 数据依据 → 样本和风险”组织。
2. 当前事实只读取 `metatft_fact`；历史变化只读取 `historical_fact`；版本改动只读取 `official_patch`。
3. `evidenceStatus=unavailable` 时，不得声称阵容变强、变弱、热度变化或解释原因，必须明确证据不足。
4. 官方公告与统计变化同时存在时，也只能说“可能相关”，不得写成确定因果。
5. `automatic_derivation` 和 `manual_comp_profile` 必须明确标为系统推导与人工画像，不能冒充 MetaTFT 或 Riot 事实。
6. 上游缺失的指标保持“不可用”，不得补造数值、段位或 T 级。

# TFTAgent 结论纠错 Prompt

上一版结论未通过服务端校验。请基于完全相同的 Evidence Pack 重新生成完整 JSON，并逐项修正随本消息提供的 `validationFeedback`。

纠错要求：

1. 校验反馈不是新的游戏事实，只用于指出格式、引用、数字、覆盖或分析边界错误。
2. 正确事实仍只能来自 Evidence Pack；不得为了通过校验而编造新值或删除必要风险。
3. 如果反馈指出遗漏候选，必须在合适的 `reasons` 或 `alternatives` 中覆盖对应 `evidenceId`。
4. 如果反馈指出数字不受支持，只能使用反馈列出的允许值或 Evidence Pack 中的原始值。
5. 如果反馈指出低样本、过期、未决或分析越界，必须收窄结论并补充对应风险。
6. 如果反馈指出 `missing_answer_dimension`，必须新增或保留该维度对应的 `reasons`/`alternatives` 条目并绑定合法 Evidence ID；`summary`、`nextAction` 或 `riskNotice` 不能替代结构化维度条目。
7. `addressedDimensions` 必须与 `reasons`/`alternatives` 中实际出现的不同 `dimension` 完全一致；修正其他错误时不得误删仍属必需的维度条目。
8. 必须重新返回完整对象，不能只返回被修改的字段。
9. 仍然只返回严格 JSON，不要解释修改过程。

export function renderGreeting() {
  return "你好！我是 TFT 数据分析与攻略助手。你可以问我当前环境、阵容推荐、英雄出装、装备比较和运营思路。";
}

export function renderCapabilityHelp(registry) {
  const capabilityText = registry.capabilities.join("、");
  const authorityText = registry.authorityRules.join("；");
  return `我当前支持：${capabilityText}。权威规则：${authorityText}。`;
}

export function renderUsageHelp(registry) {
  return [
    "你可以直接这样问：",
    "",
    ...registry.usageExamples.map((example) => `- ${example}`)
  ].join("\n");
}

export function renderOutOfDomain() {
  return "我目前主要提供 TFT 数据查询和攻略分析。你可以问我阵容、装备、环境趋势或运营问题。";
}

const registry = {
  schemaVersion: "tft_capability_registry.v1",
  capabilities: [
    "查询当前版本阵容环境与趋势",
    "查询稳定阵容和阵容排名",
    "查询英雄装备组合",
    "比较不同装备与阵容数据",
    "按段位、时间窗口和版本筛选",
    "结合机制知识和视频攻略解释原因、运营方式与适用条件"
  ],
  authorityRules: [
    "当前最好和当前排名由 MetaTFT 结构化数据决定",
    "视频攻略只提供解释、条件和创作者建议"
  ],
  usageExamples: [
    "当前有哪些稳定阵容？",
    "现在有哪些上升阵容？",
    "霞最好的装备是什么，为什么？",
    "霞已经有羊刀，剩下两件怎么补？",
    "我不想玩赌狗，有什么阵容推荐？",
    "这套阵容怎么过渡？"
  ]
};

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

export const TFT_CAPABILITY_REGISTRY = deepFreeze(registry);

export function getTftCapabilityRegistry() {
  return TFT_CAPABILITY_REGISTRY;
}

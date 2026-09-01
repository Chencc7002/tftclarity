import { SKILL_SCHEMA_VERSION, freezeSkillContract } from "../contracts.js";

// Frozen PR1A definition. Archived PR1C/PR1D experiments keep this identity.
export const UNIT_PLAY_GUIDANCE_SKILL_V1 = Object.freeze({
  schemaVersion: SKILL_SCHEMA_VERSION,
  id: "unit_play_guidance",
  version: "1.0.0",
  description: "Bounded professional coverage for how to play one resolved TFT champion.",
  triggers: Object.freeze({
    domains: Object.freeze(["tft"]),
    actions: Object.freeze(["recommend"]),
    goals: Object.freeze(["recommend_unit_play"]),
    requiredEntityTypes: Object.freeze(["champion"]),
    expectedOutputsAny: Object.freeze(["unit_play_guidance"])
  }),
  exclusions: Object.freeze({ goals: Object.freeze(["unit_build_rankings", "recommend_best_option"]) }),
  dataDependencies: Object.freeze([
    Object.freeze({ id: "official_tft_entity_catalog", requirement: "required" }),
    Object.freeze({ id: "current_unit_build_statistics", requirement: "required" }),
    Object.freeze({ id: "current_composition_statistics", requirement: "optional" }),
    Object.freeze({ id: "current_composition_tactical_details", requirement: "optional" }),
    Object.freeze({ id: "mechanism_knowledge_index", requirement: "optional" })
  ]),
  requiredCapabilities: Object.freeze(["unit_build_statistics"]),
  optionalCapabilities: Object.freeze(["composition_positioning", "composition_augment_references"]),
  allowedTools: Object.freeze(["entity_catalog_query", "unit_builds", "comps_rankings", "composition_tactical_details", "semantic_search"]),
  facets: Object.freeze([
    Object.freeze({ id: "unit_role", requirement: "required" }),
    Object.freeze({ id: "equipment_logic", requirement: "required" }),
    Object.freeze({ id: "composition_context", requirement: "required" }),
    Object.freeze({ id: "positioning", requirement: "required" }),
    Object.freeze({ id: "when_to_play", requirement: "optional" })
  ]),
  evidencePolicy: Object.freeze({
    minimumTierByFacet: Object.freeze({}),
    requireFreshForCurrentClaims: true,
    distinguishFactAdviceInference: true,
    neverTreatAbsenceAsNegativeEvidence: true
  }),
  instructions: Object.freeze([
    "Cover only facets supported by validated Evidence and qualify unavailable facets."
  ]),
  completionPolicy: Object.freeze({
    allowQualifiedIncomplete: true,
    rejectRecoverableMissingRequiredFacets: true,
    neverInventMissingEvidence: true
  })
});

// Preserve the first shadow convergence content for replay and comparison.
export const UNIT_PLAY_GUIDANCE_SKILL_V1_1 = freezeSkillContract({
  ...UNIT_PLAY_GUIDANCE_SKILL_V1,
  version: "1.1.0",
  facets: [
    // entity_catalog_query exposes identity/cost/traits, not a role fact. Only
    // explicit maintained knowledge may support role until a tool contract adds it.
    { id: "unit_role", requirement: "required", dataDependenciesAny: ["mechanism_knowledge_index"] },
    { id: "equipment_logic", requirement: "required", dataDependenciesAny: ["current_unit_build_statistics"] },
    { id: "composition_context", requirement: "required", dataDependenciesAny: ["current_composition_statistics"] },
    { id: "positioning", requirement: "required_if_supported", dataDependenciesAny: ["current_composition_tactical_details"] },
    { id: "when_to_play", requirement: "optional", dataDependenciesAny: ["mechanism_knowledge_index"] }
  ],
  instructions: [
    "Explain validated unit role before recommendations.",
    "Explain equipment logic and composition context from validated Evidence.",
    "Cover positioning only when supported; otherwise qualify it as unsupported.",
    "Never invent when-to-play tempo, opener, augment, or economy requirements.",
    "Separate current fact, source recommendation, mechanism, heuristic, and inference.",
    "Never promote composition membership into a role claim or recommendation into causality.",
    "Historical Evidence is never current; unavailable facets are never fabricated.",
    "Do not add tools, arguments, order, budgets, finish authority, or approval authority."
  ]
});

// User-refined retrieval method. Shadow/offline only until the control gates pass.
// These instructions guide registered ReAct calls; they do not execute a plan or
// grant tool access. Facet/Evidence contracts stay identical to version 1.1.0.
export const UNIT_PLAY_GUIDANCE_SKILL_V1_2 = freezeSkillContract({
  ...UNIT_PLAY_GUIDANCE_SKILL_V1_1,
  version: "1.2.0",
  instructions: [
    "For unit-play guidance, actively retrieve equipment, compositions and positioning through the registered tools before explaining those facets. Do not merely tell the user they could query them.",
    "Use only tools in both toolPolicy.effectiveTools and toolCatalog. Follow each tool's inputSchema and argumentPolicy; never supply server-scoped arguments or invent identifiers.",
    "Existing runtime nextActionAffordance, mandatory follow-ups, clarification, budgets, stop conditions and finish/grounding policies take precedence over this retrieval guidance. Do not schedule extra calls after a required finish or turn this guidance into a second execution plan.",
    "Reuse already validated current-run Evidence for the same champion, season and patch when it supplies the requested facet. Never repeat a satisfied retrieval merely to complete a checklist; historical Bridge Evidence is not current Evidence.",
    "Resolve the user's champion and any user-named items with entity_catalog_query when the runtime requires exact entity grounding. Continue only with its resolved identifiers; request clarification for ambiguity and never guess apiNames.",
    "For equipment, call unit_builds for the resolved champion unless matching current Evidence is already present. Present the returned equipment options and preserve their item combinations, source order and statistics. Do not invent items, rewrite a returned build or rank alternatives yourself.",
    "For compositions, call comps_rankings using its permitted champion filter unless matching current Evidence is already present. Use only returned compositions containing the target champion and preserve their members and source ranking. Do not create a lineup, add a substitute or infer a carry/tank role from membership.",
    "For positioning, call composition_tactical_details for a returned composition using exactly the tacticalDetailQueryPlan supplied by validated comps_rankings Evidence. Follow the tool's resolution prerequisites; never synthesize a missing plan or silently choose an ambiguous composition.",
    "Present the returned formation.units[].boardPosition. Never invent, adjust or optimize board positions yourself. If the formation is partial or unavailable, describe only the verified portion and state its limitation.",
    "Interpret the retrieved recommendations: explain equipment effects, member interactions and source positioning only where validated mechanism or role Evidence supports the explanation. Call semantic_search for missing supporting knowledge only when it is permitted and runtime policy allows another retrieval. Unstructured text, statistics alone and model memory do not establish a causal explanation.",
    "If a required source is unavailable, a lookup fails or a field is missing, disclose the specific gap and retain the verified results. Never replace missing equipment, composition or positioning data with a model-generated recommendation; follow the runtime's recovery policy without unbounded retries.",
    "For when-to-play, give only the general heuristic: consider the champion when the player has the tool-recommended equipment or favorable copies/upgrades. Phrase these as conditions, not assertions about the player's actual items or shop. Do not invent stage, level, reroll, opener, augment or economy requirements, or make a live game-state decision.",
    "Separate current fact, attributed source recommendation, supported interpretation and the general when-to-play heuristic. Cite the actual supporting Evidence, qualify unsupported role/mechanism claims and never promote a recommendation into causality.",
    "Do not add tools, permissions, arbitrary queries, budgets, finish authority or approval authority. This Skill supplies retrieval and interpretation guidance within the existing runtime."
  ]
});

// Same permitted tools and Evidence contracts; refine the presentation method.
export const UNIT_PLAY_GUIDANCE_SKILL_V1_3 = freezeSkillContract({
  ...UNIT_PLAY_GUIDANCE_SKILL_V1_2,
  version: "1.3.0",
  instructions: [
    ...UNIT_PLAY_GUIDANCE_SKILL_V1_2.instructions,
    "Present multiple source-returned compositions as composition cards in source order, with each card containing its own members, statistics, positioning and concise interpretation. Positioning is part of that card, not a separate recommendation replacing the composition list.",
    "For each composition being presented, reuse matching current tactical Evidence or retrieve it through composition_tactical_details using that composition's exact validated tacticalDetailQueryPlan. If the runtime requires a resolved composition before this call, resolve the source-returned identity through comps_rankings first. Do not bypass that prerequisite or guess an ambiguous identity.",
    "Bind every positioning result to its compositionId, clusterId, season and roster. Never attach one composition's formation to another card, including cards with the same champion or similar names. If a card has no validated positioning result, retain the card and explicitly mark its positioning unavailable.",
    "Interpretation is model-written explanation of retrieved facts under this prompt; no separate interpretation tool or knowledge pipeline is required. Use relevant mechanism/detail facts already in validated tool results before requesting more knowledge. Existing runtime-required detail lookups retain their original tool permissions and query plans. Do not add calls merely to populate an explanation section.",
    "For each card, explain only what the retrieved facts support, separating attributed recommendations from interpretation. Keep the returned equipment, members, ranking and positions unchanged. Missing explanatory facts are a limitation, not permission to fill them from model memory."
  ]
});

// Existing official detail tools are now accounted for in the Skill intersection.
// This does not register tools or expand the runtime catalog / argument policy.
export const UNIT_PLAY_GUIDANCE_SKILL_V1_4 = freezeSkillContract({
  ...UNIT_PLAY_GUIDANCE_SKILL_V1_3,
  version: "1.4.0",
  allowedTools: [...UNIT_PLAY_GUIDANCE_SKILL_V1_3.allowedTools, "unit_details", "item_details", "item_details_batch"],
  dataDependencies: [...UNIT_PLAY_GUIDANCE_SKILL_V1_3.dataDependencies,
    { id: "official_unit_details", requirement: "optional" }],
  facets: UNIT_PLAY_GUIDANCE_SKILL_V1_3.facets.map((facet) => facet.id === "unit_role"
    ? { ...facet, dataDependenciesAny: ["official_unit_details", "mechanism_knowledge_index"] } : facet),
  instructions: [
    "任务：解释一个英雄怎么玩。装备、阵容和站位必须来自注册工具，不能凭模型记忆组队、换装、重排或修改格子。解读直接用 Prompt 完成，不需要另一个解读工具或知识管线。",
    "只使用 toolPolicy.effectiveTools 与实际 toolCatalog 的交集，遵守 inputSchema、argumentPolicy、serverScopedKeys、预算、澄清、finish 校验及既有 nextActionAffordance。Skill 不增加任何权限或执行器。每次工具调用都必须输出完整 react-action.v1 对象，包含 schemaVersion、type=call_tool、tool、arguments、purposeCode；不要仅输出工具名和参数，也不要原样输出查询计划对象。",
    "先按运行时要求用 entity_catalog_query 确认英雄身份，再用允许的 unit_details 取得官方定位和技能。官方分类不等于某阵容中的主C或主坦；不要从阵容成员身份猜测定位。复用本轮同英雄同赛季且有效的证据，不重复已完成查询。",
    "用 unit_builds 获取装备，用 comps_rankings 的允许英雄筛选获取候选阵容。保留工具返回的装备组合、阵容成员、排序和统计。必要的 item_details_batch 只按运行时已给出的机制查询计划调用；不要自行扩展物品清单。",
    "重要：comps_rankings 的 resolution.status=unfiltered 表示候选列表，不能直接查询站位。每个候选的 tacticalDetailQueryPlan.resolutionPrerequisite 给出需要先调用的 comps_rankings 参数；先执行这个前置解析，等返回 resolution.status=resolved，才查询该阵容的站位。不要把 plan.status=ready 当成已完成身份解析。",
    "站位参数必须完整复制已 resolved 结果的 tacticalDetailQueryPlan 中 compositionId、clusterId、units、seasonContextId。不要把 display compositionRef.compId 当成 provider compositionId，也不要把 resolutionPrerequisite 当作战术工具参数。没有前置字段时，使用该卡片的精确 compositionRef.compId 作为 comps_rankings 的 mention 解析；歧义或未找到就说明缺口。",
    "逐个处理返回的候选，各卡片绑定自己的 compositionId、clusterId、赛季与成员集合。用 formation.units[].boardPosition 展示对应站位。partial 只展示已知格子；缺失或预算耗尽则保留阵容卡片并明确说该卡片暂无可验证站位。不反复重试被拒绝的相同动作。",
    "回答先解释有依据的英雄定位，再说明装备；逐卡简短解读阵容和它自己的站位。解释只依据已验证的机制、属性和来源事实，区分来源推荐和模型推论，统计相关性不能充当因果。官方效果足够时不要额外检索知识；不够时说明限制，不能编造。",
    "最后给出一般条件：拿到工具推荐的装备，或者来牌多、升星顺时可以考虑玩。写成条件，不能声称已经知道玩家的真实装备或来牌；不扩展到具体阶段、等级、搜牌、强化或经济决策。",
    "最终答案必须保留多个来源候选：引用初始候选列表的 Evidence ID，以及已取得的逐卡站位 Evidence ID；不要只引用最后一次单阵容解析结果而丢掉其他候选。给每张候选至少一句说明；时间不足没查到的那张也保留并说明站位缺失。历史 Bridge 不是本轮当前证据；来源不可用或缺字段时如实说明并保留有效结果。禁止用模型生成的方案填补空缺。"
  ]
});

// The new contract is opt-in to the isolated candidate; production shadow keeps
// its existing definition until that candidate has been reviewed.
export const UNIT_PLAY_GUIDANCE_SKILL_V1_5 = freezeSkillContract({
  ...UNIT_PLAY_GUIDANCE_SKILL_V1_4,
  version: "1.5.0",
  dataDependencies: [...UNIT_PLAY_GUIDANCE_SKILL_V1_4.dataDependencies,
    { id: "official_item_details", requirement: "optional" }],
  facets: UNIT_PLAY_GUIDANCE_SKILL_V1_4.facets.map(facet => facet.id === "equipment_logic"
    ? { ...facet, dataDependenciesAny: ["current_unit_build_statistics", "official_item_details"] } : facet),
  instructions: [
    "任务：简明解释一个已解析英雄怎么玩。装备、阵容、站位全部由注册工具提供，Skill 只指导获取和解读，不自行配装、组队或修改格子。解读用本 Prompt，无需新工具。",
    "仅调用 toolPolicy.effectiveTools 与实际 toolCatalog 的交集，严格遵守 inputSchema、argumentPolicy、serverScopedKeys、现有 nextActionAffordance、批准策略和预算。工具动作必须是完整 react-action.v1：schemaVersion、type=call_tool、tool、arguments、purposeCode；不得扩展权限或工具参数。",
    "按运行时要求先 entity_catalog_query 确认英雄，再 unit_details 查官方定位和技能，unit_builds 取推荐出装，comps_rankings 按英雄筛选候选。复用本轮同英雄、同赛季、有效证据，不重复查。保留工具排序、成员和装备组合。",
    "装备机制：逐一用 item_details 查询 unit_builds 首个主流方案中工具已返回的装备 apiName，一件一次；不猜 ID，不扩展到所有备选装。item_details_batch 只能服从已有确定性机制/竞争计划，无计划就不能批查。官方效果、公式缺失时说明限制；统计高低不能代替装备机制。",
    "官方装备资料以 source.retrieval 的真实下载凭据和服务端当前赛季校验为依据；source.updatedAt 是内容发布时间，不自行刷新任何时间。没有凭据、明确过期、赛季不符或效果缺失的资料不能支持当前机制解读。不要用模型记忆填空。",
    "每个候选先执行 tacticalDetailQueryPlan.resolutionPrerequisite 的 comps_rankings 解析，得到 resolution.status=resolved 后，完整复制该卡片 tacticalDetailQueryPlan 的 compositionId、clusterId、units、seasonContextId 调用 composition_tactical_details。unfiltered/plan ready 不能跳过解析。没有前置字段时按该卡片精确 compositionRef.compId 解析；歧义、失败或预算不足如实说明，不反复重试。",
    "正文目标 350—500 汉字：定位一句；主流装备组合及每件一句机制，机制与技能的联系明确写作解读/可能；每套阵容各一句来源说明和目标英雄的精确行列；最后一句考虑玩的条件。不要抄写统计表、全队成员、全队坐标、备选出装列表或未请求的强化建议，这些由工具卡片呈现。不要给坐标重复附加前中后排解释，避免两种描述冲突。",
    "逐卡用精确来源阵容名作独立标题，例如 **来源阵容名**：来源站位中目标英雄在第X排第Y列，其余见本卡棋盘。X/Y 必须取该卡 formation.units[].boardPosition，身份、cluster、赛季和成员集合不能串用；无有效站位就写暂无可验证站位。保留并引用初始候选列表及每份取得的站位证据，而不是只引用最后一套。",
    "最终引用英雄详情、装备统计、实际用于解读的当前装备详情、候选阵容和站位 Evidence ID。发现错误时只修正错误句，不另加新断言。历史 Bridge 不是当前证据。结束条件仅写：拿到来源推荐装备，或者该英雄来牌多、升星顺时可以考虑玩；不假设知道真实对局，不扩展阶段、等级、搜牌、经济或转型决策。"
  ]
});

// Keep the tested 1.5.0 content immutable; this instruction-only iteration
// emphasizes prerequisites that the live model previously skipped.
export const UNIT_PLAY_GUIDANCE_SKILL_V1_5_1 = freezeSkillContract({
  ...UNIT_PLAY_GUIDANCE_SKILL_V1_5,
  version: "1.5.1",
  instructions: UNIT_PLAY_GUIDANCE_SKILL_V1_5.instructions.flatMap((instruction, index) => {
    if (index === 3) return ["装备机制：本玩法查的是 unit_builds，不是 unit_builds_batch，因此没有批量机制选择计划。接下来逐件调用 item_details，apiName 原样取主流方案的三件装备，每件一次。不调用 item_details_batch，不为凑计划改查 unit_builds_batch；已有运行时强制 nextActionAffordance 仍优先。官方效果或公式缺失时说明限制，不用统计或记忆代替机制。"];
    if (index === 5) return [UNIT_PLAY_GUIDANCE_SKILL_V1_4.instructions[4], UNIT_PLAY_GUIDANCE_SKILL_V1_4.instructions[5]];
    if (index === 6) return ["最终正文 250—350 汉字：定位一句；主流装备组合及每件一句机制，和技能的联系注明解读/可能；每套阵容独立标题下各写目标英雄的精确行列；最后一句考虑玩的条件。统计、全队成员、全队坐标和备选出装都在工具卡片，无需抄写。不讲未请求的强化符文，不给坐标重复附加前中后排描述。"];
    return [instruction];
  })
});

export const UNIT_PLAY_GUIDANCE_SKILL_V1_5_2 = freezeSkillContract({
  ...UNIT_PLAY_GUIDANCE_SKILL_V1_5_1,
  version: "1.5.2",
  instructions: [...UNIT_PLAY_GUIDANCE_SKILL_V1_5_1.instructions,
    "完成动作使用 react-action.v1，type=finish，reasonCode=sufficient_evidence，解读放 answer，真实引用放 evidenceIds，narrative 设为 null。本任务不是装备方案对比，不生成 narrative.options、mechanismDifference 或 suitableWhen；这些有独立证据契约，不能编造 optionId 或 evidenceRefs。工具卡片照常展示，正文只写简短解读。"]
});

// Answer-contract diagnostic only. Preserve the archived 1.5.2 prompt and every
// retrieval/runtime contract; improved prose is still subject to answer review.
export const UNIT_PLAY_GUIDANCE_SKILL_V1_5_3 = freezeSkillContract({
  ...UNIT_PLAY_GUIDANCE_SKILL_V1_5_2,
  version: "1.5.3",
  instructions: [
    ...UNIT_PLAY_GUIDANCE_SKILL_V1_5_2.instructions.slice(0, -1).map((instruction, index) => {
      if (index === 7) return "正文约300—420汉字，准确优先于字数：官方定位一句；来源主流装备组合及每件一句机制；每套阵容独立标题下写目标英雄精确行列；最后写考虑玩的条件。统计、全队成员和坐标、备选出装由卡片展示，不重复抄写。坐标不再附加前中后排解释；用户未问强化时不写强化建议或强化缺失提示。";
      if (index === 9) return "引用英雄详情、装备统计、用于解读的当前装备详情、初始候选列表和各卡站位 Evidence ID；历史 Bridge 不作当前证据。结尾完整保留两个可选条件：拿到来源推荐装备，或者该英雄来牌多、升星顺时可以考虑玩。不要漏掉其中一个，不声称已知玩家当前装备或来牌，不延伸阶段、等级、搜牌、经济或转型决策。没有有效推荐装备时不要暗示已有推荐，只说明装备条件暂无法核实。";
      return instruction;
    }),
    "装备解释先拆清来源中的常驻属性、触发条件和触发效果，再简述：常驻攻击力不能写成低血量触发时才增加；叠满层才生效不能缩成叠层后生效。保留你所描述效果的阈值、持续/衰减和作用对象，不能把不同条件合并或把条件删除。可省略整项次要效果，不能改变留下效果的成立条件。与英雄技能的联系另写‘解读：可能…’，只作有依据的推论，不写‘收益明显’‘必然更强’等未经验证结论。",
    "结束动作遵循现有运行时：react-action.v1、type=finish、answer、evidenceIds、narrative=null；不要生成装备对比的 narrative.options、mechanismDifference 或 suitableWhen。reasonCode 由实际证据和运行时规则决定，不固定为 sufficient_evidence。来源失败、过期或部分缺失时保留有效结果、明确缺口；无法支持请求时按既有规则用 insufficient_evidence，不用 direct_answer 或删引用绕过证据要求，也不无界重试。预算终止服从运行时，不伪装完成。"
  ]
});

export const UNIT_PLAY_GUIDANCE_SKILL_V1_5_4 = freezeSkillContract({
  ...UNIT_PLAY_GUIDANCE_SKILL_V1_5_3,
  version: "1.5.4",
  instructions: UNIT_PLAY_GUIDANCE_SKILL_V1_5_3.instructions.map((instruction, index) => {
    if (index === 7) return "正文目标220—300汉字，只保留五部分：英雄官方定位/技能一句；来源主流三件装备；每件装备一句准确机制；每个来源阵容一行‘**阵容名**：英雄第X排第Y列，其余见本卡棋盘’；最后一句两个可玩条件。卡片已经展示星级、段位、样本、胜率、成员、羁绊和完整棋盘，正文不得重复，也不附加前中后排标签、队友站位、阵容打法、备选装或强化。准确条件优先于字数。";
    if (index === 10) return "装备解释逐件压成一句，但先核对常驻属性、触发条件和触发效果：保留所写效果的阈值、持续/衰减、叠满要求和作用对象。常驻属性不能写入低生命触发；叠满生效不能写成叠层后生效。若没有必要且有证据的技能联系，就不要增加推论；确需联系时单独写‘解读：可能…’，不能写收益幅度或必然结论。";
    return instruction;
  })
});

// Keep composition and positioning presentation in the source-backed cards.
// This narrows model prose and duplicate identity lookups without changing any
// runtime, Evidence, tool, permission or completion authority.
export const UNIT_PLAY_GUIDANCE_SKILL_V1_5_5 = freezeSkillContract({
  ...UNIT_PLAY_GUIDANCE_SKILL_V1_5_4,
  version: "1.5.5",
  allowedTools: UNIT_PLAY_GUIDANCE_SKILL_V1_5_4.allowedTools.filter((tool) => tool !== "semantic_search"),
  instructions: UNIT_PLAY_GUIDANCE_SKILL_V1_5_4.instructions.map((instruction, index) => {
    if (index === 2) return "本 Skill 只在 TaskFrame 已有唯一 resolved champion 时选择；直接复用该 resolvedId 调 unit_details、unit_builds 和 comps_rankings。不要为了重复确认同一身份调用 entity_catalog_query；仅当既有运行时明确标记身份未解析、歧义或强制该动作时才调用。unit_details 提供官方定位/技能，装备和阵容仍由各自工具获取。";
    if (index === 7) return "正文目标130—220汉字，只写三部分：英雄官方定位/技能一句；来源主流三件装备及各自准确机制；最后一句两个可玩条件。阵容名、成员、羁绊、统计和站位全部由来源卡片展示，正文不得复述或解释，不写坐标、前中后排、阵容打法、备选装、强化或额外推论。";
    if (index === 8) return "卡片获取仍须完整：初始 comps_rankings 返回几个候选，就逐个执行各自 resolutionPrerequisite，再用 resolved tacticalDetailQueryPlan 调 composition_tactical_details。每份战术 Evidence 必须与自己的 compositionId、clusterId、赛季和成员集合绑定。最终引用初始候选和每张已取得的战术 Evidence，让界面生成多个各带自身棋盘的阵容卡片；正文不要写阵容或站位。所有候选都有结果后才可用 sufficient_evidence 结束；预算不足则保留候选卡并让卡片标记站位缺失。";
    return instruction;
  })
});

// Preserve 1.5.5 diagnostics and make the initial candidate query unambiguous:
// champion ids belong in the unit filter; mention is reserved for exact comp
// resolution. Tool schemas and server validation remain authoritative.
export const UNIT_PLAY_GUIDANCE_SKILL_V1_5_6 = freezeSkillContract({
  ...UNIT_PLAY_GUIDANCE_SKILL_V1_5_5,
  version: "1.5.6",
  instructions: UNIT_PLAY_GUIDANCE_SKILL_V1_5_5.instructions.map((instruction, index) => {
    if (index === 2) return "本 Skill 只在 TaskFrame 已有唯一 resolved champion 时选择。直接复用 resolvedId：unit_details.apiName=resolvedId，unit_builds.unit=resolvedId，初始 comps_rankings.unit=resolvedId。不要把英雄中文名或 resolvedId 放进 comps_rankings.mention，也不要用中文名调用 unit_builds；mention 仅用于随后按候选自己的精确 compositionRef.compId 执行 resolutionPrerequisite。只有运行时明确标记身份未解析、歧义或强制时才调用 entity_catalog_query。";
    if (index === 8) return "卡片获取仍须完整：先以 comps_rankings.unit=resolvedId 取得 unfiltered 候选，返回几个候选就逐个执行各自 resolutionPrerequisite；随后只用 resolved tacticalDetailQueryPlan 调 composition_tactical_details。每份战术 Evidence 必须与自己的 compositionId、clusterId、赛季和成员集合绑定。最终引用初始候选和每张战术 Evidence，让界面生成多个各带自身棋盘的阵容卡片；正文不要写阵容或站位。所有候选都有结果后才可用 sufficient_evidence 结束；预算不足则保留候选卡并让卡片标记站位缺失。";
    return instruction;
  })
});

// Use only a server-produced plan to batch the leading build's official item
// details. The Skill cannot choose or alter items and retains individual detail
// lookup as the fail-closed fallback when no plan exists.
export const UNIT_PLAY_GUIDANCE_SKILL_V1_5_7 = freezeSkillContract({
  ...UNIT_PLAY_GUIDANCE_SKILL_V1_5_6,
  version: "1.5.7",
  dataDependencies: [...UNIT_PLAY_GUIDANCE_SKILL_V1_5_6.dataDependencies,
    { id: "official_item_details_batch", requirement: "optional" }],
  facets: UNIT_PLAY_GUIDANCE_SKILL_V1_5_6.facets.map((facet) => facet.id === "equipment_logic"
    ? { ...facet, dataDependenciesAny: [...facet.dataDependenciesAny, "official_item_details_batch"] }
    : facet),
  instructions: UNIT_PLAY_GUIDANCE_SKILL_V1_5_6.instructions.map((instruction, index) => {
    if (index === 3) return "装备机制：unit_builds 若返回 mechanismQueryPlan.status=available，只调用一次 item_details_batch；apiNames 顺序和 seasonContextId 必须完整复制该计划，不能增删、改序或自行选装，也不要再逐件调用 item_details。若没有有效计划，才按首个来源方案的 apiName 逐件调用 item_details。批量或逐件官方效果缺失时说明限制，不用统计或记忆代替机制。";
    if (index === 9) return "最终引用英雄详情、装备统计、实际用于解读的 item_details_batch 或 item_details、初始候选和每张战术 Evidence ID。历史 Bridge 不作当前证据。结尾完整保留两个可选条件：拿到来源推荐装备，或者该英雄来牌多、升星顺时可以考虑玩；不声称已知玩家状态，不延伸阶段、等级、搜牌、经济或转型决策。";
    return instruction;
  })
});

// Completion-reliability candidate derived from bounded Provider action traces.
// It changes no facts, tools or permissions: the initial server-returned card
// set remains authoritative and retrieval stops once that finite set is done.
export const UNIT_PLAY_GUIDANCE_SKILL_V1_5_8 = freezeSkillContract({
  ...UNIT_PLAY_GUIDANCE_SKILL_V1_5_7,
  version: "1.5.8",
  instructions: UNIT_PLAY_GUIDANCE_SKILL_V1_5_7.instructions.map((instruction, index) => {
    if (index === 8) return "卡片获取使用本轮第一次 comps_rankings.unit=resolvedId 返回的固定候选集合，不刷新、不扩展，也不寻找第三张卡。按来源顺序给每个候选执行一次自己的 resolutionPrerequisite，再用该 resolved 结果的 tacticalDetailQueryPlan 调一次 composition_tactical_details；partial、unavailable 或失败都算该候选已处理，不重复同一阵容或战术查询。固定集合全部处理后，证据获取立即结束：引用初始候选和已取得的各卡战术 Evidence，让界面生成多个各带自身棋盘的阵容卡片，正文不写阵容或站位。";
    return instruction;
  }).concat(
    "固定候选集合处理完后，下一动作必须是 react-action.v1 的 finish，不能再调用 comps_rankings、composition_tactical_details 或其他工具。finish 若被运行时拒绝，只按 decision_rejected 给出的格式或引用问题修正 answer、evidenceIds、reasonCode、narrative 后再次 finish；除非拒绝信息明确指出某个尚未执行的固定候选动作，不得用新检索代替答案修正。"
  )
});

export const UNIT_PLAY_GUIDANCE_SKILL = UNIT_PLAY_GUIDANCE_SKILL_V1_3;

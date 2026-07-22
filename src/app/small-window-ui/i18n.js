export const DEFAULT_LOCALE = "zh-CN";
export const LOCALE_STORAGE_KEY = "tftagent.locale";

export const messages = {
  "zh-CN": {
    trendWarming: "趋势数据积累中：已保存当前阵容快照，完整 72 小时后开始计算同口径排名变化。",
    trendWarmingReady: "趋势数据积累中：预计 {value} 后可计算完整 72 小时趋势。",
    trendNoneLocal: "本地 72 小时同口径数据中，暂无平均名次变化的阵容。",
    trendNoneUpstream: "MetaTFT 当前没有返回可展示的阵容升降趋势。",
    trendUnavailable: "当前未获得 MetaTFT 官方趋势，本地趋势历史也暂不可用。",
    trendGateFieldMissing: "MetaTFT 当前响应未返回 results.data.comps，暂不展示官方趋势前三；未使用推算值，本地 72 小时同口径趋势正在积累。",
    trendGateInsufficient: "MetaTFT 当前趋势证据中仅有 {eligible}/{minimum} 个阵容的平均名次变化低于 -0.10，暂不展示趋势前三；未补造缺失数值。",
    trendSourceLocal: "本地 72 小时",
    trendSourceOfficial: "MetaTFT 官方",
    trendSourcePageCalculated: "MetaTFT 页面计算",
    seasonName: "星神", seasonPbePreview: "PBE 预览", seasonSwitch: "赛季", seasonSwitchLabel: "选择赛季", seasonLiveStatus: "正式服", seasonPbeStatus: "PBE", seasonRevivalStatus: "返场", seasonArchivedStatus: "已归档", seasonComingSoonStatus: "即将推出", seasonUnavailableStatus: "不可用", seasonSwitched: "已切换到 {season}", seasonLoadFailed: "赛季列表加载失败", seasonSwitchFailed: "赛季切换失败", patchNotesUnavailable: "当前赛季暂无可用的版本公告。", languageLabel: "语言", settings: "设置",
    wallpaper: "壁纸", wallpaperOn: "开启", wallpaperOff: "关闭", wallpaperEnableTitle: "开启赛季壁纸", wallpaperDisableTitle: "关闭赛季壁纸",
    wallpaperMenuTitle: "选择壁纸", wallpaperMenuHint: "随时切换当前赛季背景", wallpaperEnabled: "显示壁纸", closeWallpaperMenu: "关闭壁纸选择",
    wallpaperChoice: "选择赛季壁纸", wallpaperCosmicCourt: "星神 · 光辉盛典", wallpaperStargazerConvergence: "星神 · 群星汇聚", wallpaperYasuo: "星神 · 亚索", wallpaperSoraka: "星神 · 索拉卡",
    statusReady: "就绪", statusQuerying: "查询中", statusRefreshing: "刷新中", statusLive: "实时",
    statusCache: "本地缓存", statusStale: "过期缓存", statusFailed: "失败", statusStopped: "已停止", statusCleared: "已清空",
    statusSaved: "已保存", statusNotSaved: "偏好未保存", statusUnavailable: "状态不可用", statusRecorded: "反馈已记录",
    conversationEyebrow: "对话", conversationTitle: "战术查询", conversationHint: "保留多轮条件", resultEyebrow: "数据结果", resultTitle: "当前推荐",
    preferencesEyebrow: "偏好与运行", welcome: "直接问我英雄出装、单件装备或阵容排行。你也可以连续追问。",
    quickTasksLabel: "常用查询任务", quickTasksTitle: "常用任务", quickTasksHint: "选择一个入口快速开始",
    quickTaskCompsTitle: "热门阵容", quickTaskCompsBody: "21 套阵容，三种标准切换", quickTaskTrendsTitle: "阵容趋势", quickTaskTrendsBody: "上升、下降与选择率排行",
    quickTaskBuildTitle: "英雄出装", quickTaskBuildBody: "指定英雄后查询三件套", quickTaskUpdatesTitle: "更新公告", quickTaskUpdatesBody: "17.7 版本要点与改动",
    quickTaskCompsPrompt: "推荐当前版本热门阵容", quickTaskTrendsPrompt: "查看当前版本阵容趋势",
    quickTaskBuildTemplate: "查询【英雄名称】的当前版本最稳三件装备", quickTaskBuildSelection: "【英雄名称】",
    compAnalysisTitle: "阵容智能分析", compAnalysisUnknownTarget: "未识别阵容", compAnalysisEvidenceStatus: "证据状态：{value}",
    compAnalysisConclusion: "结论", compAnalysisReasons: "原因", compAnalysisData: "数据依据", compAnalysisRisks: "样本和风险",
    compAnalysisTargetData: "当前阵容数据", compAnalysisSources: "Evidence Pack 来源：{value}",
    patchNotesTitle: "{version} 更新公告", patchNotesHighlights: "版本要点", patchNotesPublished: "发布时间", patchNotesSource: "内容来源", patchNotesOfficialLink: "查看官方原文",
    legalNoticeTitle: "关于与法律", legalNoticeBadge: "独立非商业粉丝项目",
    legalNoticeSummary: "tftclarity 是由玩家独立制作的非商业粉丝项目，与 Riot Games 不存在隶属、合作、赞助或认可关系。",
    legalNoticeAssets: "Riot Games、Teamfight Tactics 及相关角色、图像、名称和游戏资产归 Riot Games 或其权利人所有。",
    riotLegalPolicy: "Riot 法律政策", riotDeveloperPolicy: "开发者政策", legalFooterLabel: "法律声明",
    legalFooterSummary: "独立非商业粉丝项目，与 Riot Games 无关联，也未获得其认可。", legalFooterDetails: "法律声明",
    composerPlaceholder: "输入英雄、装备或阵容问题，Enter 发送…", retry: "重试", retryTitle: "重试上一条", stop: "停止", stopTitle: "停止查询",
    refresh: "刷新", refreshTitle: "刷新数据", clear: "清空", clearTitle: "清空会话", send: "发送", sendTitle: "发送查询",
    resultEmptyTitle: "等待你的查询", resultEmptyBody: "推荐、单件排行和阵容榜会显示在这里。", closeSettings: "关闭设置",
    advancedDefaults: "高级查询默认值", queryConditions: "查询条件", sampleThreshold: "样本阈值", noThreshold: "无下限", itemScope: "装备范围", ordinary: "普通",
    radiant: "光明", artifact: "神器", radiantCategoryName: "光明装备", artifactCategoryName: "神器", emblem: "纹章", special: "特殊", sort: "排序", sortTop4: "前四优先", sortWin: "吃鸡优先", sortRobust: "普适稳健",
    days: "统计天数", autoComp: "自动 Comp", stableMostSamples: "稳定样本最多", parser: "结构化解析", conclusionGeneration: "结论增强", inherit: "继承", automatic: "自动", on: "开启",
    off: "关闭", always: "始终", ranks: "段位", rankChallenger: "王者", rankGrandmaster: "宗师", rankMaster: "大师", rankDiamond: "钻石",
    rankEmerald: "翡翠", rankPlatinum: "铂金", rankGold: "黄金", rankSilver: "白银", rankBronze: "青铜", rankIron: "黑铁", runtimeStatus: "数据与运行状态", cache: "缓存",
    aliasReview: "别名审核（高级）", aliases: "别名", export: "导出", download: "下载", clearCandidates: "清候选", aliasState: "别名状态",
    aliasType: "别名类型", all: "全部", candidate: "候选", enabled: "已启用", allTypes: "全部类型", hero: "英雄", item: "装备", trait: "羁绊",
    searchAliases: "搜别名/API", selectAll: "全选", enableSelected: "启用选中", disableSelected: "停用选中", noCandidates: "无候选",
    previous: "上一页", next: "下一页", internalResponse: "内部响应", clearHistory: "清历史", reset: "重置", done: "完成", disable: "停用",
    nativeResize: "拖动窗口边缘调整大小（由桌面壳提供）", resizeColumns: "调整对话与结果列宽", you: "你", assistant: "tftclarity",
    understand: "理解条件", fetchData: "查询数据", calculate: "计算排名", stoppedBody: "已停止本次查询。", enterQuery: "请输入查询内容", enterChampion: "请先输入要查询的英雄名称",
    starLevel: "{value}星", targetStarLevel: "目标追到 {value} 星", completedItems: "{value}件完整出装", editCondition: "修改{value}：", noTraits: "未补羁绊", notices: "提示：{count} 条",
    excludedSummary: "已排除：{value}", unrestrictedCompLine: "Comp：未限制", noStableCompLine: "Comp：未限制 · 当前条件下没有稳定 Comp",
    explicitCompLine: "Comp：{name} · 用户指定", automaticCompLine: "Comp：{name} · 系统补全，样本 {samples}", sessionClearFailed: "本地会话已清空，服务端会话清理失败",
    queryFailed: "查询失败", resultDetails: "在结果区查看详情", recommendation: "推荐结果", itemRanking: "单件装备排行", compRanking: "阵容排行",
    clarification: "需要澄清", noResult: "暂无结果", error: "查询错误", loadingResult: "正在准备结果", best: "最佳", bestRecommendation: "最佳推荐",
    alternatives: "备选方案", lowSample: "低样本参考", top4: "前四率", win: "吃鸡率", avg: "平均名次", samples: "样本数", unavailable: "不可用",
    carried: "已携带", none: "无", frequentCore: "高频核心", coreFrequencyRule: "{count} 套展示方案中至少出现 {required} 套（≥2/3）", relativeRecommendation: "相对推荐",
    chatCoreTitle: "核心结论", chatCoreScope: "仅基于本次展示组合", chatCoreWithItems: "本次展示 {count} 套装备组合，{items} 均至少出现在 {required} 套中，达到 2/3 频率阈值，因此判断为 {unit} 的当前核心装备倾向。", chatCoreWithoutItems: "本次展示 {count} 套装备组合，没有装备至少出现在 {required} 套中，因此暂不判断 {unit} 存在固定核心装备。", chatSpecialRankingScope: "特殊装备按平均名次排序", chatSpecialRankingWithItems: "本次查询返回 {count} 件具备有效样本的{category}：{items}。清洗低于同类最高样本 2% 的离群项后，{best}的平均名次最低（{avg}），因此位列第一。", chatSpecialRankingEmpty: "本次条件下没有可进入正式排行的{category}样本。", chatFurtherInterpretation: "进一步数据解读",
    applicabilityRecommendation: "普适推荐", applicabilityScore: "普适评分", applicabilityScoreValue: "稳健分 {score}", sampleCoverageValue: "样本覆盖 {value}%", applicabilityMethodShort: "已校正小样本波动；表现接近时优先更高样本覆盖",
    replace: "替换", sameItems: "装备相同", helpful: "有帮助", notHelpful: "没帮助", recorded: "已记录", saveFailed: "保存失败",
    feedbackReasonPrompt: "哪里需要改进？", feedbackReasonSkip: "不选择原因", feedbackReasonSend: "提交",
    feedbackReasonEntityParse: "识别错了英雄或装备", feedbackReasonCompContext: "阵容上下文不对", feedbackReasonItems: "装备推荐不合适",
    feedbackReasonOutdated: "数据已过时", feedbackReasonLowSample: "样本太少", feedbackReasonUnclear: "回答不清楚",
    feedbackReasonIncorrect: "解读不正确", feedbackReasonMissing: "缺少关键信息", feedbackReasonOther: "其他",
    conditions: "查询条件", conditionSources: "条件来源", sourceCurrent: "本次输入", sourceConversation: "会话继承", sourcePreference: "用户偏好",
    sourceDefault: "系统默认", source: "数据来源", endpoint: "endpoint", updated: "更新时间", risk: "风险提示", updateUnavailable: "更新时间不可用",
    live: "实时", staleCache: "过期缓存", localCache: "本地缓存", coverage: "覆盖", commonPairings: "常见搭配", duplicateItems: "重复件",
    methodology: "统计口径", currentCompRanking: "当前版本阵容榜", currentCompTrends: "当前版本阵容趋势", allRanks: "全部段位", rank: "段位", games: "场", lowSampleSection: "低样本参考（不进入排名）",
    top4Highest: "前四率最高", winHighest: "登顶率最高", winShareHighest: "吃鸡份额最高", avgBest: "平均名次最好", mostPopular: "最热门", top4Short: "前四", winShort: "登顶", winShareShort: "吃鸡份额", avgShort: "均名", appearanceShort: "登场率",
    improvingComps: "近 3 天新兴强阵容", risingComps: "上升阵容 · Top 5", fallingComps: "下降阵容 · Top 5", selectionRateTop: "选择率最高 · Top 10",
    avgPlacementImproved: "平均名次提升 {value}", avgPlacementDeclined: "平均名次下降 {value}", emergingScore: "新兴强度", emergingFormula: "排序：平均名次提升 × √登场率",
    risingFormula: "按近 3 天平均名次提升幅度排序", fallingFormula: "按近 3 天平均名次下降幅度排序", trendWindow: "近 3 天平均名次变化",
    selectionRate: "选择率", contested: "卷", rankingStandard: "排序标准", popularCompSample: "展示最多 {value} 套阵容；当前仅按一个标准排序",
    preferenceSearchTitle: "自然语言阵容筛选", preferenceStatusOk: "条件匹配完成", preferenceStatusLowSample: "仅有低样本证据", preferenceStatusProfile: "缺少人工 Profile", preferenceStatusEvidence: "证据不足", preferenceStatusZero: "没有匹配结果",
    preferenceStrategy: "玩法：{value}", preferenceGoal: "目标：{value}", preferenceContested: "卷度：{value}", preferenceDifficulty: "难度：{value}", preferenceCount: "数量：{value}", preferenceNoReroll: "排除赌狗", preferenceBeginner: "适合新手", preferenceExperienced: "非新手向",
    preferenceReroll: "赌狗", preferenceFast8: "速八", preferenceFast9: "九五", preferenceTop4: "稳定前四", preferenceTop1: "吃鸡上限", preferenceBalanced: "综合均衡", preferenceLow: "低", preferenceMedium: "中", preferenceHigh: "高",
    preferenceReturned: "返回 {returned}/{requested} 套", deterministicRanking: "由确定性代码筛选与排序",
    queryCompUnit: "查询 {comp} 阵容中的 {star} 星 {unit}", compUnitQueryDisplay: "查询 {comp} 阵容中的 {star} 星 {unit} 出装（样本≥{samples}）",
    resultNavigation: "查询结果导航", backToComp: "返回阵容：{name}", compResultPreserved: "阵容结果已保留，可继续查询其他棋子",
    statusReturnedToComp: "已返回阵容：{name}",
    noCompData: "没有可用的阵容数据", externalRisk: "外部数据仅供参考", query: "查询", saveCandidate: "存候选", itemUnavailable: "暂无",
    userSpecified: "用户指定", previousRound: "沿用上轮", preference: "偏好", compFilled: "系统补全", systemDefault: "系统默认", unknown: "未知",
    ordinaryItems: "普通装备", radiantItems: "含光明装备", artifactItems: "含神器", specialItems: "含特殊装备", daysRecent: "近{value}天",
    samplesAtLeast: "样本≥{value}", carriedItems: "已携带 {value}", excludedItems: "排除 {value}", traits: "羁绊 {value}", noStableComp: "未限制 Comp · 当前条件下没有稳定 Comp",
    unrestrictedComp: "未限制 Comp", compSamples: "{name} · 样本 {samples}", sourceLabel: "来源", compCandidates: "Comp 候选", unknownEndpoint: "未知端点",
    cacheJson: "JSON", cacheSqlite: "SQLite", cacheMemory: "内存", persistence: "持久化", persistenceUnset: "持久化未定", timeout: "查询超时 {seconds}s",
    keyConfigured: "已设密钥", rulesFirst: "规则优先", disabled: "关闭", aiQuotaEmpty: "AI 今日已用完", aiQuotaRemaining: "AI {remaining}/{limit}", aliasDisabled: "已停用", aliasLoadFailed: "别名加载失败", aliasUpdateFailed: "别名更新失败",
    batchUpdateFailed: "批量更新失败", noAliasSelected: "未选择别名", candidateSaved: "已加入候选", candidateKnown: "候选已在字典中", selectAlias: "选择 {alias}",
    candidateClearFailed: "候选记忆清理失败", exportFailed: "导出失败", candidateSaveFailed: "候选保存失败", feedbackUnavailable: "当前结果不可反馈",
    feedbackSaveFailed: "反馈保存失败", clearFailed: "清理失败", resetFailed: "重置失败",
    aliasesUpdated: "已更新 {count} 条", candidatesCleared: "已清候选 {count} 条 / 反馈 {feedback} 条", feedback: "反馈", exported: "已导出", downloaded: "已下载", resetDone: "已重置",
    confirmClearCandidates: "清空未启用候选别名和反馈记录？已启用别名会保留。", confirmClearHistory: "清理查询历史与缓存？", confirmReset: "恢复全部默认设置？",
    lockedSummary: "已锁定：{value}", candidateSource: "候选来源：{value}", notCraftable: "不可合成", missingOfficialItemDetails: "暂无官方装备说明。", itemDetails: "装备详情",
    recipeRoute: "合成路线", effectAndStats: "效果与属性", metricTop4Rate: "前四率", metricWinRate: "吃鸡率", metricAvgPlacement: "平均名次", metricSamples: "样本",
    unitDetails: "棋子详情", unitCost: "{value} 费", traitDetails: "羁绊详情", baseStats: "基础属性", ability: "技能", traitTiers: "羁绊档位", stableItemRecommendations: "稳定装备推荐", recommendationScore: "稳定分", recommendationMethod: "综合登场频率、前四率与平均名次；优先保留平均名次不高于 4.5 的装备。", health: "生命值", mana: "法力值", attackDamage: "攻击力", armor: "护甲", magicResist: "魔抗", attackSpeed: "攻速", attackRange: "攻击距离", critChance: "暴击率", startingMana: "初始法力", noStableItems: "暂无足够的稳定装备样本。", traitRace: "种族羁绊", traitJob: "职业羁绊", unitsRequired: "{value} 人",
    reasonInsufficientSample: "样本未达门槛", reasonLowSample: "样本稳定性不足", reasonDifferenceTooSmall: "差距接近", reasonMetricUnavailable: "指标缺失", reasonOverlapTooHigh: "重叠过高", reasonStaleEvidence: "缓存时效不足", reasonInsufficientEvidence: "证据不足",
    comparisonWinner: "当前条件下 {name} 的互斥完整出装样本领先", comparisonNoWinner: "暂不判断胜者：{reason}", comparisonOverlap: "共同出现样本 {games}（{rate}%），未计入胜负", comparisonOverlapZero: "共同出现样本 0", primaryMetric: "主指标：{value}", noStablePairing: "暂无稳定搭配", exclusiveSamples: "互斥样本 {value}", commonFullBuild: "常见完整搭配", comparisonItems: "比较：{value}",
    auditMissingCanonicalName: "缺少中文名", auditUnknownCategory: "未知类别", auditMissingOfficialDetails: "缺少官方详情", auditMissingOfficialEffect: "缺少效果", auditMissingRecipe: "配方不完整", auditUnversionedAvailability: "可用性 override 未绑定版本", auditNameConflict: "官方名与手工名冲突", auditCatalogFallback: "目录使用回退缓存", auditOfficialSourceError: "官方详情源错误",
    auditMeta: "{patch} · 目录 {catalogStatus}/{catalogSource} · 详情 {detailStatus}", auditSummary: "{returned} / {total} 条 · {issues} 条有问题", noImage: "无图", noShortName: "无短名", noHistoricalAliases: "无历史别名", available: "可用", effectStatus: "效果 {value}", recipeStatus: "配方 {value}", auditNameSource: "名称源：{source} · override：{override}", unversioned: "未绑定版本", noAuditOverride: "无", noAuditIssues: "无审计问题", noAuditResults: "当前筛选无结果", auditLoading: "正在转换审核数据…", auditLoadFailed: "装备目录审核加载失败", auditExportFailed: "审核结果导出失败",
    newConversation: "新会话已开始。直接问我英雄出装、单件装备或阵容排行。", waitingQuery: "等待查询", rankCoverage: "{value}%覆盖",
    dataInterpretation: "数据解读", generatedFromEvidence: "由数据生成", templateFallback: "已使用模板回退", nextAction: "下一步", staticEvidence: "可展开的静态证据", explanationHelpful: "解读有帮助", explanationNotHelpful: "解读需改进", cachedConclusion: "结论缓存",
    conclusionStreaming: "AI 正在结合数据生成结论…", backToChat: "返回对话"
  },
  "en-US": {
    trendWarming: "Trend history is warming up. The current comp snapshot has been saved; same-scope changes become available after 72 hours.",
    trendWarmingReady: "Trend history is warming up. A complete 72-hour comparison is expected after {value}.",
    trendNoneLocal: "No comp has an average-placement change in the local same-scope 72-hour data.",
    trendNoneUpstream: "MetaTFT currently has no displayable rising or falling comp trend.",
    trendUnavailable: "MetaTFT did not provide official trends and local trend history is unavailable.",
    trendGateFieldMissing: "MetaTFT did not return results.data.comps. The official top three is hidden; no derived values are substituted while the local same-scope 72-hour history warms up.",
    trendGateInsufficient: "Only {eligible}/{minimum} current MetaTFT trends are below -0.10. The top three is hidden and missing values are not fabricated.",
    trendSourceLocal: "Local 72-hour",
    trendSourceOfficial: "MetaTFT official",
    trendSourcePageCalculated: "MetaTFT page calculation",
    seasonName: "Cosmic", seasonPbePreview: "PBE Preview", seasonSwitch: "Season", seasonSwitchLabel: "Choose season", seasonLiveStatus: "Live", seasonPbeStatus: "PBE", seasonRevivalStatus: "Revival", seasonArchivedStatus: "Archived", seasonComingSoonStatus: "Coming soon", seasonUnavailableStatus: "Unavailable", seasonSwitched: "Switched to {season}", seasonLoadFailed: "Could not load seasons", seasonSwitchFailed: "Could not switch seasons", patchNotesUnavailable: "No patch notes are available for this season.", languageLabel: "Language", settings: "Settings",
    wallpaper: "Wallpaper", wallpaperOn: "On", wallpaperOff: "Off", wallpaperEnableTitle: "Enable season wallpaper", wallpaperDisableTitle: "Disable season wallpaper",
    wallpaperMenuTitle: "Choose wallpaper", wallpaperMenuHint: "Switch the current season background", wallpaperEnabled: "Show wallpaper", closeWallpaperMenu: "Close wallpaper picker",
    wallpaperChoice: "Choose season wallpaper", wallpaperCosmicCourt: "Cosmic · Radiant Court", wallpaperStargazerConvergence: "Cosmic · Stargazer Convergence", wallpaperYasuo: "Cosmic · Yasuo", wallpaperSoraka: "Cosmic · Soraka",
    statusReady: "Ready", statusQuerying: "Querying", statusRefreshing: "Refreshing", statusLive: "Live",
    statusCache: "Local cache", statusStale: "Stale cache", statusFailed: "Failed", statusStopped: "Stopped", statusCleared: "Cleared",
    statusSaved: "Saved", statusNotSaved: "Preferences not saved", statusUnavailable: "Status unavailable", statusRecorded: "Feedback recorded",
    conversationEyebrow: "Conversation", conversationTitle: "Tactical query", conversationHint: "Multi-turn context", resultEyebrow: "Data result", resultTitle: "Current result",
    preferencesEyebrow: "Preferences & runtime", welcome: "Ask about champion builds, item rankings, or comp rankings. Follow-up questions keep the current context.",
    quickTasksLabel: "Common query tasks", quickTasksTitle: "Quick tasks", quickTasksHint: "Choose a shortcut to get started",
    quickTaskCompsTitle: "Popular comps", quickTaskCompsBody: "21 comps, switch among three metrics", quickTaskTrendsTitle: "Comp trends", quickTaskTrendsBody: "Rising, falling, and pick-rate lists",
    quickTaskBuildTitle: "Champion build", quickTaskBuildBody: "Choose a champion, then check items", quickTaskUpdatesTitle: "Release notes", quickTaskUpdatesBody: "Patch 17.7 highlights and changes",
    quickTaskCompsPrompt: "Show popular comps for the current patch", quickTaskTrendsPrompt: "Show comp trends for the current patch",
    quickTaskBuildTemplate: "Show the most stable current build for [champion name]", quickTaskBuildSelection: "[champion name]",
    compAnalysisTitle: "Comp analysis", compAnalysisUnknownTarget: "Unresolved comp", compAnalysisEvidenceStatus: "Evidence status: {value}",
    compAnalysisConclusion: "Conclusion", compAnalysisReasons: "Reasons", compAnalysisData: "Data evidence", compAnalysisRisks: "Samples and risks",
    compAnalysisTargetData: "Current comp data", compAnalysisSources: "Evidence Pack sources: {value}",
    patchNotesTitle: "Patch {version} notes", patchNotesHighlights: "Highlights", patchNotesPublished: "Published", patchNotesSource: "Source", patchNotesOfficialLink: "Read the official notes",
    legalNoticeTitle: "About & legal", legalNoticeBadge: "Independent non-commercial fan project",
    legalNoticeSummary: "tftclarity is an independent, non-commercial fan project and is not affiliated with, sponsored by, or endorsed by Riot Games.",
    legalNoticeAssets: "Riot Games, Teamfight Tactics, and related characters, artwork, names, and game assets belong to Riot Games or their respective rights holders.",
    riotLegalPolicy: "Riot legal policy", riotDeveloperPolicy: "Developer policy", legalFooterLabel: "Legal notice",
    legalFooterSummary: "Independent non-commercial fan project. Not affiliated with or endorsed by Riot Games.", legalFooterDetails: "Legal notice",
    composerPlaceholder: "Ask about a champion, item, or comp. Press Enter to send…", retry: "Retry", retryTitle: "Retry the last query", stop: "Stop", stopTitle: "Stop query",
    refresh: "Refresh", refreshTitle: "Refresh data", clear: "Clear", clearTitle: "Clear conversation", send: "Send", sendTitle: "Send query",
    resultEmptyTitle: "Waiting for your query", resultEmptyBody: "Recommendations, item rankings, and comp rankings appear here.", closeSettings: "Close settings",
    advancedDefaults: "Advanced query defaults", queryConditions: "Query conditions", sampleThreshold: "Sample threshold", noThreshold: "No threshold", itemScope: "Item scope", ordinary: "Normal",
    radiant: "Radiant", artifact: "Artifact", radiantCategoryName: "Radiant items", artifactCategoryName: "Artifacts", emblem: "Emblem", special: "Special", sort: "Sort", sortTop4: "Top 4 first", sortWin: "Win first", sortRobust: "Applicability",
    days: "Days", autoComp: "Auto Comp", stableMostSamples: "Most stable samples", parser: "Structured parsing", conclusionGeneration: "Conclusion enhancement", inherit: "Inherit", automatic: "Auto", on: "On",
    off: "Off", always: "Always", ranks: "Ranks", rankChallenger: "Challenger", rankGrandmaster: "Grandmaster", rankMaster: "Master", rankDiamond: "Diamond",
    rankEmerald: "Emerald", rankPlatinum: "Platinum", rankGold: "Gold", rankSilver: "Silver", rankBronze: "Bronze", rankIron: "Iron", runtimeStatus: "Data & runtime status", cache: "Cache",
    aliasReview: "Alias review (advanced)", aliases: "Aliases", export: "Export", download: "Download", clearCandidates: "Clear drafts", aliasState: "Alias state",
    aliasType: "Alias type", all: "All", candidate: "Candidate", enabled: "Enabled", allTypes: "All types", hero: "Champion", item: "Item", trait: "Trait",
    searchAliases: "Search alias/API", selectAll: "All", enableSelected: "Enable selected", disableSelected: "Disable selected", noCandidates: "No candidates",
    previous: "Previous", next: "Next", internalResponse: "Raw response", clearHistory: "Clear history", reset: "Reset", done: "Done", disable: "Disable",
    nativeResize: "Resize from the window edge (provided by the desktop shell)", resizeColumns: "Resize conversation and result columns", you: "You", assistant: "tftclarity",
    understand: "Understand", fetchData: "Query data", calculate: "Rank results", stoppedBody: "This query was stopped.", enterQuery: "Enter a query", enterChampion: "Enter a champion name first",
    starLevel: "{value}-star", targetStarLevel: "Target {value}-star", completedItems: "{value} completed items", editCondition: "Change {value}: ", noTraits: "No trait constraint", notices: "{count} notices",
    excludedSummary: "Excluded: {value}", unrestrictedCompLine: "Comp: unrestricted", noStableCompLine: "Comp: unrestricted · no stable Comp under current conditions",
    explicitCompLine: "Comp: {name} · user specified", automaticCompLine: "Comp: {name} · system selected, {samples} samples", sessionClearFailed: "Local conversation cleared; server session cleanup failed",
    queryFailed: "Query failed", resultDetails: "View details in results", recommendation: "Recommendation", itemRanking: "Item ranking", compRanking: "Comp ranking",
    clarification: "Clarification needed", noResult: "No results", error: "Query error", loadingResult: "Preparing results", best: "BEST", bestRecommendation: "Best recommendation",
    alternatives: "Alternatives", lowSample: "Low-sample reference", top4: "Top 4", win: "Win rate", avg: "Avg place", samples: "Samples", unavailable: "Unavailable",
    carried: "Owned", none: "None", frequentCore: "Frequent core", coreFrequencyRule: "appears in at least {required} of {count} displayed builds (≥2/3)", relativeRecommendation: "Compared with recommendation",
    chatCoreTitle: "Core conclusion", chatCoreScope: "Based only on displayed builds", chatCoreWithItems: "Across the {count} displayed builds, {items} each appear in at least {required}, meeting the 2/3 frequency threshold. They are treated as the current core-item tendency for {unit}.", chatCoreWithoutItems: "Across the {count} displayed builds, no item appears in at least {required}, so no fixed core item is identified for {unit}.", chatSpecialRankingScope: "Special items ranked by average placement", chatSpecialRankingWithItems: "This query returned {count} {category} items with valid samples: {items}. After removing outliers below 2% of the largest peer sample, {best} has the best average placement ({avg}) and ranks first.", chatSpecialRankingEmpty: "No {category} sample qualifies for the ranking under these conditions.", chatFurtherInterpretation: "Further data interpretation",
    applicabilityRecommendation: "Broad-use pick", applicabilityScore: "Applicability score", applicabilityScoreValue: "Robust score {score}", sampleCoverageValue: "Sample coverage {value}%", applicabilityMethodShort: "Small-sample volatility adjusted; higher coverage wins when performance is close",
    replace: "Replace", sameItems: "Same items", helpful: "Helpful", notHelpful: "Not helpful", recorded: "Recorded", saveFailed: "Save failed",
    feedbackReasonPrompt: "What should improve?", feedbackReasonSkip: "No reason", feedbackReasonSend: "Submit",
    feedbackReasonEntityParse: "Wrong champion or item", feedbackReasonCompContext: "Wrong comp context", feedbackReasonItems: "Poor item recommendation",
    feedbackReasonOutdated: "Outdated data", feedbackReasonLowSample: "Too few samples", feedbackReasonUnclear: "Unclear answer",
    feedbackReasonIncorrect: "Incorrect explanation", feedbackReasonMissing: "Missing key information", feedbackReasonOther: "Other",
    conditions: "Query conditions", conditionSources: "Condition sources", sourceCurrent: "Current input", sourceConversation: "Conversation", sourcePreference: "Preference",
    sourceDefault: "System default", source: "Data source", endpoint: "Endpoint", updated: "Updated", risk: "Risk notice", updateUnavailable: "Update unavailable",
    live: "Live", staleCache: "Stale cache", localCache: "Local cache", coverage: "coverage", commonPairings: "Common pairings", duplicateItems: "Duplicates",
    methodology: "Methodology", currentCompRanking: "Current patch comp rankings", currentCompTrends: "Current patch comp trends", allRanks: "All ranks", rank: "Rank", games: "games", lowSampleSection: "Low-sample references (not ranked)",
    top4Highest: "Highest Top 4", winHighest: "Highest win rate", winShareHighest: "Highest win share", avgBest: "Best average place", mostPopular: "Most popular", top4Short: "Top 4", winShort: "Win", winShareShort: "Win share", avgShort: "Avg", appearanceShort: "Play rate",
    improvingComps: "Emerging comps (last 3 days)", risingComps: "Rising comps · Top 5", fallingComps: "Falling comps · Top 5", selectionRateTop: "Highest pick rate · Top 10",
    avgPlacementImproved: "Avg placement improved by {value}", avgPlacementDeclined: "Avg placement declined by {value}", emergingScore: "Emergence score", emergingFormula: "Sorted by avg placement improvement × √play rate",
    risingFormula: "Sorted by average-placement improvement over 3 days", fallingFormula: "Sorted by average-placement decline over 3 days", trendWindow: "3-day average-placement change",
    selectionRate: "Pick rate", contested: "Contested", rankingStandard: "Ranking metric", popularCompSample: "Showing up to {value} comps, one ranking metric at a time",
    preferenceSearchTitle: "Natural-language comp filter", preferenceStatusOk: "Conditions matched", preferenceStatusLowSample: "Low-sample evidence only", preferenceStatusProfile: "Verified Profile missing", preferenceStatusEvidence: "Insufficient evidence", preferenceStatusZero: "No matching results",
    preferenceStrategy: "Strategy: {value}", preferenceGoal: "Goal: {value}", preferenceContested: "Contest level: {value}", preferenceDifficulty: "Difficulty: {value}", preferenceCount: "Count: {value}", preferenceNoReroll: "Exclude reroll", preferenceBeginner: "Beginner friendly", preferenceExperienced: "Experienced players",
    preferenceReroll: "Reroll", preferenceFast8: "Fast 8", preferenceFast9: "Fast 9", preferenceTop4: "Stable Top 4", preferenceTop1: "Win ceiling", preferenceBalanced: "Balanced", preferenceLow: "Low", preferenceMedium: "Medium", preferenceHigh: "High",
    preferenceReturned: "Returned {returned}/{requested}", deterministicRanking: "Filtered and ranked by deterministic code",
    queryCompUnit: "Query {star}-star {unit} in {comp}", compUnitQueryDisplay: "Query a {star}-star {unit} build in {comp} (samples ≥ {samples})",
    resultNavigation: "Result navigation", backToComp: "Back to comp: {name}", compResultPreserved: "Comp results are preserved so you can query another unit",
    statusReturnedToComp: "Returned to comp: {name}",
    noCompData: "No comp data is available", externalRisk: "External data is for reference only", query: "Query", saveCandidate: "Save draft", itemUnavailable: "None",
    userSpecified: "User input", previousRound: "Previous turn", preference: "Preference", compFilled: "Comp context", systemDefault: "System default", unknown: "Unknown",
    ordinaryItems: "Normal items", radiantItems: "Includes Radiant", artifactItems: "Includes Artifacts", specialItems: "Includes special items", daysRecent: "Last {value} days",
    samplesAtLeast: "Samples ≥ {value}", carriedItems: "Owned: {value}", excludedItems: "Excluded: {value}", traits: "Traits: {value}", noStableComp: "No Comp restriction · no stable Comp under current conditions",
    unrestrictedComp: "No Comp restriction", compSamples: "{name} · {samples} samples", sourceLabel: "Source", compCandidates: "Comp candidates", unknownEndpoint: "Unknown endpoint",
    cacheJson: "JSON", cacheSqlite: "SQLite", cacheMemory: "Memory", persistence: "Persistent", persistenceUnset: "Persistence not configured", timeout: "Query timeout {seconds}s",
    keyConfigured: "Key configured", rulesFirst: "Rules first", disabled: "Off", aiQuotaEmpty: "AI quota used", aiQuotaRemaining: "AI {remaining}/{limit}", aliasDisabled: "Disabled", aliasLoadFailed: "Alias loading failed", aliasUpdateFailed: "Alias update failed",
    batchUpdateFailed: "Batch update failed", noAliasSelected: "No aliases selected", candidateSaved: "Candidate saved", candidateKnown: "Candidate already exists", selectAlias: "Select {alias}",
    candidateClearFailed: "Failed to clear candidate memory", exportFailed: "Export failed", candidateSaveFailed: "Failed to save candidate", feedbackUnavailable: "Current result cannot receive feedback",
    feedbackSaveFailed: "Failed to save feedback", clearFailed: "Clear failed", resetFailed: "Reset failed",
    aliasesUpdated: "Updated {count} aliases", candidatesCleared: "Cleared {count} candidates / {feedback} feedback events", feedback: "Feedback", exported: "Exported", downloaded: "Downloaded", resetDone: "Reset complete",
    confirmClearCandidates: "Clear disabled candidate aliases and feedback? Enabled aliases will remain.", confirmClearHistory: "Clear query history and cache?", confirmReset: "Restore all default settings?",
    lockedSummary: "Locked: {value}", candidateSource: "Candidate source: {value}", notCraftable: "Not craftable", missingOfficialItemDetails: "No official item details are available.", itemDetails: "Item details",
    recipeRoute: "Recipe", effectAndStats: "Effect and stats", metricTop4Rate: "Top 4 rate", metricWinRate: "Win rate", metricAvgPlacement: "Average placement", metricSamples: "Samples",
    unitDetails: "Unit details", unitCost: "{value}-cost", traitDetails: "Trait details", baseStats: "Base stats", ability: "Ability", traitTiers: "Trait tiers", stableItemRecommendations: "Stable item recommendations", recommendationScore: "Stability", recommendationMethod: "Balances play frequency, Top 4 rate, and average placement; items at 4.5 average placement or better are preferred.", health: "Health", mana: "Mana", attackDamage: "Attack damage", armor: "Armor", magicResist: "Magic resist", attackSpeed: "Attack speed", attackRange: "Range", critChance: "Crit chance", startingMana: "Starting mana", noStableItems: "No stable item sample is available yet.", traitRace: "Origin trait", traitJob: "Class trait", unitsRequired: "{value} units",
    reasonInsufficientSample: "Below the sample threshold", reasonLowSample: "Sample stability is insufficient", reasonDifferenceTooSmall: "Difference is too small", reasonMetricUnavailable: "Metric unavailable", reasonOverlapTooHigh: "Overlap is too high", reasonStaleEvidence: "Evidence is stale", reasonInsufficientEvidence: "Insufficient evidence",
    comparisonWinner: "Under the current conditions, {name} leads on exclusive complete-build samples", comparisonNoWinner: "No winner yet: {reason}", comparisonOverlap: "{games} shared samples ({rate}%), excluded from the decision", comparisonOverlapZero: "0 shared samples", primaryMetric: "Primary metric: {value}", noStablePairing: "No stable pairing", exclusiveSamples: "Exclusive samples {value}", commonFullBuild: "Common complete build", comparisonItems: "Compare: {value}",
    auditMissingCanonicalName: "Missing Chinese canonical name", auditUnknownCategory: "Unknown category", auditMissingOfficialDetails: "Missing official details", auditMissingOfficialEffect: "Missing effect", auditMissingRecipe: "Incomplete recipe", auditUnversionedAvailability: "Availability override is not version-bound", auditNameConflict: "Official/manual name conflict", auditCatalogFallback: "Catalog uses fallback cache", auditOfficialSourceError: "Official details source error",
    auditMeta: "{patch} · Catalog {catalogStatus}/{catalogSource} · Details {detailStatus}", auditSummary: "{returned} / {total} rows · {issues} with issues", noImage: "No image", noShortName: "No short name", noHistoricalAliases: "No historical aliases", available: "Available", effectStatus: "Effect {value}", recipeStatus: "Recipe {value}", auditNameSource: "Name source: {source} · override: {override}", unversioned: "Unversioned", noAuditOverride: "None", noAuditIssues: "No audit issues", noAuditResults: "No matching results", auditLoading: "Transforming audit data…", auditLoadFailed: "Failed to load the item catalog audit", auditExportFailed: "Failed to export audit results",
    newConversation: "A new conversation has started. Ask about builds, item rankings, or comps.", waitingQuery: "Waiting for a query", rankCoverage: "{value}% coverage",
    dataInterpretation: "Data interpretation", generatedFromEvidence: "Generated from evidence", templateFallback: "Template fallback", nextAction: "Next action", staticEvidence: "Expandable static evidence", explanationHelpful: "Helpful explanation", explanationNotHelpful: "Improve explanation", cachedConclusion: "Conclusion cache",
    conclusionStreaming: "AI is preparing a conclusion from the data…", backToChat: "Back to chat"
  }
};

let locale = normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY) || DEFAULT_LOCALE);

export function normalizeLocale(value) {
  return value === "en-US" ? "en-US" : "zh-CN";
}

export function getLocale() { return locale; }

export function t(key, params = {}) {
  const template = messages[locale]?.[key] ?? messages[DEFAULT_LOCALE]?.[key] ?? key;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => params[name] ?? `{${name}}`);
}

export function setLocale(nextLocale, root = document) {
  locale = normalizeLocale(nextLocale);
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  document.documentElement.lang = locale;
  applyI18n(root);
  for (const button of root.querySelectorAll?.("[data-locale]") ?? []) {
    const active = button.dataset.locale === locale;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  return locale;
}

export function applyI18n(root = document) {
  for (const node of root.querySelectorAll?.("[data-i18n]") ?? []) node.textContent = t(node.dataset.i18n);
  for (const node of root.querySelectorAll?.("[data-i18n-title]") ?? []) node.title = t(node.dataset.i18nTitle);
  for (const node of root.querySelectorAll?.("[data-i18n-aria]") ?? []) node.setAttribute("aria-label", t(node.dataset.i18nAria));
  for (const node of root.querySelectorAll?.("[data-i18n-placeholder]") ?? []) node.placeholder = t(node.dataset.i18nPlaceholder);
}

export function formatNumber(value, options = {}) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return t("unavailable");
  return new Intl.NumberFormat(locale, options).format(Number(value));
}

export function formatDate(value) {
  if (!value) return t("updateUnavailable");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("updateUnavailable");
  return new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

export function localizedName(entity, fallback = "") {
  if (!entity || typeof entity !== "object") return String(fallback || "");
  if (locale === "en-US") return entity.enName ?? entity.nameEn ?? entity.displayNameEn ?? entity.apiName ?? entity.canonicalName ?? entity.compId ?? entity.name ?? fallback;
  return entity.zhName ?? entity.nameZh ?? entity.displayName ?? entity.name ?? entity.apiName ?? entity.canonicalName ?? fallback;
}

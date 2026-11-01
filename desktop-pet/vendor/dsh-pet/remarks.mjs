// Adapted from dsh-pet 9ccb048c82b4ac4f6cc52fbb3ca92323b42c799b (Apache-2.0).
// Changes: TypeScript erased with Node.js; relative imports changed to .mjs.
export const REMARK_KINDS = [
    'pet',
    'petCooldown',
    'feed',
    'feedCooldown',
    'noTreats'
];
export const REMARK_LINE_MAX = 120;
export const REMARK_LINES_MAX = 64;
export const BUILTIN_REMARKS = {
    pet: [
        '咕噜咕噜～被摸摸好舒服！',
        '再摸摸这里，痒痒的～',
        '头顶温度刚刚好，安心～',
        '被摸到耳朵啦，扑通扑通！',
        '你的手掌好温暖，舍不得你走～',
        '呼噜呼噜～就靠在这里不走了！',
        '今天的摸头也收货成功！',
        '蹭蹭你的手心，这是回礼～',
        '多摸摸我，亲密度会涨哦！',
        '闭眼享受中，请勿打扰～',
        '头再低一点，够不着了～',
        '呼噜呼噜，声音都冒出来了',
        '这手感，比小鱼干还上瘾',
        '摸到第三下，满意',
        '耳朵后面，别漏了……啊，舒服',
        '被摸得尾巴都卷起来了'
    ],
    petCooldown: [
        '摸过头啦，让鲸鱼娘歇口气～',
        '羽毛都快被摸秃啦，缓一缓～',
        '呼……先让我喘口气嘛！',
        '再摸就要睡着了哦～',
        '稍微休息一下，待会儿再摸～',
        '头顶要冒烟啦，停一停！',
        '我知道你喜欢我，但也要节制呀～',
        '歇一歇，摸摸的手感会更好哦～',
        '咕……等我回个蓝～',
        '让我先消化一下刚才的爱！',
        '痒痒的，先让我缓一下……',
        '再摸就掉线了，真的',
        '库存的呼噜声用完了',
        '手歇会儿，我也要补个蓝',
        '舒服归舒服，得缓缓呀',
        '再摸下去，我就要融化了'
    ],
    feed: [
        '呜哇！小鱼干好好吃！',
        '咔嚓咔嚓，美味到尾巴打结～',
        '这条小鱼干是刚晒好的，好香！',
        '谢谢你，胃里暖暖的～',
        '囤粮 +1，今天也有好好被爱！',
        '好吃到想转圈圈～',
        '小鱼干最好吃了，再来亿条！',
        '饱餐一顿，马上满血复活～',
        '这个味道，是幸福的味道！',
        '吃完了还不忘舔舔爪子～',
        '这小鱼干，是今天的顶配',
        '一口下去，精神头全回来了',
        '脆！香！就是这个味儿',
        '边吃边摇尾巴，形象不要了',
        '好吃到眼睛都眯起来了',
        '这块鱼干我记住了，懂我的'
    ],
    feedCooldown: [
        '吃饱啦，晚点再喂～',
        '肚子圆滚滚的，装不下啦～',
        '再喂就要变成球啦！',
        '让我慢慢消化这份心意～',
        '小鱼干的香气还没散呢～',
        '呼……满足得动不了了～',
        '先散步一圈再吃下一顿！',
        '肚皮已经鼓鼓的啦～',
        '好吃是好吃，可也得节制呀～',
        '等我饿了会告诉你哦～',
        '胃说它满了，脑子说还能吃',
        '这条得留着慢慢品',
        '先消消食，待会儿再战',
        '塞不下了，真塞不下了',
        '闻着香，可惜没地方放了',
        '嗝……这顿值了'
    ],
    noTreats: [
        '没有小鱼干了，多陪我工作一会儿吧～',
        '粮仓空空，陪我完成几轮任务就会有小鱼干啦～',
        '小鱼干在路上啦，先一起加油工作！',
        '嘴巴寂寞了……快去完成一轮任务！',
        '陪我多工作一会儿，鱼干自动到账～',
        '现在喂我也只会饿着肚子说谢谢哦～',
        '粮仓见底啦，用几轮任务换一条鱼干吧～',
        '饿着肚子等你完成下一轮任务～',
        '小鱼干藏在你的工作里，去找找看！',
        '先工作后干饭，我们的约定哦～',
        '粮仓见底，全靠感情撑着了',
        '饿是真饿，活也是真得干',
        '画饼充饥……不对，画鱼干充饥',
        '没鱼干的日子，靠意志力过',
        '下一轮任务，我闻到了鱼干味',
        '先记账上，欠我两条，记住啦'
    ]
};
export function builtinRemark(kind) {
    return BUILTIN_REMARKS[kind][0];
}
export function normalizePetRemarks(raw, onWarning = ()=>{}) {
    if (raw === undefined) return undefined;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        onWarning('remarks must be an object with pet/petCooldown/feed/feedCooldown/noTreats slots');
        return undefined;
    }
    const remarks = {};
    for (const [key, value] of Object.entries(raw)){
        if (!REMARK_KINDS.includes(key)) {
            onWarning('unknown remarks slot ' + JSON.stringify(key));
            continue;
        }
        const lines = (Array.isArray(value) ? value : [
            value
        ]).filter((line)=>typeof line === 'string').map((line)=>line.trim()).filter((line)=>line !== '').slice(0, REMARK_LINES_MAX).map((line)=>line.slice(0, REMARK_LINE_MAX));
        if (lines.length === 0) {
            onWarning('remarks slot ' + key + ' carries no usable lines');
            continue;
        }
        remarks[key] = lines;
    }
    return Object.keys(remarks).length === 0 ? undefined : remarks;
}
export class RemarkPicker {
    counters = new Map();
    pools;
    constructor(overrides, voiceOverrides){
        this.pools = {};
        for (const kind of REMARK_KINDS){
            const custom = overrides?.[kind];
            const voice = voiceOverrides?.[kind];
            if (custom !== undefined && custom.length > 0) {
                this.pools[kind] = custom;
            } else if (voice !== undefined && voice.length > 0) {
                this.pools[kind] = voice;
            } else {
                this.pools[kind] = BUILTIN_REMARKS[kind];
            }
        }
    }
    pool(kind) {
        return this.pools[kind];
    }
    pick(kind) {
        const pool = this.pools[kind];
        const index = (this.counters.get(kind) ?? 0) % pool.length;
        this.counters.set(kind, index + 1);
        return pool[index];
    }
    pickAt(kind, count) {
        const pool = this.pools[kind];
        return pool[Math.max(0, Math.floor(count)) % pool.length];
    }
}

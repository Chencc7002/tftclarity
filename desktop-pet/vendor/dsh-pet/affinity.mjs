// Adapted from dsh-pet 9ccb048c82b4ac4f6cc52fbb3ca92323b42c799b (Apache-2.0).
// Changes: TypeScript erased with Node.js; relative imports changed to .mjs.
import { BUILTIN_REMARKS, builtinRemark } from './remarks.mjs';
export const AFFINITY_MAX = 999_999_999;
export const AFFINITY_RANKS = [
    {
        min: 0,
        name: '幼鲸',
        emoji: '*'
    },
    {
        min: 25,
        name: '伙伴',
        emoji: '**'
    },
    {
        min: 50,
        name: '挚友',
        emoji: '***'
    },
    {
        min: 80,
        name: '深海羁绊',
        emoji: '****'
    },
    {
        min: 200,
        name: '心有灵犀',
        emoji: '*****'
    },
    {
        min: 500,
        name: '传说羁绊',
        emoji: '******'
    },
    {
        min: 2_000,
        name: '神话羁绊',
        emoji: '*******'
    },
    {
        min: 10_000,
        name: '永恒之契',
        emoji: '********'
    },
    {
        min: 100_000,
        name: '鲸生共渡',
        emoji: '*********'
    }
];
export const AFFINITY_RANKS_EN = {
    '幼鲸': 'Baby Whale',
    '伙伴': 'Companion',
    '挚友': 'Close Friend',
    '深海羁绊': 'Deep Sea Bond',
    '心有灵犀': 'Kindred Spirit',
    '传说羁绊': 'Legendary Bond',
    '神话羁绊': 'Mythic Bond',
    '永恒之契': 'Eternal Covenant',
    '鲸生共渡': 'Lifelong Companion'
};
export const defaultAffinityConfig = {
    turnReward: 1,
    petReward: 1,
    petCooldownMs: 10_000,
    feedReward: 5,
    feedCooldownMs: 30_000
};
export function emptyAffinity() {
    return {
        points: 0,
        lastPetAt: 0,
        lastFeedAt: 0,
        pets: 0,
        feeds: 0,
        petRejects: 0,
        feedRejects: 0,
        turns: 0
    };
}
function builtinRankOf(points) {
    let rank = AFFINITY_RANKS[0];
    for (const candidate of AFFINITY_RANKS){
        if (points >= candidate.min) rank = candidate;
    }
    return rank;
}
export function rankOf(points, ladder) {
    const builtin = builtinRankOf(points);
    if (ladder === undefined || ladder.length === 0) return builtin;
    let selected = ladder[0];
    for (const candidate of ladder){
        if (points >= candidate.min) selected = candidate;
    }
    return {
        min: selected.min,
        name: selected.name,
        ...selected.nameEn === undefined ? {} : {
            nameEn: selected.nameEn
        },
        emoji: builtin.emoji
    };
}
export function affinityViewOf(state, nowMs, config = defaultAffinityConfig, ladder) {
    const rank = rankOf(state.points, ladder);
    return {
        points: state.points,
        rank: rank.name,
        ...rank.nameEn === undefined ? {} : {
            rankEn: rank.nameEn
        },
        rankEmoji: rank.emoji,
        pets: state.pets,
        feeds: state.feeds,
        turns: state.turns,
        petCooldown: nowMs - state.lastPetAt < config.petCooldownMs,
        feedCooldown: nowMs - state.lastFeedAt < config.feedCooldownMs
    };
}
function clamp(points) {
    return Math.min(AFFINITY_MAX, Math.max(0, points));
}
function countedRemark(kind, count) {
    const pool = BUILTIN_REMARKS[kind];
    return pool[Math.max(0, Math.floor(count)) % pool.length] ?? builtinRemark(kind);
}
export function applyInteraction(state, kind, nowMs, config = defaultAffinityConfig) {
    const next = {
        ...state
    };
    if (kind === 'pet') {
        if (state.lastPetAt !== 0 && nowMs - state.lastPetAt < config.petCooldownMs) {
            next.petRejects += 1;
            return {
                affinity: next,
                delta: 0,
                reaction: countedRemark('petCooldown', state.petRejects),
                accepted: false
            };
        }
        next.lastPetAt = nowMs;
        next.pets += 1;
        next.points = clamp(state.points + config.petReward);
        return {
            affinity: next,
            delta: config.petReward,
            reaction: countedRemark('pet', state.pets),
            accepted: true
        };
    }
    if (kind === 'feed') {
        if (state.lastFeedAt !== 0 && nowMs - state.lastFeedAt < config.feedCooldownMs) {
            next.feedRejects += 1;
            return {
                affinity: next,
                delta: 0,
                reaction: countedRemark('feedCooldown', state.feedRejects),
                accepted: false
            };
        }
        next.lastFeedAt = nowMs;
        next.feeds += 1;
        next.points = clamp(state.points + config.feedReward);
        return {
            affinity: next,
            delta: config.feedReward,
            reaction: countedRemark('feed', state.feeds),
            accepted: true
        };
    }
    return {
        affinity: state,
        delta: 0,
        reaction: '',
        accepted: false
    };
}
export function applyTurnReward(state, config = defaultAffinityConfig) {
    const next = {
        ...state
    };
    next.turns += 1;
    next.points = clamp(state.points + config.turnReward);
    return next;
}

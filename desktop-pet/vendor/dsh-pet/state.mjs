// Adapted from dsh-pet 9ccb048c82b4ac4f6cc52fbb3ca92323b42c799b (Apache-2.0).
// Changes: TypeScript erased with Node.js; relative imports changed to .mjs.
export const defaultPetStateConfig = {
    celebrateMs: 2400,
    failureMs: 2400
};
export function animationForPhase(phase) {
    switch(phase){
        case 'thinking':
            return 'running';
        case 'tool':
            return 'running-right';
        case 'review':
            return 'review';
        case 'waiting':
            return 'waiting';
        case 'done':
            return 'jumping';
        case 'failed':
            return 'failed';
        case 'idle':
            return 'idle';
    }
}
export function rowOf(animation) {
    const rows = {
        'idle': 0,
        'running-right': 1,
        'running-left': 2,
        'waving': 3,
        'jumping': 4,
        'failed': 5,
        'waiting': 6,
        'running': 7,
        'review': 8
    };
    return rows[animation];
}
export class PetStateMachine {
    now;
    phase = 'idle';
    line;
    phrase;
    sessionActive = false;
    doneAt;
    failedAt;
    config;
    constructor(config = defaultPetStateConfig, now = Date.now){
        this.now = now;
        this.config = {
            ...defaultPetStateConfig,
            ...config
        };
    }
    onActivityStatus(input) {
        this.phase = input.phase;
        this.line = input.line;
        this.phrase = input.phrase;
        this.doneAt = input.phase === 'done' ? this.now() : undefined;
        this.failedAt = input.phase === 'failed' ? this.now() : undefined;
    }
    onSessionActive() {
        this.sessionActive = true;
    }
    onSessionDisposed() {
        this.sessionActive = false;
        this.phase = 'idle';
        this.line = undefined;
        this.phrase = undefined;
        this.doneAt = undefined;
        this.failedAt = undefined;
    }
    render() {
        const nowMs = this.now();
        let animation = animationForPhase(this.phase);
        const doneSettled = this.phase === 'done' && this.doneAt !== undefined && nowMs - this.doneAt >= this.config.celebrateMs;
        const failedSettled = this.phase === 'failed' && this.failedAt !== undefined && nowMs - this.failedAt >= this.config.failureMs;
        if (doneSettled || failedSettled) animation = 'idle';
        const settled = this.phase === 'idle' || doneSettled || failedSettled;
        const bubble = settled ? undefined : this.phrase ?? this.line;
        return {
            animation,
            ...bubble === undefined ? {} : {
                bubble
            },
            animationStartedAt: nowMs,
            phase: this.phase,
            sessionActive: this.sessionActive
        };
    }
}

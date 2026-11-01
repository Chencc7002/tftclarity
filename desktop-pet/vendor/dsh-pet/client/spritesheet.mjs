// Adapted from dsh-pet 9ccb048c82b4ac4f6cc52fbb3ca92323b42c799b (Apache-2.0).
// Changes: TypeScript erased with Node.js; relative imports changed to .mjs.
import { rowOf } from '../state.mjs';
export function rowOfTrack(animation) {
    return rowOf(animation);
}
export function scaledCellSize(cell, scale) {
    return {
        width: Math.max(1, Math.round(cell.width * scale)),
        height: Math.max(1, Math.round(cell.height * scale))
    };
}
export function framePosition(cell, row, col, scale = 1) {
    const scaled = scaledCellSize(cell, scale);
    return {
        x: -col * scaled.width,
        y: -row * scaled.height
    };
}
export function trimTrack(track, frameCount) {
    const n = Math.max(1, Math.min(frameCount, track.frames.length, track.durations.length));
    return {
        frames: track.frames.slice(0, n),
        durations: track.durations.slice(0, n),
        loop: track.loop,
        ...track.fallback === undefined ? {} : {
            fallback: track.fallback
        }
    };
}

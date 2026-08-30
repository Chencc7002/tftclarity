import { DEFAULT_SEASON_CONTEXT_ID } from "../../src/season/season-context.js";

// Pool scope is server-owned. Preserve explicitly pinned historical/PBE pools.
export function poolSeason(pool = {}, player = {}) {
  if (pool.season) return pool.season;
  return (player.region ?? pool.region) === "pbe" || pool.environment === "pbe"
    ? "set18-pbe"
    : DEFAULT_SEASON_CONTEXT_ID;
}

export function poolSetNumber(pool = {}) {
  const match = String(pool.season ?? "").match(/^set(\d+)-(?:live|pbe)$/u);
  return match ? Number(match[1]) : null;
}

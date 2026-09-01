import { createSeasonContextService, SEASON_CONTEXTS } from "../../src/season/season-context.js";

// Frozen S17 datasets test domain behavior independently of public availability.
// Production registry/HTTP disable tests intentionally do not use this fixture.
export function createLegacySeasonFixture() {
  return createSeasonContextService({ contexts: SEASON_CONTEXTS.map(context =>
    context.id === "set17-live" ? { ...context, status: "live", selectable: true } : context
  ) });
}

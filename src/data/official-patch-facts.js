import { buildPatchHistory } from "../app/small-window-ui/patch-history.js";
import { getOfficialPatchEvidence } from "./official-patch-evidence.js";

export const OFFICIAL_PATCH_FACTS_SCHEMA_VERSION = "official-patch-facts.v1";

function normalizeLocale(value) {
  return String(value ?? "zh-CN").toLowerCase() === "en-us" ? "en-US" : "zh-CN";
}

function summaryFor(revisions) {
  const changes = revisions.flatMap((revision) => revision.changes);
  return {
    revisionCount: revisions.length,
    changeCount: changes.length,
    buffs: changes.filter((change) => change.direction === "buff").length,
    nerfs: changes.filter((change) => change.direction === "nerf").length
  };
}

export function getOfficialPatchFacts(options = {}) {
  const patch = getOfficialPatchEvidence(options.patch);
  const locale = normalizeLocale(options.locale);
  if (!patch) {
    return {
      schemaVersion: OFFICIAL_PATCH_FACTS_SCHEMA_VERSION,
      type: "patch_facts",
      status: "not_found",
      patch: String(options.patch ?? ""),
      locale,
      numericOnly: true,
      publishedAt: null,
      updatedAt: null,
      source: null,
      summary: { revisionCount: 0, changeCount: 0, buffs: 0, nerfs: 0 },
      revisions: [],
      warnings: ["patch_not_found"]
    };
  }

  const localizedPatch = {
    sourceName: locale === "en-US" ? "Official Riot Games patch notes" : patch.sourceName,
    sourceUrl: patch.sourceUrl
  };
  const revisions = buildPatchHistory(patch, localizedPatch, locale).map((revision) => ({
    id: revision.id,
    parentId: revision.parentId,
    kind: revision.kind,
    publishedAt: revision.publishedAt,
    title: revision.title,
    summary: revision.summary,
    sourceName: revision.sourceName,
    sourceUrl: revision.sourceUrl,
    changes: revision.groups.flatMap((group) => group.changes.map((change) => ({
      id: change.id,
      group: group.title,
      label: change.body,
      direction: change.direction,
      entityType: change.entityType,
      entityApiNames: [...(change.entityApiNames ?? [])],
      relatedTraitApiNames: [...(change.relatedTraitApiNames ?? [])],
      stat: change.stat,
      before: change.before,
      after: change.after
    })))
  }));
  const updatedAt = revisions.at(-1)?.publishedAt ?? patch.publishedAt;

  return {
    schemaVersion: OFFICIAL_PATCH_FACTS_SCHEMA_VERSION,
    type: "patch_facts",
    status: revisions.length ? "found" : "no_numeric_revisions",
    patch: patch.version,
    locale,
    numericOnly: true,
    title: patch.title ?? `Teamfight Tactics patch ${patch.version}`,
    publishedAt: patch.publishedAt,
    updatedAt,
    source: {
      sourceType: "riot_games",
      sourceId: `tft-patch-${patch.version}`,
      sourceName: localizedPatch.sourceName,
      sourceUrl: localizedPatch.sourceUrl
    },
    summary: summaryFor(revisions),
    revisions,
    warnings: revisions.length ? [] : ["no_numeric_revisions"]
  };
}

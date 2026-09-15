import {
  OFFICIAL_PATCH_EVIDENCE_VERSION,
  listOfficialPatchEvidence
} from "../data/official-patch-evidence.js";
import {
  OFFICIAL_PATCH_FACTS_SCHEMA_VERSION,
  getOfficialPatchFacts
} from "../data/official-patch-facts.js";
import {
  createKnowledgeDocument,
  knowledgeDocumentToSemanticDocument
} from "./knowledge-document-schema.js";

export const OFFICIAL_PATCH_KNOWLEDGE_VERSION = "official_patch_knowledge.v1";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function directionLabel(direction) {
  return {
    buff: "增强",
    nerf: "削弱",
    mixed: "调整",
    new: "新增"
  }[direction] ?? "调整";
}

function patchText(patch, facts) {
  const numericIds = new Set(array(facts?.revisions).flatMap((revision) => revision.changes.map((change) => change.id)));
  const changes = array(patch.changes).filter((change) => !numericIds.has(change.id)).map(
    (change, index) => `${index + 1}. 【${directionLabel(change.direction)}】${change.summary}`
  );
  const revisionChanges = array(facts?.revisions).flatMap((revision) => [
    `数值修订 ${revision.publishedAt} / ${revision.title}`,
    ...array(revision.changes).map((change, index) => (
      `${index + 1}. 【${directionLabel(change.direction)}】${change.label}：${change.before} → ${change.after}`
    ))
  ]);
  return [
    `Patch ${patch.version} / ${patch.title ?? `${patch.version} 版本更新公告`}`,
    `首发时间：${patch.publishedAt}`,
    patch.summary,
    ...changes,
    ...revisionChanges
  ].filter(Boolean).join("\n");
}

export function buildOfficialPatchKnowledgeDocuments(options = {}) {
  const seasonContextId = String(options.seasonContextId ?? "set17-live");
  const locale = String(options.locale ?? "zh-CN");
  const requestedVersions = options.versions
    ? new Set(array(options.versions).map(String))
    : null;

  return listOfficialPatchEvidence()
    .filter((patch) => !requestedVersions || requestedVersions.has(String(patch.version)))
    .map((patch) => {
      const facts = getOfficialPatchFacts({ patch: patch.version, locale });
      return createKnowledgeDocument({
        id: `${seasonContextId}:patch_note:${patch.version}:overview`,
        documentType: "patch_note",
        title: patch.title ?? `云顶之弈 ${patch.version} 版本更新公告`,
        text: patchText(patch, facts),
        metadata: {
          source: "riot_games",
          sourceId: `tft-patch-${patch.version}`,
          sourceTitle: patch.title ?? `Teamfight Tactics patch ${patch.version}`,
          author: "Riot Games",
          publishedAt: patch.publishedAt,
          generatedAt: facts.updatedAt ?? patch.publishedAt,
          season: seasonContextId,
          patch: patch.version,
          locale,
          topics: [
            `Patch ${patch.version}`,
            `${patch.version} 版本`,
            "更新公告",
            "版本改动",
            ...array(patch.changes).flatMap((change) => [
              ...array(change.entityApiNames),
              ...array(change.relatedTraitApiNames)
            ]),
            ...facts.revisions.flatMap((revision) => revision.changes.flatMap((change) => [
              ...change.entityApiNames,
              ...change.relatedTraitApiNames
            ]))
          ],
          claimType: "official_fact",
          sourceUrl: facts.source?.sourceUrl ?? patch.sourceUrl,
          namespace: "static_knowledge",
          rawData: {
            evidenceVersion: OFFICIAL_PATCH_EVIDENCE_VERSION,
            knowledgeVersion: OFFICIAL_PATCH_KNOWLEDGE_VERSION,
            patchFactsVersion: OFFICIAL_PATCH_FACTS_SCHEMA_VERSION,
            changes: patch.changes,
            numericRevisions: facts.revisions
          }
        }
      });
    });
}

export function buildOfficialPatchSemanticDocuments(options = {}) {
  const seasonContextId = String(options.seasonContextId ?? "set17-live");
  return buildOfficialPatchKnowledgeDocuments(options).flatMap((document) => {
    const documents = [document];
    // The registered semantic tool returns at most 800 characters per hit.
    // Index bounded entity sections as well as the overview, so later changes
    // in a long release remain retrievable without widening the tool budget.
    if (document.text.length > 800) {
      for (const revision of array(document.metadata.rawData?.numericRevisions)) {
        const groups = new Map();
        for (const change of revision.changes) {
          const subject = change.entityApiNames.length
            ? change.entityApiNames.join("|")
            : change.label.split("·")[0].trim();
          if (!groups.has(subject)) groups.set(subject, []);
          groups.get(subject).push(change);
        }
        for (const changes of groups.values()) {
          const header = `Patch ${document.metadata.patch} / ${revision.title} / ${revision.publishedAt}`;
          let batch = [], lines = [];
          const emit = () => {
            if (!batch.length) return;
            documents.push(createKnowledgeDocument({
              id: `${document.id}:section:${batch[0].id}`,
              documentType: "patch_note",
              title: `${document.title} · ${batch[0].label.split("·")[0].trim()}`,
              text: [header, ...lines].join("\n"),
              metadata: {
                ...document.metadata,
                generatedAt: revision.publishedAt,
                publishedAt: revision.publishedAt,
                sourceUrl: revision.sourceUrl,
                topics: ["更新公告", "版本改动", `Patch ${document.metadata.patch}`,
                  ...batch.flatMap((change) => [change.label, ...change.entityApiNames])],
                rawData: { ...document.metadata.rawData, changes: batch, numericRevisions: [] }
              }
            }));
          };
          for (const change of changes) {
            const line = `【${directionLabel(change.direction)}】${change.label}：${change.before} → ${change.after}`;
            if (batch.length && [header, ...lines, line].join("\n").length > 800) {
              emit(); batch = []; lines = [];
            }
            batch.push(change); lines.push(line);
          }
          emit();
        }
      }
    }
    return documents.map((entry) => knowledgeDocumentToSemanticDocument(entry, { seasonContextId }));
  });
}

export function extractPatchVersionFromQuestion(value) {
  const match = String(value ?? "").match(/(?:^|[^\d])(\d{1,2}\.\d{1,2})(?!\d)/u);
  return match?.[1] ?? null;
}

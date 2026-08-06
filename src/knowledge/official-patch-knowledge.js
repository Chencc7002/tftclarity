import {
  OFFICIAL_PATCH_EVIDENCE_VERSION,
  listOfficialPatchEvidence
} from "../data/official-patch-evidence.js";
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

function patchText(patch) {
  const changes = array(patch.changes).map(
    (change, index) => `${index + 1}. 【${directionLabel(change.direction)}】${change.summary}`
  );
  return [
    `Patch ${patch.version} / ${patch.title ?? `${patch.version} 版本更新公告`}`,
    patch.summary,
    ...changes
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
    .map((patch) => createKnowledgeDocument({
      id: `${seasonContextId}:patch_note:${patch.version}:overview`,
      documentType: "patch_note",
      title: patch.title ?? `云顶之弈 ${patch.version} 版本更新公告`,
      text: patchText(patch),
      metadata: {
        source: "riot_games",
        sourceId: `tft-patch-${patch.version}`,
        sourceTitle: patch.title ?? `Teamfight Tactics patch ${patch.version}`,
        author: "Riot Games",
        publishedAt: patch.publishedAt,
        generatedAt: patch.publishedAt,
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
          ])
        ],
        claimType: "official_fact",
        sourceUrl: patch.sourceUrl,
        namespace: "static_knowledge",
        rawData: {
          evidenceVersion: OFFICIAL_PATCH_EVIDENCE_VERSION,
          knowledgeVersion: OFFICIAL_PATCH_KNOWLEDGE_VERSION,
          changes: patch.changes
        }
      }
    }));
}

export function buildOfficialPatchSemanticDocuments(options = {}) {
  const seasonContextId = String(options.seasonContextId ?? "set17-live");
  return buildOfficialPatchKnowledgeDocuments(options).map((document) => (
    knowledgeDocumentToSemanticDocument(document, { seasonContextId })
  ));
}

export function extractPatchVersionFromQuestion(value) {
  const match = String(value ?? "").match(/(?:^|[^\d])(\d{1,2}\.\d{1,2})(?!\d)/u);
  return match?.[1] ?? null;
}

import {
  CURRENT_STATS_SEMANTIC_PROJECTION_VERSION
} from "./current-stats-semantic-projection.js";

export const KNOWLEDGE_DOCUMENT_SCHEMA_VERSION = "knowledge_document.v1";
export const CURRENT_STATS_SCHEMA_VERSION = "current_stats.v2";

export const CURRENT_STATS_DOCUMENT_TYPES = Object.freeze([
  "meta_snapshot",
  "unit_stats",
  "comp_stats",
  "trend_snapshot"
]);

export const KNOWLEDGE_DOCUMENT_TYPES = Object.freeze([
  ...CURRENT_STATS_DOCUMENT_TYPES,
  "item_stats",
  "video_guide",
  "mechanism_knowledge",
  "patch_note",
  "static_game_knowledge"
]);

export const KNOWLEDGE_CLAIM_TYPES = Object.freeze([
  "statistics",
  "official_fact",
  "mechanism",
  "creator_advice",
  "strategic_advice",
  "speculation"
]);

export const KNOWLEDGE_NAMESPACES = Object.freeze({
  meta_snapshot: "current_stats",
  unit_stats: "current_stats",
  comp_stats: "current_stats",
  item_stats: "current_stats",
  trend_snapshot: "current_stats",
  video_guide: "video_guides",
  mechanism_knowledge: "mechanism_knowledge",
  patch_note: "static_knowledge",
  static_game_knowledge: "static_knowledge"
});

export const KNOWLEDGE_DOCUMENT_JSON_SCHEMA = Object.freeze({
  $id: "https://tftclarity.local/schemas/knowledge-document.v1.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "id", "documentType", "title", "text", "metadata"],
  properties: {
    schemaVersion: { const: KNOWLEDGE_DOCUMENT_SCHEMA_VERSION },
    id: { type: "string", minLength: 1 },
    documentType: { enum: KNOWLEDGE_DOCUMENT_TYPES },
    title: { type: "string", minLength: 1 },
    text: { type: "string", minLength: 1 },
    metadata: { type: "object" }
  }
});

function array(value) {
  return Array.isArray(value) ? value : [];
}

function compactString(value, maximum = 500) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maximum) : null;
}

function nullableString(value, maximum = 500) {
  return value === null || value === undefined || value === ""
    ? null
    : compactString(value, maximum);
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function uniqueStrings(value, maximum = 50) {
  return [...new Set(array(value).map((entry) => compactString(entry, 180)).filter(Boolean))].slice(0, maximum);
}

function isoDate(value) {
  const text = nullableString(value, 40);
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? text : null;
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return JSON.parse(JSON.stringify(value));
}

function normalizeMetadata(value = {}, documentType) {
  const claimType = compactString(value.claimType ?? value.claim_type, 80);
  return {
    source: compactString(value.source, 80),
    sourceId: nullableString(value.sourceId ?? value.source_id, 160),
    sourceTitle: nullableString(value.sourceTitle ?? value.source_title, 300),
    author: nullableString(value.author ?? value.channel, 180),
    publishedAt: isoDate(value.publishedAt ?? value.published_at ?? value.date),
    season: nullableString(value.season, 80),
    patch: nullableString(value.patch, 80),
    rank: nullableString(value.rank, 80),
    timeWindow: nullableString(value.timeWindow ?? value.time_window, 80),
    region: nullableString(value.region, 40),
    locale: nullableString(value.locale, 40) ?? "zh-CN",
    topics: uniqueStrings(value.topics ?? value.subjects),
    timestampStart: finite(value.timestampStart ?? value.timestamp_start),
    timestampEnd: finite(value.timestampEnd ?? value.timestamp_end),
    claimType,
    conditions: uniqueStrings(value.conditions),
    sourceUrl: nullableString(value.sourceUrl ?? value.source_url ?? value.videoUrl ?? value.video_url, 1000),
    generatedAt: isoDate(value.generatedAt ?? value.generated_at) ?? new Date().toISOString(),
    expiresAt: isoDate(value.expiresAt ?? value.expires_at),
    trendSource: nullableString(value.trendSource ?? value.trend_source, 120),
    comparedAt: isoDate(value.comparedAt ?? value.compared_at),
    rawData: plainObject(value.rawData ?? value.raw_data),
    semanticProjection: plainObject(value.semanticProjection ?? value.semantic_projection),
    semanticProjectionConfig: plainObject(
      value.semanticProjectionConfig ?? value.semantic_projection_config
    ),
    videoVersion: nullableString(value.videoVersion ?? value.video_version, 160),
    transcriptHash: nullableString(value.transcriptHash ?? value.transcript_hash, 160),
    segmentId: nullableString(value.segmentId ?? value.segment_id, 240),
    segmentIndex: Number.isInteger(Number(value.segmentIndex ?? value.segment_index))
      ? Number(value.segmentIndex ?? value.segment_index)
      : null,
    segmentStatus: nullableString(value.segmentStatus ?? value.segment_status, 40),
    ingestionRunId: nullableString(value.ingestionRunId ?? value.ingestion_run_id, 160),
    ingestionStatus: nullableString(value.ingestionStatus ?? value.ingestion_status, 40),
    extractionModel: nullableString(value.extractionModel ?? value.extraction_model, 160),
    extractionPromptVersion: nullableString(
      value.extractionPromptVersion ?? value.extraction_prompt_version,
      160
    ),
    aiGenerated: value.aiGenerated ?? value.ai_generated ?? null,
    contentOrigin: nullableString(value.contentOrigin ?? value.content_origin, 120),
    reviewStatus: nullableString(value.reviewStatus ?? value.review_status, 80),
    contentDisclosure: nullableString(
      value.contentDisclosure ?? value.content_disclosure,
      500
    ),
    isCurrentVersion: value.isCurrentVersion ?? value.is_current_version ?? null,
    namespace: compactString(value.namespace, 80) ?? KNOWLEDGE_NAMESPACES[documentType] ?? "static_knowledge"
  };
}

export function createKnowledgeDocument(value = {}) {
  const documentType = compactString(value.documentType ?? value.document_type, 80);
  return {
    schemaVersion: KNOWLEDGE_DOCUMENT_SCHEMA_VERSION,
    id: compactString(value.id, 300) ?? "",
    documentType: documentType ?? "",
    title: compactString(value.title, 500) ?? "",
    text: compactString(value.text ?? value.content, 8000) ?? "",
    metadata: normalizeMetadata(value.metadata, documentType)
  };
}

export function validateKnowledgeDocument(value, options = {}) {
  const document = options.normalize === false ? value : createKnowledgeDocument(value);
  const rawMetadata = value?.metadata && typeof value.metadata === "object"
    ? value.metadata
    : {};
  const errors = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return { valid: false, errors: ["KnowledgeDocument must be an object"], value: null };
  }
  if (document.schemaVersion !== KNOWLEDGE_DOCUMENT_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${KNOWLEDGE_DOCUMENT_SCHEMA_VERSION}`);
  }
  if (!document.id) errors.push("id is required");
  if (!KNOWLEDGE_DOCUMENT_TYPES.includes(document.documentType)) {
    errors.push(`documentType must be one of: ${KNOWLEDGE_DOCUMENT_TYPES.join(", ")}`);
  }
  if (!document.title) errors.push("title is required");
  if (!document.text) errors.push("text is required");
  if (!document.metadata?.source) errors.push("metadata.source is required");
  if (!KNOWLEDGE_CLAIM_TYPES.includes(document.metadata?.claimType)) {
    errors.push(`metadata.claimType must be one of: ${KNOWLEDGE_CLAIM_TYPES.join(", ")}`);
  }
  if (document.metadata?.timestampStart !== null && document.metadata.timestampStart < 0) {
    errors.push("metadata.timestampStart must be non-negative");
  }
  if (document.metadata?.timestampEnd !== null && document.metadata.timestampEnd < 0) {
    errors.push("metadata.timestampEnd must be non-negative");
  }
  if (
    document.metadata?.timestampStart !== null
    && document.metadata?.timestampEnd !== null
    && document.metadata.timestampEnd < document.metadata.timestampStart
  ) {
    errors.push("metadata.timestampEnd must not precede timestampStart");
  }
  if (document.documentType === "video_guide") {
    if (document.metadata.source !== "youtube") errors.push("video_guide metadata.source must be youtube");
    for (const key of ["sourceId", "sourceTitle", "author", "publishedAt", "sourceUrl"]) {
      if (!document.metadata[key]) errors.push(`video_guide metadata.${key} is required`);
    }
    if (document.metadata.timestampStart === null) errors.push("video_guide metadata.timestampStart is required");
    if (!["creator_advice", "strategic_advice", "speculation"].includes(document.metadata.claimType)) {
      errors.push("video_guide claimType must be creator_advice, strategic_advice or speculation");
    }
    for (const key of ["season", "patch", "videoVersion", "transcriptHash", "segmentId"]) {
      if (!document.metadata[key]) errors.push(`video_guide metadata.${key} is required`);
    }
    if (!Number.isInteger(document.metadata.segmentIndex) || document.metadata.segmentIndex < 0) {
      errors.push("video_guide metadata.segmentIndex must be a non-negative integer");
    }
    if (!["success", "partial_success"].includes(document.metadata.ingestionStatus)) {
      errors.push("video_guide metadata.ingestionStatus must be success or partial_success");
    }
    if (document.metadata.aiGenerated !== true) {
      errors.push("video_guide metadata.aiGenerated must be true");
    }
    if (document.metadata.contentOrigin !== "ai_generated_transcript_summary") {
      errors.push(
        "video_guide metadata.contentOrigin must be ai_generated_transcript_summary"
      );
    }
    if (!["ai_generated_unreviewed", "human_reviewed"].includes(
      document.metadata.reviewStatus
    )) {
      errors.push(
        "video_guide metadata.reviewStatus must be ai_generated_unreviewed or human_reviewed"
      );
    }
    if (!document.metadata.contentDisclosure) {
      errors.push("video_guide metadata.contentDisclosure is required");
    }
    if (document.metadata.isCurrentVersion !== true) {
      errors.push("video_guide metadata.isCurrentVersion must be true");
    }
  }
  if (CURRENT_STATS_DOCUMENT_TYPES.includes(document.documentType)) {
    if (document.metadata.source !== "metatft") {
      errors.push(`${document.documentType} metadata.source must be metatft`);
    }
    if (document.metadata.claimType !== "statistics") {
      errors.push(`${document.documentType} metadata.claimType must be statistics`);
    }
    if (document.metadata.namespace !== "current_stats") {
      errors.push(`${document.documentType} metadata.namespace must be current_stats`);
    }
    for (const key of ["season", "patch", "rank", "timeWindow", "region"]) {
      if (!document.metadata[key]) errors.push(`${document.documentType} metadata.${key} is required`);
    }
    if (!document.metadata.topics.length) {
      errors.push(`${document.documentType} metadata.topics must not be empty`);
    }
    if (!(rawMetadata.generatedAt ?? rawMetadata.generated_at)) {
      errors.push(`${document.documentType} metadata.generatedAt is required`);
    }
    if (!(rawMetadata.expiresAt ?? rawMetadata.expires_at)) {
      errors.push(`${document.documentType} metadata.expiresAt is required`);
    }
    if (!document.metadata.rawData) {
      errors.push(`${document.documentType} metadata.rawData is required`);
    }
    if (
      document.metadata.semanticProjection?.schemaVersion
      !== CURRENT_STATS_SEMANTIC_PROJECTION_VERSION
    ) {
      errors.push(
        `${document.documentType} metadata.semanticProjection.schemaVersion must be ${CURRENT_STATS_SEMANTIC_PROJECTION_VERSION}`
      );
    }
    if (
      document.metadata.semanticProjection
      && document.metadata.semanticProjection.documentType !== document.documentType
    ) {
      errors.push(`${document.documentType} metadata.semanticProjection.documentType must match`);
    }
    for (const key of ["season", "patch", "rank", "timeWindow", "region"]) {
      if (
        document.metadata.semanticProjection
        && String(document.metadata.semanticProjection.scope?.[key] ?? "").toLowerCase()
          !== String(document.metadata[key] ?? "").toLowerCase()
      ) {
        errors.push(`${document.documentType} metadata.semanticProjection.scope.${key} must match`);
      }
    }
    if (!document.metadata.semanticProjectionConfig) {
      errors.push(`${document.documentType} metadata.semanticProjectionConfig is required`);
    }
    const rawGeneratedAt = rawMetadata.generatedAt ?? rawMetadata.generated_at;
    const rawExpiresAt = rawMetadata.expiresAt ?? rawMetadata.expires_at;
    if (rawGeneratedAt && !Number.isFinite(Date.parse(String(rawGeneratedAt)))) {
      errors.push(`${document.documentType} metadata.generatedAt must be a valid ISO date`);
    }
    if (rawExpiresAt && !Number.isFinite(Date.parse(String(rawExpiresAt)))) {
      errors.push(`${document.documentType} metadata.expiresAt must be a valid ISO date`);
    }
    const generatedAt = Date.parse(document.metadata.generatedAt ?? "");
    const expiresAt = Date.parse(document.metadata.expiresAt ?? "");
    if (Number.isFinite(generatedAt) && Number.isFinite(expiresAt) && expiresAt <= generatedAt) {
      errors.push(`${document.documentType} metadata.expiresAt must be after generatedAt`);
    }
  }
  if (document.metadata?.claimType === "strategic_advice" && !document.metadata.conditions.length) {
    errors.push("strategic_advice requires at least one applicable condition");
  }
  if (
    document.metadata?.claimType === "speculation"
    && !/(可能|通常|推测|大概|或许|倾向|likely|may|might|could|possibly)/i.test(document.text)
  ) {
    errors.push("speculation must use explicit uncertainty language");
  }
  return {
    valid: errors.length === 0,
    errors,
    value: errors.length === 0 ? document : null
  };
}

export function assertKnowledgeDocument(value, options = {}) {
  const validation = validateKnowledgeDocument(value, options);
  if (!validation.valid) throw new TypeError(`Invalid KnowledgeDocument: ${validation.errors.join("; ")}`);
  return validation.value;
}

export function assertCurrentStatsKnowledgeDocument(value, options = {}) {
  const document = assertKnowledgeDocument(value, options);
  if (!CURRENT_STATS_DOCUMENT_TYPES.includes(document.documentType)) {
    throw new TypeError(
      `Current stats documentType must be one of: ${CURRENT_STATS_DOCUMENT_TYPES.join(", ")}`
    );
  }
  return document;
}

export function knowledgeDocumentToSemanticDocument(value, options = {}) {
  const document = assertKnowledgeDocument(value);
  return {
    seasonContextId: String(options.seasonContextId ?? document.metadata.season ?? "set17-live"),
    id: document.id,
    documentType: document.documentType,
    content: document.text,
    patch: document.metadata.patch,
    locale: document.metadata.locale,
    source: document.metadata.source,
    updatedAt: document.metadata.generatedAt,
    metadata: {
      ...document.metadata,
      title: document.title,
      knowledgeSchemaVersion: document.schemaVersion
    }
  };
}

import {
  assertValid,
  canonicalResponseHash,
  lineupSignature,
  responseDocument,
  validateRawProbePair
} from "./contracts.js";

const API_BASE_URL = "https://api-hc.metatft.com";
const PAGE_URL = "https://www.metatft.com/comps";
const QUEUE = "1100";

function previousPatch(patch) {
  const match = /^(\d+)\.(\d+)$/u.exec(String(patch ?? ""));
  if (!match || Number(match[2]) <= 0) return null;
  return `${match[1]}.${Number(match[2]) - 1}`;
}

async function fetchJsonDocument(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "TFTClarity-PR1B-Developer-Probe/1.0"
      }
    });
    const contentType = String(response.headers.get("content-type") ?? "");
    const text = await response.text();
    if (!response.ok) {
      const failure = new Error(`MetaTFT probe request failed: ${response.status} ${url}`);
      failure.code = "PROBE_HTTP_ERROR";
      throw failure;
    }
    if (!contentType.includes("application/json")) {
      const failure = new Error(`MetaTFT probe received non-JSON content from ${url}`);
      failure.code = "PROBE_NON_JSON";
      throw failure;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (cause) {
      const failure = new Error(`MetaTFT probe received invalid JSON from ${url}`, { cause });
      failure.code = "PROBE_INVALID_JSON";
      throw failure;
    }
    return responseDocument(url, parsed, {
      status: response.status,
      contentType
    });
  } finally {
    clearTimeout(timer);
  }
}

function url(path, params = {}) {
  const value = new URL(path, API_BASE_URL);
  for (const [key, entry] of Object.entries(params)) {
    if (entry !== undefined && entry !== null) value.searchParams.set(key, String(entry));
  }
  return value.toString();
}

function patchLabel(response) {
  return `${String(response?.patch ?? "")}${String(response?.b_patch_version ?? "")}`;
}

function rawFixture({
  capturedAt,
  role,
  patch,
  bPatch,
  definition,
  source,
  documents,
  patchBinding,
  bindingProbes = null
}) {
  const signature = lineupSignature(definition);
  return {
    schemaVersion: "metatft-comp-guide-probe-raw.v1",
    parserVersion: "metatft-comp-guide-normalizer.v1",
    payloadKind: "metatft_comp_guide_probe",
    capturedAt,
    source: {
      provider: "MetaTFT",
      pageUrl: PAGE_URL,
      queue: QUEUE,
      tftSet: String(documents.compsData.response.tft_set),
      probeMode: "developer_only"
    },
    patch: {
      role,
      label: patch,
      bPatch
    },
    identity: {
      sourceCompId: String(definition.Cluster),
      sourceClusterId: String(documents.compsData.response.cluster_id),
      stableCompId: signature.stableCompId,
      signatureVersion: signature.version,
      units: signature.units,
      traits: signature.traits
    },
    endpoints: {
      patchDiscovery: documents.patchDiscovery,
      compsData: documents.compsData,
      compsStats: documents.compsStats,
      compDetails: documents.compDetails,
      compAugmentTiers: documents.compAugmentTiers
    },
    patchBinding,
    ...(bindingProbes ? { bindingProbes } : {}),
    capturePolicy: {
      immutableFixture: true,
      overwriteRequiresFlag: true,
      rawBodiesParsedWithoutFieldNormalization: true,
      productionRuntimeUsed: false
    }
  };
}

export async function captureMetaTftCompGuideProbe(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("MetaTFT probe requires fetch");
  const timeoutMs = Number(options.timeoutMs ?? 20000);
  const sourceCompId = String(options.sourceCompId ?? "409000");
  const capturedAt = new Date(options.now?.() ?? Date.now()).toISOString();

  const patchDiscovery = await fetchJsonDocument(fetchImpl, url("/tft-stat-api/patch"), timeoutMs);
  const currentPatch = patchLabel(patchDiscovery.response);
  const previous = String(options.previousPatch ?? previousPatch(currentPatch) ?? "");
  if (!/^\d+\.\d+$/u.test(currentPatch) || !/^\d+\.\d+$/u.test(previous) || currentPatch === previous) {
    const failure = new Error(`MetaTFT probe could not resolve a two-patch window: ${currentPatch}/${previous}`);
    failure.code = "PROBE_PATCH_WINDOW_INVALID";
    throw failure;
  }

  const compsData = await fetchJsonDocument(fetchImpl, url("/tft-comps-api/comps_data", { queue: QUEUE }), timeoutMs);
  const sourceClusterId = String(compsData.response.cluster_id ?? "");
  const definition = compsData.response?.results?.data?.cluster_details?.[sourceCompId];
  if (!definition || String(definition.Cluster) !== sourceCompId || !sourceClusterId) {
    const failure = new Error(`MetaTFT comps_data does not contain requested comp ${sourceCompId}`);
    failure.code = "PROBE_COMP_NOT_FOUND";
    throw failure;
  }

  const currentStats = await fetchJsonDocument(fetchImpl, url("/tft-comps-api/comps_stats", { queue: QUEUE }), timeoutMs);
  const previousStats = await fetchJsonDocument(fetchImpl, url("/tft-comps-api/comps_stats", {
    queue: QUEUE,
    patch: previous,
    b_patch: ""
  }), timeoutMs);
  const currentDetails = await fetchJsonDocument(fetchImpl, url("/tft-comps-api/comp_details", {
    comp: sourceCompId,
    cluster_id: sourceClusterId
  }), timeoutMs);
  const previousDetailsProbe = await fetchJsonDocument(fetchImpl, url("/tft-comps-api/comp_details", {
    comp: sourceCompId,
    cluster_id: sourceClusterId,
    patch: previous,
    b_patch: ""
  }), timeoutMs);
  const currentAugments = await fetchJsonDocument(fetchImpl, url("/tft-comps-api/comp_augment_tiers", {
    cluster_id: sourceClusterId
  }), timeoutMs);
  const previousAugmentsProbe = await fetchJsonDocument(fetchImpl, url("/tft-comps-api/comp_augment_tiers", {
    cluster_id: sourceClusterId,
    patch: previous,
    b_patch: ""
  }), timeoutMs);

  for (const [name, document] of Object.entries({ compsData, currentStats, previousStats, currentDetails, previousDetailsProbe, currentAugments, previousAugmentsProbe })) {
    if (String(document.response.tft_set ?? "") !== String(compsData.response.tft_set ?? "")) {
      const failure = new Error(`MetaTFT ${name} changed TFT set during capture`);
      failure.code = "PROBE_SET_MISMATCH";
      throw failure;
    }
    if (String(document.response.cluster_id ?? "") !== sourceClusterId) {
      const failure = new Error(`MetaTFT ${name} changed cluster during capture`);
      failure.code = "PROBE_CLUSTER_MISMATCH";
      throw failure;
    }
  }
  const detailsPatchBound = canonicalResponseHash(currentDetails.response) !== canonicalResponseHash(previousDetailsProbe.response);
  const augmentsPatchBound = canonicalResponseHash(currentAugments.response) !== canonicalResponseHash(previousAugmentsProbe.response);
  if (detailsPatchBound || augmentsPatchBound) {
    const failure = new Error("MetaTFT detail patch-binding behavior changed; the PR1B unbound contract requires review");
    failure.code = "PROBE_ENDPOINT_BINDING_CHANGED";
    failure.details = { detailsPatchBound, augmentsPatchBound };
    throw failure;
  }

  const current = rawFixture({
    capturedAt,
    role: "current",
    patch: currentPatch,
    bPatch: String(patchDiscovery.response.b_patch_version ?? ""),
    definition,
    documents: {
      patchDiscovery,
      compsData,
      compsStats: currentStats,
      compDetails: currentDetails,
      compAugmentTiers: currentAugments
    },
    patchBinding: {
      stats: "current_pointer",
      details: "current_pointer",
      augments: "current_pointer"
    }
  });
  const previousFixture = rawFixture({
    capturedAt,
    role: "previous",
    patch: previous,
    bPatch: "",
    definition,
    documents: {
      patchDiscovery,
      compsData,
      compsStats: previousStats,
      compDetails: null,
      compAugmentTiers: null
    },
    patchBinding: {
      stats: "explicit_patch_query",
      details: "unbound",
      augments: "unbound"
    },
    bindingProbes: {
      compDetails: previousDetailsProbe,
      compAugmentTiers: previousAugmentsProbe
    }
  });
  const fixtures = [current, previousFixture];
  assertValid(validateRawProbePair(fixtures), "captured MetaTFT comp guide probe pair is invalid");
  return {
    fixtures,
    diagnostics: {
      currentPatch,
      previousPatch: previous,
      sourceCompId,
      sourceClusterId,
      stableCompId: current.identity.stableCompId,
      detailsPatchBound,
      augmentsPatchBound,
      currentStatsSha256: currentStats.responseSha256,
      previousStatsSha256: previousStats.responseSha256
    }
  };
}

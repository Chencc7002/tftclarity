import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

/**
 * One-time probe: discover OP.GG MCP tft_get_play_style per-call return
 * capacity. Raw responses are written ONLY under the OS temp directory and
 * must be deleted after the probe finishes. No PUUID is printed or written
 * into the repository.
 */

const ENDPOINT = "https://mcp-api.op.gg/mcp";
const TARGET_TOOL = "tft_get_play_style";
const PROFILE_TOOL = "lol_get_summoner_profile";
const RUN_COUNT = 3;
const BETWEEN_RUNS_MS = 1500;
const RETRY_DELAY_MS = 3000;

const PROBE_DIR = join(tmpdir(), "opgg-play-style-probe");

function parseCliArguments(argv) {
  const options = {
    gameName: "chencc",
    tagLine: "1215",
    region: "na"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--game-name" && next) {
      options.gameName = next;
      index += 1;
      continue;
    }
    if (current === "--tag-line" && next) {
      options.tagLine = next;
      index += 1;
      continue;
    }
    if (current === "--region" && next) {
      options.region = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  return options;
}

const cliOptions = parseCliArguments(process.argv.slice(2));
const GAME_NAME = cliOptions.gameName;
const TAG_LINE = cliOptions.tagLine;
const REGION = cliOptions.region;

const PAGINATION_KEYS = [
  "count",
  "limit",
  "offset",
  "page",
  "cursor",
  "before",
  "after",
  "start",
  "hasMore",
  "nextCursor"
];

const MATCH_ID_KEYS = ["matchId", "match_id", "gameId", "game_id"];

let sessionId = null;
let protocolVersion = "2025-06-18";
let requestId = 0;

function sanitizeText(value) {
  const text = String(value ?? "");
  return text.replace(/[A-Za-z0-9_-]{30,}/g, "<redacted>");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseSseMessages(text) {
  const messages = [];
  const eventBlocks = text.split(/\r?\n\r?\n/);

  for (const block of eventBlocks) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();

    if (!data || data === "[DONE]") {
      continue;
    }

    try {
      messages.push(JSON.parse(data));
    } catch (error) {
      console.warn("Unable to parse SSE data block:", error.message);
    }
  }

  return messages;
}

async function readResponseMessages(response) {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}\n${text}`);
  }

  if (!text.trim()) {
    return { messages: [], text };
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("text/event-stream")) {
    return { messages: parseSseMessages(text), text };
  }

  try {
    const parsed = JSON.parse(text);
    return { messages: Array.isArray(parsed) ? parsed : [parsed], text };
  } catch {
    throw new Error(`Unable to parse MCP response as JSON or SSE:\n${text}`);
  }
}

async function sendMessage(message, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream"
  };

  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  if (options.includeProtocolHeader !== false) {
    headers["MCP-Protocol-Version"] = protocolVersion;
  }

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(message)
  });

  const returnedSessionId = response.headers.get("mcp-session-id");
  if (returnedSessionId) {
    sessionId = returnedSessionId;
  }

  const { messages, text } = await readResponseMessages(response);

  if (message.id === undefined) {
    return { result: null, headers: Object.fromEntries(response.headers), rawText: text };
  }

  const responseMessage =
    messages.find((candidate) => String(candidate?.id) === String(message.id)) ??
    messages.find(
      (candidate) =>
        candidate?.result !== undefined || candidate?.error !== undefined
    );

  if (!responseMessage) {
    throw new Error(`No JSON-RPC response found for request ${message.id}.`);
  }

  if (responseMessage.error) {
    const error = new Error(
      `MCP error ${responseMessage.error.code}: ${responseMessage.error.message}`
    );
    error.mcpCode = responseMessage.error.code;
    error.mcpData = responseMessage.error.data ?? null;
    throw error;
  }

  return {
    result: responseMessage.result,
    headers: Object.fromEntries(response.headers),
    rawText: text
  };
}

async function rpc(method, params = {}) {
  requestId += 1;
  return sendMessage({
    jsonrpc: "2.0",
    id: requestId,
    method,
    params
  });
}

async function initialize() {
  requestId += 1;

  const { result } = await sendMessage(
    {
      jsonrpc: "2.0",
      id: requestId,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "tftclarity-opgg-capacity-probe",
          version: "0.1.0"
        }
      }
    },
    { includeProtocolHeader: false }
  );

  protocolVersion = result?.protocolVersion ?? protocolVersion;

  await sendMessage({
    jsonrpc: "2.0",
    method: "notifications/initialized"
  });

  return result;
}

async function listAllTools() {
  const tools = [];
  let cursor = null;

  do {
    const { result } = await rpc("tools/list", cursor ? { cursor } : {});
    tools.push(...(result?.tools ?? []));
    cursor = result?.nextCursor ?? null;
  } while (cursor);

  return tools;
}

async function terminateSession() {
  if (!sessionId) {
    return;
  }

  try {
    await fetch(ENDPOINT, {
      method: "DELETE",
      headers: {
        "Mcp-Session-Id": sessionId,
        "MCP-Protocol-Version": protocolVersion
      }
    });
  } catch {
    // Session termination failure does not affect probe results.
  }
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function isMatchObject(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return false;
  }

  const hasId = MATCH_ID_KEYS.some(
    (key) => candidate[key] !== undefined && candidate[key] !== null
  );
  const hasInfo = candidate.info !== null && typeof candidate.info === "object";
  const hasSummary =
    candidate.summary !== null && typeof candidate.summary === "object";
  const summaryComplete =
    hasSummary &&
    Array.isArray(candidate.summary.units) &&
    Array.isArray(candidate.summary.traits) &&
    candidate.summary.placement !== undefined;

  if (hasId && (hasInfo || hasSummary || candidate.placement !== undefined)) {
    return true;
  }
  if (hasInfo && (summaryComplete || hasSummary)) {
    return true;
  }

  return false;
}

function collectArrays(value, path, out) {
  if (Array.isArray(value)) {
    out.push({ path, value });
    value.forEach((item, index) =>
      collectArrays(item, `${path}[${index}]`, out)
    );
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectArrays(child, path ? `${path}.${key}` : key, out);
    }
  }
}

function getMatchId(match) {
  const value = firstDefined(
    match?.metadata?.matchId,
    match?.matchId,
    match?.info?.matchId,
    match?.match_id,
    match?.info?.gameId,
    match?.gameId,
    match?.game_id
  );
  return value === undefined || value === null ? null : String(value);
}

function getUnits(match) {
  return firstDefined(match?.summary?.units, match?.units, match?.data?.units);
}

function getTraits(match) {
  return firstDefined(match?.summary?.traits, match?.traits, match?.data?.traits);
}

function getGameDatetime(match) {
  const value = firstDefined(
    match?.info?.gameDatetime,
    match?.info?.gameCreation,
    match?.gameDatetime,
    match?.gameCreation
  );
  if (typeof value !== "number") {
    return null;
  }
  // Normalize seconds (10-digit epoch) to milliseconds.
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function getCompositeKey(match) {
  const units = getUnits(match);
  const unitIds = Array.isArray(units)
    ? units
        .map((unit) => unit?.characterId ?? unit?.name ?? unit?.id ?? "")
        .sort()
        .join(",")
    : "";
  return [
    getGameDatetime(match) ?? "",
    match?.summary?.placement ?? match?.placement ?? "",
    match?.summary?.level ?? match?.level ?? "",
    unitIds
  ].join("|");
}

function hasUnitItems(match) {
  const units = getUnits(match);
  if (!Array.isArray(units) || units.length === 0) {
    return false;
  }
  return units.every(
    (unit) =>
      Array.isArray(unit?.itemNames) ||
      Array.isArray(unit?.items) ||
      unit?.itemIds !== undefined ||
      unit?.items !== undefined
  );
}

function analyzeMatchCompleteness(match) {
  const units = getUnits(match);
  const traits = getTraits(match);
  const summary = match?.summary ?? {};
  const info = match?.info ?? {};

  return {
    matchId: getMatchId(match),
    placement: firstDefined(summary.placement, match.placement),
    level: firstDefined(summary.level, match.level),
    traits: Array.isArray(traits) && traits.length > 0,
    units: Array.isArray(units) && units.length > 0,
    unitItems: hasUnitItems(match),
    gameDatetime: getGameDatetime(match),
    goldLeft: firstDefined(summary.goldLeft, match.goldLeft),
    lastRound: firstDefined(summary.lastRound, match.lastRound),
    playersEliminated: firstDefined(
      summary.playersEliminated,
      match.playersEliminated
    ),
    augments: firstDefined(summary.augments, match.augments),
    companion: firstDefined(summary.companion, match.companion)
  };
}

function isCompleteMatch(analysis) {
  return (
    analysis.placement !== undefined &&
    analysis.level !== undefined &&
    analysis.traits === true &&
    analysis.units === true &&
    analysis.unitItems === true
  );
}

function findMatchArray(parsed) {
  const arrays = [];
  collectArrays(parsed, "", arrays);

  const preferredPaths = [
    "items.data",
    "data.matches",
    "result.matches",
    "result.items",
    "data.items",
    "matches",
    "games",
    "recentMatches",
    "items",
    "result.matches.data"
  ];

  let best = null;
  let bestScore = -1;

  for (const candidate of arrays) {
    const elements = candidate.value;
    if (!Array.isArray(elements) || elements.length === 0) {
      continue;
    }
    const matchElements = elements.filter((element) =>
      isMatchObject(element)
    );
    const score =
      matchElements.length -
      (elements.length - matchElements.length) * 2;

    if (score <= 0) {
      continue;
    }

    const preference = preferredPaths.indexOf(candidate.path);
    const priority = preference === -1 ? 100 + preference : preference;

    if (
      !best ||
      score > bestScore ||
      (score === bestScore && priority < best.priority)
    ) {
      best = { ...candidate, matchElements };
      bestScore = score;
    }
  }

  return best;
}

function extractMatches(parsed) {
  const matchArray = findMatchArray(parsed);
  const matches = [];
  const arraySources = [];

  if (matchArray) {
    matches.push(...matchArray.matchElements);
    arraySources.push(matchArray.path);
  }

  // Also catch match objects directly under common single-match roots.
  for (const rootKey of ["data", "result", "match"]) {
    const rootValue = parsed?.[rootKey];
    if (rootValue && typeof rootValue === "object" && !Array.isArray(rootValue)) {
      if (isMatchObject(rootValue) && !matches.includes(rootValue)) {
        matches.push(rootValue);
      }
    }
  }

  return {
    matches,
    matchArrayPath: matchArray?.path ?? (matches.length ? "(direct object)" : null),
    rawArrayLength: matchArray?.value.length ?? (matches.length ? 1 : 0)
  };
}

function parsePayload(result) {
  const parsedCandidates = [];
  const warnings = [];

  if (result?.structuredContent !== undefined) {
    parsedCandidates.push(result.structuredContent);
  }

  const contents = Array.isArray(result?.content) ? result.content : [];

  for (const content of contents) {
    if (typeof content?.text !== "string") {
      continue;
    }

    const text = content.text.trim();
    if (!text) {
      continue;
    }

    try {
      parsedCandidates.push(JSON.parse(text));
      continue;
    } catch {
      // Fall through to markdown code block handling.
    }

    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock?.[1]) {
      try {
        parsedCandidates.push(JSON.parse(codeBlock[1].trim()));
        warnings.push("parsed JSON from markdown code block");
        continue;
      } catch {
        // Fall through.
      }
    }

    warnings.push("content text is not parseable JSON");
  }

  return { parsedCandidates, warnings };
}

function detectTruncation(result, rawText) {
  const flags = [];
  const walk = (value) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (
        ["hasMore", "nextCursor", "truncated", "isTruncated"].includes(key) &&
        child !== undefined &&
        child !== null &&
        child !== false
      ) {
        flags.push(`${key}=${String(child).slice(0, 60)}`);
      }
      walk(child);
    }
  };
  walk(result);

  const suspiciousTail = /[}\]]\s*\.\.\.\s*$/;
  if (typeof rawText === "string" && suspiciousTail.test(rawText)) {
    flags.push("rawTextEndsWithEllipsis");
  }

  return flags.length > 0;
}

function cacheInfo(headers) {
  const header = Object.fromEntries(
    Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
  );
  const cacheStatus =
    header["x-cache"] ??
    header["cf-cache-status"] ??
    header["x-vercel-cache"] ??
    header["x-cache-status"] ??
    null;
  const age = header["age"] ?? null;

  if (cacheStatus === null) {
    return { cacheHit: null, cacheStatus: null, age };
  }
  return {
    cacheHit:
      /hit|stale|fresh|served/i.test(String(cacheStatus)) &&
      !/miss/i.test(String(cacheStatus)),
    cacheStatus: String(cacheStatus),
    age
  };
}

async function callToolOnce(name, args, runIndex) {
  const startedAt = Date.now();
  let callResult;

  try {
    const response = await rpc("tools/call", { name, arguments: args });
    callResult = response;
  } catch (error) {
    const retryable =
      error?.mcpCode === 429 ||
      /rate\s*limit|too many|429/i.test(String(error?.message ?? ""));

    if (retryable) {
      await sleep(RETRY_DELAY_MS);
      try {
        const response = await rpc("tools/call", { name, arguments: args });
        callResult = { ...response, retriedAfterRateLimit: true };
      } catch (retryError) {
        throw retryError;
      }
    } else {
      throw error;
    }
  }

  const latencyMs = Date.now() - startedAt;
  const { parsedCandidates, warnings } = parsePayload(callResult.result);
  const combinedParsed = parsedCandidates.find(
    (candidate) => candidate !== undefined && candidate !== null
  ) ?? {};

  const { matches, matchArrayPath, rawArrayLength } =
    extractMatches(combinedParsed);

  const seen = new Map();
  const analyses = [];
  let compositeKeyUsed = false;

  for (const match of matches) {
    const analysis = analyzeMatchCompleteness(match);
    const id = analysis.matchId;
    let key = id;
    if (!key) {
      key = getCompositeKey(match);
      compositeKeyUsed = true;
    }
    analyses.push({ ...analysis, dedupeKey: key });

    if (!seen.has(key)) {
      seen.set(key, {
        matchId: id,
        gameDatetime: analysis.gameDatetime,
        complete: isCompleteMatch(analysis)
      });
    }
  }

  const unique = [...seen.values()];
  const datetimes = unique
    .map((entry) => entry.gameDatetime)
    .filter((value) => typeof value === "number");
  const newestMatchTime = datetimes.length
    ? new Date(Math.max(...datetimes)).toISOString()
    : null;
  const oldestMatchTime = datetimes.length
    ? new Date(Math.min(...datetimes)).toISOString()
    : null;

  const cache = cacheInfo(callResult.headers);
  const truncated = detectTruncation(callResult.result, callResult.rawText);
  const payloadKB = Number(
    (Buffer.byteLength(callResult.rawText ?? "", "utf8") / 1024).toFixed(2)
  );

  return {
    stats: {
      run: runIndex,
      toolName: name,
      latencyMs,
      cacheHit: cache.cacheHit,
      cacheStatus: cache.cacheStatus,
      rateLimited: Boolean(callResult.retriedAfterRateLimit),
      truncated,
      parseWarnings: warnings,
      rawArrayLength,
      detectedMatchObjects: matches.length,
      uniqueMatchCount: unique.length,
      duplicateCount: matches.length - unique.length,
      completeMatchCount: unique.filter((entry) => entry.complete).length,
      newestMatchTime,
      oldestMatchTime,
      payloadKB,
      matchArrayPath,
      compositeKeyUsed,
      matchIds: unique.map((entry) => entry.matchId),
      completeMatchIds: unique
        .filter((entry) => entry.complete)
        .map((entry) => entry.matchId)
    },
    rawResponse: callResult.result,
    rawText: callResult.rawText
  };
}

function extractPuuid(result) {
  let found = null;

  const walk = (value, path) => {
    if (found) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "puuid" && typeof child === "string" && child.length >= 30) {
        found = { path: path ? `${path}.${key}` : key, value: child };
        return;
      }
      walk(child, path ? `${path}.${key}` : key);
    }
  };

  walk(result, "");
  return found;
}

function extractPuuidFromText(text) {
  if (typeof text !== "string") {
    return null;
  }
  const quoted =
    text.match(/["']([A-Za-z0-9_-]{30,})["']/g) ?? [];

  // Riot PUUIDs are exactly 78 URL-safe characters; prefer that shape
  // over other long identifiers (summoner_id / acct_id) that may appear
  // earlier in a Python-repr profile payload.
  for (const token of quoted) {
    const value = token.slice(1, -1);
    if (value.length === 78) {
      return value;
    }
  }

  for (const token of quoted) {
    const value = token.slice(1, -1);
    if (value.length >= 30) {
      return value;
    }
  }
  return null;
}

async function resolveProfile() {
  const baseArgs = {
    game_name: GAME_NAME,
    tag_line: TAG_LINE,
    region: REGION
  };

  const attempts = [
    { label: "without desired_output_fields", args: { ...baseArgs } },
    {
      label: "with desired_output_fields",
      args: {
        ...baseArgs,
        desired_output_fields: ["data.summoner.{game_name,tagline,puuid}"]
      }
    }
  ];

  let lastError = null;
  const attemptResults = [];

  for (const attempt of attempts) {
    try {
      const startedAt = Date.now();
      const response = await rpc("tools/call", {
        name: PROFILE_TOOL,
        arguments: attempt.args
      });
      const payload = parsePayload(response.result);
      const parsed =
        payload.parsedCandidates.find(
          (candidate) => candidate !== undefined && candidate !== null
        ) ?? response.result;
      const textContents = Array.isArray(response.result?.content)
        ? response.result.content
            .filter((item) => typeof item?.text === "string")
            .map((item) => item.text)
        : [];
      const textPuuid = textContents
        .map(extractPuuidFromText)
        .find(Boolean);
      const extracted =
        extractPuuid(parsed) ??
        (textPuuid
          ? {
              path: "content[].text (non-JSON Python repr)",
              value: textPuuid
            }
          : null);

      await writeJson(
        join(PROBE_DIR, "profile.json"),
        {
          request: attempt.args,
          latencyMs: Date.now() - startedAt,
          response: response.result
        }
      );

      if (extracted) {
        attemptResults.push({ label: attempt.label, ok: true });
        return {
          puuid: extracted.value,
          puuidPath: extracted.path,
          usedAttempt: attempt.label,
          attemptResults,
          latencyMs: Date.now() - startedAt,
          profilePayloadKB: Number(
            (
              Buffer.byteLength(response.rawText ?? "", "utf8") / 1024
            ).toFixed(2)
          )
        };
      }

      lastError = new Error("profile response did not contain a PUUID");
      attemptResults.push({
        label: attempt.label,
        ok: false,
        error: "no PUUID found in response"
      });
    } catch (error) {
      lastError = error;
      attemptResults.push({
        label: attempt.label,
        ok: false,
        error: sanitizeText(error?.message ?? "unknown")
      });
    }
  }

  throw new Error(
    `Unable to resolve PUUID: ${sanitizeText(lastError?.message ?? "unknown")}`
  );
}

async function main() {
  await mkdir(PROBE_DIR, { recursive: true });

  const probe = {
    startedAt: new Date().toISOString(),
    endpoint: ENDPOINT,
    account: `${GAME_NAME}#${TAG_LINE}`,
    region: REGION,
    toolsList: {},
    schemas: {},
    profile: {},
    runs: [],
    comparison: {},
    pagination: {},
    errors: []
  };

  console.log(`Connecting to ${ENDPOINT} ...`);

  try {
    const initializeResult = await initialize();
    probe.protocolVersion = protocolVersion;
    probe.sessionIdAssigned = Boolean(sessionId);
    probe.initializeResult = initializeResult;

    console.log("Fetching tools/list ...");
    let tools = [];
    try {
      tools = await listAllTools();
      probe.toolsList = {
        ok: true,
        toolCount: tools.length,
        tftToolCount: tools.filter((tool) =>
          String(tool?.name ?? "").startsWith("tft_")
        ).length
      };
      console.log(
        `tools/list ok: ${tools.length} tools received.`
      );
    } catch (error) {
      probe.toolsList = {
        ok: false,
        error: sanitizeText(error?.message ?? "unknown"),
        note:
          "tools/list failed; proceeding with known tool names via tools/call."
      };
      probe.errors.push(`tools/list: ${probe.toolsList.error}`);
      console.warn("tools/list failed:", probe.toolsList.error);
    }

    const definitions = {};
    for (const toolName of [PROFILE_TOOL, TARGET_TOOL]) {
      const definition = tools.find((tool) => tool?.name === toolName) ?? null;
      definitions[toolName] = definition;

      const schema = definition?.inputSchema ?? {};
      const properties = schema.properties ?? {};
      const declaredPagination = PAGINATION_KEYS.filter(
        (key) => properties[key] !== undefined
      );
      const required = new Set(schema.required ?? []);

      probe.schemas[toolName] = {
        foundInToolsList: Boolean(definition),
        description: definition?.description ?? null,
        parameters: Object.fromEntries(
          Object.entries(properties).map(([name, item]) => [
            name,
            {
              type: item?.type ?? null,
              required: required.has(name),
              description: sanitizeText(
                String(item?.description ?? "").slice(0, 220)
              ),
              enum: item?.enum ?? null,
              default: item?.default ?? null
            }
          ])
        ),
        declaredPaginationFields: declaredPagination,
        outputSchema: definition?.outputSchema ?? null
      };
    }

    const tftSchema = probe.schemas[TARGET_TOOL];
    console.log(
      `${TARGET_TOOL} schema found: ${tftSchema.foundInToolsList}; ` +
        `declared pagination fields: ` +
        (tftSchema.declaredPaginationFields.length
          ? tftSchema.declaredPaginationFields.join(", ")
          : "none")
    );

    const countField = tftSchema.declaredPaginationFields.find((key) =>
      ["count", "limit"].includes(key)
    );
    probe.pagination = {
      supportsCountOrLimit: Boolean(countField),
      countField,
      supportsPagination: tftSchema.declaredPaginationFields.some((key) =>
        ["offset", "page", "cursor", "before", "after", "start"].includes(key)
      ),
      note:
        countField || tftSchema.declaredPaginationFields.length
          ? null
          : "Schema declares neither count/limit nor pagination fields; " +
            "no guessed parameters will be sent."
    };

    console.log("Resolving summoner profile ...");
    const profile = await resolveProfile();
    probe.profile = {
      resolved: true,
      usedAttempt: profile.usedAttempt,
      puuidPath: profile.puuidPath,
      latencyMs: profile.latencyMs,
      profilePayloadKB: profile.profilePayloadKB
    };
    console.log("Profile resolved (PUUID kept out of logs).");

    const runArgs = { region: REGION, puuid: profile.puuid };
    await writeJson(join(PROBE_DIR, "call-arguments.json"), runArgs);

    for (let run = 1; run <= RUN_COUNT; run += 1) {
      if (run > 1) {
        await sleep(BETWEEN_RUNS_MS);
      }

      console.log(`Calling ${TARGET_TOOL} (run ${run}/${RUN_COUNT}) ...`);

      try {
        const { stats, rawResponse } = await callToolOnce(
          TARGET_TOOL,
          runArgs,
          run
        );
        probe.runs.push(stats);
        await writeJson(
          join(PROBE_DIR, `play-style-run-${run}.json`),
          {
            run,
            requestedAt: new Date().toISOString(),
            latencyMs: stats.latencyMs,
            cacheHit: stats.cacheHit,
            truncated: stats.truncated,
            response: rawResponse
          }
        );
        console.log(
          `  run ${run}: unique=${stats.uniqueMatchCount} ` +
            `complete=${stats.completeMatchCount} ` +
            `rawArray=${stats.rawArrayLength} payloadKB=${stats.payloadKB}`
        );
      } catch (error) {
        probe.errors.push(
          `run ${run}: ${sanitizeText(error?.message ?? "unknown")}`
        );
        probe.runs.push({
          run,
          toolName: TARGET_TOOL,
          error: sanitizeText(error?.message ?? "unknown"),
          latencyMs: null,
          cacheHit: null,
          rateLimited: error?.mcpCode === 429,
          truncated: false,
          parseWarnings: [],
          rawArrayLength: 0,
          detectedMatchObjects: 0,
          uniqueMatchCount: 0,
          duplicateCount: 0,
          completeMatchCount: 0,
          newestMatchTime: null,
          oldestMatchTime: null,
          payloadKB: 0,
          matchArrayPath: null,
          compositeKeyUsed: false,
          matchIds: [],
          completeMatchIds: []
        });
        console.warn(`  run ${run} failed: ${probe.errors.at(-1)}`);
      }
    }

    if (probe.pagination.supportsCountOrLimit && probe.runs[0]) {
      console.log(`Testing ${probe.pagination.countField}=20 ...`);
      const testArgs = {
        ...runArgs,
        [probe.pagination.countField]: 20
      };
      const { stats, rawResponse } = await callToolOnce(
        TARGET_TOOL,
        testArgs,
        4
      );
      probe.paginationTest = stats;
      await writeJson(join(PROBE_DIR, "play-style-run-4-count20.json"), {
        run: 4,
        requestedAt: new Date().toISOString(),
        latencyMs: stats.latencyMs,
        response: rawResponse
      });
      console.log(
        `  count test: unique=${stats.uniqueMatchCount} complete=${stats.completeMatchCount}`
      );
    } else {
      probe.paginationTest = {
        tested: false,
        reason: "tool schema does not declare count/limit; no guessed args sent"
      };
    }

    const successRuns = probe.runs.filter((run) => !run.error);
    const uniqueCounts = successRuns.map((run) => run.uniqueMatchCount);
    const completeCounts = successRuns.map((run) => run.completeMatchCount);
    const idSets = successRuns.map((run) => new Set(run.matchIds));
    const allHaveIds = successRuns.every(
      (run) => run.matchIds.length > 0 && !run.compositeKeyUsed
    );

    const sameSets =
      successRuns.length > 1 &&
      idSets.every(
        (set, index) =>
          index === 0 ||
          (set.size === idSets[0].size &&
            [...set].every((id) => idSets[0].has(id)))
      );

    const sameOrder =
      successRuns.length > 1 &&
      successRuns.every(
        (run, index) =>
          index === 0 ||
          JSON.stringify(run.matchIds) ===
            JSON.stringify(successRuns[0].matchIds)
      );

    const run2New = successRuns[1]
      ? successRuns[1].matchIds.filter(
          (id) => !new Set(successRuns[0].matchIds).has(id)
        )
      : [];
    const run3New = successRuns[2]
      ? successRuns[2].matchIds.filter(
          (id) =>
            !new Set([
              ...(successRuns[0]?.matchIds ?? []),
              ...(successRuns[1]?.matchIds ?? [])
            ]).has(id)
        )
      : [];

    const allDatetimes = [];
    for (const run of successRuns) {
      if (run.oldestMatchTime) {
        allDatetimes.push(Date.parse(run.oldestMatchTime));
      }
    }
    const oldestAgeMs = allDatetimes.length
      ? Date.now() - Math.min(...allDatetimes)
      : null;

    probe.comparison = {
      observedMinimum: uniqueCounts.length
        ? Math.min(...uniqueCounts)
        : 0,
      observedMaximum: uniqueCounts.length
        ? Math.max(...uniqueCounts)
        : 0,
      completeMinimum: completeCounts.length
        ? Math.min(...completeCounts)
        : 0,
      completeMaximum: completeCounts.length
        ? Math.max(...completeCounts)
        : 0,
      stableCounts:
        successRuns.length >= 2 &&
        new Set(uniqueCounts).size === 1 &&
        new Set(completeCounts).size === 1,
      sameMatchIdSets: sameSets,
      sameMatchOrder: sameOrder,
      allRunsHaveStableMatchIds: allHaveIds && sameSets,
      paginationDetected: successRuns.some((run) => run.truncated),
      newMatchesRun2: run2New,
      newMatchesRun3: run3New,
      oldestMatchAgeMs: oldestAgeMs
    };

    const minUnique = probe.comparison.observedMinimum;
    const minComplete = probe.comparison.completeMinimum;
    const stable = probe.comparison.stableCounts;
    const stableIds = probe.comparison.allRunsHaveStableMatchIds;

    let conclusion;
    let role;

    if (!stable) {
      conclusion =
        "数量不稳定：不能作为稳定统计源，需检查缓存、限流、上下文截断或适配器解析问题。";
      role = "unstable_stats_unsuitable";
    } else if (minUnique >= 20 && minComplete >= 20) {
      conclusion =
        "稳定返回20场以上且完整对局≥20：可直接支持20场个人复盘，可用于职业选手小型趋势聚合。";
      role = "primary_review_source";
    } else if (minUnique >= 10 && minComplete >= 10) {
      conclusion =
        "稳定返回10—19场且完整对局≥10：可支持10场个人复盘；20场需要分页或本地持续增量积累。";
      role = "ten_match_review_supported";
    } else if (minUnique >= 5 && minComplete >= 5) {
      conclusion =
        "稳定返回5—9场：不适合首次完整10场复盘；" +
        (stableIds
          ? "有稳定Match ID，可定期抓取并本地累计。"
          : "Match ID不稳定，本地累计可靠性不足。");
      role = "incremental_accumulation_only";
    } else {
      conclusion =
        "少于5场：只适合作为玩法风格预览或辅助数据源，不适合作为正式复盘主数据源。";
      role = "play_style_preview_auxiliary";
    }

    probe.finalJudgment = {
      suitableFor10MatchReview:
        stable && minUnique >= 10 && minComplete >= 10,
      suitableFor20MatchReview:
        stable && minUnique >= 20 && minComplete >= 20,
      suitableForIncrementalCollection:
        stable && minUnique >= 5 && stableIds,
      recommendedRole: role,
      conclusion
    };

    await writeJson(join(PROBE_DIR, "summary-sanitized.json"), probe);

    console.log("\n===== SANITIZED PROBE SUMMARY =====");
    console.log(
      JSON.stringify(
        {
          toolsList: probe.toolsList,
          schemas: {
            [TARGET_TOOL]: {
              parameters: Object.keys(
                probe.schemas[TARGET_TOOL].parameters
              ),
              declaredPaginationFields:
                probe.schemas[TARGET_TOOL].declaredPaginationFields,
              outputSchema:
                probe.schemas[TARGET_TOOL].outputSchema ?? null
            }
          },
          profile: probe.profile,
          runs: probe.runs.map((run) => ({
            run: run.run,
            error: run.error ?? null,
            latencyMs: run.latencyMs,
            rawArrayLength: run.rawArrayLength,
            detectedMatchObjects: run.detectedMatchObjects,
            uniqueMatchCount: run.uniqueMatchCount,
            duplicateCount: run.duplicateCount,
            completeMatchCount: run.completeMatchCount,
            newestMatchTime: run.newestMatchTime,
            oldestMatchTime: run.oldestMatchTime,
            payloadKB: run.payloadKB,
            matchArrayPath: run.matchArrayPath,
            matchIds: run.matchIds,
            completeMatchIds: run.completeMatchIds,
            cacheHit: run.cacheHit,
            truncated: run.truncated
          })),
          comparison: probe.comparison,
          paginationTest: probe.paginationTest,
          finalJudgment: probe.finalJudgment,
          errors: probe.errors
        },
        null,
        2
      )
    );
  } finally {
    await terminateSession();
  }
}

main().catch((error) => {
  console.error("OP.GG capacity probe failed:");
  console.error(sanitizeText(error?.stack ?? error));
  process.exitCode = 1;
});

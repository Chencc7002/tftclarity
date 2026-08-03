import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const ENDPOINT = "https://mcp-api.op.gg/mcp";
const TARGET_TOOL = "lol_get_summoner_profile";
const OUTPUT_DIR = resolve(
  process.cwd(),
  ".cache",
  "opgg-profile-probe"
);

let sessionId = null;
let protocolVersion = "2025-06-18";
let requestId = 0;

function parseCliArguments(argv) {
  const options = {
    argumentsFile: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === "--args") {
      const next = argv[index + 1];

      if (!next) {
        throw new Error("--args requires a JSON file path.");
      }

      options.argumentsFile = resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  return options;
}

async function writeJson(filePath, value) {
  await writeFile(
    filePath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8"
  );
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
      console.warn("Unable to parse SSE data block:");
      console.warn(data);
      console.warn(error.message);
    }
  }

  return messages;
}

async function readResponseMessages(response) {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}\n${text}`
    );
  }

  if (!text.trim()) {
    return [];
  }

  const contentType =
    response.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("text/event-stream")) {
    return parseSseMessages(text);
  }

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    throw new Error(
      `Unable to parse MCP response as JSON or SSE:\n${text}`
    );
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

  const returnedSessionId =
    response.headers.get("mcp-session-id");

  if (returnedSessionId) {
    sessionId = returnedSessionId;
  }

  const messages = await readResponseMessages(response);

  // Notification normally has no response body.
  if (message.id === undefined) {
    return null;
  }

  const responseMessage =
    messages.find(
      (candidate) => String(candidate?.id) === String(message.id)
    ) ??
    messages.find(
      (candidate) =>
        candidate?.result !== undefined ||
        candidate?.error !== undefined
    );

  if (!responseMessage) {
    throw new Error(
      `No JSON-RPC response found for request ${message.id}.`
    );
  }

  if (responseMessage.error) {
    throw new Error(
      `MCP error ${responseMessage.error.code}: ` +
      `${responseMessage.error.message}\n` +
      JSON.stringify(responseMessage.error.data ?? null, null, 2)
    );
  }

  return responseMessage.result;
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

  const result = await sendMessage(
    {
      jsonrpc: "2.0",
      id: requestId,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "tftclarity-opgg-raw-probe",
          version: "0.1.0"
        }
      }
    },
    {
      includeProtocolHeader: false
    }
  );

  protocolVersion =
    result?.protocolVersion ?? protocolVersion;

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
    const result = await rpc(
      "tools/list",
      cursor ? { cursor } : {}
    );

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

function summarizeTool(tool) {
  const schema = tool?.inputSchema ?? {};
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  return {
    name: tool?.name ?? null,
    title: tool?.title ?? tool?.annotations?.title ?? null,
    description: tool?.description ?? null,
    parameters: Object.entries(properties).map(
      ([name, definition]) => ({
        name,
        required: required.has(name),
        type: definition?.type ?? null,
        description: definition?.description ?? null,
        enum: definition?.enum ?? null,
        default: definition?.default ?? null
      })
    ),
    inputSchema: schema,
    outputSchema: tool?.outputSchema ?? null
  };
}

async function main() {
  const cli = parseCliArguments(process.argv.slice(2));

  await mkdir(OUTPUT_DIR, {
    recursive: true
  });

  console.log(`Connecting to ${ENDPOINT} ...`);

  try {
    const initializeResult = await initialize();

    console.log(
      `Connected. Protocol: ${protocolVersion}`
    );

    if (sessionId) {
      console.log("Server created an MCP session.");
    }

    await writeJson(
      resolve(OUTPUT_DIR, "server-info.json"),
      {
        endpoint: ENDPOINT,
        protocolVersion,
        sessionIdAssigned: Boolean(sessionId),
        initializeResult,
        fetchedAt: new Date().toISOString()
      }
    );

    console.log("Fetching raw tools/list ...");

    const tools = await listAllTools();

    await writeJson(
      resolve(OUTPUT_DIR, "tools-list.json"),
      tools
    );

    const tftTools = tools.filter((tool) =>
      String(tool?.name ?? "").startsWith("tft_")
    );

    console.log(
      `Received ${tools.length} tools; ` +
      `${tftTools.length} are TFT tools.`
    );

    console.log("\nAvailable TFT tools:");

    for (const tool of tftTools) {
      console.log(`- ${tool.name}: ${tool.description ?? ""}`);
    }

    const targetTool = tools.find(
      (tool) => tool?.name === TARGET_TOOL
    );

    if (!targetTool) {
      throw new Error(
        `${TARGET_TOOL} was not found. ` +
        `Available TFT tools: ` +
        tftTools.map((tool) => tool.name).join(", ")
      );
    }

    await writeJson(
      resolve(OUTPUT_DIR, "tool-definition.json"),
      targetTool
    );

    await writeJson(
      resolve(OUTPUT_DIR, "tool-summary.json"),
      summarizeTool(targetTool)
    );

    console.log("\nTarget tool definition:");
    console.log(JSON.stringify(targetTool, null, 2));

    if (!cli.argumentsFile) {
      console.log(
        "\nSchema probe completed." +
        "\nCheck:" +
        "\n  .cache\\opgg-play-style-probe\\" +
        "tool-definition.json"
      );

      return;
    }

    const argumentsText = await readFile(
      cli.argumentsFile,
      "utf8"
    );

    const toolArguments = JSON.parse(argumentsText);

    if (
      !toolArguments ||
      typeof toolArguments !== "object" ||
      Array.isArray(toolArguments)
    ) {
      throw new TypeError(
        "Tool arguments must be a JSON object."
      );
    }

    await writeJson(
      resolve(OUTPUT_DIR, "call-arguments.json"),
      toolArguments
    );

    console.log("\nCalling tft_get_play_style ...");

    const startedAt = Date.now();

    const callResult = await rpc("tools/call", {
      name: TARGET_TOOL,
      arguments: toolArguments
    });

    const savedResult = {
      latencyMs: Date.now() - startedAt,
      result: callResult
    };

    await writeJson(
      resolve(OUTPUT_DIR, "call-result.json"),
      savedResult
    );

    console.log("\nCall result:");
    console.log(JSON.stringify(savedResult, null, 2));
  } finally {
    await terminateSession();
  }
}

main().catch((error) => {
  console.error("\nOP.GG raw MCP probe failed:");
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});

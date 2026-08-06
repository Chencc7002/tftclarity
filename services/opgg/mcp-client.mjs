/**
 * Shared OP.GG MCP client (Streamable HTTP over JSON-RPC).
 *
 * This is the single long-term client used by project services. One-off
 * probe scripts under scripts/ keep their own inline copies for historical
 * reproducibility; new code should import this module instead of duplicating
 * the transport.
 *
 * Privacy: callers are responsible for not printing PUUIDs. This module
 * never logs request arguments or response bodies.
 */

const DEFAULT_ENDPOINT = "https://mcp-api.op.gg/mcp";
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

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
    } catch {
      // Skip malformed SSE blocks; the JSON-RPC matcher below still works
      // as long as the response message itself parsed.
    }
  }

  return messages;
}

function createOpggClient(options = {}) {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  let protocolVersion = DEFAULT_PROTOCOL_VERSION;
  let sessionId = null;
  let requestId = 0;
  let initialized = false;

  async function sendMessage(message, includeProtocolHeader = true) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
    };

    if (sessionId) {
      headers["Mcp-Session-Id"] = sessionId;
    }
    if (includeProtocolHeader) {
      headers["MCP-Protocol-Version"] = protocolVersion;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(message)
    });

    const returnedSessionId = response.headers.get("mcp-session-id");
    if (returnedSessionId) {
      sessionId = returnedSessionId;
    }

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}\n${text}`);
    }

    if (!text.trim()) {
      return null;
    }

    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? "";
    const messages = contentType.includes("text/event-stream")
      ? parseSseMessages(text)
      : (() => {
          try {
            const parsed = JSON.parse(text);
            return Array.isArray(parsed) ? parsed : [parsed];
          } catch {
            throw new Error(
              `Unable to parse MCP response as JSON or SSE:\n${text}`
            );
          }
        })();

    if (message.id === undefined) {
      return null;
    }

    const responseMessage =
      messages.find(
        (candidate) => String(candidate?.id) === String(message.id)
      ) ??
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

  return {
    async initialize() {
      requestId += 1;
      const response = await sendMessage(
        {
          jsonrpc: "2.0",
          id: requestId,
          method: "initialize",
          params: {
            protocolVersion: DEFAULT_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: {
              name: options.clientName ?? "tftclarity-opgg-client",
              version: options.clientVersion ?? "0.1.0"
            }
          }
        },
        false
      );

      protocolVersion = response?.result?.protocolVersion ?? protocolVersion;

      await sendMessage({
        jsonrpc: "2.0",
        method: "notifications/initialized"
      });

      initialized = true;
      return response?.result;
    },

    async listTools() {
      const tools = [];
      let cursor = null;

      do {
        const { result } = await rpc("tools/list", cursor ? { cursor } : {});
        tools.push(...(result?.tools ?? []));
        cursor = result?.nextCursor ?? null;
      } while (cursor);

      return tools;
    },

    async callTool(name, argumentsValue) {
      return rpc("tools/call", { name, arguments: argumentsValue });
    },

    async terminate() {
      if (!sessionId) {
        return;
      }
      try {
        await fetch(endpoint, {
          method: "DELETE",
          headers: {
            "Mcp-Session-Id": sessionId,
            "MCP-Protocol-Version": protocolVersion
          }
        });
      } catch {
        // Session termination failure does not affect callers.
      } finally {
        sessionId = null;
        initialized = false;
      }
    },

    get initialized() {
      return initialized;
    }
  };
}

/**
 * Parse the MCP result into candidate JSON payloads. OP.GG typically wraps
 * the tool output in result.content[].text as a JSON string; some tools
 * return non-JSON Python repr text instead (handled by callers).
 */
function parsePayload(result) {
  const candidates = [];
  const warnings = [];

  if (result?.structuredContent !== undefined) {
    candidates.push(result.structuredContent);
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
      candidates.push(JSON.parse(text));
      continue;
    } catch {
      // Fall through to markdown code block handling.
    }

    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock?.[1]) {
      try {
        candidates.push(JSON.parse(codeBlock[1].trim()));
        warnings.push("parsed JSON from markdown code block");
        continue;
      } catch {
        // Fall through.
      }
    }

    warnings.push("content text is not parseable JSON");
  }

  return { candidates, warnings };
}

/**
 * Find a Riot PUUID inside a parsed object tree (key-based walk).
 */
function extractPuuidFromObject(result) {
  let found = null;

  const walk = (value) => {
    if (found) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "puuid" && typeof child === "string" && child.length >= 30) {
        found = child;
        return;
      }
      walk(child);
    }
  };

  walk(result);
  return found;
}

/**
 * Find a Riot PUUID inside a plain text payload (e.g. OP.GG Python repr).
 * Prefers the exact 78-character URL-safe shape because summoner_id /
 * acct_id (47 chars) may appear earlier in the text.
 */
function extractPuuidFromText(text) {
  if (typeof text !== "string") {
    return null;
  }

  const quoted = text.match(/["']([A-Za-z0-9_-]{30,})["']/g) ?? [];

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

export {
  createOpggClient,
  parsePayload,
  extractPuuidFromObject,
  extractPuuidFromText
};

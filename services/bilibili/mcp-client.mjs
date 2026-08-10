const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

function parseSseMessages(text) {
  return String(text ?? "")
    .split(/\r?\n\r?\n/u)
    .map((block) => block
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim())
    .filter((value) => value && value !== "[DONE]")
    .flatMap((value) => {
      try {
        return [JSON.parse(value)];
      } catch {
        return [];
      }
    });
}

function parseMessages(text, contentType) {
  if (String(contentType ?? "").toLowerCase().includes("text/event-stream")) {
    return parseSseMessages(text);
  }
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function contentText(result) {
  return (Array.isArray(result?.content) ? result.content : [])
    .filter((entry) => typeof entry?.text === "string")
    .map((entry) => entry.text.trim())
    .filter(Boolean)
    .join("\n");
}

export function parseMcpPayload(result) {
  const candidates = [];
  const warnings = [];
  if (result?.structuredContent !== undefined) candidates.push(result.structuredContent);
  for (const entry of Array.isArray(result?.content) ? result.content : []) {
    const text = typeof entry?.text === "string" ? entry.text.trim() : "";
    if (!text) continue;
    try {
      candidates.push(JSON.parse(text));
      continue;
    } catch {
      // Some MCP servers wrap JSON in a Markdown block.
    }
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1];
    if (fenced) {
      try {
        candidates.push(JSON.parse(fenced.trim()));
        warnings.push("parsed_json_from_markdown");
        continue;
      } catch {
        // Preserve a stable warning without exposing the upstream body.
      }
    }
    warnings.push("unparseable_text_content");
  }
  return { candidates, warnings };
}

export function createBilibiliMcpHttpClient(options = {}) {
  const endpoint = String(options.endpoint ?? "").trim();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = Math.max(500, Number(options.timeoutMs ?? 8000));
  let protocolVersion = DEFAULT_PROTOCOL_VERSION;
  let sessionId = null;
  let requestId = 0;
  let initialized = false;
  let initializationPromise = null;

  if (!endpoint) throw new TypeError("Bilibili MCP endpoint is required");
  if (typeof fetchImpl !== "function") throw new TypeError("Bilibili MCP fetch implementation is required");

  async function send(message, { protocolHeader = true, signal } = {}) {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener?.("abort", onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error("Bilibili MCP request timed out")), timeoutMs);
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(options.headers ?? {})
    };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;
    if (protocolHeader) headers["MCP-Protocol-Version"] = protocolVersion;
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal: controller.signal
      });
      sessionId = response.headers.get("mcp-session-id") ?? sessionId;
      const text = await response.text();
      if (!response.ok) {
        const error = new Error(`Bilibili MCP HTTP ${response.status}`);
        error.code = "bilibili_mcp_http_error";
        error.status = response.status;
        throw error;
      }
      if (message.id === undefined || !text.trim()) return null;
      let messages;
      try {
        messages = parseMessages(text, response.headers.get("content-type"));
      } catch (cause) {
        const error = new Error("Bilibili MCP returned an unreadable response", { cause });
        error.code = "bilibili_mcp_invalid_response";
        throw error;
      }
      const matched = messages.find((entry) => String(entry?.id) === String(message.id))
        ?? messages.find((entry) => entry?.result !== undefined || entry?.error !== undefined);
      if (!matched) {
        const error = new Error("Bilibili MCP response did not contain JSON-RPC result");
        error.code = "bilibili_mcp_missing_result";
        throw error;
      }
      if (matched.error) {
        const error = new Error(String(matched.error.message ?? "Bilibili MCP error"));
        error.code = "bilibili_mcp_rpc_error";
        error.mcpCode = matched.error.code;
        throw error;
      }
      return matched.result;
    } catch (cause) {
      if (cause?.name === "AbortError" || controller.signal.aborted) {
        const error = new Error("Bilibili MCP request timed out or was cancelled", { cause });
        error.code = signal?.aborted ? "bilibili_mcp_cancelled" : "bilibili_mcp_timeout";
        throw error;
      }
      throw cause;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener?.("abort", onAbort);
    }
  }

  async function rpc(method, params = {}, signal) {
    requestId += 1;
    return send({ jsonrpc: "2.0", id: requestId, method, params }, { signal });
  }

  async function initialize(signal) {
    requestId += 1;
    const result = await send({
      jsonrpc: "2.0",
      id: requestId,
      method: "initialize",
      params: {
        protocolVersion: DEFAULT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: options.clientName ?? "tftclarity-bilibili-client",
          version: options.clientVersion ?? "0.1.0"
        }
      }
    }, { protocolHeader: false, signal });
    protocolVersion = result?.protocolVersion ?? protocolVersion;
    await send({ jsonrpc: "2.0", method: "notifications/initialized" }, { signal });
    initialized = true;
    return result;
  }

  async function ensureInitialized(signal) {
    if (initialized) return;
    initializationPromise ??= initialize(signal).finally(() => {
      initializationPromise = null;
    });
    await initializationPromise;
  }

  return {
    async callTool(name, argumentsValue, context = {}) {
      await ensureInitialized(context.signal);
      const result = await rpc("tools/call", { name, arguments: argumentsValue }, context.signal);
      if (result?.isError) {
        const error = new Error(contentText(result) || `Bilibili MCP tool failed: ${name}`);
        error.code = "bilibili_mcp_tool_error";
        throw error;
      }
      return result;
    },
    async listTools(context = {}) {
      await ensureInitialized(context.signal);
      const tools = [];
      let cursor = null;
      do {
        const result = await rpc("tools/list", cursor ? { cursor } : {}, context.signal);
        tools.push(...(result?.tools ?? []));
        cursor = result?.nextCursor ?? null;
      } while (cursor);
      return tools;
    },
    async terminate() {
      if (!sessionId) return;
      try {
        await fetchImpl(endpoint, {
          method: "DELETE",
          headers: {
            "Mcp-Session-Id": sessionId,
            "MCP-Protocol-Version": protocolVersion,
            ...(options.headers ?? {})
          }
        });
      } catch {
        // Shutdown is best-effort.
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

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

function createPlayerMatchMcpClient(options = {}) {
  const endpoint = String(
    options.endpoint ??
      process.env.METATFT_PLAYER_MATCH_MCP_ENDPOINT ??
      "http://127.0.0.1:3010/mcp"
  );
  const timeoutMs = Number(options.timeoutMs ?? process.env.METATFT_PLAYER_MATCH_MCP_TIMEOUT_MS ?? 10_000);
  let client = null;

  async function connectedClient() {
    if (client) return client;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const next = new Client({ name: "tftclarity-player-match-client", version: "0.1.0" });
      const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: { signal: controller.signal }
      });
      await next.connect(transport);
      client = next;
      return client;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async callTool(name, argumentsValue) {
      const active = await connectedClient();
      const result = await active.callTool(
        { name, arguments: argumentsValue },
        undefined,
        { timeout: timeoutMs }
      );
      const payload = result?.structuredContent ?? (() => {
        const text = result?.content?.find?.((entry) => entry?.type === "text")?.text;
        try { return JSON.parse(text); } catch { return null; }
      })();
      if (result?.isError || payload?.error) {
        const error = new Error(payload?.error?.message ?? `Player Match MCP tool failed: ${name}`);
        error.code = payload?.error?.code ?? "PLAYER_MATCH_MCP_ERROR";
        throw error;
      }
      return payload;
    },
    async close() {
      if (!client) return;
      await client.close();
      client = null;
    }
  };
}

export { createPlayerMatchMcpClient };

import { createBilibiliMcpHttpClient } from "../services/bilibili/mcp-client.mjs";

const endpoint = String(process.env.BILIBILI_MCP_ENDPOINT ?? "").trim();
if (!endpoint) {
  throw new Error("BILIBILI_MCP_ENDPOINT is required for the Bilibili MCP smoke test");
}

const client = createBilibiliMcpHttpClient({
  endpoint,
  timeoutMs: Number(process.env.BILIBILI_MCP_TIMEOUT_MS ?? 8000)
});

try {
  const tools = await client.listTools();
  const toolNames = new Set(tools.map((tool) => tool?.name).filter(Boolean));
  const required = ["bilibili-search-summary", "bilibili-video-detail"];
  const missing = required.filter((name) => !toolNames.has(name));
  if (missing.length) {
    throw new Error(`Bilibili MCP is missing required tools: ${missing.join(", ")}`);
  }
  console.log(JSON.stringify({
    status: "ok",
    endpoint,
    requiredTools: required,
    advertisedToolCount: tools.length
  }));
} finally {
  await client.terminate();
}

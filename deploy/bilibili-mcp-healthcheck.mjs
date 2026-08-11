import { createBilibiliMcpHttpClient } from "./mcp-client.mjs";

const requiredTools = ["bilibili-search-summary", "bilibili-video-detail"];
const client = createBilibiliMcpHttpClient({
  endpoint: `http://127.0.0.1:${process.env.PORT ?? "3000"}/mcp`,
  timeoutMs: 4000,
  clientName: "tftclarity-bilibili-healthcheck"
});

try {
  const tools = await client.listTools();
  const advertised = new Set(tools.map((tool) => tool?.name).filter(Boolean));
  if (requiredTools.some((name) => !advertised.has(name))) process.exitCode = 1;
} catch {
  process.exitCode = 1;
} finally {
  await client.terminate();
}

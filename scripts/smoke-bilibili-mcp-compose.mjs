import { BilibiliMcpAdapter } from "../services/bilibili/adapter.mjs";
import { createBilibiliMcpHttpClient } from "../services/bilibili/mcp-client.mjs";

const endpoint = String(process.env.BILIBILI_MCP_ENDPOINT ?? "").trim();
if (endpoint !== "http://bilibili-mcp:3000/mcp") {
  throw new Error(`Unexpected production Bilibili MCP endpoint: ${endpoint || "<empty>"}`);
}

const client = createBilibiliMcpHttpClient({ endpoint, timeoutMs: 15_000 });
const adapter = new BilibiliMcpAdapter({ client });

try {
  const tools = await client.listTools();
  const toolNames = new Set(tools.map((tool) => tool?.name).filter(Boolean));
  for (const required of ["bilibili-search-summary", "bilibili-video-detail"]) {
    if (!toolNames.has(required)) throw new Error(`Missing required MCP tool: ${required}`);
  }

  const search = await adapter.searchVideos({ query: "云顶之弈 S17 攻略", page: 1, limit: 5 });
  const candidate = search.videos.find((video) => /^BV[A-Za-z0-9]{10}$/u.test(video?.videoId ?? ""));
  if (!candidate) throw new Error("Real Bilibili search returned no valid BVID");

  const detail = await adapter.getVideoDetail({ videoId: candidate.videoId });
  if (!detail.video?.title || !detail.video?.url?.startsWith("https://www.bilibili.com/video/")) {
    throw new Error("Real Bilibili detail result is missing a usable title or URL");
  }

  console.log(JSON.stringify({
    status: "ok",
    endpoint,
    advertisedToolCount: tools.length,
    realSearch: true,
    realDetail: true,
    videoId: detail.video.videoId,
    title: detail.video.title,
    url: detail.video.url
  }));
} finally {
  await client.terminate();
}

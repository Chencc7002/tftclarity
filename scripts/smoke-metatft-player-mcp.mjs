import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["services/metatft-player/mcp-server.mjs"],
  env: {
    ...process.env,
    METATFT_PLAYER_MATCH_ENABLED: "true",
    METATFT_PBE_ENABLED: "true",
    METATFT_NA_ENABLED: "true"
  }
});
const client = new Client({ name: "tftclarity-metatft-smoke", version: "0.1.0" });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const expected = ["resolve_player", "list_matches", "get_match", "get_player_match_history"];
  for (const name of expected) {
    if (!tools.tools.some((tool) => tool.name === name)) throw new Error(`Missing tool ${name}`);
  }
  const pbeResult = await client.callTool({
    name: "list_matches",
    arguments: {
      gameName: "Flancy",
      tagLine: "PBE2",
      environment: "pbe",
      season: "set18-pbe",
      limit: 10
    }
  });
  const pbe = pbeResult.structuredContent;
  if (pbeResult.isError || pbe?.returnedCount !== 10) {
    throw new Error(`Unexpected PBE MCP result: ${JSON.stringify(pbe)}`);
  }
  const detailResult = await client.callTool({
    name: "get_match",
    arguments: {
      gameName: "Flancy",
      tagLine: "PBE2",
      environment: "pbe",
      season: "set18-pbe",
      matchId: pbe.matches[0].matchId
    }
  });
  const detail = detailResult.structuredContent;
  if (detailResult.isError || detail?.match?.participantCount !== 8) {
    throw new Error(`Unexpected detail MCP result: ${JSON.stringify(detail)}`);
  }
  const naResult = await client.callTool({
    name: "list_matches",
    arguments: {
      gameName: "Deis1k",
      tagLine: "NA1",
      environment: "live",
      season: "set17-live",
      limit: 10
    }
  });
  const na = naResult.structuredContent;
  if (naResult.isError || na?.returnedCount !== 10 || na.matches.some((entry) => entry.set !== "TFTSet17")) {
    throw new Error(`Unexpected NA MCP result: ${JSON.stringify(na)}`);
  }
  console.log(JSON.stringify({
    ok: true,
    tools: expected,
    pbeReturnedCount: pbe.returnedCount,
    pbeDetailParticipantCount: detail.match.participantCount,
    naReturnedCount: na.returnedCount,
    pbeProvenance: pbe.provenance,
    naProvenance: na.provenance
  }, null, 2));
} finally {
  await client.close();
}

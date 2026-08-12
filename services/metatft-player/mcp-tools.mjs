import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toPublicError } from "./errors.mjs";
import { createPlayerMatchService } from "./service.mjs";

const commonSchema = {
  gameName: z.string().min(1).describe("Riot ID game name"),
  tagLine: z.string().min(1).describe("Riot ID tag line, such as PBE2 or NA1"),
  environment: z.enum(["pbe", "live"]).optional(),
  season: z.string().optional().describe("Explicit season, e.g. set18-pbe or set17-live"),
  callerKey: z.string().max(128).optional().describe("Opaque caller scope for rate limiting")
  ,verificationMode: z.enum(["provider"]).optional().describe("Admin pool import only: verify against the explicitly selected environment instead of routing by tag format")
};

function resultOf(work) {
  return Promise.resolve()
    .then(work)
    .then((value) => ({
      content: [{ type: "text", text: JSON.stringify(value) }],
      structuredContent: value
    }))
    .catch((error) => {
      const value = toPublicError(error);
      return {
        content: [{ type: "text", text: JSON.stringify(value) }],
        structuredContent: value,
        isError: true
      };
    });
}

function createPlayerMatchMcpServer(options = {}) {
  const service = options.service ?? createPlayerMatchService(options);
  const server = new McpServer(
    { name: "tftclarity-player-match", version: "0.1.0" },
    {
      instructions:
        "Use resolve_player/list_matches first. Call get_match only when a user expands one match or requests deep review. Never mix PBE and live data."
    }
  );

  server.registerTool(
    "resolve_player",
    {
      title: "Resolve TFT player",
      description: "Resolve a supported #PBE<number> or #NA<number> Riot ID without cross-region fallback.",
      inputSchema: commonSchema
    },
    (input) => resultOf(() => service.resolvePlayer(input))
  );

  server.registerTool(
    "list_matches",
    {
      title: "List TFT player matches",
      description: "List 10 to 20 normalized match summaries (default 20). If fewer exist, returns the actual count; does not fetch every match detail.",
      inputSchema: { ...commonSchema, limit: z.number().int().min(10).max(20).optional() }
    },
    (input) => resultOf(() => service.listMatches(input))
  );

  server.registerTool(
    "get_match",
    {
      title: "Get one TFT match",
      description: "Fetch one expanded match after list_matches, with strict environment and season validation.",
      inputSchema: { ...commonSchema, matchId: z.string().min(1) }
    },
    (input) => resultOf(() => service.getMatch(input))
  );

  server.registerTool(
    "get_player_match_history",
    {
      title: "Get TFT player match history",
      description: "Convenience alias for resolve_player plus list_matches semantics; it never expands every match.",
      inputSchema: { ...commonSchema, limit: z.number().int().min(10).max(20).optional() }
    },
    (input) => resultOf(() => service.getPlayerMatchHistory(input))
  );

  return server;
}

export { createPlayerMatchMcpServer };

#!/usr/bin/env node
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPlayerMatchMcpServer } from "./mcp-tools.mjs";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? "3010");

const httpServer = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "metatft-player-mcp" }));
    return;
  }
  if (request.url !== "/mcp") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  response.on("close", () => transport.close().catch(() => {}));
  const server = createPlayerMatchMcpServer();
  await server.connect(transport);
  await transport.handleRequest(request, response);
});

httpServer.listen(port, host, () => {
  console.error(`MetaTFT Player Match MCP listening on ${host}:${port}`);
});

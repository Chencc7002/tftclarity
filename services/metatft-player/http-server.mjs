#!/usr/bin/env node
import { webcrypto } from "node:crypto";
import { createServer } from "node:http";
import { loadLocalEnvironment } from "../../src/config/load-env.js";

// Node 18 can expose Web Crypto differently depending on how the process is
// launched. The MCP stream transport uses the browser-compatible global when
// assigning stream ids, so make that dependency explicit for the HTTP sidecar.
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto
  });
}

loadLocalEnvironment();

const [{ StreamableHTTPServerTransport }, { createPlayerMatchMcpServer }] = await Promise.all([
  import("@modelcontextprotocol/sdk/server/streamableHttp.js"),
  import("./mcp-tools.mjs")
]);

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

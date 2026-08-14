import { createServer, request as httpRequest } from "node:http";

const portArg = process.argv.find((value) => value.startsWith("--port="));
const upstreamArg = process.argv.find((value) => value.startsWith("--upstream="));
const port = Number(portArg?.slice("--port=".length) ?? 17331);
const upstream = new URL(upstreamArg?.slice("--upstream=".length) ?? "http://127.0.0.1:17330");

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function proxy(req, res, body) {
  const upstreamRequest = httpRequest({
    hostname: upstream.hostname,
    port: upstream.port,
    method: req.method,
    path: req.url,
    headers: {
      ...req.headers,
      host: upstream.host,
      ...(req.headers.origin ? { origin: upstream.origin } : {}),
      ...(req.headers.referer ? { referer: `${upstream.origin}/` } : {}),
      "content-length": String(body.length)
    }
  }, (upstreamResponse) => {
    res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(res);
  });
  upstreamRequest.on("error", (error) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(error.message);
  });
  if (body.length) upstreamRequest.write(body);
  upstreamRequest.end();
}

const server = createServer(async (req, res) => {
  const body = await readBody(req);
  if (req.method === "POST" && req.url === "/api/react-chat/stream") {
    const payload = JSON.parse(body.toString("utf8"));
    const attempt = Number(payload?.transportRetry?.attempt ?? 0);
    console.log(`stream-attempt request=${payload.requestId} attempt=${attempt}`);
    if (attempt === 0) {
      res.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      res.write(`${JSON.stringify({
        type: "diagnostic",
        endpointMode: "react_chat",
        requestId: payload.requestId,
        conversationId: payload.conversationId
      })}\n`);
      res.write(`${JSON.stringify({
        type: "event",
        event: {
          schemaVersion: "react-stream-event.v1",
          sequence: 1,
          type: "run_started",
          data: { fixture: "disconnect_after_first_event" }
        }
      })}\n`);
      setTimeout(() => res.destroy(), 80);
      return;
    }
  }
  proxy(req, res, body);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`stream retry browser fixture http://127.0.0.1:${port} -> ${upstream}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

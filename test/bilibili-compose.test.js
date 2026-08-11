import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const compose = readFileSync(new URL("../compose.yaml", import.meta.url), "utf8").replace(/\r\n/gu, "\n");
const appDockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const mcpDockerfile = readFileSync(new URL("../deploy/bilibili-mcp.Dockerfile", import.meta.url), "utf8");
const mcpRuntimePackage = JSON.parse(readFileSync(new URL("../deploy/bilibili-mcp-runtime/package.json", import.meta.url), "utf8"));
const productionEnv = readFileSync(new URL("../.env.production.example", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const ciWorkflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

function serviceBlock(name) {
  const marker = `  ${name}:\n`;
  const start = compose.indexOf(marker);
  assert.notEqual(start, -1, `compose service ${name} must exist`);
  const after = compose.slice(start + marker.length);
  const nextService = after.search(/^(?:  [a-z0-9][a-z0-9-]*:|[a-z][a-z0-9-]*:)$/mu);
  return nextService === -1 ? after : after.slice(0, nextService);
}

test("Bilibili MCP compose sidecar is private and failure-isolated", () => {
  const sidecar = serviceBlock("bilibili-mcp");
  assert.match(sidecar, /dockerfile:\s+deploy\/bilibili-mcp\.Dockerfile/u);
  assert.match(sidecar, /TRANSPORT:\s+remote/u);
  assert.match(sidecar, /PORT:\s+"3000"/u);
  assert.match(sidecar, /networks:\s+\[bilibili_mcp\]/u);
  assert.match(sidecar, /healthcheck:/u);
  assert.match(sidecar, /node",\s+"healthcheck\.mjs"/u);
  assert.doesNotMatch(sidecar, /env_file:/u);
  assert.doesNotMatch(sidecar, /^\s+ports:/mu);
  assert.doesNotMatch(sidecar, /^\s+expose:/mu);

  const app = serviceBlock("app");
  assert.match(app, /BILIBILI_MCP_ENDPOINT:\s+http:\/\/bilibili-mcp:3000\/mcp/u);
  assert.doesNotMatch(app, /bilibili-mcp:\s+\{ condition: service_healthy \}/u);
  assert.match(app, /networks:\s+\[edge, backend, bilibili_mcp\]/u);
  assert.doesNotMatch(serviceBlock("worker"), /BILIBILI_MCP_ENDPOINT/u);
  assert.doesNotMatch(serviceBlock("migrate"), /BILIBILI_MCP_ENDPOINT/u);
  assert.match(serviceBlock("caddy"), /networks:\s+\[edge\]/u);
  assert.doesNotMatch(serviceBlock("caddy"), /backend/u);
  assert.doesNotMatch(serviceBlock("caddy"), /bilibili_mcp/u);
});

test("Docker images include runtime services and pin the upstream MCP revision", () => {
  assert.match(appDockerfile, /COPY services \.\/services/u);
  assert.match(mcpDockerfile, /BILIBILI_MCP_REF=3574a43f3b44b2cf726f3931ce753fa4e0ff4f25/u);
  assert.match(mcpDockerfile, /npm ci/u);
  assert.match(mcpDockerfile, /npm run build/u);
  assert.match(mcpDockerfile, /bilibili-mcp-healthcheck\.mjs/u);
  assert.match(mcpDockerfile, /bilibili-mcp-runtime\/package-lock\.json/u);
  assert.doesNotMatch(mcpDockerfile, /\/build\/node_modules/u);
  assert.match(mcpDockerfile, /USER node/u);
  assert.doesNotMatch(mcpDockerfile, /^EXPOSE\s+/mu);
  assert.deepEqual(mcpRuntimePackage.dependencies, {
    "@modelcontextprotocol/sdk": "1.30.0",
    axios: "1.19.0",
    express: "5.2.1",
    "tough-cookie": "6.0.2"
  });
  assert.equal(mcpRuntimePackage.overrides["@hono/node-server"], "2.1.0");
});

test("production config and smoke command use the private Compose endpoint", () => {
  assert.doesNotMatch(productionEnv, /^BILIBILI_MCP_ENDPOINT=/mu);
  assert.equal(packageJson.scripts["smoke:bilibili"], "node scripts/smoke-bilibili-mcp.mjs");
  assert.equal(packageJson.scripts["smoke:bilibili:mcp:compose"], "node scripts/smoke-bilibili-mcp-compose.mjs");
  assert.match(ciWorkflow, /bilibili-compose-runtime-gate/u);
  assert.match(ciWorkflow, /docker compose build --no-cache bilibili-mcp app/u);
  assert.match(ciWorkflow, /docker compose stop bilibili-mcp/u);
});

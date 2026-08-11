import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/gu, "\n");
const productionEnv = read(".env.production.example");
const caddyfile = read("deploy/Caddyfile");
const indexHtml = read("src/app/small-window-ui/index.html");
const appJs = read("src/app/small-window-ui/app.js");
const styles = read("src/app/small-window-ui/styles.css");
const i18n = read("src/app/small-window-ui/i18n.js");
const privacyHtml = read("src/app/small-window-ui/privacy.html");
const deployV2 = read("docs/deploy-v2.md");
const readiness = read("docs/r1-release-readiness.md");
const historicalR1 = read("docs/r1-acceptance-report.md");
const readme = read("README.md");
const compose = read("compose.yaml");

test("V2 production template enables the public-beta runtime without committing real secrets", () => {
  assert.match(productionEnv, /^TFT_AGENT_REACT_CHAT_MODE=on$/mu);
  assert.match(productionEnv, /^TFT_AGENT_CONVERSATION_BRIDGE_MODE=on$/mu);
  assert.match(productionEnv, /^TFT_AGENT_TRUST_PROXY=true$/mu);
  assert.match(productionEnv, /^TFT_AGENT_LLM_MODE=auto$/mu);
  assert.match(productionEnv, /^TFT_AGENT_LLM_PROVIDER=chat$/mu);
  assert.match(productionEnv, /^TFT_AGENT_LLM_ENDPOINT=https:\/\/your-provider\.example\/v1\/chat\/completions$/mu);
  assert.match(productionEnv, /^TFT_AGENT_LLM_MODEL=your-model$/mu);
  assert.match(productionEnv, /^TFT_AGENT_LLM_API_KEY=replace-me$/mu);
  assert.match(productionEnv, /^TFT_AGENT_EMBEDDING_MODE=on$/mu);
  assert.match(productionEnv, /^TFT_AGENT_EMBEDDING_PROVIDER=openai_compatible$/mu);
  assert.match(productionEnv, /^TFT_AGENT_EMBEDDING_ENDPOINT=http:\/\/embedding:11434\/v1$/mu);
  assert.match(productionEnv, /^TFT_AGENT_EMBEDDING_MODEL=bge-m3$/mu);
  assert.match(productionEnv, /^TFT_AGENT_EMBEDDING_ALLOW_UNAUTHENTICATED=true$/mu);
  assert.match(productionEnv, /^TFT_AGENT_VISITOR_SECRET=CHANGE_ME$/mu);
  assert.match(productionEnv, /^TFT_AGENT_ADMIN_TOKEN=CHANGE_ME_TOO$/mu);
});

test("public chat visibly discloses AI output without relabeling the evidence fallback", () => {
  assert.match(indexHtml, /class="ai-generated-disclaimer"[^>]*role="note"/u);
  assert.match(indexHtml, /data-i18n="aiGeneratedDisclaimer"/u);
  assert.match(styles, /\.ai-generated-disclaimer/u);
  assert.match(styles, /\.ai-generated-label/u);
  assert.match(i18n, /aiGeneratedLabel: "AI 生成"/u);
  assert.match(i18n, /aiGeneratedLabel: "AI-generated"/u);
  assert.match(i18n, /AI 生成内容可能存在错误或不完整/u);
  assert.match(i18n, /AI-generated content may be incorrect or incomplete/u);
  assert.match(appJs, /systemFallback \? "" : `<span class="ai-generated-label">/u);
  assert.match(appJs, /t\(systemFallback \? "systemEvidenceConclusion" : "modelFinalConclusion"\)/u);
});

test("Privacy Policy matches the seven-day Conversation Bridge retention contract", () => {
  assert.match(privacyHtml, /Effective and last updated: August 11, 2026/u);
  assert.match(privacyHtml, /structured Conversation Bridge records[^<]*retained for no longer than 7 days/u);
  assert.doesNotMatch(privacyHtml, /Conversation context: about 30 minutes/u);
});

test("Caddy keeps HSTS and serves the public beta with baseline security headers", () => {
  assert.match(caddyfile, /Strict-Transport-Security "max-age=31536000; includeSubDomains"/u);
  assert.match(caddyfile, /X-Content-Type-Options "nosniff"/u);
  assert.match(caddyfile, /Referrer-Policy "strict-origin-when-cross-origin"/u);
  assert.match(caddyfile, /Permissions-Policy "camera=\(\), microphone=\(\), geolocation=\(\)"/u);
  assert.match(caddyfile, /Content-Security-Policy "[^"]*default-src 'self'/u);
  assert.match(caddyfile, /Content-Security-Policy "[^"]*frame-ancestors 'none'/u);
  assert.match(caddyfile, /Content-Security-Policy "[^"]*img-src 'self' data:/u);
  assert.doesNotMatch(caddyfile, /Content-Security-Policy "[^"]*unsafe-eval/u);
  assert.doesNotMatch(caddyfile, /Content-Security-Policy "[^"]*\*/u);
  assert.match(caddyfile, /\n\s+-Server\n/u);
});

test("V2 runbook documents the real production topology and recoverable boundaries", () => {
  for (const service of ["app", "worker", "migrate", "postgres", "redis", "embedding", "embedding-model", "bilibili-mcp", "caddy"]) {
    assert.ok(deployV2.includes(`| \`${service}\` |`), `missing ${service} topology row`);
  }
  assert.match(deployV2, /pg_dump/u);
  assert.match(deployV2, /pg_restore/u);
  assert.match(deployV2, /没有 down migration 命令/u);
  assert.match(deployV2, /它不是用户偏好、反馈、审计、目录或趋势等持久业务数据的唯一事实源/u);
  assert.match(deployV2, /bilibili-mcp[^\n]*Compose 网络/u);
  assert.match(deployV2, /tft_semantic/u);
  assert.match(deployV2, /ollama_models/u);
  assert.match(deployV2, /missing_embedding=0/u);
  assert.match(deployV2, /SQLite 文件复制和对应 restore 步骤不适用于 V2 production 主数据库/u);
  assert.doesNotMatch(deployV2, /V2 production 使用 SQLite 作为主数据库/u);
  assert.doesNotMatch(deployV2, /db:migrate:down/u);
});

test("local embedding stays internal and is ready before the app", () => {
  assert.match(compose, /embedding:\n\s+image: ollama\/ollama:0\.32\.5/u);
  assert.match(compose, /embedding-model:\n\s+image: ollama\/ollama:0\.32\.5/u);
  assert.match(compose, /command: \["pull", "bge-m3"\]/u);
  assert.match(compose, /embedding-model: \{ condition: service_completed_successfully \}/u);
  assert.match(compose, /ollama_models:\/root\/\.ollama/u);
  const embeddingBlock = compose.match(/\n  embedding:\n([\s\S]*?)\n  embedding-model:/u)?.[1] ?? "";
  assert.doesNotMatch(embeddingBlock, /^\s+ports:/mu);
  assert.doesNotMatch(embeddingBlock, /^\s+expose:/mu);
});

test("one authoritative readiness document preserves the Public Beta scope boundary", () => {
  assert.match(readiness, /G3 Replacement \| \*\*PASS\*\*/u);
  assert.match(readiness, /G4-A Item Contention \| \*\*PASS\*\*/u);
  assert.match(readiness, /G5 Constraint Re-query \| \*\*PASS\*\*/u);
  assert.match(readiness, /G5-O ReAct Orchestration \| \*\*PASS\*\*/u);
  assert.match(readiness, /G4-B Allocation Priority \| \*\*DEFERRED — NOT IN PUBLIC BETA\*\*/u);
  assert.match(readiness, /V2 Public Beta Repository Readiness \| \*\*PASS\*\*/u);
  assert.match(readiness, /Final Release Image Gate \| \*\*BLOCKED\*\*/u);
  assert.match(readiness, /Full R1 Composite Release \| \*\*NOT YET SIGNED\*\*/u);
  assert.doesNotMatch(readiness, /Final Release Image Gate(?:\s|—|-)*PASS/u);
  assert.doesNotMatch(readiness, /Full R1 Product Functional Acceptance(?:\s|—|-)*PASS/u);
  assert.match(historicalR1, /状态入口已迁移/u);
  assert.match(historicalR1, /r1-release-readiness\.md/u);
  assert.match(readiness, /decisionProviderMode=unavailable/u);
  assert.match(readiness, /semantic:audit[^\n]*healthy=true/u);
  assert.match(readiness, /missing_embedding=0/u);
  assert.match(readiness, /model=`bge-m3`/u);
  assert.match(readiness, /最终 release SHA/u);
});

test("README routes V2 operators to the current runbook and readiness status", () => {
  assert.match(readme, /\[V2 部署指南\]\(docs\/deploy-v2\.md\)/u);
  assert.match(readme, /\[发布就绪状态\]\(docs\/r1-release-readiness\.md\)/u);
  assert.match(readme, /G4-B 装备分配优先级不在本次 Beta 承诺范围/u);
  assert.match(readme, /PostgreSQL 持久业务存储、Redis 临时状态\/队列、独立 Worker/u);
  assert.match(readme, /V1 腾讯云部署指南（历史单机参考）/u);
});

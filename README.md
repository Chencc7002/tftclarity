# TFT Agent

Data-driven in-game decision assistant and small-window plugin for Teamfight Tactics.

The MVP parses Chinese natural-language queries, retrieves structured MetaTFT statistics, computes metrics locally, filters unavailable or non-ordinary items, and presents a short recommendation with alternatives.

## Local development

```powershell
npm install
npm test
npm run smoke:small-window
npm start
```

Open `http://127.0.0.1:17317/` after starting the small-window server.

## Public web V1

The production profile supports anonymous, isolated browser sessions and bounded LLM usage without requiring user accounts. Docker Compose runs the Node service behind Caddy with automatic HTTPS.

See [the Tencent Cloud deployment guide](docs/deploy-tencent-cloud-v1.md) and copy `.env.production.example` to `.env.production` before deployment.

## Scope

- Structured query parsing and local ranking remain deterministic.
- LLM/RAG is optional and limited to controlled entity parsing and candidate retrieval.
- `.probe/` contains offline captured fixtures used by tests and catalog audits.
- MetaTFT is a non-official external data source; live smoke tests are environment-dependent.

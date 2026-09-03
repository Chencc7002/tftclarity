FROM node:24-bookworm-slim AS build

ARG BILIBILI_MCP_REPOSITORY=https://github.com/34892002/bilibili-mcp-js.git
ARG BILIBILI_MCP_REF=3574a43f3b44b2cf726f3931ce753fa4e0ff4f25

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN git init \
    && git remote add origin "$BILIBILI_MCP_REPOSITORY" \
    && git fetch --depth=1 origin "$BILIBILI_MCP_REF" \
    && git checkout --detach FETCH_HEAD
COPY deploy/patch-bilibili-mcp-upstream.mjs /tmp/patch-bilibili-mcp-upstream.mjs
RUN node /tmp/patch-bilibili-mcp-upstream.mjs /build/src/index.ts
RUN npm ci \
    && npm run build

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    TRANSPORT=remote \
    PORT=3000
WORKDIR /app

COPY deploy/bilibili-mcp-runtime/package.json deploy/bilibili-mcp-runtime/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY --from=build --chown=node:node /build/dist/index.js ./dist/index.js
COPY --from=build --chown=node:node /build/dist/src ./dist/src
COPY --chown=node:node services/bilibili/mcp-client.mjs ./mcp-client.mjs
COPY --chown=node:node deploy/bilibili-mcp-healthcheck.mjs ./healthcheck.mjs

USER node
CMD ["node", "dist/index.js"]

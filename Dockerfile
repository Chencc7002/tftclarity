FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY test/fixtures/conclusion-fixture.json ./test/fixtures/conclusion-fixture.json
COPY README.md ./README.md

RUN mkdir -p /app/.cache && chown -R node:node /app
USER node

EXPOSE 17317
CMD ["node", "src/app/small-window-server.js", "--host=0.0.0.0", "--port=17317"]

FROM node:22-alpine AS build

WORKDIR /repo

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY README.md LICENSE ./

RUN pnpm build
RUN pnpm pack --pack-destination /tmp/mcp-pack

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

LABEL io.modelcontextprotocol.server.name="com.printyourduck/quote"
LABEL org.opencontainers.image.source="https://github.com/printyourduck/printyourduck-mcp"

COPY --from=build /tmp/mcp-pack/*.tgz /tmp/printyourduck-mcp.tgz

RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund /tmp/printyourduck-mcp.tgz \
  && rm /tmp/printyourduck-mcp.tgz \
  && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

RUN addgroup -S printyourduck \
  && adduser -S -G printyourduck printyourduck

USER printyourduck

ENTRYPOINT ["node", "node_modules/@printyourduck/mcp/dist/index.js"]

FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.base.json tsconfig.server.json tsconfig.web.json vite.config.ts ./
COPY server ./server
COPY scripts ./scripts
COPY shared ./shared
COPY web ./web

ENV VITE_BASE_PATH=/ops/
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY THIRD_PARTY_NOTICES.md ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

USER node
EXPOSE 8080

CMD ["node", "dist/server/index.js"]

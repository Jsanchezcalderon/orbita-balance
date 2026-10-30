# Contexto de build: raíz del repo (docker compose build api)
FROM node:20-alpine
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY api/package.json api/
RUN pnpm install --frozen-lockfile --filter @orbita/api...

COPY api api

ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["pnpm", "--filter", "@orbita/api", "start"]

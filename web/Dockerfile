# Contexto de build: raíz del repo (docker compose build web)
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY web/package.json web/
RUN pnpm install --frozen-lockfile --filter @orbita/web...

COPY web web
# La URL de la API se incrusta en el build (la usa el navegador, no el contenedor).
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @orbita/web build

FROM nginx:alpine
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80

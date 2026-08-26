# Mnemosyne — multi-stage build. Runtime is dist + prod deps only.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Runtime is glibc (slim, not alpine): onnxruntime-node — pulled in by
# @xenova/transformers for semantic search — ships glibc-only native
# bindings that crash on musl at require time (the 1.14.0 lesson).
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# sharp rasterizes SVG text for the per-lesson OG cards — needs real fonts.
RUN apt-get update && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY public ./public
USER node
EXPOSE 8095
# Migrate (DDL user, idempotent) then serve.
CMD ["sh", "-c", "node dist/migrate.js && exec node dist/server.js"]

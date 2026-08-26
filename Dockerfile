# Mnemosyne — multi-stage build. Runtime is dist + prod deps only.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# sharp rasterizes SVG text for the per-lesson OG cards — needs real fonts.
RUN apk add --no-cache fontconfig ttf-dejavu
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY public ./public
USER node
EXPOSE 8095
# Migrate (DDL user, idempotent) then serve.
CMD ["sh", "-c", "node dist/migrate.js && exec node dist/server.js"]

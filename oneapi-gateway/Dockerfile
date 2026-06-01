FROM node:22-alpine AS build-gateway

WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json /app/
RUN npm ci --no-audit --no-fund
COPY src /app/src
RUN npx tsc -p tsconfig.build.json

FROM node:22-alpine AS build-admin-ui

WORKDIR /app/admin-ui
COPY admin-ui/package.json admin-ui/package-lock.json admin-ui/tsconfig.json admin-ui/vite.config.ts admin-ui/index.html /app/admin-ui/
COPY admin-ui/src /app/admin-ui/src
RUN npm ci --no-audit --no-fund
RUN npm run build

FROM node:22-alpine AS build-chat-ui

WORKDIR /app/chat-ui
COPY chat-ui/package.json chat-ui/package-lock.json chat-ui/tsconfig.json chat-ui/vite.config.ts chat-ui/index.html /app/chat-ui/
COPY chat-ui/src /app/chat-ui/src
RUN npm ci --no-audit --no-fund
RUN npm run build

FROM node:22-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app
COPY --from=build-gateway /app/package.json /app/package.json
COPY --from=build-gateway /app/node_modules /app/node_modules
COPY --from=build-gateway /app/dist /app/dist
COPY --from=build-admin-ui /app/admin-ui/dist /app/admin-ui/dist
COPY --from=build-chat-ui /app/chat-ui/dist /app/chat-ui/dist

USER appuser
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3003/healthz',r=>process.exit(r.statusCode!==200?1:0))" || exit 1
CMD ["node", "dist/index.js"]

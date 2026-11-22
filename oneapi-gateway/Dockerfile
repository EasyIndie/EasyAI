FROM node:22-alpine AS build-gateway

WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json /app/
RUN npm ci --no-audit --no-fund
COPY src /app/src
RUN npx tsc -p tsconfig.build.json

FROM node:22-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app
COPY --from=build-gateway /app/package.json /app/package.json
COPY --from=build-gateway /app/node_modules /app/node_modules
COPY --from=build-gateway /app/dist /app/dist

USER appuser
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3003/healthz',r=>process.exit(r.statusCode!==200?1:0))" || exit 1
CMD ["node", "dist/index.js"]

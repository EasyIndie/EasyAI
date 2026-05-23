FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json /app/
RUN npm ci
COPY src /app/src
COPY admin-ui /app/admin-ui
COPY chat-ui /app/chat-ui
RUN npx tsc -p tsconfig.build.json
RUN cd /app/admin-ui && npm ci && npm run build
RUN cd /app/chat-ui && npm ci && npm run build

FROM node:22-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
COPY --from=build /app/admin-ui/dist /app/admin-ui/dist
COPY --from=build /app/chat-ui/dist /app/chat-ui/dist

USER appuser
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3003/healthz',r=>process.exit(r.statusCode!==200?1:0))" || exit 1
CMD ["node", "dist/index.js"]

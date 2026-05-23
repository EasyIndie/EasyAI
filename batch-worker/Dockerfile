FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json /app/
RUN npm ci
COPY src /app/src
RUN npx tsc -p tsconfig.build.json

FROM node:22-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist

USER appuser
CMD ["node", "dist/index.js"]

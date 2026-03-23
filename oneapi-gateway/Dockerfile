FROM node:22-alpine AS build

WORKDIR /app
COPY package.json tsconfig.json /app/
RUN npm install
COPY src /app/src
COPY test /app/test
COPY admin-ui /app/admin-ui
RUN npm run build
RUN cd /app/admin-ui && npm install && npm run build

FROM node:22-alpine

WORKDIR /app
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/tsconfig.json /app/tsconfig.json
COPY --from=build /app/src /app/src
COPY --from=build /app/admin-ui/dist /app/admin-ui/dist

EXPOSE 8080
CMD ["node", "--loader", "ts-node/esm", "src/index.ts"]

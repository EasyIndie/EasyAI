import dotenv from "dotenv";
dotenv.config();

import Fastify from "fastify";
import { loadConfig } from "./config.ts";
import { createRedis } from "./redis.ts";
import { createDb } from "./db.ts";
import { registry } from "./metrics.ts";
import { createOAuthVerifier, authenticate } from "./auth.ts";
import { UpstreamPool } from "./upstreams.ts";
import { registerProxyRoutes } from "./proxy.ts";
import { registerDashboard } from "./dashboard.ts";
import { registerAdminApi } from "./admin.ts";
import { registerBatchRoutes } from "./batch.ts";
import { registerOpenApi } from "./openapi.ts";

const cfg = loadConfig();

const app = Fastify({
  logger: { level: cfg.logLevel },
  bodyLimit: 10 * 1024 * 1024,
  trustProxy: cfg.trustProxy,
});

const redis = await createRedis(cfg.redisUrl);
const db = await createDb(cfg.databaseUrl);
const oauth = createOAuthVerifier(cfg);
const pool = new UpstreamPool(cfg.upstreams);

app.get("/healthz", async () => {
  return {
    ok: true,
    service: "oneapi-gateway",
    upstreams: pool.list().map((u) => u.baseUrl),
    authModes: Array.from(cfg.authModes.values()),
    cacheEnabled: cfg.cacheEnabled,
  };
});

app.get("/metrics", async (_req, reply) => {
  reply.header("content-type", registry.contentType);
  return registry.metrics();
});

await registerOpenApi(app, cfg);
await registerDashboard(app, cfg, db);
await registerAdminApi(app, cfg, db, redis);

await registerProxyRoutes(app, {
  cfg,
  redis,
  db,
  pool,
  authenticateRequest: async (headers, reqIp) => authenticate(cfg, oauth, headers, db, redis, reqIp),
});

await registerBatchRoutes(app, cfg, db, redis, async (headers) => authenticate(cfg, oauth, headers, db, redis));

await app.listen({ host: "0.0.0.0", port: cfg.port });

const shutdown = async () => {
  try {
    await app.close();
  } finally {
    await redis.disconnect().catch(() => {});
    await db.close().catch(() => {});
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

import Fastify from "fastify";
import cors from "@fastify/cors";
import fs from "node:fs";
import { loadConfig } from "./config.js";
import { createRedis } from "./redis.js";
import { createDb } from "./db.js";
import { registry } from "./metrics.js";
import { createOAuthVerifier, authenticate } from "./auth.js";
import { UpstreamPool } from "./upstreams.js";
import { registerProxyRoutes } from "./proxy.js";
import { registerDashboard } from "./dashboard.js";
import { registerAdminApi } from "./admin.js";
import { registerBatchRoutes } from "./batch.js";
import { registerOpenApi } from "./openapi.js";
import { registerChatRoutes } from "./chat.js";
import { ipAllowed } from "./net.js";

const cfg = loadConfig();

const app = Fastify({
  logger: {
    level: cfg.logLevel,
    redact: ["req.headers.authorization", "req.headers.x-api-key", "req.headers.x-oneapi-internal-token"],
  },
  bodyLimit: cfg.bodyLimitBytes ?? 10 * 1024 * 1024,
  trustProxy: cfg.trustProxy,
  ...(cfg.tls ? {
    https: {
      cert: fs.readFileSync(cfg.tls.certPath),
      key: fs.readFileSync(cfg.tls.keyPath),
    },
  } : {}),
});

const redis = await createRedis(cfg.redisUrl);
const db = await createDb(cfg.databaseUrl);
const oauth = createOAuthVerifier(cfg);
const pool = new UpstreamPool(cfg.upstreams);

await app.register(cors, { origin: cfg.corsOrigin });

if (cfg.securityHeadersEnabled === true) {
  app.addHook("onRequest", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cross-Origin-Resource-Policy", "same-origin");
    reply.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
  });
}

app.get("/healthz", async () => {
  return {
    ok: true,
    service: "oneapi-gateway",
    appEnv: cfg.appEnv,
    upstreams: pool.list().map((u) => u.baseUrl),
    authModes: Array.from(cfg.authModes.values()),
    cacheEnabled: cfg.cacheEnabled,
  };
});

app.get("/metrics", async (_req, reply) => {
  if (!ipAllowed((_req as any).ip, cfg.metricsAllowedCidrs)) {
    return reply.status(403).send({ error: { message: "forbidden", type: "auth_error" } });
  }
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

await registerChatRoutes(app, cfg, oauth, db, redis);

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

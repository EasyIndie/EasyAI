import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadConfig } from "./config.js";
import { createRedis } from "./redis.js";
import { createDb } from "./db.js";
import { registerProxyRoutes } from "./proxy.js";
import { registerUi } from "./ui.js";
import { registerBatchRoutes } from "./batch.js";

const cfg = loadConfig();

const app = Fastify({
  logger: {
    level: cfg.logLevel,
    redact: ["req.headers.authorization", "req.headers.x-api-key", "req.headers.x-oneapi-internal-token"],
  },
});

const redis = await createRedis(cfg.redisUrl);
const db = await createDb(cfg.databaseUrl);

await app.register(cors, { origin: "*" });

if (cfg.appEnv !== "development") {
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
    service: "easyai-gateway",
    appEnv: cfg.appEnv,
    modelPlane: cfg.litellmBaseUrl,
    consoleUrl: cfg.consoleUrl ?? null,
  };
});

/**
 * Docs and metrics are produced by LiteLLM; the gateway only forwards them so
 * there is a single source of truth for the API surface and observability.
 */
async function fetchModelPlane(path: string, reply: any) {
  try {
    const res = await fetch(`${cfg.litellmBaseUrl}${path}`, {
      headers: { authorization: `Bearer ${cfg.litellmMasterKey}` },
    });
    const contentType = res.headers.get("content-type") ?? "application/json";
    reply.status(res.status).header("content-type", contentType);
    return reply.send(Buffer.from(await res.arrayBuffer()));
  } catch {
    return reply.status(503).send({ error: { message: "model service unavailable", type: "upstream_error" } });
  }
}

app.get("/openapi.json", async (_req, reply) => fetchModelPlane("/openapi.json", reply));
app.get("/docs", async (_req, reply) => fetchModelPlane("/docs", reply));
app.get("/docs/*", async (req, reply) => fetchModelPlane(req.url, reply));
app.get("/metrics", async (_req, reply) => fetchModelPlane("/metrics", reply));

await registerUi(app, cfg);

await registerProxyRoutes(app, { cfg, redis });

await registerBatchRoutes(app, cfg, db, redis);

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

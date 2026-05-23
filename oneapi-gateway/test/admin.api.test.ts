import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerAdminApi } from "../src/admin.js";
import type { Config } from "../src/config.js";

function basic(u: string, p: string) {
  return "Basic " + Buffer.from(`${u}:${p}`, "utf8").toString("base64");
}

test("admin api: write endpoints require x-oneapi-admin-action", async () => {
  const cfg: Config = {
    appEnv: "test",
    port: 0,
    logLevel: "info",
    trustProxy: false,
    adminUser: "admin",
    adminPass: "admin",
    authModes: new Set(["apikey"]),
    apiKeys: new Set(["k1"]),
    oauth: {},
    upstreams: ["http://u"],
    upstreamTimeoutMs: 1000,
    rateLimitRpm: 120,
    cacheEnabled: true,
    cacheTtlSeconds: 60,
    cacheReplayChunkDelayMs: 0,
    cacheReplayMaxTotalMs: 0,
    cacheReplayMode: "fixed",
    guardrails: { enabled: false, blockInternalIp: true, injectionKeywords: [], piiMaskEnabled: true },
    corsOrigin: "*", tls: undefined,
    internalToken: "dev-internal",
    redisUrl: "redis://x",
    databaseUrl: "postgres://x",
    modelMap: {},
    fallbackMap: {},
  };

  const db: any = {
    pool: {
      query: async (sql: string) => {
        if (sql.includes("select id, key_hash")) return { rows: [] };
        if (sql.includes("insert into api_keys")) return { rows: [{ id: 1 }] };
        throw new Error(`unexpected query: ${sql}`);
      },
    },
    close: async () => {},
  };
  const redis: any = {
    set: async () => "OK",
    del: async () => 1,
  };

  const app = Fastify({ logger: false });
  await registerAdminApi(app, cfg, db, redis);

  const r1 = await app.inject({
    method: "POST",
    url: "/admin/api/keys",
    headers: { authorization: basic("admin", "admin") },
  });
  assert.equal(r1.statusCode, 401);

  const r2 = await app.inject({
    method: "POST",
    url: "/admin/api/keys",
    headers: { authorization: basic("admin", "admin"), "x-oneapi-admin-action": "1" },
  });
  assert.equal(r2.statusCode, 200);
  const j2 = r2.json() as any;
  assert.equal(j2.id, 1);
  assert.ok(String(j2.api_key).startsWith("sk-"));

  const r3 = await app.inject({
    method: "GET",
    url: "/admin/api/keys",
    headers: { authorization: basic("admin", "admin") },
  });
  assert.equal(r3.statusCode, 200);
});

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDashboard } from "../src/dashboard.ts";
import type { Config } from "../src/config.ts";

function basic(u: string, p: string) {
  return "Basic " + Buffer.from(`${u}:${p}`, "utf8").toString("base64");
}

test("dashboard api: usage includes tenant and api key fields", async () => {
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
    internalToken: undefined,
    internalTokenAllowCidrs: undefined,
    redisUrl: "redis://x",
    databaseUrl: "postgres://x",
    modelMap: {},
    fallbackMap: {},
  };

  const db: any = {
    pool: {
      query: async (sql: string) => {
        if (sql.includes("from usage_events ue")) {
          return {
            rows: [
              {
                principal: "apikey:abc123",
                auth_mode: "apikey",
                tenant_id: "tenant-a",
                api_key_id: 7,
                api_key_prefix: "sk-123456",
                requests: 10,
                errors: 1,
                cached: 3,
                p95_latency_ms: 120,
                total_tokens: 999,
              },
            ],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    },
    close: async () => {},
  };

  const app = Fastify({ logger: false });
  await registerDashboard(app, cfg, db);

  const r = await app.inject({
    method: "GET",
    url: "/admin/api/usage?sinceMinutes=60",
    headers: { authorization: basic("admin", "admin") },
  });

  assert.equal(r.statusCode, 200);
  const j = r.json() as any;
  assert.equal(Array.isArray(j.rows), true);
  assert.equal(j.rows[0].tenant_id, "tenant-a");
  assert.equal(j.rows[0].api_key_id, 7);
  assert.equal(j.rows[0].api_key_prefix, "sk-123456");
  assert.equal(j.rows[0].auth_mode, "apikey");
});

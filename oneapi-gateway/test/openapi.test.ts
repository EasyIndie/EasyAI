import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerOpenApi } from "../src/openapi.ts";
import type { Config } from "../src/config.ts";

test("openapi: serves spec and docs", async () => {
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

  const app = Fastify({ logger: false });
  await registerOpenApi(app, cfg);

  const r1 = await app.inject({ method: "GET", url: "/openapi.json" });
  assert.equal(r1.statusCode, 200);
  const spec = r1.json() as any;
  assert.equal(spec.openapi, "3.0.3");
  assert.ok(spec.paths?.["/v1/chat/completions"]);
  assert.ok(spec.paths?.["/v1/batches/{batchId}/output"]);

  const r2 = await app.inject({ method: "GET", url: "/docs" });
  assert.equal(r2.statusCode, 200);
  assert.ok(r2.headers["content-type"]?.includes("text/html"));
  assert.ok(r2.body.includes("/openapi.json"));
});


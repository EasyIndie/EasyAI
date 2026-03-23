import test from "node:test";
import assert from "node:assert/strict";
import { authenticate } from "../src/auth.ts";
import type { Config } from "../src/config.ts";

const baseCfg: Config = {
  port: 8080,
  logLevel: "info",
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
  redisUrl: "redis://x",
  databaseUrl: "postgres://x",
  modelMap: {},
  fallbackMap: {},
};

test("authenticate: api key via bearer", async () => {
  const ctx = await authenticate(baseCfg, undefined, { authorization: "Bearer k1" });
  assert.equal(ctx.authMode, "apikey");
  assert.ok(ctx.principal.startsWith("apikey:"));
  assert.ok(ctx.apiKeyHash);
});

test("authenticate: rejects invalid key", async () => {
  await assert.rejects(() => authenticate(baseCfg, undefined, { authorization: "Bearer nope" }));
});

import test from "node:test";
import assert from "node:assert/strict";
import { authenticate } from "../src/auth.js";
import type { Config } from "../src/config.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    appEnv: "test",
    port: 0,
    logLevel: "info",
    trustProxy: false,
    apiKeys: new Set(["dev-key"]),
    litellmBaseUrl: "http://litellm:4000",
    litellmMasterKey: "sk-test-master",
    upstreamTimeoutMs: 1000,
    rateLimitRpm: 120,
    corsOrigin: "*",
    internalToken: "dev-internal",
    redisUrl: "redis://fake",
    databaseUrl: "postgres://fake",
    ...overrides,
  };
}

test("auth: YAML api key is accepted and mapped to the master key", () => {
  const cfg = makeConfig();
  const auth = authenticate(cfg, { authorization: "Bearer dev-key" });
  assert.equal(auth.useMasterKey, true);
  assert.match(auth.principal, /^key:[0-9a-f]{12}$/);
  assert.equal(auth.token, "dev-key");
});

test("auth: x-api-key header is accepted too", () => {
  const cfg = makeConfig();
  const auth = authenticate(cfg, { "x-api-key": "dev-key" });
  assert.equal(auth.useMasterKey, true);
});

test("auth: unknown keys are forwarded to LiteLLM for validation", () => {
  const cfg = makeConfig();
  const auth = authenticate(cfg, { authorization: "Bearer sk-virtual-123" });
  assert.equal(auth.useMasterKey, false);
  assert.match(auth.principal, /^litellm:[0-9a-f]{12}$/);
});

test("auth: same key always maps to the same principal", () => {
  const cfg = makeConfig();
  const a = authenticate(cfg, { authorization: "Bearer sk-virtual-123" });
  const b = authenticate(cfg, { authorization: "Bearer sk-virtual-123" });
  assert.equal(a.principal, b.principal);
});

test("auth: missing credentials are rejected", () => {
  const cfg = makeConfig();
  assert.throws(() => authenticate(cfg, {}), /missing credentials/);
});

test("auth: internal token accepts an explicit principal", () => {
  const cfg = makeConfig();
  const auth = authenticate(cfg, {
    "x-oneapi-internal-token": "dev-internal",
    "x-oneapi-principal": "apikey:abcd1234",
  });
  assert.equal(auth.principal, "apikey:abcd1234");
  assert.equal(auth.useMasterKey, true);
});

test("auth: wrong internal token falls back to normal key handling", () => {
  const cfg = makeConfig();
  assert.throws(
    () => authenticate(cfg, { "x-oneapi-internal-token": "nope" }),
    /missing credentials/,
  );
});

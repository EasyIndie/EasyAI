import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDashboard } from "../src/dashboard.js";
import type { Config } from "../src/config.js";

function basic(u: string, p: string) {
  return "Basic " + Buffer.from(`${u}:${p}`, "utf8").toString("base64");
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
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
    internalToken: "test-internal",
    internalTokenAllowCidrs: undefined,
    redisUrl: "redis://x",
    databaseUrl: "postgres://x",
    modelMap: {},
    fallbackMap: {},
    ...overrides,
  };
}

test("dashboard api: usage includes tenant and api key fields", async () => {
  const cfg = makeConfig();

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

test("dashboard api: playground models proxies through internal auth", async () => {
  const cfg = makeConfig();
  const db: any = { pool: { query: async () => ({ rows: [] }) }, close: async () => {} };
  const app = Fastify({ logger: false });

  app.get("/v1/models", async (req) => {
    assert.equal(req.headers["x-oneapi-internal-token"], "test-internal");
    assert.equal(req.headers["x-oneapi-principal"], "admin:playground");
    return {
      object: "list",
      data: [{ id: "local/ollama:qwen2.5:0.5b", object: "model" }],
    };
  });

  await registerDashboard(app, cfg, db);

  const r = await app.inject({
    method: "GET",
    url: "/admin/api/playground/models",
    headers: { authorization: basic("admin", "admin") },
  });

  assert.equal(r.statusCode, 200);
  const j = r.json() as any;
  assert.equal(j.data[0].id, "local/ollama:qwen2.5:0.5b");
});

test("dashboard api: playground chat requires admin action and proxies body", async () => {
  const cfg = makeConfig();
  const db: any = { pool: { query: async () => ({ rows: [] }) }, close: async () => {} };
  const app = Fastify({ logger: false });

  app.post("/v1/chat/completions", async (req) => {
    assert.equal(req.headers["x-oneapi-internal-token"], "test-internal");
    assert.equal(req.headers["x-oneapi-principal"], "admin:playground");
    const body = req.body as any;
    assert.equal(body.model, "local/ollama:qwen2.5:0.5b");
    assert.equal(body.stream, false);
    assert.equal(body.messages[0].role, "user");
    return {
      id: "chatcmpl-test",
      object: "chat.completion",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  await registerDashboard(app, cfg, db);

  const unauthorized = await app.inject({
    method: "POST",
    url: "/admin/api/playground/chat",
    headers: { authorization: basic("admin", "admin") },
    payload: {
      model: "local/ollama:qwen2.5:0.5b",
      messages: [{ role: "user", content: "hello" }],
    },
  });
  assert.equal(unauthorized.statusCode, 401);

  const ok = await app.inject({
    method: "POST",
    url: "/admin/api/playground/chat",
    headers: { authorization: basic("admin", "admin"), "x-oneapi-admin-action": "1" },
    payload: {
      model: "local/ollama:qwen2.5:0.5b",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    },
  });

  assert.equal(ok.statusCode, 200);
  const j = ok.json() as any;
  assert.equal(j.choices[0].message.content, "ok");
  assert.equal(j.usage.total_tokens, 2);
});

test("dashboard api: playground chat streams via fallback inject when port is 0", async () => {
  const cfg = makeConfig({ port: 0 });
  const db: any = { pool: { query: async () => ({ rows: [] }) }, close: async () => {} };
  const app = Fastify({ logger: false });

  app.post("/v1/chat/completions", async (req, reply) => {
    const body = req.body as any;
    assert.equal(body.stream, true);
    reply.header("content-type", "text/event-stream");
    return reply.send('data: {"choices":[{"delta":{"content":"o"}}]}\n\ndata: {"choices":[{"delta":{"content":"k"}}]}\n\ndata: [DONE]\n\n');
  });

  await registerDashboard(app, cfg, db);

  const ok = await app.inject({
    method: "POST",
    url: "/admin/api/playground/chat",
    headers: { authorization: basic("admin", "admin"), "x-oneapi-admin-action": "1" },
    payload: {
      model: "local/ollama:qwen2.5:0.5b",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
    },
  });

  assert.equal(ok.statusCode, 200);
  assert.match(String(ok.headers["content-type"] ?? ""), /text\/event-stream/);
  assert.match(ok.body, /data: \{"choices":\[\{"delta":\{"content":"o"\}\}\]\}/);
  assert.match(ok.body, /data: \[DONE\]/);
});

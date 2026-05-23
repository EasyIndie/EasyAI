import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerProxyRoutes } from "../src/proxy.js";
import type { Config } from "../src/config.js";
import { UpstreamPool } from "../src/upstreams.js";
import { authenticate } from "../src/auth.js";

class FakeRedis {
  private readonly kv = new Map<string, string>();
  private readonly counters = new Map<string, number>();
  async connect() {}
  async disconnect() {}
  on() {}
  async get(k: string) {
    return this.kv.get(k) ?? null;
  }
  async set(k: string, v: string, _opts?: any) {
    this.kv.set(k, v);
    return "OK";
  }
  async incr(k: string) {
    const v = (this.counters.get(k) ?? 0) + 1;
    this.counters.set(k, v);
    return v;
  }
  async incrBy(k: string, by: number) {
    const v = (this.counters.get(k) ?? 0) + by;
    this.counters.set(k, v);
    return v;
  }
  async expire(_k: string, _s: number) {
    return 1;
  }
}

const dbStub = {
  pool: {
    query: async (_q: string, _p?: any[]) => ({ rows: [] }),
  },
  close: async () => {},
} as any;

test("proxy: forwards to upstream and caches", async () => {
  const upstream = Fastify();
  upstream.post("/v1/chat/completions", async (req) => {
    const body: any = req.body;
    return {
      id: "x",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "ok:" + body.model } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });
  await upstream.listen({ host: "127.0.0.1", port: 0 });
  const upstreamAddr = upstream.server.address();
  assert.ok(upstreamAddr && typeof upstreamAddr === "object");
  const upstreamUrl = `http://127.0.0.1:${upstreamAddr.port}`;

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
    upstreams: [upstreamUrl],
    upstreamTimeoutMs: 2000,
    rateLimitRpm: 1000,
    cacheEnabled: true,
    cacheTtlSeconds: 60,
    cacheReplayChunkDelayMs: 0,
    cacheReplayMaxTotalMs: 0,
    cacheReplayMode: "fixed",
    guardrails: { enabled: false, blockInternalIp: true, injectionKeywords: [], piiMaskEnabled: true },
    corsOrigin: "*", tls: undefined,
    internalToken: undefined,
    redisUrl: "redis://fake",
    databaseUrl: "postgres://fake",
    modelMap: { alias: "real" },
    fallbackMap: {},
  };

  const redis = new FakeRedis() as any;
  const pool = new UpstreamPool([upstreamUrl]);
  const app = Fastify({ logger: false });

  await registerProxyRoutes(app, {
    cfg,
    redis,
    db: dbStub,
    pool,
    authenticateRequest: async (headers, reqIp) => authenticate(cfg, undefined, headers, undefined, undefined, reqIp),
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const gwAddr = app.server.address();
  assert.ok(gwAddr && typeof gwAddr === "object");
  const gwUrl = `http://127.0.0.1:${gwAddr.port}`;

  const payload = { model: "alias", messages: [{ role: "user", content: "hi" }], temperature: 0 };
  const r1 = await fetch(gwUrl + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer k1" },
    body: JSON.stringify(payload),
  });
  const j1Text = await r1.text();
  assert.equal(r1.status, 200, j1Text);
  assert.equal(r1.headers.get("x-cache"), "miss");
  const j1: any = JSON.parse(j1Text);
  assert.equal(j1.choices[0].message.content, "ok:real");

  const r2 = await fetch(gwUrl + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer k1" },
    body: JSON.stringify(payload),
  });
  assert.equal(r2.status, 200);
  assert.equal(r2.headers.get("x-cache"), "hit");

  await app.close();
  await upstream.close();
});

test("proxy: falls back to secondary model on upstream failure", async () => {
  const upstream = Fastify();
  upstream.post("/v1/chat/completions", async (req, reply) => {
    const b = req.body as any;
    if (b.model === "primary") {
      return reply.status(503).send({ error: "primary failed" });
    }
    return { choices: [{ message: { content: "fallback_ok" } }] };
  });
  await upstream.listen({ host: "127.0.0.1", port: 0 });
  const upstreamAddr = upstream.server.address();
  assert.ok(upstreamAddr && typeof upstreamAddr === "object");
  const upstreamUrl = `http://127.0.0.1:${upstreamAddr.port}`;

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
    upstreams: [upstreamUrl],
    upstreamTimeoutMs: 2000,
    rateLimitRpm: 1000,
    cacheEnabled: false,
    cacheTtlSeconds: 60,
    cacheReplayChunkDelayMs: 0,
    cacheReplayMaxTotalMs: 0,
    cacheReplayMode: "fixed",
    guardrails: { enabled: false, blockInternalIp: true, injectionKeywords: [], piiMaskEnabled: true },
    corsOrigin: "*", tls: undefined,
    internalToken: undefined,
    redisUrl: "redis://fake",
    databaseUrl: "postgres://fake",
    modelMap: {},
    fallbackMap: { primary: ["secondary"] },
  };

  const redis = new FakeRedis() as any;
  const pool = new UpstreamPool([upstreamUrl]);
  const app = Fastify({ logger: false });

  await registerProxyRoutes(app, {
    cfg,
    redis,
    db: dbStub,
    pool,
    authenticateRequest: async (headers, reqIp) => authenticate(cfg, undefined, headers, undefined, undefined, reqIp),
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const gwAddr = app.server.address();
  assert.ok(gwAddr && typeof gwAddr === "object");
  const gwUrl = `http://127.0.0.1:${gwAddr.port}`;

  const r = await fetch(gwUrl + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer k1" },
    body: JSON.stringify({ model: "primary", messages: [{ role: "user", content: "hi" }] }),
  });

  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-model-fallback"), "secondary");
  const data = await r.json() as any;
  assert.equal(data.choices[0].message.content, "fallback_ok");

  await app.close();
  await upstream.close();
});

test("proxy: forwards streaming requests and caches", async () => {
  const upstream = Fastify();
  upstream.post("/v1/chat/completions", async (req, reply) => {
    reply.header("content-type", "text/event-stream");
    return reply.send("data: {\"choices\": [{\"delta\": {\"content\": \"hello\"}}]}\n\ndata: [DONE]\n\n");
  });
  await upstream.listen({ host: "127.0.0.1", port: 0 });
  const upstreamAddr = upstream.server.address();
  assert.ok(upstreamAddr && typeof upstreamAddr === "object");
  const upstreamUrl = `http://127.0.0.1:${upstreamAddr.port}`;

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
    upstreams: [upstreamUrl],
    upstreamTimeoutMs: 2000,
    rateLimitRpm: 1000,
    cacheEnabled: true,
    cacheTtlSeconds: 60,
    cacheReplayChunkDelayMs: 0,
    cacheReplayMaxTotalMs: 0,
    cacheReplayMode: "fixed",
    guardrails: { enabled: false, blockInternalIp: true, injectionKeywords: [], piiMaskEnabled: true },
    corsOrigin: "*", tls: undefined,
    internalToken: undefined,
    redisUrl: "redis://fake",
    databaseUrl: "postgres://fake",
    modelMap: {},
    fallbackMap: {},
  };

  const redis = new FakeRedis() as any;
  const pool = new UpstreamPool([upstreamUrl]);
  const app = Fastify({ logger: false });

  await registerProxyRoutes(app, {
    cfg,
    redis,
    db: dbStub,
    pool,
    authenticateRequest: async (headers, reqIp) => authenticate(cfg, undefined, headers, undefined, undefined, reqIp),
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const gwAddr = app.server.address();
  assert.ok(gwAddr && typeof gwAddr === "object");
  const gwUrl = `http://127.0.0.1:${gwAddr.port}`;

  const payload = { model: "real", messages: [{ role: "user", content: "hi" }], temperature: 0, stream: true };
  const r1 = await fetch(gwUrl + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer k1" },
    body: JSON.stringify(payload),
  });
  const text1 = await r1.text();
  assert.equal(r1.status, 200, text1);
  assert.equal(r1.headers.get("x-cache"), "miss");
  assert.equal(r1.headers.get("content-type")?.includes("text/event-stream"), true);
  assert.equal(text1.includes("hello"), true);

  // Allow cache to be written asynchronously
  await new Promise((r) => setTimeout(r, 50));

  const r2 = await fetch(gwUrl + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer k1" },
    body: JSON.stringify(payload),
  });
  assert.equal(r2.status, 200);
  assert.equal(r2.headers.get("x-cache"), "hit");
  assert.equal(r2.headers.get("content-type")?.includes("text/event-stream"), true);
  const text2 = await r2.text();
  assert.equal(text2.includes("hello"), true);

  await app.close();
  await upstream.close();
});

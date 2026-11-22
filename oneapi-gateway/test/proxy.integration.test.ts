import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerProxyRoutes } from "../src/proxy.js";
import type { Config } from "../src/config.js";

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

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    appEnv: "test",
    port: 0,
    logLevel: "info",
    trustProxy: false,
    apiKeys: new Set(["k1"]),
    litellmBaseUrl: "http://127.0.0.1:1",
    litellmMasterKey: "sk-test-master",
    upstreamTimeoutMs: 2000,
    rateLimitRpm: 1000,
    corsOrigin: "*",
    internalToken: undefined,
    redisUrl: "redis://fake",
    databaseUrl: "postgres://fake",
    ...overrides,
  };
}

async function startModelPlane(handler: (req: any, reply: any) => any) {
  const upstream = Fastify();
  upstream.post("/v1/chat/completions", handler);
  await upstream.listen({ host: "127.0.0.1", port: 0 });
  const addr = upstream.server.address();
  assert.ok(addr && typeof addr === "object");
  return { upstream, url: `http://127.0.0.1:${addr.port}` };
}

async function startGateway(cfg: Config) {
  const app = Fastify({ logger: false });
  await registerProxyRoutes(app, { cfg, redis: new FakeRedis() as any });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  assert.ok(addr && typeof addr === "object");
  return { app, url: `http://127.0.0.1:${addr.port}` };
}

test("proxy: forwards json requests to the model plane with the master key", async () => {
  let seenAuth: string | undefined;
  const { upstream, url } = await startModelPlane(async (req) => {
    seenAuth = req.headers.authorization;
    const body: any = req.body;
    return {
      id: "x",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "ok:" + body.model } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });

  const cfg = makeConfig({ litellmBaseUrl: url });
  const { app, url: gwUrl } = await startGateway(cfg);

  const res = await fetch(gwUrl + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer k1" },
    body: JSON.stringify({ model: "chat", messages: [{ role: "user", content: "hi" }] }),
  });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const json: any = JSON.parse(text);
  assert.equal(json.choices[0].message.content, "ok:chat");
  assert.equal(seenAuth, "Bearer sk-test-master");

  await app.close();
  await upstream.close();
});

test("proxy: rejects missing credentials", async () => {
  const { upstream, url } = await startModelPlane(async () => ({ ok: true }));
  const cfg = makeConfig({ litellmBaseUrl: url });
  const { app, url: gwUrl } = await startGateway(cfg);

  const res = await fetch(gwUrl + "/v1/models");
  assert.equal(res.status, 401);

  await app.close();
  await upstream.close();
});

test("proxy: passes through upstream errors", async () => {
  const { upstream, url } = await startModelPlane(async (_req, reply) => {
    return reply.status(400).send({ error: { message: "bad model", type: "invalid_request_error" } });
  });
  const cfg = makeConfig({ litellmBaseUrl: url });
  const { app, url: gwUrl } = await startGateway(cfg);

  const res = await fetch(gwUrl + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer k1" },
    body: JSON.stringify({ model: "nope", messages: [] }),
  });
  assert.equal(res.status, 400);
  const json: any = await res.json();
  assert.equal(json.error.message, "bad model");

  await app.close();
  await upstream.close();
});

test("proxy: streams sse responses", async () => {
  const { upstream, url } = await startModelPlane(async (_req, reply) => {
    reply.header("content-type", "text/event-stream");
    return reply.send(
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: {"usage":{"total_tokens":3}}\n\ndata: [DONE]\n\n',
    );
  });
  const cfg = makeConfig({ litellmBaseUrl: url });
  const { app, url: gwUrl } = await startGateway(cfg);

  const res = await fetch(gwUrl + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer k1" },
    body: JSON.stringify({ model: "chat", messages: [{ role: "user", content: "hi" }], stream: true }),
  });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  assert.equal(res.headers.get("content-type")?.includes("text/event-stream"), true);
  assert.equal(text.includes("hello"), true);
  assert.equal(text.includes("[DONE]"), true);

  await app.close();
  await upstream.close();
});

test("proxy: reports unreachable model plane as 502", async () => {
  const cfg = makeConfig({ litellmBaseUrl: "http://127.0.0.1:1", upstreamTimeoutMs: 500 });
  const { app, url: gwUrl } = await startGateway(cfg);

  const res = await fetch(gwUrl + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer k1" },
    body: JSON.stringify({ model: "chat", messages: [] }),
  });
  assert.equal(res.status, 502);

  await app.close();
});

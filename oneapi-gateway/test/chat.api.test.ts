import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerChatRoutes } from "../src/chat.js";
import { registerProxyRoutes } from "../src/proxy.js";
import type { Config } from "../src/config.js";
import { authenticate } from "../src/auth.js";
import { UpstreamPool } from "../src/upstreams.js";

class FakeRedis {
  private readonly kv = new Map<string, string>();
  private readonly counters = new Map<string, number>();
  async connect() {}
  async disconnect() {}
  on() {}
  async get(k: string) {
    return this.kv.get(k) ?? null;
  }
  async set(k: string, v: string) {
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
  async expire() {
    return 1;
  }
}

class MemoryChatDb {
  readonly conversations = new Map<string, any>();
  readonly messages: any[] = [];
  readonly pool = {
    query: async (sql: string, params: any[] = []) => this.query(sql, params),
  };
  async close() {}

  private async query(sql: string, params: any[]) {
    if (sql.includes("insert into conversations")) {
      const [id, title, principal, tenantId] = params;
      this.conversations.set(id, {
        id,
        title,
        principal,
        tenant_id: tenantId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("from conversations c") && sql.includes("where c.id = $1")) {
      const [id, principal] = params;
      const row = this.conversations.get(id);
      if (!row || row.principal !== principal) return { rows: [] };
      return {
        rows: [{
          ...row,
          message_count: this.messages.filter((m) => m.conversation_id === id).length,
        }],
      };
    }

    if (sql.includes("from conversations c") && sql.includes("where c.principal = $1")) {
      const [principal] = params;
      return {
        rows: Array.from(this.conversations.values())
          .filter((row) => row.principal === principal)
          .map((row) => ({
            ...row,
            message_count: this.messages.filter((m) => m.conversation_id === row.id).length,
          })),
      };
    }

    if (sql.includes("update conversations set title")) {
      const [id, title] = params;
      const row = this.conversations.get(id);
      if (row) row.title = title;
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    if (sql.includes("update conversations set updated_at")) {
      const [id] = params;
      const row = this.conversations.get(id);
      if (row) row.updated_at = new Date().toISOString();
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    if (sql.includes("insert into messages")) {
      const [id, conversationId, role, content, model, promptTokens, completionTokens] = params;
      this.messages.push({
        id,
        conversation_id: conversationId,
        role,
        content,
        model,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        created_at: new Date().toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("from messages") && sql.includes("where conversation_id = $1")) {
      const [conversationId] = params;
      return { rows: this.messages.filter((m) => m.conversation_id === conversationId) };
    }

    if (sql.includes("insert into usage_events")) return { rows: [], rowCount: 1 };
    if (sql.includes("from api_keys")) return { rows: [] };
    if (sql.includes("from tenants")) return { rows: [] };

    throw new Error(`unexpected query: ${sql}`);
  }
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
    upstreamTimeoutMs: 2000,
    rateLimitRpm: 1000,
    cacheEnabled: false,
    cacheTtlSeconds: 60,
    cacheReplayChunkDelayMs: 0,
    cacheReplayMaxTotalMs: 0,
    cacheReplayMode: "fixed",
    guardrails: { enabled: false, blockInternalIp: true, injectionKeywords: [], piiMaskEnabled: true },
    corsOrigin: "*",
    tls: undefined,
    internalToken: undefined,
    redisUrl: "redis://fake",
    databaseUrl: "postgres://fake",
    modelMap: {},
    fallbackMap: {},
    ...overrides,
  };
}

test("chat api: streams assistant response and persists it", async () => {
  const upstream = Fastify();
  upstream.post("/v1/chat/completions", async (_req, reply) => {
    reply.header("content-type", "text/event-stream");
    return reply.send([
      'data: {"choices":[{"delta":{"content":"hello"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":" world"}}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n"));
  });
  await upstream.listen({ host: "127.0.0.1", port: 0 });
  const upstreamAddr = upstream.server.address();
  assert.ok(upstreamAddr && typeof upstreamAddr === "object");
  const upstreamUrl = `http://127.0.0.1:${upstreamAddr.port}`;

  const app = Fastify({ logger: false });
  try {
    const cfg = makeConfig({ upstreams: [upstreamUrl] });
    const redis = new FakeRedis() as any;
    const db = new MemoryChatDb() as any;
    const pool = new UpstreamPool([upstreamUrl]);

    await registerProxyRoutes(app, {
      cfg,
      redis,
      db,
      pool,
      authenticateRequest: async (headers, reqIp) => authenticate(cfg, undefined, headers, undefined, undefined, reqIp),
    });
    await registerChatRoutes(app, cfg, undefined, db, redis);

    await app.listen({ host: "127.0.0.1", port: 0 });
    const appAddr = app.server.address();
    assert.ok(appAddr && typeof appAddr === "object");
    cfg.port = appAddr.port;
    const baseUrl = `http://127.0.0.1:${appAddr.port}`;

    const created = await fetch(`${baseUrl}/chat-api/conversations`, {
      method: "POST",
      headers: { authorization: "Bearer k1" },
    });
    const createdText = await created.text();
    assert.equal(created.status, 200, createdText);
    const createdJson: any = JSON.parse(createdText);

    const chat = await fetch(`${baseUrl}/chat-api/conversations/${createdJson.id}/chat`, {
      method: "POST",
      headers: {
        authorization: "Bearer k1",
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({ model: "chat", message: "hi", stream: true }),
    });

    const text = await chat.text();
    assert.equal(chat.status, 200, text);
    assert.match(String(chat.headers.get("content-type")), /text\/event-stream/);
    assert.equal(text.includes("hello"), true, text);
    assert.equal(text.includes(" world"), true, text);
    assert.equal(text.includes("data: [DONE]"), true);

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(db.messages.filter((m: any) => m.role === "user").length, 1);
    const assistant = db.messages.find((m: any) => m.role === "assistant");
    assert.equal(assistant?.content, "hello world");
  } finally {
    await app.close();
    await upstream.close();
  }
});

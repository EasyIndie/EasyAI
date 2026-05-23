import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerBatchRoutes } from "../src/batch.js";
import type { Config } from "../src/config.js";

type Batch = {
  batch_id: string;
  principal: string;
  tenant_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  total: number;
  completed: number;
  failed: number;
};

type BatchItem = { idx: number; endpoint: string; status: string; response_json: string | null; error: string | null; request_json: string };

class MemDb {
  private readonly batches = new Map<string, Batch>();
  private readonly items = new Map<string, BatchItem[]>();

  pool = {
    query: async (sql: string, params?: any[]) => {
      if (sql.includes("insert into batches")) {
        const [batchId, principal, tenantId, total] = params as any[];
        const now = new Date().toISOString();
        this.batches.set(batchId, {
          batch_id: batchId,
          principal,
          tenant_id: tenantId ?? null,
          status: "queued",
          created_at: now,
          updated_at: now,
          total: Number(total),
          completed: 0,
          failed: 0,
        });
        this.items.set(batchId, []);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("insert into batch_items")) {
        const [batchId, idx, endpoint, requestJson] = params as any[];
        const arr = this.items.get(batchId) ?? [];
        arr.push({
          idx: Number(idx),
          endpoint,
          status: "queued",
          response_json: null,
          error: null,
          request_json: requestJson,
        });
        this.items.set(batchId, arr);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("select batch_id, principal")) {
        const [batchId] = params as any[];
        const b = this.batches.get(batchId);
        return { rows: b ? [b] : [] };
      }
      if (sql.includes("select idx, endpoint, status")) {
        const [batchId] = params as any[];
        const arr = (this.items.get(batchId) ?? []).sort((a, b) => a.idx - b.idx);
        return { rows: arr.map(({ idx, endpoint, status, response_json, error }) => ({ idx, endpoint, status, response_json, error })) };
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
  close = async () => {};
}

class MemRedis {
  readonly list: string[] = [];
  async lPush(_k: string, v: string) {
    this.list.unshift(v);
    return this.list.length;
  }
}

const baseCfg: Config = {
  appEnv: "test",
  port: 0,
  logLevel: "info",
  trustProxy: false,
  adminUser: "admin",
  adminPass: "admin",
  authModes: new Set(["apikey"]),
  apiKeys: new Set(["dev-key"]),
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

test("batch: 503 when internal token not configured", async () => {
  const app = Fastify({ logger: false });
  const db = new MemDb() as any;
  const redis = new MemRedis() as any;
  await registerBatchRoutes(app, { ...baseCfg, internalToken: undefined }, db, redis, async () => {
    throw new Error("no");
  });
  const r = await app.inject({ method: "POST", url: "/v1/batches", payload: { requests: [] } });
  assert.equal(r.statusCode, 503);
});

test("batch: creates batch and output jsonl", async () => {
  const app = Fastify({ logger: false });
  const db = new MemDb() as any;
  const redis = new MemRedis() as any;
  await registerBatchRoutes(app, baseCfg, db, redis, async () => ({ authMode: "apikey", principal: "p1", apiKeyHash: "h", tenantId: null }));

  const r = await app.inject({
    method: "POST",
    url: "/v1/batches",
    payload: { requests: [{ endpoint: "/v1/chat/completions", body: { model: "chat", messages: [] } }] },
    headers: { authorization: "Bearer dev-key" },
  });
  assert.equal(r.statusCode, 200, r.body);
  const j = r.json() as any;
  assert.equal(j.status, "queued");
  assert.ok(typeof j.batch_id === "string" && j.batch_id.length > 10);
  assert.equal(redis.list[0], j.batch_id);

  const r2 = await app.inject({
    method: "GET",
    url: `/v1/batches/${j.batch_id}`,
    headers: { authorization: "Bearer dev-key" },
  });
  assert.equal(r2.statusCode, 200);

  const r3 = await app.inject({
    method: "GET",
    url: `/v1/batches/${j.batch_id}/output`,
    headers: { authorization: "Bearer dev-key" },
  });
  assert.equal(r3.statusCode, 200);
  assert.equal(r3.headers["content-type"]?.includes("application/jsonl"), true);
  assert.ok(r3.body.includes(`"idx":0`));
});

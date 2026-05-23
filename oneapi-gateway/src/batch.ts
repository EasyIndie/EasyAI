import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { createBatch, getBatch, insertBatchItem, listBatchItems } from "./db.js";
import type { RedisClient } from "./redis.js";
import type { AuthContext } from "./auth.js";

type BatchRequestItem = {
  endpoint?: string;
  body: unknown;
};

function okEndpoint(p: string): boolean {
  if (!p.startsWith("/v1/")) return false;
  if (p.includes("..")) return false;
  return true;
}

export async function registerBatchRoutes(
  app: FastifyInstance,
  cfg: Config,
  db: Db,
  redis: RedisClient,
  authenticateRequest: (headers: Record<string, any>) => Promise<AuthContext>,
): Promise<void> {
  app.post("/v1/batches", async (req, reply) => {
    if (!cfg.internalToken) {
      return reply.status(503).send({ error: { message: "batch worker not configured", type: "service_error" } });
    }
    let auth: AuthContext;
    try {
      auth = await authenticateRequest(req.headers as any);
    } catch {
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }

    const body = (req.body ?? {}) as any;
    const items = (body.requests ?? body.items) as BatchRequestItem[] | undefined;
    if (!Array.isArray(items) || items.length < 1 || items.length > 1000) {
      return reply.status(400).send({ error: { message: "invalid requests", type: "invalid_request_error" } });
    }

    const batchId = randomUUID();
    await createBatch(db, batchId, auth.principal, auth.tenantId ?? null, items.length);

    for (let i = 0; i < items.length; i++) {
      const it = items[i] as any;
      const endpoint = typeof it.endpoint === "string" && it.endpoint.trim().length ? it.endpoint.trim() : "/v1/chat/completions";
      if (!okEndpoint(endpoint)) {
        return reply.status(400).send({ error: { message: "invalid endpoint", type: "invalid_request_error" } });
      }
      const requestJson = JSON.stringify(it.body ?? null);
      await insertBatchItem(db, batchId, i, endpoint, requestJson);
    }

    await redis.lPush("batch:q:v1", batchId);

    return reply.send({ batch_id: batchId, status: "queued" });
  });

  app.get("/v1/batches/:batchId", async (req, reply) => {
    let auth: AuthContext;
    try {
      auth = await authenticateRequest(req.headers as any);
    } catch {
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }

    const batchId = String((req.params as any).batchId ?? "").trim();
    const row = await getBatch(db, batchId);
    if (!row) return reply.status(404).send({ error: { message: "not found", type: "not_found" } });
    if (row.principal !== auth.principal) return reply.status(403).send({ error: { message: "forbidden", type: "auth_error" } });
    return reply.send(row);
  });

  app.get("/v1/batches/:batchId/output", async (req, reply) => {
    let auth: AuthContext;
    try {
      auth = await authenticateRequest(req.headers as any);
    } catch {
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }

    const batchId = String((req.params as any).batchId ?? "").trim();
    const row = await getBatch(db, batchId);
    if (!row) return reply.status(404).send({ error: { message: "not found", type: "not_found" } });
    if (row.principal !== auth.principal) return reply.status(403).send({ error: { message: "forbidden", type: "auth_error" } });

    const items = await listBatchItems(db, batchId);
    reply.type("application/jsonl; charset=utf-8");
    const lines = items.map((it) => {
      return JSON.stringify({
        idx: it.idx,
        endpoint: it.endpoint,
        status: it.status,
        response: it.response_json ? safeJsonParse(it.response_json) : null,
        error: it.error,
      });
    });
    return reply.send(lines.join("\n") + "\n");
  });
}

function safeJsonParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}

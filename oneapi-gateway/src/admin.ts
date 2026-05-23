import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { sha256Hex } from "./crypto.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import {
  findTenant,
  deleteApiKey,
  deleteTenant,
  insertApiKey,
  listApiKeys,
  listTenants,
  revokeApiKey,
  unbindTenantKeys,
  updateApiKeyRpm,
  updateApiKeyTenant,
  upsertTenant,
} from "./db.js";
import type { RedisClient } from "./redis.js";

function basicAuthOk(authHeader: string | undefined, user: string, pass: string): boolean {
  if (!authHeader) return false;
  const m = authHeader.match(/^Basic\s+(.+)$/i);
  if (!m) return false;
  const decoded = Buffer.from(m[1]!, "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx < 0) return false;
  const u = decoded.slice(0, idx);
  const p = decoded.slice(idx + 1);
  return u === user && p === pass;
}

function requireAdmin(req: any, cfg: Config): boolean {
  return basicAuthOk(req.headers.authorization, cfg.adminUser, cfg.adminPass);
}

function requireAdminAction(req: any): boolean {
  const h = req.headers["x-oneapi-admin-action"];
  const v = Array.isArray(h) ? h[0] : h;
  return String(v ?? "") === "1";
}

function requireAdminWrite(req: any, cfg: Config): boolean {
  return requireAdmin(req, cfg) && requireAdminAction(req);
}

function apiKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, 8);
}

function generateApiKey(): string {
  const b = randomBytes(24).toString("base64url");
  return `sk-${b}`;
}

export async function registerAdminApi(app: FastifyInstance, cfg: Config, db: Db, redis: RedisClient): Promise<void> {
  app.get("/admin/api/keys", async (req, reply) => {
    if (!requireAdmin(req, cfg)) {
      reply.header("WWW-Authenticate", 'Basic realm="oneapi-dashboard"');
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }
    const keys = await listApiKeys(db);
    return {
      keys: keys.map((k) => ({
        id: k.id,
        key_prefix: k.key_prefix,
        created_at: k.created_at,
        revoked_at: k.revoked_at,
        rpm_limit: k.rpm_limit,
        tenant_id: k.tenant_id,
      })),
    };
  });

  app.post("/admin/api/keys", async (req, reply) => {
    if (!requireAdminWrite(req, cfg)) {
      reply.header("WWW-Authenticate", 'Basic realm="oneapi-dashboard"');
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }
    const raw = generateApiKey();
    const hash = sha256Hex(raw);
    const prefix = apiKeyPrefix(raw);
    const out = await insertApiKey(db, hash, prefix);
    return { id: out.id, api_key: raw, key_prefix: prefix };
  });

  app.post("/admin/api/keys/:id/revoke", async (req, reply) => {
    if (!requireAdminWrite(req, cfg)) {
      reply.header("WWW-Authenticate", 'Basic realm="oneapi-dashboard"');
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }
    const id = Number((req.params as any).id);
    if (!Number.isFinite(id) || id <= 0) return reply.status(400).send({ error: { message: "invalid id", type: "invalid_request_error" } });
    await revokeApiKey(db, id);
    return { ok: true };
  });

  app.delete("/admin/api/keys/:id", async (req, reply) => {
    if (!requireAdminWrite(req, cfg)) {
      reply.header("WWW-Authenticate", 'Basic realm="oneapi-dashboard"');
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }
    const id = Number((req.params as any).id);
    if (!Number.isFinite(id) || id <= 0) return reply.status(400).send({ error: { message: "invalid id", type: "invalid_request_error" } });
    const body = (req.body ?? {}) as any;
    const force = Boolean(body.force);
    const r = await deleteApiKey(db, id, force);
    if (r === "deleted") return { ok: true };
    if (r === "not_found") return reply.status(404).send({ error: { message: "not found", type: "not_found" } });
    return reply.status(409).send({ error: { message: "key must be revoked before delete", type: "invalid_request_error" } });
  });

  app.put("/admin/api/keys/:id/rpm", async (req, reply) => {
    if (!requireAdminWrite(req, cfg)) {
      reply.header("WWW-Authenticate", 'Basic realm="oneapi-dashboard"');
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }
    const id = Number((req.params as any).id);
    if (!Number.isFinite(id) || id <= 0) return reply.status(400).send({ error: { message: "invalid id", type: "invalid_request_error" } });
    const body = (req.body ?? {}) as any;
    const rpm = body.rpm_limit === null || body.rpm_limit === undefined ? null : Number(body.rpm_limit);
    if (rpm !== null && (!Number.isFinite(rpm) || rpm <= 0)) return reply.status(400).send({ error: { message: "invalid rpm_limit", type: "invalid_request_error" } });
    await updateApiKeyRpm(db, id, rpm);
    return { ok: true };
  });

  app.put("/admin/api/keys/:id/tenant", async (req, reply) => {
    if (!requireAdminWrite(req, cfg)) {
      reply.header("WWW-Authenticate", 'Basic realm="oneapi-dashboard"');
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }
    const id = Number((req.params as any).id);
    if (!Number.isFinite(id) || id <= 0) return reply.status(400).send({ error: { message: "invalid id", type: "invalid_request_error" } });
    const body = (req.body ?? {}) as any;
    const tenantIdRaw = body.tenant_id === null || body.tenant_id === undefined ? null : String(body.tenant_id).trim();
    const tenantId = tenantIdRaw ? tenantIdRaw : null;
    if (tenantId) {
      const t = await findTenant(db, tenantId);
      if (!t) return reply.status(400).send({ error: { message: "tenant not found", type: "not_found" } });
    }
    await updateApiKeyTenant(db, id, tenantId);
    return { ok: true };
  });

  app.get("/admin/api/tenants", async (req, reply) => {
    if (!requireAdmin(req, cfg)) {
      reply.header("WWW-Authenticate", 'Basic realm="oneapi-dashboard"');
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }
    const tenants = await listTenants(db);
    return { tenants };
  });

  app.put("/admin/api/tenants/:tenantId", async (req, reply) => {
    if (!requireAdminWrite(req, cfg)) {
      reply.header("WWW-Authenticate", 'Basic realm="oneapi-dashboard"');
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }
    const tenantId = String((req.params as any).tenantId ?? "").trim();
    if (!tenantId) return reply.status(400).send({ error: { message: "invalid tenantId", type: "invalid_request_error" } });
    const body = (req.body ?? {}) as any;
    const rpm = body.rpm_limit === null || body.rpm_limit === undefined ? null : Number(body.rpm_limit);
    const tpm = body.tpm_limit === null || body.tpm_limit === undefined ? null : Number(body.tpm_limit);
    const disabled = Boolean(body.disabled);
    if (rpm !== null && (!Number.isFinite(rpm) || rpm <= 0)) return reply.status(400).send({ error: { message: "invalid rpm_limit", type: "invalid_request_error" } });
    if (tpm !== null && (!Number.isFinite(tpm) || tpm <= 0)) return reply.status(400).send({ error: { message: "invalid tpm_limit", type: "invalid_request_error" } });
    await upsertTenant(db, tenantId, rpm, tpm, disabled);
    await redis.set(
      `tenantcfg:v1:${tenantId}`,
      JSON.stringify({ rpm_limit: rpm, tpm_limit: tpm, disabled }),
      { EX: 300 },
    );
    return { ok: true };
  });

  app.delete("/admin/api/tenants/:tenantId", async (req, reply) => {
    if (!requireAdminWrite(req, cfg)) {
      reply.header("WWW-Authenticate", 'Basic realm="oneapi-dashboard"');
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }
    const tenantId = String((req.params as any).tenantId ?? "").trim();
    if (!tenantId) return reply.status(400).send({ error: { message: "invalid tenantId", type: "invalid_request_error" } });
    const body = (req.body ?? {}) as any;
    const force = Boolean(body.force);
    const r = await deleteTenant(db, tenantId, force);
    if (r === "deleted") {
      await redis.del(`tenantcfg:v1:${tenantId}`);
      return { ok: true };
    }
    if (r === "not_found") return reply.status(404).send({ error: { message: "not found", type: "not_found" } });
    return reply.status(409).send({ error: { message: "tenant still has keys bound", type: "invalid_request_error" } });
  });

  app.post("/admin/api/tenants/:tenantId/unbind_keys", async (req, reply) => {
    if (!requireAdminWrite(req, cfg)) {
      reply.header("WWW-Authenticate", 'Basic realm="oneapi-dashboard"');
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }
    const tenantId = String((req.params as any).tenantId ?? "").trim();
    if (!tenantId) return reply.status(400).send({ error: { message: "invalid tenantId", type: "invalid_request_error" } });
    const t = await findTenant(db, tenantId);
    if (!t) return reply.status(404).send({ error: { message: "not found", type: "not_found" } });
    const n = await unbindTenantKeys(db, tenantId);
    await redis.del(`tenantcfg:v1:${tenantId}`);
    return { ok: true, unbound: n };
  });
}

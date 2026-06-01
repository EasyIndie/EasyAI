import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { sha256Hex } from "./crypto.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import {
  findTenant,
  deleteApiKey,
  deleteTenant,
  getApiKeyUsage,
  insertApiKey,
  listApiKeys,
  listTenants,
  revokeApiKey,
  scheduleApiKeyRevocation,
  unbindTenantKeys,
  updateApiKeyAutoRevoke,
  updateApiKeyMetadata,
  updateApiKeyRpm,
  updateApiKeyTenant,
  upsertTenant,
} from "./db.js";
import type { RedisClient } from "./redis.js";
import { isAdminRequest } from "./admin-auth.js";

function requireAdmin(req: any, cfg: Config): boolean {
  return isAdminRequest(req, cfg);
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

function apiKeySuffix(rawKey: string): string {
  return rawKey.slice(-6);
}

function generateApiKey(): string {
  const b = randomBytes(24).toString("base64url");
  return `sk-${b}`;
}

function runtimeKeyEnvironment(cfg: Config): "development" | "production" {
  return cfg.appEnv === "production" ? "production" : "development";
}

function parseStringList(value: unknown): string[] | null {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseNullableDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new Error("invalid date");
  return d.toISOString();
}

function keyStatus(k: { revoked_at: string | null; expires_at?: string | null; revocation_scheduled_at?: string | null }): string {
  if (k.revoked_at) return "revoked";
  if (k.expires_at && new Date(k.expires_at).getTime() <= Date.now()) return "expired";
  if (k.revocation_scheduled_at) return "revoking";
  return "active";
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
        name: k.name,
        key_prefix: k.key_prefix,
        key_suffix: k.key_suffix,
        masked_key: `${k.key_prefix}...${k.key_suffix ?? ""}`,
        environment: k.environment,
        scopes: k.scopes,
        created_at: k.created_at,
        revoked_at: k.revoked_at,
        expires_at: k.expires_at,
        last_used_at: k.last_used_at,
        last_used_ip: k.last_used_ip,
        revocation_scheduled_at: k.revocation_scheduled_at,
        auto_revoke_after_unused_days: k.auto_revoke_after_unused_days,
        ip_allow_cidrs: k.ip_allow_cidrs,
        status: keyStatus(k),
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
    const body = (req.body ?? {}) as any;
    let expiresAt: string | null;
    try {
      expiresAt = parseNullableDate(body.expires_at);
    } catch {
      return reply.status(400).send({ error: { message: "invalid expires_at", type: "invalid_request_error" } });
    }
    const raw = generateApiKey();
    const hash = sha256Hex(raw);
    const prefix = apiKeyPrefix(raw);
    const suffix = apiKeySuffix(raw);
    const out = await insertApiKey(db, {
      keyHash: hash,
      keyPrefix: prefix,
      keySuffix: suffix,
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : null,
      environment: runtimeKeyEnvironment(cfg),
      scopes: parseStringList(body.scopes),
      expiresAt,
      ipAllowCidrs: null,
    });
    return { id: out.id, api_key: raw, key_prefix: prefix, key_suffix: suffix, masked_key: `${prefix}...${suffix}` };
  });

  app.post("/admin/api/keys/:id/revoke", async (req, reply) => {
    if (!requireAdminWrite(req, cfg)) {
      reply.header("WWW-Authenticate", 'Basic realm="oneapi-dashboard"');
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }
    const id = Number((req.params as any).id);
    if (!Number.isFinite(id) || id <= 0) return reply.status(400).send({ error: { message: "invalid id", type: "invalid_request_error" } });
    const body = (req.body ?? {}) as any;
    if (body.mode === "scheduled") {
      const hours = Number(body.delay_hours);
      if (!Number.isFinite(hours) || hours <= 0) return reply.status(400).send({ error: { message: "invalid delay_hours", type: "invalid_request_error" } });
      await scheduleApiKeyRevocation(db, id, new Date(Date.now() + hours * 60 * 60 * 1000).toISOString());
    } else if (body.mode === "unused") {
      const days = Number(body.unused_days);
      if (!Number.isFinite(days) || days <= 0) return reply.status(400).send({ error: { message: "invalid unused_days", type: "invalid_request_error" } });
      await updateApiKeyAutoRevoke(db, id, Math.floor(days));
    } else {
      await revokeApiKey(db, id);
    }
    return { ok: true };
  });

  app.patch("/admin/api/keys/:id", async (req, reply) => {
    if (!requireAdminWrite(req, cfg)) {
      reply.header("WWW-Authenticate", 'Basic realm="oneapi-dashboard"');
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }
    const id = Number((req.params as any).id);
    if (!Number.isFinite(id) || id <= 0) return reply.status(400).send({ error: { message: "invalid id", type: "invalid_request_error" } });
    const body = (req.body ?? {}) as any;
    let expiresAt: string | null;
    try {
      expiresAt = parseNullableDate(body.expires_at);
    } catch {
      return reply.status(400).send({ error: { message: "invalid expires_at", type: "invalid_request_error" } });
    }
    await updateApiKeyMetadata(db, id, {
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : null,
      environment: runtimeKeyEnvironment(cfg),
      scopes: parseStringList(body.scopes),
      expiresAt,
      ipAllowCidrs: null,
    });
    return { ok: true };
  });

  app.get("/admin/api/keys/:id/usage", async (req, reply) => {
    if (!requireAdmin(req, cfg)) {
      reply.header("WWW-Authenticate", 'Basic realm="oneapi-dashboard"');
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }
    const id = Number((req.params as any).id);
    if (!Number.isFinite(id) || id <= 0) return reply.status(400).send({ error: { message: "invalid id", type: "invalid_request_error" } });
    const q = req.query as any;
    const sinceMinutes = Math.min(Math.max(Number(q.sinceMinutes ?? 1440), 1), 60 * 24 * 30);
    const rows = await getApiKeyUsage(db, id, sinceMinutes);
    return { rows };
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

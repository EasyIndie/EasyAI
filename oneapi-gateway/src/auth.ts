import { createRemoteJWKSet, jwtVerify } from "jose";
import { sha256Hex } from "./crypto.ts";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { findActiveApiKeyByHash, findTenant } from "./db.ts";
import type { RedisClient } from "./redis.ts";

function normalizeIp(raw?: string): string | undefined {
  if (!raw) return;
  const ip = raw.trim();
  if (!ip) return;
  if (ip === "::1") return "127.0.0.1";
  if (ip.startsWith("::ffff:")) return ip.slice("::ffff:".length);
  return ip;
}

function ipv4ToInt(ip: string): number | undefined {
  const parts = ip.split(".");
  if (parts.length !== 4) return;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [base, maskRaw] = cidr.split("/");
  const mask = Number(maskRaw);
  if (!base || !Number.isInteger(mask) || mask < 0 || mask > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === undefined || baseInt === undefined) return false;
  const m = mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0;
  return (ipInt & m) === (baseInt & m);
}

function ipAllowed(ipRaw: string | undefined, allowCidrs: string[] | null | undefined): boolean {
  if (allowCidrs === undefined || allowCidrs === null) return true;
  const ip = normalizeIp(ipRaw);
  if (!ip) return false;
  return allowCidrs.some((c) => ipInCidr(ip, c));
}

export type AuthContext = {
  principal: string;
  authMode: "apikey" | "oauth";
  apiKeyHash?: string;
  apiKeyId?: number;
  rpmLimit?: number | null;
  tenantId?: string | null;
  tenantRpmLimit?: number | null;
  tenantTpmLimit?: number | null;
  tenantDisabled?: boolean;
};

function bearerTokenFromHeaders(headers: Record<string, string | string[] | undefined>): string | undefined {
  const h = headers["authorization"];
  const v = Array.isArray(h) ? h[0] : h;
  if (!v) return;
  const m = v.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim();
}

function apiKeyFromHeaders(headers: Record<string, string | string[] | undefined>): string | undefined {
  const headerKey = headers["x-api-key"];
  const hk = Array.isArray(headerKey) ? headerKey[0] : headerKey;
  if (hk && hk.trim().length) return hk.trim();
  return bearerTokenFromHeaders(headers);
}

export type OAuthVerifier = {
  verify: (token: string) => Promise<{ subject: string }>;
};

export function createOAuthVerifier(cfg: Config): OAuthVerifier | undefined {
  if (!cfg.authModes.has("oauth")) return;
  if (!cfg.oauth.jwksUrl) return;

  const jwks = createRemoteJWKSet(new URL(cfg.oauth.jwksUrl));
  return {
    verify: async (token: string) => {
      const out = await jwtVerify(token, jwks, {
        issuer: cfg.oauth.issuer,
        audience: cfg.oauth.audience,
      });
      const sub = out.payload.sub;
      if (!sub || typeof sub !== "string") throw new Error("missing sub");
      return { subject: sub };
    },
  };
}

export async function authenticate(
  cfg: Config,
  oauth: OAuthVerifier | undefined,
  headers: Record<string, string | string[] | undefined>,
  db?: Db,
  redis?: RedisClient,
  reqIp?: string,
): Promise<AuthContext> {
  const internalHeader = headers["x-oneapi-internal-token"];
  const internalToken = Array.isArray(internalHeader) ? internalHeader[0] : internalHeader;
  if (cfg.internalToken && internalToken && internalToken === cfg.internalToken) {
    if (!ipAllowed(reqIp, cfg.internalTokenAllowCidrs)) throw new Error("unauthorized");
    const pHeader = headers["x-oneapi-principal"];
    const principal = (Array.isArray(pHeader) ? pHeader[0] : pHeader)?.trim();
    if (!principal) throw new Error("missing principal");
    const tenantHeader = headers["x-oneapi-tenant-id"];
    const tenantId = (Array.isArray(tenantHeader) ? tenantHeader[0] : tenantHeader)?.trim();
    let tenantRpmLimit: number | null | undefined;
    let tenantTpmLimit: number | null | undefined;
    let tenantDisabled: boolean | undefined;
    if (tenantId && db) {
      if (redis) {
        const cached = await redis.get(`tenantcfg:v1:${tenantId}`);
        if (cached) {
          try {
            const j = JSON.parse(cached);
            tenantRpmLimit = typeof j.rpm_limit === "number" ? j.rpm_limit : null;
            tenantTpmLimit = typeof j.tpm_limit === "number" ? j.tpm_limit : null;
            tenantDisabled = Boolean(j.disabled);
          } catch {}
        }
      }
      if (tenantRpmLimit === undefined && tenantTpmLimit === undefined && tenantDisabled === undefined) {
        const t = await findTenant(db, tenantId);
        if (t) {
          tenantRpmLimit = t.rpm_limit ?? null;
          tenantTpmLimit = t.tpm_limit ?? null;
          tenantDisabled = Boolean(t.disabled);
        }
      }
    }
    return { principal, authMode: "apikey", tenantId: tenantId || null, tenantRpmLimit, tenantTpmLimit, tenantDisabled };
  }

  const tokenOrKey = apiKeyFromHeaders(headers);
  if (!tokenOrKey) throw new Error("missing credentials");

  if (cfg.authModes.has("apikey") && cfg.apiKeys.size > 0 && cfg.apiKeys.has(tokenOrKey)) {
    const apiKeyHash = sha256Hex(tokenOrKey);
    return { principal: `apikey:${apiKeyHash.slice(0, 12)}`, authMode: "apikey", apiKeyHash };
  }

  if (cfg.authModes.has("apikey") && db) {
    const apiKeyHash = sha256Hex(tokenOrKey);
    const row = await findActiveApiKeyByHash(db, apiKeyHash);
    if (row) {
      let tenantRpmLimit: number | null | undefined;
      let tenantTpmLimit: number | null | undefined;
      let tenantDisabled: boolean | undefined;
      if (row.tenant_id) {
        if (redis) {
          const cached = await redis.get(`tenantcfg:v1:${row.tenant_id}`);
          if (cached) {
            try {
              const j = JSON.parse(cached);
              tenantRpmLimit = typeof j.rpm_limit === "number" ? j.rpm_limit : null;
              tenantTpmLimit = typeof j.tpm_limit === "number" ? j.tpm_limit : null;
              tenantDisabled = Boolean(j.disabled);
            } catch {}
          }
        }
        if (tenantRpmLimit === undefined && tenantTpmLimit === undefined && tenantDisabled === undefined) {
          const t = await findTenant(db, row.tenant_id);
          if (t) {
            tenantRpmLimit = t.rpm_limit ?? null;
            tenantTpmLimit = t.tpm_limit ?? null;
            tenantDisabled = Boolean(t.disabled);
            if (redis) {
              await redis.set(
                `tenantcfg:v1:${row.tenant_id}`,
                JSON.stringify({ rpm_limit: tenantRpmLimit, tpm_limit: tenantTpmLimit, disabled: tenantDisabled }),
                { EX: 300 },
              );
            }
          }
        }
      }
      return {
        principal: `apikey:${apiKeyHash.slice(0, 12)}`,
        authMode: "apikey",
        apiKeyHash,
        apiKeyId: row.id,
        rpmLimit: row.rpm_limit,
        tenantId: row.tenant_id,
        tenantRpmLimit,
        tenantTpmLimit,
        tenantDisabled,
      };
    }
  }

  if (cfg.authModes.has("oauth") && oauth) {
    const out = await oauth.verify(tokenOrKey);
    return { principal: `oauth:${out.subject}`, authMode: "oauth" };
  }

  throw new Error("invalid credentials");
}

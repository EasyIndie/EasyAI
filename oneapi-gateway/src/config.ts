import fs from "node:fs";
import yaml from "js-yaml";
import { parseCidrAllowList } from "./net.js";

export type AuthMode = "apikey" | "oauth";

export type Config = {
  appEnv: "development" | "staging" | "production" | "test";
  port: number;
  bodyLimitBytes?: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  trustProxy: boolean | number;
  adminUser: string;
  adminPass: string;
  adminAllowedCidrs?: string[] | null;
  metricsAllowedCidrs?: string[] | null;
  securityHeadersEnabled?: boolean;
  authModes: Set<AuthMode>;
  apiKeys: Set<string>;
  oauth: {
    jwksUrl?: string;
    audience?: string;
    issuer?: string;
  };
  upstreams: string[];
  upstreamTimeoutMs: number;
  rateLimitRpm: number;
  cacheEnabled: boolean;
  cacheTtlSeconds: number;
  cacheReplayChunkDelayMs: number;
  cacheReplayMaxTotalMs: number;
  cacheReplayMode: "fixed" | "original";
  guardrails: {
    enabled: boolean;
    blockInternalIp: boolean;
    injectionKeywords: string[];
    piiMaskEnabled: boolean;
  };
  corsOrigin: string | string[];
  tls?: {
    certPath: string;
    keyPath: string;
  };
  internalToken?: string;
  internalTokenAllowCidrs?: string[] | null;
  redisUrl: string;
  databaseUrl: string;
  modelMap: Record<string, string>;
  fallbackMap: Record<string, string[]>;
};

const PRIVATE_CIDRS = ["127.0.0.1/32", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"];

function parseBytes(value: unknown, defaultBytes: number): number {
  if (value === undefined || value === null || value === "") return defaultBytes;
  if (typeof value === "number") return value;
  const s = String(value).trim().toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib)?$/);
  if (!m) return defaultBytes;
  const n = Number(m[1]);
  const unit = m[2] ?? "b";
  const multiplier = unit === "mb" || unit === "mib" ? 1024 * 1024 : unit === "kb" || unit === "kib" ? 1024 : 1;
  return Math.floor(n * multiplier);
}

function arr(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : fallback;
}

function buildPostgresUrl(database: any, fallback: string): string {
  if (!database || typeof database !== "object" || Object.keys(database).length === 0) return fallback;
  if (database.url) return String(database.url);
  const host = String(database.host ?? "localhost");
  const port = Number(database.port ?? 5432);
  const user = String(database.user ?? "oneapi");
  const password = String(database.password ?? "oneapi");
  const name = String(database.name ?? "oneapi");
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(name)}`;
}

export function loadConfig(configPath = "/app/config/oneapi.yaml"): Config {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }

  const fileContents = fs.readFileSync(configPath, "utf8");
  const parsed = yaml.load(fileContents) as any;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid YAML configuration");
  }

  const server = parsed.server || {};
  const security = parsed.security || {};
  const admin = security.admin || {};
  const internal = parsed.internal || security.internal || {};
  const gateway = parsed.gateway || {};
  const database = parsed.database || {};

  const appEnv = server.env || parsed.app_env || "development";
  const port = Number(server.port ?? parsed.port ?? 3003);
  const bodyLimitBytes = parseBytes(server.body_limit_bytes ?? server.body_limit ?? parsed.body_limit_bytes ?? parsed.body_limit, 10 * 1024 * 1024);
  const logLevel = server.log_level ?? parsed.log_level ?? "info";
  const trustProxy = server.trust_proxy ?? parsed.trust_proxy ?? false;

  const adminUser = String(admin.user ?? parsed.admin_user ?? "admin").trim();
  const adminPass = String(admin.password ?? parsed.admin_pass ?? "admin").trim();
  const adminAllowedCidrs = parseCidrAllowList(admin.allowed_cidrs ?? parsed.admin_allowed_cidrs, appEnv === "production" ? PRIVATE_CIDRS : undefined);
  const metricsAllowedCidrs = parseCidrAllowList(security.metrics_allowed_cidrs ?? parsed.metrics_allowed_cidrs, appEnv === "production" ? PRIVATE_CIDRS : undefined);
  const securityHeadersEnabled = security.security_headers ?? security.headers?.enabled ?? parsed.security_headers?.enabled ?? appEnv !== "development";

  const authModesArr = Array.isArray(security.auth_modes) ? security.auth_modes : Array.isArray(parsed.auth_modes) ? parsed.auth_modes : ["apikey"];
  const authModes = new Set<AuthMode>(authModesArr.map((s: string) => s.trim()).filter(Boolean));

  const apiKeysArr = Array.isArray(security.api_keys) ? security.api_keys : Array.isArray(parsed.api_keys) ? parsed.api_keys : [];
  const apiKeys = new Set<string>(apiKeysArr.map((s: string) => s.trim()).filter(Boolean));

  const oauth = security.oauth || parsed.oauth || {};

  const upstreams = arr(gateway.upstreams ?? parsed.upstreams, ["http://localhost:4000"]);
  const upstreamTimeoutMs = Number(gateway.upstream_timeout_ms ?? parsed.upstream_timeout_ms ?? 60000);
  
  const rateLimitRpm = Number(gateway.rate_limit_rpm ?? parsed.rate_limit_rpm ?? 120);
  
  const cache = gateway.cache || parsed.cache || {};
  const cacheEnabled = cache.enabled ?? true;
  const cacheTtlSeconds = Number(cache.ttl_seconds ?? 60);
  const cacheReplayChunkDelayMs = Number(cache.replay_chunk_delay_ms ?? 0);
  const cacheReplayMaxTotalMs = Number(cache.replay_max_total_ms ?? 0);
  const cacheReplayMode = (cache.replay_mode === "original" ? "original" : "fixed");

  const guardrails = gateway.guardrails || parsed.guardrails || {};
  const guardEnabled = guardrails.enabled ?? false;
  const guardBlockInternalIp = guardrails.block_internal_ip ?? true;
  const guardPiiMaskEnabled = guardrails.pii_mask_enabled ?? true;
  const injectionKeywords = Array.isArray(guardrails.injection_keywords) ? guardrails.injection_keywords : [];

  const corsOrigin = security.cors_origins ?? parsed.cors?.origin ?? "*";

  const tlsConfig = security.tls || parsed.tls || {};
  const tls = (tlsConfig.cert_path && tlsConfig.key_path)
    ? { certPath: String(tlsConfig.cert_path), keyPath: String(tlsConfig.key_path) }
    : undefined;

  const internalToken = internal.token ?? parsed.internal_token;
  let internalTokenAllowCidrs: string[] | null | undefined = undefined;
  if (internalToken) internalTokenAllowCidrs = parseCidrAllowList(internal.allow_cidrs ?? parsed.internal_token_allow_cidrs, PRIVATE_CIDRS);

  const redisUrl = database.redis_url ?? parsed.redis_url ?? "redis://localhost:6379";
  const databaseUrl = buildPostgresUrl(database, parsed.database_url ?? "postgres://oneapi:oneapi@localhost:5432/oneapi");

  const modelMap = gateway.model_map || parsed.model_map || {};
  const fallbackMap = gateway.fallback_map || parsed.fallback_map || {};

  if (appEnv === "production") {
    if (adminUser === "admin" && adminPass === "admin") throw new Error(`Refusing to start with default admin credentials in production`);
    if (apiKeys.has("dev-key")) throw new Error(`Refusing to start with api_keys containing "dev-key" in production`);
    if (internalToken === "dev-internal") throw new Error(`Refusing to start with internal_token="dev-internal" in production`);
    if (databaseUrl.includes("oneapi:oneapi@")) throw new Error(`Refusing to start with default database password in production`);
    if (authModes.has("oauth") && !oauth.jwks_url) throw new Error(`oauth.jwks_url is required when auth_modes includes oauth`);
  }

  return {
    appEnv,
    port,
    bodyLimitBytes,
    logLevel,
    trustProxy,
    adminUser,
    adminPass,
    adminAllowedCidrs,
    metricsAllowedCidrs,
    securityHeadersEnabled,
    authModes,
    apiKeys,
    oauth: {
      jwksUrl: oauth.jwks_url || undefined,
      audience: oauth.audience || undefined,
      issuer: oauth.issuer || undefined,
    },
    upstreams,
    upstreamTimeoutMs,
    rateLimitRpm,
    cacheEnabled,
    cacheTtlSeconds,
    cacheReplayChunkDelayMs,
    cacheReplayMaxTotalMs,
    cacheReplayMode,
    guardrails: {
      enabled: guardEnabled,
      blockInternalIp: guardBlockInternalIp,
      injectionKeywords,
      piiMaskEnabled: guardPiiMaskEnabled,
    },
    corsOrigin,
    tls,
    internalToken,
    internalTokenAllowCidrs,
    redisUrl,
    databaseUrl,
    modelMap,
    fallbackMap,
  };
}

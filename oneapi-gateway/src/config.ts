import fs from "node:fs";
import process from "node:process";
import yaml from "js-yaml";

export type AuthMode = "apikey" | "oauth";

export type Config = {
  appEnv: "development" | "staging" | "production" | "test";
  port: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  trustProxy: boolean | number;
  adminUser: string;
  adminPass: string;
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

export function loadConfig(): Config {
  const configPath = process.env.ONEAPI_CONFIG_PATH ?? "/app/config/oneapi.yaml";
  
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }

  const fileContents = fs.readFileSync(configPath, "utf8");
  const parsed = yaml.load(fileContents) as any;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid YAML configuration");
  }

  const appEnv = parsed.app_env || "development";
  const port = Number(parsed.port ?? 3003);
  const logLevel = parsed.log_level ?? "info";
  const trustProxy = parsed.trust_proxy ?? false;

  const adminUser = (parsed.admin_user ?? "admin").trim();
  const adminPass = (parsed.admin_pass ?? "admin").trim();

  const authModesArr = Array.isArray(parsed.auth_modes) ? parsed.auth_modes : ["apikey"];
  const authModes = new Set<AuthMode>(authModesArr.map((s: string) => s.trim()).filter(Boolean));

  const apiKeysArr = Array.isArray(parsed.api_keys) ? parsed.api_keys : [];
  const apiKeys = new Set<string>(apiKeysArr.map((s: string) => s.trim()).filter(Boolean));

  const oauth = parsed.oauth || {};

  const upstreams = Array.isArray(parsed.upstreams) ? parsed.upstreams : ["http://localhost:4000"];
  const upstreamTimeoutMs = Number(parsed.upstream_timeout_ms ?? 60000);
  
  const rateLimitRpm = Number(parsed.rate_limit_rpm ?? 120);
  
  const cache = parsed.cache || {};
  const cacheEnabled = cache.enabled ?? true;
  const cacheTtlSeconds = Number(cache.ttl_seconds ?? 60);
  const cacheReplayChunkDelayMs = Number(cache.replay_chunk_delay_ms ?? 0);
  const cacheReplayMaxTotalMs = Number(cache.replay_max_total_ms ?? 0);
  const cacheReplayMode = (cache.replay_mode === "original" ? "original" : "fixed");

  const guardrails = parsed.guardrails || {};
  const guardEnabled = guardrails.enabled ?? false;
  const guardBlockInternalIp = guardrails.block_internal_ip ?? true;
  const guardPiiMaskEnabled = guardrails.pii_mask_enabled ?? true;
  const injectionKeywords = Array.isArray(guardrails.injection_keywords) ? guardrails.injection_keywords : [];

  const corsConfig = parsed.cors || {};
  const corsOrigin = corsConfig.origin ?? "*";

  const tlsConfig = parsed.tls || {};
  const tls = (tlsConfig.cert_path && tlsConfig.key_path)
    ? { certPath: String(tlsConfig.cert_path), keyPath: String(tlsConfig.key_path) }
    : undefined;

  const internalToken = parsed.internal_token;
  let internalTokenAllowCidrs: string[] | null | undefined = undefined;
  if (internalToken) {
    if (parsed.internal_token_allow_cidrs === "any" || parsed.internal_token_allow_cidrs === null) {
      internalTokenAllowCidrs = null;
    } else if (Array.isArray(parsed.internal_token_allow_cidrs)) {
      internalTokenAllowCidrs = parsed.internal_token_allow_cidrs;
    } else {
      internalTokenAllowCidrs = ["127.0.0.1/32", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"];
    }
  }

  const redisUrl = parsed.redis_url ?? "redis://localhost:6379";
  const databaseUrl = parsed.database_url ?? "postgres://oneapi:oneapi@localhost:5432/oneapi";

  const modelMap = parsed.model_map || {};
  const fallbackMap = parsed.fallback_map || {};

  if (appEnv === "production") {
    if (adminUser === "admin" && adminPass === "admin") throw new Error(`Refusing to start with default admin credentials in production`);
    if (apiKeys.has("dev-key")) throw new Error(`Refusing to start with ONEAPI_API_KEYS containing "dev-key" in production`);
    if (internalToken === "dev-internal") throw new Error(`Refusing to start with ONEAPI_INTERNAL_TOKEN="dev-internal" in production`);
    if (authModes.has("oauth") && !oauth.jwks_url) throw new Error(`oauth.jwks_url is required when auth_modes includes oauth`);
  }

  return {
    appEnv,
    port,
    logLevel,
    trustProxy,
    adminUser,
    adminPass,
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

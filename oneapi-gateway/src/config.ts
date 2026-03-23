import process from "node:process";

export type AuthMode = "apikey" | "oauth";

export type Config = {
  port: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
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
  internalToken?: string;
  redisUrl: string;
  databaseUrl: string;
  modelMap: Record<string, string>;
  fallbackMap: Record<string, string[]>;
};

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length ? v : undefined;
}

export function loadConfig(): Config {
  const port = Number(process.env.ONEAPI_PORT ?? "8080");
  const logLevel = (process.env.ONEAPI_LOG_LEVEL ?? "info") as Config["logLevel"];

  const authModes = new Set<AuthMode>(
    (process.env.ONEAPI_AUTH_MODE ?? "apikey")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as AuthMode[],
  );

  const apiKeys = new Set<string>(
    (process.env.ONEAPI_API_KEYS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const upstreams = (process.env.ONEAPI_UPSTREAMS ?? "http://localhost:4000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const upstreamTimeoutMs = Number(process.env.ONEAPI_UPSTREAM_TIMEOUT_MS ?? "20000");
  const rateLimitRpm = Number(process.env.ONEAPI_RATE_LIMIT_RPM ?? "120");
  const cacheEnabled = (process.env.ONEAPI_CACHE_ENABLED ?? "1") !== "0";
  const cacheTtlSeconds = Number(process.env.ONEAPI_CACHE_TTL_SECONDS ?? "60");
  const cacheReplayChunkDelayMs = Number(process.env.ONEAPI_CACHE_REPLAY_CHUNK_DELAY_MS ?? "0");
  const cacheReplayMaxTotalMs = Number(process.env.ONEAPI_CACHE_REPLAY_MAX_TOTAL_MS ?? "0");
  const cacheReplayMode = ((process.env.ONEAPI_CACHE_REPLAY_MODE ?? "fixed").trim().toLowerCase() === "original"
    ? "original"
    : "fixed") as Config["cacheReplayMode"];

  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://oneapi:oneapi@localhost:5432/oneapi";

  let modelMap: Record<string, string> = {};
  const mm = opt("ONEAPI_MODEL_MAP");
  if (mm) {
    try {
      const parsed = JSON.parse(mm);
      if (parsed && typeof parsed === "object") modelMap = parsed as Record<string, string>;
    } catch {}
  }

  let fallbackMap: Record<string, string[]> = {};
  const fm = opt("ONEAPI_FALLBACK_MAP");
  if (fm) {
    try {
      const parsed = JSON.parse(fm);
      if (parsed && typeof parsed === "object") fallbackMap = parsed as Record<string, string[]>;
    } catch {}
  }

  const guardEnabled = (process.env.ONEAPI_GUARDRAILS_ENABLED ?? "0") === "1";
  const guardBlockInternalIp = (process.env.ONEAPI_GUARDRAILS_BLOCK_INTERNAL_IP ?? "1") !== "0";
  const guardPiiMaskEnabled = (process.env.ONEAPI_GUARDRAILS_PII_MASK_ENABLED ?? "1") !== "0";
  const kwRaw = opt("ONEAPI_GUARDRAILS_INJECTION_KEYWORDS");
  const injectionKeywords = kwRaw
    ? kwRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const internalToken = opt("ONEAPI_INTERNAL_TOKEN");

  return {
    port,
    logLevel,
    adminUser: req("ONEAPI_ADMIN_USER"),
    adminPass: req("ONEAPI_ADMIN_PASS"),
    authModes,
    apiKeys,
    oauth: {
      jwksUrl: opt("ONEAPI_OAUTH_JWKS_URL"),
      audience: opt("ONEAPI_OAUTH_AUDIENCE"),
      issuer: opt("ONEAPI_OAUTH_ISSUER"),
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
    internalToken,
    redisUrl,
    databaseUrl,
    modelMap,
    fallbackMap,
  };
}

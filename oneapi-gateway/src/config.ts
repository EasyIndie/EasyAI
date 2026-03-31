import process from "node:process";

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
  internalToken?: string;
  internalTokenAllowCidrs?: string[] | null;
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
  const appEnv = ((process.env.APP_ENV ?? "development").trim().toLowerCase() as Config["appEnv"]) || "development";
  const port = Number(process.env.ONEAPI_PORT ?? "8080");
  const logLevel = (process.env.ONEAPI_LOG_LEVEL ?? "info") as Config["logLevel"];
  const trustProxyEnabled = (process.env.ONEAPI_TRUST_PROXY ?? "0") === "1";
  const trustProxyHopsRaw = process.env.ONEAPI_TRUST_PROXY_HOPS;
  const trustProxyHops = trustProxyHopsRaw && trustProxyHopsRaw.trim().length ? Number(trustProxyHopsRaw) : undefined;
  const trustProxy = trustProxyEnabled ? (Number.isFinite(trustProxyHops) ? (trustProxyHops as number) : true) : false;

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

  function parseJsonObject(name: string, raw?: string): any {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch (e: any) {
      throw new Error(`Invalid JSON in ${name}: ${String(e?.message ?? e)}`);
    }
  }

  const mm = parseJsonObject("ONEAPI_MODEL_MAP", opt("ONEAPI_MODEL_MAP"));
  const modelMap: Record<string, string> = {};
  if (mm !== undefined) {
    if (!mm || typeof mm !== "object" || Array.isArray(mm)) throw new Error(`Invalid ONEAPI_MODEL_MAP: must be JSON object`);
    for (const [k, v] of Object.entries(mm)) {
      if (typeof k !== "string" || !k.trim()) throw new Error(`Invalid ONEAPI_MODEL_MAP key`);
      if (typeof v !== "string" || !v.trim()) throw new Error(`Invalid ONEAPI_MODEL_MAP value for "${k}"`);
      modelMap[k] = v;
    }
  }

  const fm = parseJsonObject("ONEAPI_FALLBACK_MAP", opt("ONEAPI_FALLBACK_MAP"));
  const fallbackMap: Record<string, string[]> = {};
  if (fm !== undefined) {
    if (!fm || typeof fm !== "object" || Array.isArray(fm)) throw new Error(`Invalid ONEAPI_FALLBACK_MAP: must be JSON object`);
    for (const [k, v] of Object.entries(fm)) {
      if (typeof k !== "string" || !k.trim()) throw new Error(`Invalid ONEAPI_FALLBACK_MAP key`);
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !x.trim())) {
        throw new Error(`Invalid ONEAPI_FALLBACK_MAP value for "${k}": must be string[]`);
      }
      fallbackMap[k] = v;
    }
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
  const allowCidrsRaw = opt("ONEAPI_INTERNAL_TOKEN_ALLOW_CIDRS");
  let internalTokenAllowCidrs: string[] | null | undefined = undefined;
  if (internalToken) {
    if ((allowCidrsRaw ?? "").trim().toLowerCase() === "any") {
      internalTokenAllowCidrs = null;
    } else if (allowCidrsRaw && allowCidrsRaw.trim()) {
      internalTokenAllowCidrs = allowCidrsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      internalTokenAllowCidrs = ["127.0.0.1/32", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"];
    }
  }

  const adminUser = req("ONEAPI_ADMIN_USER").trim();
  const adminPass = req("ONEAPI_ADMIN_PASS").trim();

  if (appEnv === "production") {
    if (adminUser === "admin" && adminPass === "admin") throw new Error(`Refusing to start with default admin credentials in production`);
    if (apiKeys.has("dev-key")) throw new Error(`Refusing to start with ONEAPI_API_KEYS containing "dev-key" in production`);
    if (internalToken === "dev-internal") throw new Error(`Refusing to start with ONEAPI_INTERNAL_TOKEN="dev-internal" in production`);
    if (authModes.has("oauth") && !opt("ONEAPI_OAUTH_JWKS_URL")) throw new Error(`ONEAPI_OAUTH_JWKS_URL is required when ONEAPI_AUTH_MODE includes oauth`);
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
    internalTokenAllowCidrs,
    redisUrl,
    databaseUrl,
    modelMap,
    fallbackMap,
  };
}

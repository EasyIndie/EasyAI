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

function buildPostgresUrl(password: string): string {
  const host = "postgres";
  const port = 5432;
  const user = "oneapi";
  const name = "oneapi";
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(name)}`;
}

function isPlaceholderSecret(value: unknown): boolean {
  const s = String(value ?? "").trim().toLowerCase();
  return (
    !s ||
    ["admin", "dev-key", "dev-internal", "oneapi", "change-me", "changeme", "replace-me"].includes(s) ||
    s.startsWith("replace_with_")
  );
}

function assertNoPlaceholderSecrets(opts: {
  adminPass: string;
  apiKeys: Set<string>;
  internalToken?: string;
  databaseUrl: string;
}): void {
  if (isPlaceholderSecret(opts.adminPass)) throw new Error(`Refusing to start with placeholder admin password in production`);
  for (const key of opts.apiKeys) {
    if (isPlaceholderSecret(key)) throw new Error(`Refusing to start with placeholder api key in production`);
  }
  if (opts.internalToken && isPlaceholderSecret(opts.internalToken)) {
    throw new Error(`Refusing to start with placeholder internal token in production`);
  }
  if (opts.databaseUrl.includes("oneapi:oneapi@")) {
    throw new Error(`Refusing to start with default database password in production`);
  }
}

function resolveConfigPath(configPath: string): string {
  if (fs.existsSync(configPath)) return configPath;
  if (fs.existsSync("../config/easyai.development.yaml")) return "../config/easyai.development.yaml";
  if (fs.existsSync("config/easyai.development.yaml")) return "config/easyai.development.yaml";
  return configPath;
}

export function loadConfig(configPath = "/app/config/easyai.yaml"): Config {
  configPath = resolveConfigPath(configPath);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }

  const fileContents = fs.readFileSync(configPath, "utf8");
  const parsed = yaml.load(fileContents) as any;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid YAML configuration");
  }

  const app = parsed.app || {};
  const secrets = parsed.secrets || {};

  const appEnv = app.env || "development";
  const port = Number(app.port ?? 3003);
  const bodyLimitBytes = parseBytes(app.body_limit, 10 * 1024 * 1024);
  const logLevel = app.log_level ?? "info";
  const trustProxy = app.trust_proxy ?? false;

  const adminUser = "admin";
  const adminPass = String(secrets.admin_password ?? "").trim();
  const adminAllowedCidrs = parseCidrAllowList(undefined, appEnv === "production" ? PRIVATE_CIDRS : undefined);
  const metricsAllowedCidrs = parseCidrAllowList(undefined, appEnv === "production" ? PRIVATE_CIDRS : undefined);
  const securityHeadersEnabled = appEnv !== "development";

  const authModes = new Set<AuthMode>(["apikey"]);

  const apiKeysArr = Array.isArray(secrets.api_keys) ? secrets.api_keys : [];
  const apiKeys = new Set<string>(apiKeysArr.map((s: string) => s.trim()).filter(Boolean));

  const oauth = {};

  const upstreams = ["http://litellm:4000"];
  const upstreamTimeoutMs = 60000;
  
  const rateLimitRpm = 120;
  
  const cacheEnabled = true;
  const cacheTtlSeconds = 60;
  const cacheReplayChunkDelayMs = 35;
  const cacheReplayMaxTotalMs = 10000;
  const cacheReplayMode = "original";

  const guardEnabled = true;
  const guardBlockInternalIp = true;
  const guardPiiMaskEnabled = false;
  const injectionKeywords = ["ignore all previous instructions", "system prompt", "developer message", "jailbreak"];

  const corsOrigin = "*";

  const tls = undefined;

  const internalToken = secrets.internal_token;
  let internalTokenAllowCidrs: string[] | null | undefined = undefined;
  if (internalToken) internalTokenAllowCidrs = parseCidrAllowList(undefined, PRIVATE_CIDRS);

  const redisUrl = "redis://redis:6379";
  const databaseUrl = buildPostgresUrl(String(secrets.postgres_password ?? "oneapi"));

  const modelMap = {};
  const fallbackMap = {};

  if (appEnv === "production") {
    assertNoPlaceholderSecrets({ adminPass, apiKeys, internalToken, databaseUrl });
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
      jwksUrl: undefined,
      audience: undefined,
      issuer: undefined,
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

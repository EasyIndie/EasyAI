import fs from "node:fs";
import { load as loadYaml } from "js-yaml";

export type Config = {
  appEnv: "development" | "staging" | "production" | "test";
  port: number;
  bodyLimitBytes?: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  trustProxy: boolean | string;
  securityHeadersEnabled?: boolean;
  /** Keys defined in YAML. LiteLLM virtual keys are also accepted and validated by LiteLLM. */
  apiKeys: Set<string>;
  /** LiteLLM proxy base URL (model access plane). */
  litellmBaseUrl: string;
  /** Master key used by the gateway when it talks to LiteLLM on behalf of YAML keys. */
  litellmMasterKey: string;
  /** Public URL of the LiteLLM console (`/ui`). */
  consoleUrl?: string;
  upstreamTimeoutMs: number;
  rateLimitRpm: number;
  corsOrigin: string | string[];
  internalToken?: string;
  redisUrl: string;
  databaseUrl: string;
};

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

function buildPostgresUrl(password: string, app: any): string {
  const host = String(app.postgres_host ?? "postgres");
  const port = Number(app.postgres_port ?? 5432);
  const user = String(app.postgres_user ?? "oneapi");
  const name = String(app.postgres_db ?? "oneapi");
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

function assertNoPlaceholderSecrets(opts: { apiKeys: Set<string>; internalToken?: string; masterKey: string; databaseUrl: string }): void {
  for (const key of opts.apiKeys) {
    if (isPlaceholderSecret(key)) throw new Error(`Refusing to start with placeholder api key in production`);
  }
  if (opts.internalToken && isPlaceholderSecret(opts.internalToken)) {
    throw new Error(`Refusing to start with placeholder internal token in production`);
  }
  if (isPlaceholderSecret(opts.masterKey)) {
    throw new Error(`Refusing to start with placeholder master key in production`);
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

  const parsed = loadYaml(fs.readFileSync(configPath, "utf8")) as any;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid YAML configuration");
  }

  const app = parsed.app || {};
  const secrets = parsed.secrets || {};

  const appEnv = app.env || "development";
  const port = Number(app.port ?? 3003);
  const bodyLimitBytes = parseBytes(app.body_limit, 10 * 1024 * 1024);
  const logLevel = app.log_level ?? "info";
  const trustProxy = typeof app.trust_proxy === "number" ? String(app.trust_proxy) : (app.trust_proxy ?? false);
  const securityHeadersEnabled = appEnv !== "development";

  const apiKeysArr = Array.isArray(secrets.api_keys) ? secrets.api_keys : [];
  const apiKeys = new Set<string>(apiKeysArr.map((s: string) => String(s).trim()).filter(Boolean));

  const litellmBaseUrl = String(app.litellm_base_url ?? "http://litellm:4000").replace(/\/+$/, "");
  const litellmMasterKey = String(secrets.master_key ?? "").trim();
  if (!litellmMasterKey) {
    throw new Error("Missing secrets.master_key in configuration");
  }

  const consoleUrl = app.console_url ? String(app.console_url) : undefined;
  const upstreamTimeoutMs = Number(app.upstream_timeout_ms ?? 60000);
  const rateLimitRpm = Number(app.rate_limit_rpm ?? 120);
  const corsOrigin = "*";

  const internalToken = secrets.internal_token ? String(secrets.internal_token) : undefined;
  const redisUrl = "redis://redis:6379";
  const databaseUrl = buildPostgresUrl(String(secrets.postgres_password ?? "oneapi"), app);

  if (appEnv === "production") {
    assertNoPlaceholderSecrets({ apiKeys, internalToken, masterKey: litellmMasterKey, databaseUrl });
  }

  return {
    appEnv,
    port,
    bodyLimitBytes,
    logLevel,
    trustProxy,
    securityHeadersEnabled,
    apiKeys,
    litellmBaseUrl,
    litellmMasterKey,
    consoleUrl,
    upstreamTimeoutMs,
    rateLimitRpm,
    corsOrigin,
    internalToken,
    redisUrl,
    databaseUrl,
  };
}

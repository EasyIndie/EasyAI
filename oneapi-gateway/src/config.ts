import fs from "node:fs";
import { load as loadYaml } from "js-yaml";

export type Config = {
  appEnv: "development" | "staging" | "production" | "test";
  port: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  /** Keys defined in YAML. LiteLLM virtual keys are also accepted and validated by LiteLLM. */
  apiKeys: Set<string>;
  /** LiteLLM proxy base URL (model access plane). */
  litellmBaseUrl: string;
  /** Master key used by the gateway when it talks to LiteLLM on behalf of YAML keys. */
  litellmMasterKey: string;
  /** Public URL of the LiteLLM console (`/ui`). */
  consoleUrl?: string;
  /** Public URL of the optional chat UI (Open WebUI). */
  chatUrl?: string;
  /** Provider request timeout. The gateway waits a bit longer than LiteLLM. */
  timeoutMs: number;
  rateLimitRpm: number;
  internalToken?: string;
  redisUrl: string;
  databaseUrl: string;
};

/** Matching docker-compose service names keep the config surface small. */
const REDIS_URL = "redis://redis:6379";
const POSTGRES_HOST = "postgres";
const POSTGRES_PORT = 5432;
const POSTGRES_USER = "oneapi";
const POSTGRES_DB = "oneapi";

function buildPostgresUrl(password: string): string {
  const user = encodeURIComponent(POSTGRES_USER);
  const pass = encodeURIComponent(password);
  return `postgres://${user}:${pass}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`;
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
  const logLevel = app.log_level ?? "info";

  const apiKeysArr = Array.isArray(secrets.api_keys) ? secrets.api_keys : [];
  const apiKeys = new Set<string>(apiKeysArr.map((s: string) => String(s).trim()).filter(Boolean));

  const litellmBaseUrl = String(app.litellm_base_url ?? "http://litellm:4000").replace(/\/+$/, "");
  const litellmMasterKey = String(secrets.master_key ?? "").trim();
  if (!litellmMasterKey) {
    throw new Error("Missing secrets.master_key in configuration");
  }

  const consoleUrl = app.console_url ? String(app.console_url) : undefined;
  const chatUrl = app.chat_url ? String(app.chat_url) : undefined;

  const timeoutMs = Number(app.timeout_ms ?? 120000);
  const rateLimitRpm = Number(app.rate_limit_rpm ?? 120);

  const internalToken = secrets.internal_token ? String(secrets.internal_token) : undefined;
  const databaseUrl = buildPostgresUrl(String(secrets.postgres_password ?? "oneapi"));

  if (appEnv === "production") {
    assertNoPlaceholderSecrets({ apiKeys, internalToken, masterKey: litellmMasterKey, databaseUrl });
  }

  return {
    appEnv,
    port,
    logLevel,
    apiKeys,
    litellmBaseUrl,
    litellmMasterKey,
    consoleUrl,
    chatUrl,
    timeoutMs,
    rateLimitRpm,
    internalToken,
    redisUrl: REDIS_URL,
    databaseUrl,
  };
}

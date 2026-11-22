import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dump as dumpYaml } from "js-yaml";
import { loadConfig } from "../src/config.js";

async function withConfig(configObj: any, fn: (configPath: string) => void | Promise<void>) {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `test-config-${Date.now()}-${Math.random()}.yaml`);
  fs.writeFileSync(tmpFile, dumpYaml(configObj), "utf8");

  try {
    await fn(tmpFile);
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

test("loadConfig: production blocks dev-key", async () => {
  await withConfig(
    {
      app: { env: "production" },
      secrets: {
        api_keys: ["dev-key"],
        internal_token: "strong-internal-token",
        master_key: "sk-strong-master",
        postgres_password: "strong-password",
      },
    },
    async (tmpFile) => {
      assert.throws(() => loadConfig(tmpFile), /placeholder api key/i);
    },
  );
});

test("loadConfig: production blocks placeholder internal token", async () => {
  await withConfig(
    {
      app: { env: "production" },
      secrets: {
        api_keys: ["k1"],
        internal_token: "dev-internal",
        master_key: "sk-strong-master",
        postgres_password: "strong-password",
      },
    },
    async (tmpFile) => {
      assert.throws(() => loadConfig(tmpFile), /placeholder internal token/i);
    },
  );
});

test("loadConfig: supports minimal unified easyai config", async () => {
  await withConfig(
    {
      app: { env: "development", port: 3999 },
      secrets: {
        api_keys: ["dev-key"],
        internal_token: "dev-internal",
        master_key: "sk-strong-master",
        postgres_password: "oneapi",
      },
      models: {
        chat: { provider: "ollama", model: "qwen2.5:0.5b" },
      },
    },
    async (tmpFile) => {
      const cfg = loadConfig(tmpFile);
      assert.equal(cfg.port, 3999);
      assert.equal(cfg.apiKeys.has("dev-key"), true);
      assert.equal(cfg.internalToken, "dev-internal");
      assert.equal(cfg.litellmBaseUrl, "http://litellm:4000");
      assert.equal(cfg.redisUrl, "redis://redis:6379");
      assert.equal(cfg.databaseUrl, "postgres://oneapi:oneapi@postgres:5432/oneapi");
      assert.equal(cfg.consoleUrl, undefined);
    },
  );
});

test("loadConfig: production blocks placeholder master key", async () => {
  await withConfig(
    {
      app: { env: "production" },
      secrets: {
        master_key: "REPLACE_WITH_LITELLM_MASTER_KEY",
        api_keys: ["k1"],
        internal_token: "strong-internal-token",
        postgres_password: "strong-password",
      },
    },
    async (tmpFile) => {
      assert.throws(() => loadConfig(tmpFile), /placeholder master key/i);
    },
  );
});

test("loadConfig: requires secrets.master_key", async () => {
  await withConfig(
    {
      app: { env: "development" },
      secrets: {
        api_keys: ["dev-key"],
        internal_token: "dev-internal",
        postgres_password: "oneapi",
      },
    },
    async (tmpFile) => {
      assert.throws(() => loadConfig(tmpFile), /master_key/i);
    },
  );
});

test("loadConfig: reads app.console_url and gateway knobs from YAML", async () => {
  await withConfig(
    {
      app: {
        env: "development",
        console_url: "http://localhost:3005/ui",
        rate_limit_rpm: 7,
        upstream_timeout_ms: 1500,
        litellm_base_url: "http://litellm:4000/",
      },
      secrets: {
        api_keys: ["dev-key"],
        master_key: "sk-dev-master",
        postgres_password: "oneapi",
      },
    },
    async (tmpFile) => {
      const cfg = loadConfig(tmpFile);
      assert.equal(cfg.consoleUrl, "http://localhost:3005/ui");
      assert.equal(cfg.rateLimitRpm, 7);
      assert.equal(cfg.upstreamTimeoutMs, 1500);
      assert.equal(cfg.litellmBaseUrl, "http://litellm:4000");
    },
  );
});

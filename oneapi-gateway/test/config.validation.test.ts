import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { loadConfig } from "../src/config.js";

async function withConfig(configObj: any, fn: (configPath: string) => void | Promise<void>) {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `test-config-${Date.now()}-${Math.random()}.yaml`);
  fs.writeFileSync(tmpFile, yaml.dump(configObj), "utf8");

  try {
    await fn(tmpFile);
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

test("loadConfig: production blocks placeholder admin password", async () => {
  await withConfig(
    {
      app: { env: "production" },
      secrets: {
        admin_password: "admin",
        api_keys: ["k1"],
        internal_token: "strong-internal-token",
        postgres_password: "strong-password",
      },
    },
    async (tmpFile) => {
      assert.throws(() => loadConfig(tmpFile), /placeholder admin password/i);
    },
  );
});

test("loadConfig: production blocks dev-key", async () => {
  await withConfig(
    {
      app: { env: "production" },
      secrets: {
        admin_password: "strong-admin-password",
        api_keys: ["dev-key"],
        internal_token: "strong-internal-token",
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
        admin_password: "strong-admin-password",
        api_keys: ["k1"],
        internal_token: "dev-internal",
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
        admin_password: "admin",
        api_keys: ["dev-key"],
        internal_token: "dev-internal",
        postgres_password: "oneapi",
      },
      models: {
        chat: { provider: "ollama", model: "qwen2.5:0.5b" },
      },
    },
    async (tmpFile) => {
      const cfg = loadConfig(tmpFile);
      assert.equal(cfg.port, 3999);
      assert.equal(cfg.adminPass, "admin");
      assert.equal(cfg.apiKeys.has("dev-key"), true);
      assert.equal(cfg.internalToken, "dev-internal");
      assert.equal(cfg.upstreams[0], "http://litellm:4000");
      assert.equal(cfg.redisUrl, "redis://redis:6379");
      assert.equal(cfg.databaseUrl, "postgres://oneapi:oneapi@postgres:5432/oneapi");
    },
  );
});

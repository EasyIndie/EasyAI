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

test("loadConfig: production blocks default admin credentials", async () => {
  await withConfig(
    {
      app_env: "production",
      admin_user: "admin",
      admin_pass: "admin",
      api_keys: ["k1"]
    },
    async (tmpFile) => {
      assert.throws(() => loadConfig(tmpFile), /default admin credentials/i);
    },
  );
});

test("loadConfig: production blocks dev-key", async () => {
  await withConfig(
    {
      app_env: "production",
      admin_user: "u",
      admin_pass: "p",
      api_keys: ["dev-key"]
    },
    async (tmpFile) => {
      assert.throws(() => loadConfig(tmpFile), /dev-key/);
    },
  );
});

test("loadConfig: production requires JWKS when oauth enabled", async () => {
  await withConfig(
    {
      app_env: "production",
      admin_user: "u",
      admin_pass: "p",
      auth_modes: ["apikey", "oauth"],
      api_keys: ["k1"],
      database_url: "postgres://oneapi:strong-password@postgres:5432/oneapi",
      oauth: { jwks_url: "" }
    },
    async (tmpFile) => {
      assert.throws(() => loadConfig(tmpFile), /oauth.jwks_url is required/);
    },
  );
});

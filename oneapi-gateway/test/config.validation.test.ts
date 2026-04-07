import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { loadConfig } from "../src/config.ts";

async function withConfig(configObj: any, fn: () => void | Promise<void>) {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `test-config-${Date.now()}-${Math.random()}.yaml`);
  fs.writeFileSync(tmpFile, yaml.dump(configObj), "utf8");
  
  const prevPath = process.env.ONEAPI_CONFIG_PATH;
  process.env.ONEAPI_CONFIG_PATH = tmpFile;
  
  try {
    await fn();
  } finally {
    if (prevPath === undefined) delete process.env.ONEAPI_CONFIG_PATH;
    else process.env.ONEAPI_CONFIG_PATH = prevPath;
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
    async () => {
      assert.throws(() => loadConfig(), /default admin credentials/i);
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
    async () => {
      assert.throws(() => loadConfig(), /dev-key/);
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
      oauth: { jwks_url: "" }
    },
    async () => {
      assert.throws(() => loadConfig(), /oauth.jwks_url is required/);
    },
  );
});



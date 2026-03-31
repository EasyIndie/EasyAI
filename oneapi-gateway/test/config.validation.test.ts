import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";

function withEnv(env: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const done = async () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  const r = fn();
  if (r && typeof (r as any).then === "function") return (r as Promise<void>).finally(done);
  return done();
}

test("loadConfig: invalid ONEAPI_MODEL_MAP JSON throws", async () => {
  await withEnv(
    {
      APP_ENV: "development",
      ONEAPI_ADMIN_USER: "u",
      ONEAPI_ADMIN_PASS: "p",
      ONEAPI_MODEL_MAP: "{bad",
    },
    async () => {
      assert.throws(() => loadConfig(), /Invalid JSON in ONEAPI_MODEL_MAP/);
    },
  );
});

test("loadConfig: production blocks default admin credentials", async () => {
  await withEnv(
    {
      APP_ENV: "production",
      ONEAPI_ADMIN_USER: "admin",
      ONEAPI_ADMIN_PASS: "admin",
      ONEAPI_API_KEYS: "k1",
    },
    async () => {
      assert.throws(() => loadConfig(), /default admin credentials/i);
    },
  );
});

test("loadConfig: production blocks dev-key", async () => {
  await withEnv(
    {
      APP_ENV: "production",
      ONEAPI_ADMIN_USER: "u",
      ONEAPI_ADMIN_PASS: "p",
      ONEAPI_API_KEYS: "dev-key",
    },
    async () => {
      assert.throws(() => loadConfig(), /dev-key/);
    },
  );
});

test("loadConfig: production requires JWKS when oauth enabled", async () => {
  await withEnv(
    {
      APP_ENV: "production",
      ONEAPI_ADMIN_USER: "u",
      ONEAPI_ADMIN_PASS: "p",
      ONEAPI_AUTH_MODE: "apikey,oauth",
      ONEAPI_API_KEYS: "k1",
      ONEAPI_OAUTH_JWKS_URL: "",
    },
    async () => {
      assert.throws(() => loadConfig(), /ONEAPI_OAUTH_JWKS_URL is required/);
    },
  );
});


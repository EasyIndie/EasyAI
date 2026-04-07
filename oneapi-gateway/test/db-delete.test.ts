import test from "node:test";
import assert from "node:assert/strict";
import { deleteApiKey, deleteTenant, unbindTenantKeys } from "../src/db.ts";

function makeDb(script: { sqlIncludes: string; result: any }[]) {
  const calls: string[] = [];
  const db: any = {
    pool: {
      query: async (sql: string) => {
        calls.push(sql);
        const step = script.shift();
        if (!step) throw new Error("unexpected query");
        if (!sql.includes(step.sqlIncludes)) throw new Error(`unexpected sql: ${sql}`);
        return step.result;
      },
    },
    close: async () => {},
  };
  return { db, calls };
}

test("deleteApiKey: non-force requires revoke", async () => {
  const { db } = makeDb([
    { sqlIncludes: "select id, key_hash, revoked_at, tenant_id from api_keys where id=$1 limit 1", result: { rows: [{ id: 1, key_hash: "hash", revoked_at: null, tenant_id: "t1" }] } },
  ]);
  const r = await deleteApiKey(db, 1, false);
  assert.equal(r, "must_revoke");
});

test("deleteApiKey: force deletes", async () => {
  const { db, calls } = makeDb([
    { sqlIncludes: "select id, key_hash, revoked_at, tenant_id from api_keys where id=$1 limit 1", result: { rows: [{ id: 1, key_hash: "hash", revoked_at: null, tenant_id: "t1" }] } },
    { sqlIncludes: "delete from usage_events where api_key_id=$1", result: { rowCount: 5 } },
    { sqlIncludes: "delete from api_keys where id=$1", result: { rowCount: 1 } },
  ]);
  const r = await deleteApiKey(db, 1, true);
  assert.equal(r, "deleted");
  assert.equal(calls[1]?.includes("delete from usage_events where api_key_id=$1"), true);
});

test("deleteTenant: non-force blocks when has keys", async () => {
  const { db } = makeDb([
    { sqlIncludes: "delete from tenants", result: { rowCount: 0 } },
    { sqlIncludes: "select tenant_id from tenants", result: { rows: [{ tenant_id: "t1" }] } },
    { sqlIncludes: "select 1 from api_keys", result: { rows: [{ 1: 1 }] } },
  ]);
  const r = await deleteTenant(db, "t1", false);
  assert.equal(r, "has_keys");
});

test("deleteTenant: force unbinds then deletes", async () => {
  const { db, calls } = makeDb([
    { sqlIncludes: "select tenant_id from tenants", result: { rows: [{ tenant_id: "t1" }] } },
    { sqlIncludes: "delete from usage_events where tenant_id=$1", result: { rowCount: 4 } },
    { sqlIncludes: "update api_keys set tenant_id=null", result: { rowCount: 2 } },
    { sqlIncludes: "delete from tenants", result: { rowCount: 1 } },
  ]);
  const r = await deleteTenant(db, "t1", true);
  assert.equal(r, "deleted");
  assert.equal(calls.length, 4);
  assert.equal(calls[1]?.includes("delete from usage_events where tenant_id=$1"), true);
});

test("deleteTenant: non-force clears tenant usage before delete", async () => {
  const { db, calls } = makeDb([
    { sqlIncludes: "delete from tenants", result: { rowCount: 0 } },
    { sqlIncludes: "select tenant_id from tenants", result: { rows: [{ tenant_id: "t1" }] } },
    { sqlIncludes: "select 1 from api_keys", result: { rows: [] } },
    { sqlIncludes: "delete from usage_events where tenant_id=$1", result: { rowCount: 3 } },
    { sqlIncludes: "delete from tenants where tenant_id=$1", result: { rowCount: 1 } },
  ]);
  const r = await deleteTenant(db, "t1", false);
  assert.equal(r, "deleted");
  assert.equal(calls[3]?.includes("delete from usage_events where tenant_id=$1"), true);
});

test("unbindTenantKeys: updates keys", async () => {
  const { db } = makeDb([{ sqlIncludes: "update api_keys set tenant_id=null", result: { rowCount: 3 } }]);
  const n = await unbindTenantKeys(db, "t1");
  assert.equal(n, 3);
});

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
    { sqlIncludes: "delete from api_keys where id=$1 and revoked_at is not null", result: { rowCount: 0 } },
    { sqlIncludes: "select id, revoked_at from api_keys", result: { rows: [{ id: 1, revoked_at: null }] } },
  ]);
  const r = await deleteApiKey(db, 1, false);
  assert.equal(r, "must_revoke");
});

test("deleteApiKey: force deletes", async () => {
  const { db } = makeDb([{ sqlIncludes: "delete from api_keys where id=$1", result: { rowCount: 1 } }]);
  const r = await deleteApiKey(db, 1, true);
  assert.equal(r, "deleted");
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
    { sqlIncludes: "update api_keys set tenant_id=null", result: { rowCount: 2 } },
    { sqlIncludes: "delete from tenants", result: { rowCount: 1 } },
  ]);
  const r = await deleteTenant(db, "t1", true);
  assert.equal(r, "deleted");
  assert.equal(calls.length, 3);
});

test("unbindTenantKeys: updates keys", async () => {
  const { db } = makeDb([{ sqlIncludes: "update api_keys set tenant_id=null", result: { rowCount: 3 } }]);
  const n = await unbindTenantKeys(db, "t1");
  assert.equal(n, 3);
});

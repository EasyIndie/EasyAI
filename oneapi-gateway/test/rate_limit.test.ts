import test from "node:test";
import assert from "node:assert/strict";
import { checkTpm, enforceRpm, recordTpm } from "../src/rate_limit.ts";

class FakeRedis {
  private readonly kv = new Map<string, string>();
  private readonly counters = new Map<string, number>();
  async get(k: string) {
    return this.kv.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.kv.set(k, v);
    return "OK";
  }
  async incr(k: string) {
    const v = (this.counters.get(k) ?? 0) + 1;
    this.counters.set(k, v);
    this.kv.set(k, String(v));
    return v;
  }
  async incrBy(k: string, by: number) {
    const v = (this.counters.get(k) ?? 0) + by;
    this.counters.set(k, v);
    this.kv.set(k, String(v));
    return v;
  }
  async expire(_k: string, _s: number) {
    return 1;
  }
}

test("enforceRpm: blocks after rpm exceeded", async () => {
  const redis = new FakeRedis() as any;
  const now = 1710000000000;
  const r1 = await enforceRpm(redis, "p1", 2, now);
  assert.equal(r1.ok, true);
  const r2 = await enforceRpm(redis, "p1", 2, now);
  assert.equal(r2.ok, true);
  const r3 = await enforceRpm(redis, "p1", 2, now);
  assert.equal(r3.ok, false);
  assert.equal(r3.limit, 2);
});

test("TPM: record then check", async () => {
  const redis = new FakeRedis() as any;
  const now = 1710000000000;
  await recordTpm(redis, "t1", 10, now);
  await recordTpm(redis, "t1", 5, now);
  const ok = await checkTpm(redis, "t1", 20, now);
  assert.deepEqual(ok, { ok: true });
  const blocked = await checkTpm(redis, "t1", 12, now);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.limit, 12);
    assert.equal(blocked.used, 15);
  }
});

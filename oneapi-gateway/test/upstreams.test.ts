import test from "node:test";
import assert from "node:assert/strict";
import { UpstreamPool } from "../src/upstreams.js";

test("UpstreamPool: round robin", () => {
  const pool = new UpstreamPool(["http://a", "http://b"]);
  const now = Date.now();
  const u1 = pool.pick(now)!.baseUrl;
  const u2 = pool.pick(now)!.baseUrl;
  assert.notEqual(u1, u2);
});

test("UpstreamPool: opens circuit after failures", () => {
  const pool = new UpstreamPool(["http://a"], 2, 10000);
  const now = Date.now();
  pool.reportFailure("http://a", now);
  pool.reportFailure("http://a", now);
  assert.equal(pool.pick(now + 1), undefined);
  assert.ok(pool.pick(now + 10001));
});

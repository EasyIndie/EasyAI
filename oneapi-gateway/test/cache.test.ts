import test from "node:test";
import assert from "node:assert/strict";
import { decideCache } from "../src/cache.ts";

test("decideCache: caches deterministic chat completions", () => {
  const d = decideCache("/v1/chat/completions", {
    model: "m",
    messages: [{ role: "user", content: "hi" }],
    temperature: 0,
  });
  assert.equal(d.shouldCache, true);
});

test("decideCache: caches streaming", () => {
  const d1 = decideCache("/v1/chat/completions", {
    model: "m",
    messages: [{ role: "user", content: "hi" }],
    stream: true,
  });
  const d2 = decideCache("/v1/chat/completions", {
    model: "m",
    messages: [{ role: "user", content: "hi" }],
    stream: false,
  });
  assert.equal(d1.shouldCache, true);
  assert.equal(d2.shouldCache, true);
  if (d1.shouldCache && d2.shouldCache) {
    assert.notEqual(d1.cacheKey, d2.cacheKey);
  }
});

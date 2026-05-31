import test from "node:test";
import assert from "node:assert/strict";
import { createClientId } from "../chat-ui/src/ui/id.ts";

test("chat ui: creates client ids when crypto.randomUUID is unavailable", () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: undefined,
  });

  try {
    const id = createClientId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally {
    if (originalCrypto) Object.defineProperty(globalThis, "crypto", originalCrypto);
  }
});

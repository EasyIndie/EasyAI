import test from "node:test";
import assert from "node:assert/strict";
import { parseSseDataEvents } from "../chat-ui/src/ui/stream.ts";

test("chat ui: parses SSE data events without requiring a space after data colon", () => {
  const first = parseSseDataEvents('data:{"choices":[{"delta":{"content":"he"}}]}\n\n');
  assert.deepEqual(first, {
    dataEvents: ['{"choices":[{"delta":{"content":"he"}}]}'],
    rest: "",
  });

  const split = parseSseDataEvents('data: {"choices":[{"delta":{"content":"l');
  assert.deepEqual(split, {
    dataEvents: [],
    rest: 'data: {"choices":[{"delta":{"content":"l',
  });

  const finished = parseSseDataEvents(`${split.rest}lo"}}]}\n\ndata:[DONE]\n\n`);
  assert.deepEqual(finished, {
    dataEvents: ['{"choices":[{"delta":{"content":"llo"}}]}', "[DONE]"],
    rest: "",
  });
});

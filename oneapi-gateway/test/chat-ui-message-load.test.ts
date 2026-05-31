import test from "node:test";
import assert from "node:assert/strict";
import { shouldApplyLoadedMessages } from "../chat-ui/src/ui/messageLoad.ts";

test("chat ui: ignores stale message loads while a send is streaming", () => {
  assert.equal(shouldApplyLoadedMessages({
    requestSeq: 1,
    currentSeq: 2,
    requestedConversationId: "c1",
    currentConversationId: "c1",
    isStreaming: false,
  }), false);

  assert.equal(shouldApplyLoadedMessages({
    requestSeq: 2,
    currentSeq: 2,
    requestedConversationId: "c1",
    currentConversationId: "c1",
    isStreaming: true,
  }), false);

  assert.equal(shouldApplyLoadedMessages({
    requestSeq: 2,
    currentSeq: 2,
    requestedConversationId: "c1",
    currentConversationId: "c2",
    isStreaming: false,
  }), false);

  assert.equal(shouldApplyLoadedMessages({
    requestSeq: 2,
    currentSeq: 2,
    requestedConversationId: "c1",
    currentConversationId: "c1",
    isStreaming: false,
  }), true);
});

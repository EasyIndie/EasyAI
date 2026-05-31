export function shouldApplyLoadedMessages(args: {
  requestSeq: number;
  currentSeq: number;
  requestedConversationId: string;
  currentConversationId: string | null;
  isStreaming: boolean;
}): boolean {
  return (
    args.requestSeq === args.currentSeq &&
    args.currentConversationId === args.requestedConversationId &&
    !args.isStreaming
  );
}

export function parseSseDataEvents(buffer: string, flush = false): { dataEvents: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const chunks = normalized.split("\n\n");
  const rest = flush ? "" : chunks.pop() ?? "";
  if (flush && chunks[chunks.length - 1] === "") chunks.pop();
  const dataEvents = chunks
    .map((event) =>
      event
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n"),
    )
    .filter(Boolean);
  return { dataEvents, rest };
}

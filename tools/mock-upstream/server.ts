import http from "node:http";

const port = Number(process.env.PORT ?? "18081");
const status = Number(process.env.STATUS ?? "200");
const mode = String(process.env.MODE ?? "ok");

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    await readBody(req);
    if (mode === "fail") {
      res.writeHead(status || 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "upstream error", type: "api_error" } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "mock",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, mode, status, port }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: "not found" } }));
});

server.listen(port);

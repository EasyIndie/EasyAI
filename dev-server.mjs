/**
 * 独立开发服务器 - 用于验证聊天 UI
 *
 * 用法: node dev-server.mjs
 * 访问: http://localhost:8080/chat
 * API Key: dev-key
 *
 * 不需要 PostgreSQL / Redis / Ollama / LiteLLM
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8080;
const DEV_API_KEY = "dev-key";
const CHAT_UI_DIST = path.resolve(__dirname, "oneapi-gateway/chat-ui/dist");

// ---------- In-memory storage ----------
const conversations = [];
const messagesByConv = new Map();
let convIdCounter = 0;

function convKey(principal) {
  return conversations
    .filter((c) => c.principal === principal)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}

// ---------- MIME types ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".map": "application/json",
};

// ---------- SSE helpers ----------
function sseSerialize(model, content, finishReason) {
  const lines = [`data: ${JSON.stringify({
    id: `chatcmpl-${randomUUID().slice(0, 8)}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: content ? { content } : {},
      finish_reason: finishReason ?? null,
    }],
  })}`];
  return lines.join("\n") + "\n\n";
}

function sseDone() {
  return "data: [DONE]\n\n";
}

function sseUsage(model, promptTokens, completionTokens) {
  return `data: ${JSON.stringify({
    id: `chatcmpl-${randomUUID().slice(0, 8)}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: {},
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  })}\n\n`;
}

// ---------- Request handler ----------
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const method = req.method;
  const pathname = url.pathname;

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, x-api-key, accept");
  if (method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  // Auth check for /chat-api/*
  const authHeader = req.headers["authorization"] || req.headers["x-api-key"] || "";
  const apiKey = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const token = apiKey.replace(/^Bearer\s+/i, "").trim();

  if (pathname.startsWith("/chat-api/")) {
    if (token !== DEV_API_KEY) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "unauthorized" }));
    }
  }

  // Static files: /chat/*
  if (pathname === "/chat" || pathname.startsWith("/chat/")) {
    const assetMatch = pathname.match(/^\/chat\/assets\/(.+)/);
    if (assetMatch) {
      const filePath = path.join(CHAT_UI_DIST, "assets", assetMatch[1]);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
        return res.end(fs.readFileSync(filePath));
      }
      res.writeHead(404);
      return res.end("Not found");
    }

    if (!fs.existsSync(CHAT_UI_DIST)) {
      res.writeHead(503, { "content-type": "text/plain" });
      return res.end("Chat UI not built. Run: cd oneapi-gateway/chat-ui && npm run build");
    }

    // Serve index.html for SPA
    const indexPath = path.join(CHAT_UI_DIST, "index.html");
    const html = fs.readFileSync(indexPath, "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  // ----- Chat API -----

  // GET /chat-api/conversations
  if (pathname === "/chat-api/conversations" && method === "GET") {
    const principal = `apikey:dev:${token.slice(0, 8)}`;
    const list = convKey(principal).map((c) => ({
      ...c,
      created_at: c.created_at.toISOString(),
      updated_at: c.updated_at.toISOString(),
    }));
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ conversations: list }));
  }

  // POST /chat-api/conversations
  if (pathname === "/chat-api/conversations" && method === "POST") {
    const principal = `apikey:dev:${token.slice(0, 8)}`;
    const id = randomUUID();
    const now = new Date();
    const conv = { id, title: "", principal, tenant_id: null, message_count: 0, created_at: now, updated_at: now };
    conversations.push(conv);
    messagesByConv.set(id, []);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ id }));
  }

  // DELETE /chat-api/conversations/:id
  const deleteMatch = pathname.match(/^\/chat-api\/conversations\/([^/]+)$/);
  if (deleteMatch && method === "DELETE") {
    const id = deleteMatch[1];
    const principal = `apikey:dev:${token.slice(0, 8)}`;
    const idx = conversations.findIndex((c) => c.id === id && c.principal === principal);
    if (idx === -1) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "not found" }));
    }
    conversations.splice(idx, 1);
    messagesByConv.delete(id);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  // PUT /chat-api/conversations/:id/title
  const titleMatch = pathname.match(/^\/chat-api\/conversations\/([^/]+)\/title$/);
  if (titleMatch && method === "PUT") {
    const id = titleMatch[1];
    const body = await readBody(req);
    const title = JSON.parse(body).title;
    const conv = conversations.find((c) => c.id === id);
    if (!conv) {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: "not found" }));
    }
    conv.title = title;
    conv.updated_at = new Date();
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  // GET /chat-api/conversations/:id/messages
  const msgListMatch = pathname.match(/^\/chat-api\/conversations\/([^/]+)\/messages$/);
  if (msgListMatch && method === "GET") {
    const id = msgListMatch[1];
    const conv = conversations.find((c) => c.id === id);
    if (!conv) {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: "not found" }));
    }
    const list = (messagesByConv.get(id) || []).map((m) => ({
      ...m,
      created_at: m.created_at.toISOString(),
    }));
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ messages: list }));
  }

  // POST /chat-api/conversations/:id/chat
  const chatMatch = pathname.match(/^\/chat-api\/conversations\/([^/]+)\/chat$/);
  if (chatMatch && method === "POST") {
    const id = chatMatch[1];
    const conv = conversations.find((c) => c.id === id);
    if (!conv) {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: "not found" }));
    }

    const body = JSON.parse(await readBody(req));
    const model = body.model || "dev-model";
    const userMessage = body.message || "";
    const isStream = body.stream !== false;

    // Save user message
    const userMsg = {
      id: randomUUID(),
      conversation_id: id,
      role: "user",
      content: userMessage,
      model,
      prompt_tokens: null,
      completion_tokens: null,
      created_at: new Date(),
    };
    const msgs = messagesByConv.get(id) || [];
    msgs.push(userMsg);
    conv.message_count = msgs.length;
    conv.updated_at = new Date();

    // Auto-title from first message
    if (msgs.filter((m) => m.role === "user").length === 1) {
      conv.title = userMessage.length > 60 ? userMessage.slice(0, 57) + "..." : userMessage;
    }

    if (!isStream) {
      // Non-streaming
      const assistantContent = `这是来自开发服务器的模拟回复。\n\n你发送的消息是：${userMessage}\n\n当前时间：${new Date().toLocaleString("zh-CN")}\n使用模型：${model}`;
      const assistantMsg = {
        id: randomUUID(),
        conversation_id: id,
        role: "assistant",
        content: assistantContent,
        model,
        prompt_tokens: 10,
        completion_tokens: Math.ceil(assistantContent.length / 2),
        created_at: new Date(),
      };
      msgs.push(assistantMsg);
      conv.updated_at = new Date();
      conv.message_count = msgs.length;

      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({
        id: `chatcmpl-${randomUUID().slice(0, 8)}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: "assistant", content: assistantContent }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: Math.ceil(assistantContent.length / 2), total_tokens: 10 + Math.ceil(assistantContent.length / 2) },
      }));
    }

    // Streaming
    const assistantContent = `这是来自开发服务器的模拟回复。\n\n你发送的消息是：${userMessage}\n\n当前时间：${new Date().toLocaleString("zh-CN")}\n使用模型：${model}`;

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    });

    // Stream the response character by character
    const words = assistantContent.split("");
    let idx = 0;

    function streamNext() {
      if (idx < words.length) {
        const chunk = words[idx];
        idx++;
        res.write(sseSerialize(model, chunk, null));
        setTimeout(streamNext, 15 + Math.random() * 20);
      } else {
        const promptTokens = 10;
        const completionTokens = Math.ceil(assistantContent.length / 2);
        res.write(sseUsage(model, promptTokens, completionTokens));
        res.write(sseDone());
        res.end();

        // Save assistant message after stream completes
        const assistantMsg = {
          id: randomUUID(),
          conversation_id: id,
          role: "assistant",
          content: assistantContent,
          model,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          created_at: new Date(),
        };
        msgs.push(assistantMsg);
        conv.message_count = msgs.length;
        conv.updated_at = new Date();
      }
    }

    streamNext();
    return;
  }

  // 404
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ---------- Start server ----------
if (!fs.existsSync(CHAT_UI_DIST)) {
  console.error(`Chat UI dist not found at: ${CHAT_UI_DIST}`);
  console.error("Run: cd oneapi-gateway/chat-ui && npm install && npm run build");
  process.exit(1);
}

const server = http.createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`\n  EasyAI Chat Dev Server`);
  console.log(`  ─────────────────────`);
  console.log(`  URL:    http://localhost:${PORT}/chat`);
  console.log(`  API Key: dev-key`);
  console.log(`\n  Chat API: http://localhost:${PORT}/chat-api/`);
  console.log(`  Hit Ctrl+C to stop\n`);
});

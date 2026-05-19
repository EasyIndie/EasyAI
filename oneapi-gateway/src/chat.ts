import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { Config } from "./config.ts";
import type { Db, ConversationRow } from "./db.ts";
import { createConversation, listConversations, getConversation, updateConversationTitle, touchConversation, deleteConversation, insertMessage, listMessages } from "./db.ts";
import type { RedisClient } from "./redis.ts";
import type { AuthContext, OAuthVerifier } from "./auth.ts";
import { authenticate } from "./auth.ts";

async function authenticateRequest(cfg: Config, oauth: OAuthVerifier | undefined, headers: Record<string, any>, db: Db, redis: RedisClient, reqIp?: string): Promise<AuthContext> {
  return authenticate(cfg, oauth, headers, db, redis, reqIp);
}

function authHeaderFromRequest(req: any): string {
  const h = req.headers["authorization"] ?? req.headers["x-api-key"];
  return h ? String(Array.isArray(h) ? h[0] : h) : "";
}

function extractAssistantContent(sseText: string): { content: string; promptTokens: number; completionTokens: number } {
  let content = "";
  let promptTokens = 0;
  let completionTokens = 0;

  for (const line of sseText.split("\n")) {
    if (line.startsWith("data: ") && line !== "data: [DONE]") {
      try {
        const j = JSON.parse(line.slice(6));
        const delta = j?.choices?.[0]?.delta?.content;
        if (typeof delta === "string") content += delta;
        if (j?.usage) {
          promptTokens = j.usage.prompt_tokens ?? 0;
          completionTokens = j.usage.completion_tokens ?? 0;
        }
      } catch {}
    }
  }
  return { content, promptTokens, completionTokens };
}

export async function registerChatRoutes(app: FastifyInstance, cfg: Config, oauth: OAuthVerifier | undefined, db: Db, redis: RedisClient): Promise<void> {
  app.addHook("onRequest", async (req, reply) => {
    const p = (req.url.split("?")[0] ?? req.url) as string;
    if (!p.startsWith("/chat-api/")) return;
    try {
      const auth = await authenticateRequest(cfg, oauth, req.headers as any, db, redis, (req as any).ip);
      (req as any).authContext = auth;
    } catch {
      return reply.status(401).send({ error: "unauthorized" });
    }
  });

  app.get("/chat-api/conversations", async (req, reply) => {
    const auth = (req as any).authContext as AuthContext;
    const rows = await listConversations(db, auth.principal);
    return { conversations: rows };
  });

  app.post("/chat-api/conversations", async (req, reply) => {
    const auth = (req as any).authContext as AuthContext;
    const id = randomUUID();
    await createConversation(db, id, auth.principal, auth.tenantId ?? null);
    return { id };
  });

  app.delete("/chat-api/conversations/:id", async (req, reply) => {
    const auth = (req as any).authContext as AuthContext;
    const id = String((req.params as any).id ?? "");
    if (!id) return reply.status(400).send({ error: "invalid id" });
    const r = await deleteConversation(db, id, auth.principal);
    if (r === "not_found") return reply.status(404).send({ error: "not found" });
    return { ok: true };
  });

  app.put("/chat-api/conversations/:id/title", async (req, reply) => {
    const auth = (req as any).authContext as AuthContext;
    const id = String((req.params as any).id ?? "");
    if (!id) return reply.status(400).send({ error: "invalid id" });
    const body = (req.body ?? {}) as any;
    const title = String(body.title ?? "").trim().slice(0, 200);
    if (!title) return reply.status(400).send({ error: "title is required" });
    const conv = await getConversation(db, id, auth.principal);
    if (!conv) return reply.status(404).send({ error: "not found" });
    await updateConversationTitle(db, id, title);
    return { ok: true };
  });

  app.get("/chat-api/conversations/:id/messages", async (req, reply) => {
    const auth = (req as any).authContext as AuthContext;
    const id = String((req.params as any).id ?? "");
    if (!id) return reply.status(400).send({ error: "invalid id" });
    const conv = await getConversation(db, id, auth.principal);
    if (!conv) return reply.status(404).send({ error: "not found" });
    const messages = await listMessages(db, id);
    return { messages };
  });

  app.post("/chat-api/conversations/:id/chat", async (req, reply) => {
    const auth = (req as any).authContext as AuthContext;
    const id = String((req.params as any).id ?? "");
    if (!id) return reply.status(400).send({ error: "invalid id" });
    const conv = await getConversation(db, id, auth.principal);
    if (!conv) return reply.status(404).send({ error: "not found" });

    const body = (req.body ?? {}) as any;
    if (!body || typeof body !== "object") return reply.status(400).send({ error: "invalid body" });
    if (typeof body.model !== "string" || !body.model.trim()) return reply.status(400).send({ error: "model is required" });
    if (typeof body.message !== "string" || !body.message.trim()) return reply.status(400).send({ error: "message is required" });

    const model = body.model.trim();
    const userMessage = body.message.trim();
    const temperature = typeof body.temperature === "number" ? body.temperature : undefined;
    const maxTokens = typeof body.max_tokens === "number" ? body.max_tokens : undefined;

    const userMsgId = randomUUID();
    await insertMessage(db, userMsgId, id, "user", userMessage, model, null, null);
    await touchConversation(db, id);

    const isFirstMessage = (conv as any).message_count === 0;
    if (isFirstMessage) {
      const title = userMessage.length > 60 ? userMessage.slice(0, 57) + "..." : userMessage;
      await updateConversationTitle(db, id, title);
    }

    const isStream = body.stream !== false;

    const history = await listMessages(db, id);
    const messages: Array<{ role: string; content: string }> = [];
    for (const msg of history) {
      if (msg.role === "system") continue;
      if (msg.id === userMsgId) continue;
      messages.push({ role: msg.role, content: msg.content });
    }
    messages.push({ role: "user", content: userMessage });

    const payload: Record<string, any> = {
      model,
      messages,
      stream: isStream,
    };
    if (temperature !== undefined) payload.temperature = temperature;
    if (maxTokens !== undefined) payload.max_tokens = maxTokens;

    const clientAuthHeader = authHeaderFromRequest(req);

    if (!isStream) {
      const injectRes = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          authorization: clientAuthHeader,
          "content-type": "application/json",
        },
        payload,
      });

      const status = injectRes.statusCode;
      reply.status(status);
      const contentType = injectRes.headers["content-type"];
      if (contentType) reply.header("content-type", String(contentType));

      const bodyText = injectRes.body;
      if (status >= 400) {
        return reply.send(bodyText || { error: "upstream error" });
      }

      let parsed: any;
      try { parsed = JSON.parse(bodyText); } catch { parsed = null; }

      const assistantText = parsed?.choices?.[0]?.message?.content ?? "";
      const promptTokens = parsed?.usage?.prompt_tokens ?? 0;
      const completionTokens = parsed?.usage?.completion_tokens ?? 0;

      if (assistantText) {
        const assistantMsgId = randomUUID();
        await insertMessage(db, assistantMsgId, id, "assistant", assistantText, model, promptTokens || null, completionTokens || null);
        await touchConversation(db, id);
      }

      return reply.send(parsed ?? bodyText);
    }

    if (cfg.port <= 0) return reply.status(500).send({ error: "streaming not available" });

    const upstream = await fetch(`http://127.0.0.1:${cfg.port}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: clientAuthHeader,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify(payload),
    });

    reply.status(upstream.status);
    const contentType = upstream.headers.get("content-type");
    if (contentType) reply.header("content-type", contentType);
    reply.header("cache-control", "no-store");
    reply.header("x-accel-buffering", "no");

    if (!upstream.body) {
      return reply.send(await upstream.text());
    }

    if (upstream.status >= 400) {
      const errText = await upstream.text();
      return reply.send(errText);
    }

    async function* streamGenerator() {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder("utf-8");
      let responseText = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            responseText += chunk;
            yield Buffer.from(chunk);
          }
        }
        const final = decoder.decode();
        if (final) {
          responseText += final;
          yield Buffer.from(final);
        }
      } catch (err) {
        throw err;
      } finally {
        reader.releaseLock();

        const isComplete = responseText.includes("data: [DONE]");
        if (isComplete) {
          const { content, promptTokens, completionTokens } = extractAssistantContent(responseText);
          if (content) {
            const assistantMsgId = randomUUID();
            await insertMessage(db, assistantMsgId, id, "assistant", content, model, promptTokens || null, completionTokens || null).catch(console.error);
            await touchConversation(db, id).catch(console.error);
          }
        }
      }
    }

    return reply.send(Readable.from(streamGenerator()));
  });
}

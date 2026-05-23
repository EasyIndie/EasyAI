import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { getUsageSummary } from "./db.js";

function basicAuthOk(authHeader: string | undefined, user: string, pass: string): boolean {
  if (!authHeader) return false;
  const m = authHeader.match(/^Basic\s+(.+)$/i);
  if (!m) return false;
  const decoded = Buffer.from(m[1]!, "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx < 0) return false;
  const u = decoded.slice(0, idx);
  const p = decoded.slice(idx + 1);
  return u === user && p === pass;
}

function requireAdminAction(req: any): boolean {
  const h = req.headers["x-oneapi-admin-action"];
  const v = Array.isArray(h) ? h[0] : h;
  return String(v ?? "") === "1";
}

function buildPlaygroundAuthHeaders(cfg: Config): Record<string, string> | undefined {
  if (cfg.internalToken) {
    return {
      "x-oneapi-internal-token": cfg.internalToken,
      "x-oneapi-principal": "admin:playground",
    };
  }
  const firstApiKey = Array.from(cfg.apiKeys.values())[0];
  if (firstApiKey) {
    return { authorization: `Bearer ${firstApiKey}` };
  }
  return;
}

export async function registerDashboard(app: FastifyInstance, cfg: Config, db: Db): Promise<void> {
  app.addHook("onRequest", async (req, reply) => {
    const p = (req.url.split("?")[0] ?? req.url) as string;
    const needsAuth = p === "/dashboard" || p.startsWith("/dashboard/") || p.startsWith("/admin/api/");
    if (!needsAuth) return;
    const ok = basicAuthOk(req.headers.authorization, cfg.adminUser, cfg.adminPass);
    if (ok) return;
    reply.header("WWW-Authenticate", 'Basic realm="oneapi-dashboard"');
    if (p.startsWith("/admin/api/")) return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
  });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const dashboardRoot = path.resolve(__dirname, "../admin-ui/dist");

  if (fs.existsSync(dashboardRoot)) {
    const assetsRoot = path.join(dashboardRoot, "assets");
    if (fs.existsSync(assetsRoot)) {
      await app.register(fastifyStatic, { root: assetsRoot, prefix: "/dashboard/assets/" });
    }

    app.get("/dashboard", async (_req, reply) => {
      const html = fs.readFileSync(path.join(dashboardRoot, "index.html"), "utf8");
      reply.type("text/html; charset=utf-8");
      return reply.send(html);
    });

    app.get("/dashboard/*", async (_req, reply) => {
      const html = fs.readFileSync(path.join(dashboardRoot, "index.html"), "utf8");
      reply.type("text/html; charset=utf-8");
      return reply.send(html);
    });
  } else {
    app.get("/dashboard", async (_req, reply) => {
      return reply.status(503).send("Dashboard not built");
    });
  }

  const chatRoot = path.resolve(__dirname, "../chat-ui/dist");
  if (fs.existsSync(chatRoot)) {
    const chatAssetsRoot = path.join(chatRoot, "assets");
    if (fs.existsSync(chatAssetsRoot)) {
      await app.register(fastifyStatic, { root: chatAssetsRoot, prefix: "/chat/assets/", decorateReply: false });
    }

    app.get("/chat", async (_req, reply) => {
      const html = fs.readFileSync(path.join(chatRoot, "index.html"), "utf8");
      reply.type("text/html; charset=utf-8");
      return reply.send(html);
    });

    app.get("/chat/*", async (_req, reply) => {
      const html = fs.readFileSync(path.join(chatRoot, "index.html"), "utf8");
      reply.type("text/html; charset=utf-8");
      return reply.send(html);
    });
  } else {
    app.get("/chat", async (_req, reply) => {
      return reply.status(503).send("Chat UI not built");
    });
  }

  app.get("/admin/api/usage", async (req, reply) => {
    const ok = basicAuthOk(req.headers.authorization, cfg.adminUser, cfg.adminPass);
    if (!ok) {
      reply.header("WWW-Authenticate", 'Basic realm="oneapi-dashboard"');
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }

    const sinceMinutes = Math.max(1, Math.min(24 * 60, Number((req.query as any)?.sinceMinutes ?? "60")));
    const rows = await getUsageSummary(db, sinceMinutes);
    return { rows };
  });

  app.get("/admin/api/playground/models", async (req, reply) => {
    const ok = basicAuthOk(req.headers.authorization, cfg.adminUser, cfg.adminPass);
    if (!ok) {
      reply.header("WWW-Authenticate", 'Basic realm="oneapi-dashboard"');
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }
    const authHeaders = buildPlaygroundAuthHeaders(cfg);
    if (!authHeaders) return reply.status(503).send({ error: { message: "no playground auth configured", type: "gateway_error" } });

    const upstream = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: authHeaders,
    });

    reply.status(upstream.statusCode);
    const contentType = upstream.headers["content-type"];
    if (contentType) reply.header("content-type", String(contentType));
    const payload = upstream.body;
    if (!payload) return reply.send({});
    try {
      return reply.send(JSON.parse(payload));
    } catch {
      return reply.send(payload);
    }
  });

  app.post("/admin/api/playground/chat", async (req, reply) => {
    const ok = basicAuthOk(req.headers.authorization, cfg.adminUser, cfg.adminPass);
    if (!ok || !requireAdminAction(req)) {
      reply.header("WWW-Authenticate", 'Basic realm="oneapi-dashboard"');
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }
    const authHeaders = buildPlaygroundAuthHeaders(cfg);
    if (!authHeaders) return reply.status(503).send({ error: { message: "no playground auth configured", type: "gateway_error" } });

    const body = (req.body ?? {}) as any;
    if (!body || typeof body !== "object") return reply.status(400).send({ error: { message: "invalid body", type: "invalid_request_error" } });
    if (typeof body.model !== "string" || !body.model.trim()) return reply.status(400).send({ error: { message: "model is required", type: "invalid_request_error" } });
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return reply.status(400).send({ error: { message: "messages is required", type: "invalid_request_error" } });
    }

    const payload = {
      ...body,
      stream: body.stream === true,
    };

    if (payload.stream) {
      if (cfg.port > 0) {
        const upstream = await fetch(`http://127.0.0.1:${cfg.port}/v1/chat/completions`, {
          method: "POST",
          headers: {
            ...authHeaders,
            accept: "text/event-stream",
            "content-type": "application/json",
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
        return reply.send(Readable.fromWeb(upstream.body as any));
      }

      const injected = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          ...authHeaders,
          accept: "text/event-stream",
          "content-type": "application/json",
        },
        payload,
      });
      reply.status(injected.statusCode);
      const contentType = injected.headers["content-type"];
      if (contentType) reply.header("content-type", String(contentType));
      reply.header("cache-control", "no-store");
      return reply.send(injected.body);
    }

    const upstream = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
      },
      payload,
    });

    reply.status(upstream.statusCode);
    const contentType = upstream.headers["content-type"];
    if (contentType) reply.header("content-type", String(contentType));
    const payloadText = upstream.body;
    if (!payloadText) return reply.send({});
    try {
      return reply.send(JSON.parse(payloadText));
    } catch {
      return reply.send(payloadText);
    }
  });
}

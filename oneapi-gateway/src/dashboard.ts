import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { getUsageSummary } from "./db.js";
import { ipAllowed } from "./net.js";
import { clearAdminSessionCookie, createAdminSessionCookie, isAdminRequest } from "./admin-auth.js";
import { buildGlobalNav, buildThemeInitScript, injectGlobalNav } from "./ui-shell.js";

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

function buildHomeHtml(cfg: Config, isAdmin: boolean, loginState?: string): string {
  const capabilityItems = [
    "统一 OpenAI-compatible 入口，屏蔽上游模型服务差异",
    "支持 API Key 调用，按租户做配额和限流治理",
    "内置聊天界面，支持会话历史、流式输出和模型测试",
    "提供 Batch API，用于离线批量请求和异步处理",
    "提供缓存、回放、指标和用量统计，便于控制成本和排障",
    "提供注入拦截、内网 IP 拦截和可选 PII 脱敏能力",
  ];
  const usageSteps = [
    {
      title: "1. 启动服务",
      body: "使用 Docker Compose 启动完整栈，网关会自动连接 LiteLLM、Redis、Postgres、Ollama 和 Batch Worker。",
      hint: "docker compose up -d --build",
    },
    {
      title: "2. 选择入口",
      body: "普通用户进入会话页并输入 API Key；管理员先在首页登录后进入 Dashboard；开发者可直接打开 API 文档。",
      hint: "Chat / Dashboard / Docs",
    },
    {
      title: "3. 开始使用",
      body: "管理员在 Dashboard 创建 API Key 并绑定租户；用户使用分配到的 Key 调用接口或进入会话页。",
      hint: "API Key / Tenant / Usage",
    },
  ];
  return `<!doctype html>
<html lang="zh-CN">
<head>
  ${buildThemeInitScript()}
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EasyAI Console</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: var(--ui-font-sans);
      color: var(--ui-text);
    }
    .wrap {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
    }
    main {
      padding: 44px 0 56px;
    }
    .hero {
      margin-bottom: 20px;
    }
    .intro {
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-lg);
      background: var(--ui-bg-elevated);
      box-shadow: var(--ui-shadow-soft);
      padding: 22px;
      backdrop-filter: blur(14px);
    }
    h1 {
      margin: 0 0 12px;
      font-size: 32px;
      line-height: 1.16;
      letter-spacing: 0;
    }
    .lead {
      margin: 0;
      color: var(--ui-text-muted);
      font-size: 16px;
      line-height: 1.65;
    }
    .subtle {
      margin: 0 0 14px;
      color: var(--ui-primary);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0;
    }
    .section {
      margin-top: 24px;
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-lg);
      background: var(--ui-bg-elevated);
      box-shadow: var(--ui-shadow-soft);
      padding: 20px;
      backdrop-filter: blur(14px);
    }
    .section h2 {
      margin: 0 0 12px;
      font-size: 20px;
      line-height: 1.3;
    }
    .section p {
      margin: 0;
      color: var(--ui-text-muted);
      line-height: 1.65;
    }
    .feature-list {
      margin: 14px 0 0;
      padding: 0;
      list-style: none;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .feature-list li {
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-md);
      padding: 12px 14px;
      background: var(--ui-bg-strong);
      color: var(--ui-text);
      line-height: 1.5;
    }
    .steps {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-top: 14px;
    }
    .step {
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-md);
      padding: 14px;
      background: var(--ui-bg-strong);
    }
    .step strong {
      display: block;
      margin-bottom: 8px;
      font-size: 15px;
    }
    .step p {
      margin: 0 0 10px;
      font-size: 14px;
    }
    .step code,
    .hint {
      display: block;
      color: var(--ui-primary);
      font-family: var(--ui-font-mono);
      font-size: 12px;
      word-break: break-word;
    }
    @media (max-width: 880px) {
      .feature-list { grid-template-columns: 1fr; }
      .steps { grid-template-columns: 1fr; }
    }
    @media (max-width: 560px) {
      .wrap { width: min(100% - 24px, 1120px); }
      main { padding: 28px 0 40px; }
      h1 { font-size: 28px; }
      .section { padding: 16px; }
    }
  </style>
</head>
<body class="easyai-page-home">
  ${buildGlobalNav({ active: "home", isAdmin, loginState })}
  <main class="wrap">
    <section class="hero">
      <div class="intro">
        <p class="subtle">EasyAI Platform</p>
        <h1>统一入口：会话、管理和 API 文档</h1>
        <p class="lead">EasyAI 提供 OpenAI-compatible 网关、本地模型接入、会话页、API Key 管理、租户治理、批处理和用量统计。</p>
        <p class="lead" style="margin-top: 12px;">顶部导航集中提供会话页、API 文档和管理员登录入口；正文只保留平台能力与使用顺序。</p>
      </div>
    </section>

    <section class="section" aria-labelledby="capabilities-title">
      <h2 id="capabilities-title">项目能做什么</h2>
      <p>这套服务不是单纯的聊天页，而是一个可直接用于本地开发、团队试用和生产接入的 LLM 服务平台。</p>
      <ul class="feature-list">
        ${capabilityItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </section>

    <section class="section" aria-labelledby="usage-title">
      <h2 id="usage-title">用户怎么用</h2>
      <p>推荐的使用顺序很简单：先启动服务，再选择入口，最后按角色完成自己的操作。</p>
      <div class="steps">
        ${usageSteps.map((step) => `<div class="step"><strong>${step.title}</strong><p>${step.body}</p><span class="hint">${step.hint}</span></div>`).join("")}
      </div>
    </section>

  </main>
  ${isAdmin ? "" : `<script src="/admin/session.js"></script>`}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function registerDashboard(app: FastifyInstance, cfg: Config, db: Db): Promise<void> {
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });

  app.addHook("onRequest", async (req, reply) => {
    const p = (req.url.split("?")[0] ?? req.url) as string;
    if (p.startsWith("/dashboard/assets/")) return;
    const needsAuth = p === "/dashboard" || p.startsWith("/dashboard/") || p.startsWith("/admin/api/");
    if (!needsAuth) return;
    if (!ipAllowed((req as any).ip, cfg.adminAllowedCidrs)) {
      return reply.status(403).send({ error: { message: "forbidden", type: "auth_error" } });
    }
    const ok = isAdminRequest(req, cfg);
    if (ok) return;
    if (p.startsWith("/admin/api/")) return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    return reply.redirect("/?adminLogin=required");
  });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  app.get("/", async (req, reply) => {
    reply.type("text/html; charset=utf-8");
    const loginState = String((req.query as any)?.adminLogin ?? "");
    return reply.send(buildHomeHtml(cfg, isAdminRequest(req, cfg), loginState));
  });

  app.get("/admin/session.js", async (_req, reply) => {
    reply.type("application/javascript; charset=utf-8");
    return reply.send(`
const form = document.getElementById("admin-login-form");
if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const res = await fetch("/admin/session", {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({
        username: String(data.get("username") || ""),
        password: String(data.get("password") || "")
      })
    });
    window.location.href = res.ok ? "/" : "/?adminLogin=failed";
  });
}
`);
  });

  app.post("/admin/session", async (req, reply) => {
    if (!ipAllowed((req as any).ip, cfg.adminAllowedCidrs)) {
      return reply.status(403).send({ error: { message: "forbidden", type: "auth_error" } });
    }
    const body = (req.body ?? {}) as any;
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    if (username !== cfg.adminUser || password !== cfg.adminPass) {
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }
    reply.header("set-cookie", createAdminSessionCookie(cfg));
    return { ok: true };
  });

  app.post("/admin/session/logout", async (_req, reply) => {
    reply.header("set-cookie", clearAdminSessionCookie());
    return reply.redirect("/", 303);
  });

  const dashboardRoot = path.resolve(__dirname, "../admin-ui/dist");

  if (fs.existsSync(dashboardRoot)) {
    const assetsRoot = path.join(dashboardRoot, "assets");
    if (fs.existsSync(assetsRoot)) {
      await app.register(fastifyStatic, { root: assetsRoot, prefix: "/dashboard/assets/" });
    }

    app.get("/dashboard", async (_req, reply) => {
      const html = fs.readFileSync(path.join(dashboardRoot, "index.html"), "utf8");
      reply.type("text/html; charset=utf-8");
      return reply.send(injectGlobalNav(html, { active: "dashboard" }));
    });

    app.get("/dashboard/*", async (_req, reply) => {
      const html = fs.readFileSync(path.join(dashboardRoot, "index.html"), "utf8");
      reply.type("text/html; charset=utf-8");
      return reply.send(injectGlobalNav(html, { active: "dashboard" }));
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
      return reply.send(injectGlobalNav(html, { active: "chat" }));
    });

    app.get("/chat/*", async (_req, reply) => {
      const html = fs.readFileSync(path.join(chatRoot, "index.html"), "utf8");
      reply.type("text/html; charset=utf-8");
      return reply.send(injectGlobalNav(html, { active: "chat" }));
    });
  } else {
    app.get("/chat", async (_req, reply) => {
      return reply.status(503).send("Chat UI not built");
    });
  }

  app.get("/admin/api/usage", async (req, reply) => {
    const ok = isAdminRequest(req, cfg);
    if (!ok) {
      return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    }

    const sinceMinutes = Math.max(1, Math.min(24 * 60, Number((req.query as any)?.sinceMinutes ?? "60")));
    const rows = await getUsageSummary(db, sinceMinutes);
    return { rows };
  });

  app.get("/admin/api/playground/models", async (req, reply) => {
    const ok = isAdminRequest(req, cfg);
    if (!ok) {
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
    const ok = isAdminRequest(req, cfg);
    if (!ok || !requireAdminAction(req)) {
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

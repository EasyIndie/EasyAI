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

function buildHomeHtml(cfg: Config): string {
  const authModes = Array.from(cfg.authModes.values()).join(", ") || "none";
  const upstreams = cfg.upstreams.map((u) => `<code>${escapeHtml(u)}</code>`).join("");
  const cards = [
    {
      href: "/chat",
      label: "Chat UI",
      title: "内置聊天",
      desc: "普通用户输入 API Key 后进行对话，也可以在同页切换到模型测试。",
    },
    {
      href: "/dashboard",
      label: "Dashboard",
      title: "管理后台",
      desc: "管理 API Key、租户、用量统计，并查看运行状态与后台操作入口。",
    },
    {
      href: "/docs",
      label: "Swagger",
      title: "API 文档",
      desc: "查看和调试 OpenAI-compatible API、Batch API 与模型列表接口。",
    },
    {
      href: "/openapi.json",
      label: "JSON",
      title: "OpenAPI JSON",
      desc: "供客户端生成、接口审计和自动化集成使用的机器可读规范。",
    },
  ];
  const capabilityItems = [
    "统一 OpenAI-compatible 入口，屏蔽上游模型服务差异",
    "支持 API Key / OAuth 调用，按租户做配额和限流治理",
    "内置聊天界面，支持会话历史、流式输出和模型测试",
    "提供 Batch API，用于离线批量请求和异步处理",
    "提供缓存、回放、指标和用量统计，便于控制成本和排障",
    "提供注入拦截、内网 IP 拦截和 PII 脱敏等安全能力",
  ];
  const usageSteps = [
    {
      title: "1. 启动服务",
      body: "使用 Docker Compose 启动完整栈，网关会自动连接 LiteLLM、Redis、Postgres、Ollama 和 Batch Worker。",
      hint: "docker compose up -d --build",
    },
    {
      title: "2. 进入入口",
      body: "先打开首页查看概览；普通用户进入 Chat，管理员进入 Dashboard，开发者查看 Docs。",
      hint: "http://localhost:3003/",
    },
    {
      title: "3. 开始使用",
      body: "在 Dashboard 创建 API Key 并绑定租户，或者直接在 Chat 页输入 Key 开始对话；需要测试模型时切换到模型测试。",
      hint: "Chat / Dashboard / Docs",
    },
  ];
  const serviceRows = [
    ["首页", "/","快速了解服务能力和主要入口"],
    ["聊天", "/chat","对话、历史、流式输出、模型测试"],
    ["管理后台", "/dashboard","API Key、租户、用量、后台操作"],
    ["文档", "/docs","Swagger UI 与 OpenAPI 规范"],
    ["健康检查", "/healthz","服务状态和上游列表"],
    ["指标", "/metrics","Prometheus 指标，仅允许受限 IP 访问"],
  ];

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EasyAI Console</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fb;
      --panel: #ffffff;
      --text: #172033;
      --muted: #5c667a;
      --line: #d9dee8;
      --accent: #1769aa;
      --accent-strong: #0f4f87;
      --ok: #167a4a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background: var(--bg);
    }
    header {
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    .wrap {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
    }
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 72px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 700;
      font-size: 18px;
    }
    .mark {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      color: #ffffff;
      background: var(--accent);
      font-weight: 800;
    }
    .status {
      color: var(--ok);
      font-size: 14px;
      font-weight: 600;
    }
    main {
      padding: 44px 0 56px;
    }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.75fr);
      gap: 20px;
      align-items: stretch;
      margin-bottom: 20px;
    }
    .intro {
      border: 1px solid var(--line);
      border-radius: 10px;
      background: linear-gradient(180deg, #ffffff 0%, #f9fbff 100%);
      padding: 22px;
    }
    h1 {
      margin: 0 0 12px;
      font-size: 32px;
      line-height: 1.16;
      letter-spacing: 0;
    }
    .lead {
      margin: 0;
      color: var(--muted);
      font-size: 16px;
      line-height: 1.65;
    }
    .subtle {
      margin: 0 0 14px;
      color: var(--accent-strong);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    .meta {
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--panel);
      padding: 18px;
    }
    .meta dl {
      margin: 0;
      display: grid;
      gap: 12px;
    }
    .meta dt {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }
    .meta dd {
      margin: 4px 0 0;
      font-size: 14px;
      word-break: break-word;
    }
    .meta code {
      display: block;
      margin-top: 4px;
      color: var(--accent-strong);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-top: 20px;
    }
    .card {
      display: flex;
      flex-direction: column;
      min-height: 188px;
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: inherit;
      background: var(--panel);
      text-decoration: none;
      transition: border-color .15s ease, transform .15s ease, box-shadow .15s ease;
    }
    .card:hover {
      transform: translateY(-2px);
      border-color: var(--accent);
      box-shadow: 0 12px 28px rgba(23, 32, 51, .08);
    }
    .label {
      color: var(--accent-strong);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .card h2 {
      margin: 18px 0 8px;
      font-size: 20px;
      line-height: 1.25;
      letter-spacing: 0;
    }
    .card p {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.55;
    }
    .go {
      margin-top: auto;
      padding-top: 20px;
      color: var(--accent);
      font-size: 14px;
      font-weight: 700;
    }
    .section {
      margin-top: 24px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--panel);
      padding: 20px;
    }
    .section h2 {
      margin: 0 0 12px;
      font-size: 20px;
      line-height: 1.3;
    }
    .section p {
      margin: 0;
      color: var(--muted);
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
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px 14px;
      background: #fbfcfe;
      color: var(--text);
      line-height: 1.5;
    }
    .steps {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-top: 14px;
    }
    .step {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      background: #fbfcfe;
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
      color: var(--accent-strong);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      word-break: break-word;
    }
    .matrix {
      width: 100%;
      border-collapse: collapse;
      margin-top: 14px;
    }
    .matrix th,
    .matrix td {
      padding: 12px 10px;
      border-top: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }
    .matrix th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .04em;
      width: 18%;
    }
    .matrix td:first-child {
      font-weight: 700;
      width: 18%;
      white-space: nowrap;
    }
    @media (max-width: 880px) {
      .hero { grid-template-columns: 1fr; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .feature-list { grid-template-columns: 1fr; }
      .steps { grid-template-columns: 1fr; }
    }
    @media (max-width: 560px) {
      .wrap { width: min(100% - 24px, 1120px); }
      .top { align-items: flex-start; flex-direction: column; padding: 16px 0; }
      main { padding: 28px 0 40px; }
      h1 { font-size: 28px; }
      .grid { grid-template-columns: 1fr; }
      .card { min-height: 154px; }
      .section { padding: 16px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap top">
      <div class="brand"><span class="mark">AI</span><span>EasyAI Console</span></div>
      <div class="status">Gateway online</div>
    </div>
  </header>
  <main class="wrap">
    <section class="hero">
      <div class="intro">
        <p class="subtle">EasyAI Platform</p>
        <h1>统一的大模型网关、聊天入口和治理控制台</h1>
        <p class="lead">这个项目把上游模型服务、OpenAI-compatible API、聊天界面、管理后台、批处理、缓存和审计能力放在同一个入口里，方便业务接入、管理员治理和开发者调试。</p>
        <p class="lead" style="margin-top: 12px;">打开首页后，你可以先看清服务能力，再按角色进入聊天、管理或文档页面，不需要在多个服务之间来回找入口。</p>
      </div>
      <aside class="meta" aria-label="运行状态">
        <dl>
          <div><dt>服务端口</dt><dd>${cfg.port}</dd></div>
          <div><dt>认证模式</dt><dd>${escapeHtml(authModes)}</dd></div>
          <div><dt>缓存</dt><dd>${cfg.cacheEnabled ? "enabled" : "disabled"}</dd></div>
          <div><dt>上游</dt><dd>${upstreams || "未配置"}</dd></div>
        </dl>
      </aside>
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

    <section class="section" aria-labelledby="entry-title">
      <h2 id="entry-title">常用入口</h2>
      <p>下面这些地址覆盖了大部分日常操作和排障场景。</p>
      <table class="matrix">
        <thead>
          <tr>
            <th>入口</th>
            <th>路径</th>
            <th>用途</th>
          </tr>
        </thead>
        <tbody>
          ${serviceRows.map(([name, pathValue, desc]) => `<tr><td>${escapeHtml(name)}</td><td><code>${escapeHtml(pathValue)}</code></td><td>${escapeHtml(desc)}</td></tr>`).join("")}
        </tbody>
      </table>
    </section>

    <nav class="grid" aria-label="页面导航">
      ${cards.map((card) => `<a class="card" href="${card.href}">
        <span class="label">${card.label}</span>
        <h2>${card.title}</h2>
        <p>${card.desc}</p>
        <span class="go">打开 →</span>
      </a>`).join("")}
    </nav>
  </main>
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
  app.addHook("onRequest", async (req, reply) => {
    const p = (req.url.split("?")[0] ?? req.url) as string;
    const needsAuth = p === "/dashboard" || p.startsWith("/dashboard/") || p.startsWith("/admin/api/");
    if (!needsAuth) return;
    if (!ipAllowed((req as any).ip, cfg.adminAllowedCidrs)) {
      return reply.status(403).send({ error: { message: "forbidden", type: "auth_error" } });
    }
    const ok = basicAuthOk(req.headers.authorization, cfg.adminUser, cfg.adminPass);
    if (ok) return;
    reply.header("WWW-Authenticate", 'Basic realm="oneapi-dashboard"');
    if (p.startsWith("/admin/api/")) return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
    return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
  });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  app.get("/", async (_req, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(buildHomeHtml(cfg));
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

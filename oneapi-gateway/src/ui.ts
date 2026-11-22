import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.js";
import { buildGlobalNav, buildThemeInitScript } from "./ui-shell.js";

function buildHomeHtml(cfg: Config): string {
  const consoleHref = cfg.consoleUrl ?? "/ui";
  const baseUrl = cfg.consoleUrl ? "" : "http://localhost:3004";

  const capabilities = [
    "统一 OpenAI-compatible 入口，屏蔽不同厂商的协议差异",
    "模型别名来自一份 YAML，换厂商不用改客户端代码",
    "内置控制台：密钥、预算、用量、日志与请求重放",
    "支持流式输出、内置聊天页和离线 Batch 批处理",
    "自动重试与故障转移、Redis 响应缓存、内容护栏",
  ];

  const steps = [
    {
      title: "1. 启动服务",
      body: "一条 compose 命令拉起网关、模型接入层与本地 Ollama。",
      hint: "docker compose up -d --build",
    },
    {
      title: "2. 发起请求",
      body: "用 YAML 里的 API Key 调用统一入口，模型名使用 YAML 中的别名。",
      hint: `curl ${baseUrl}/v1/chat/completions -H "Authorization: Bearer dev-key" ...`,
    },
    {
      title: "3. 管理密钥",
      body: "打开控制台创建/吊销密钥、设置预算与限流，界面右上角可切换中文。",
      hint: consoleHref,
    },
  ];

  return `<!doctype html>
<html lang="zh-CN">
<head>
  ${buildThemeInitScript()}
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EasyAI · 统一 LLM 接入层</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: var(--ui-font-sans);
      color: var(--ui-text);
    }
    main {
      max-width: 1080px;
      margin: 0 auto;
      padding: 40px 20px 64px;
      display: grid;
      gap: 22px;
    }
    .hero {
      background: var(--ui-bg-elevated);
      border: 1px solid var(--ui-border);
      border-radius: 18px;
      padding: 28px;
      box-shadow: var(--ui-shadow-soft);
    }
    .hero h1 { margin: 0 0 10px; font-size: 30px; line-height: 1.2; }
    .hero p { margin: 0; color: var(--ui-text-muted); font-size: 15px; line-height: 1.7; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
    .actions a {
      display: inline-flex;
      align-items: center;
      min-height: 40px;
      padding: 0 16px;
      border-radius: 10px;
      border: 1px solid var(--ui-border);
      background: var(--ui-bg-strong);
      color: var(--ui-text);
      text-decoration: none;
      font-weight: 700;
      font-size: 14px;
    }
    .actions a.primary { background: var(--ui-primary); border-color: var(--ui-primary); color: #fff; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
    .card {
      background: var(--ui-bg-elevated);
      border: 1px solid var(--ui-border);
      border-radius: 14px;
      padding: 20px;
    }
    .card h2 { margin: 0 0 8px; font-size: 15px; }
    .card p { margin: 0; color: var(--ui-text-muted); font-size: 13px; line-height: 1.7; }
    .card code {
      display: block;
      margin-top: 12px;
      padding: 10px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--ui-primary) 8%, transparent);
      color: var(--ui-text);
      font-family: var(--ui-font-mono);
      font-size: 12px;
      word-break: break-all;
    }
    ul.plain { margin: 0; padding-left: 18px; color: var(--ui-text-muted); font-size: 14px; line-height: 1.9; }
    footer { color: var(--ui-text-muted); font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  ${buildGlobalNav({ active: "home", consoleHref })}
  <main>
    <section class="hero">
      <h1>EasyAI · 统一 LLM 接入层</h1>
      <p>个人和小团队免费自部署。一个入口、一份 YAML，统一接入不同厂商的模型服务，模型接入与治理交给 LiteLLM。</p>
      <div class="actions">
        <a class="primary" href="/chat">开始对话</a>
        <a href="${consoleHref}">管理控制台</a>
        <a href="/docs">API 文档</a>
      </div>
    </section>

    <div class="grid">
      ${steps
        .map(
          (s) => `<div class="card"><h2>${s.title}</h2><p>${s.body}</p><code>${s.hint}</code></div>`,
        )
        .join("\n")}
    </div>

    <section class="card">
      <h2>能做什么</h2>
      <ul class="plain">
        ${capabilities.map((c) => `<li>${c}</li>`).join("\n        ")}
      </ul>
    </section>

    <footer>EasyAI · 网关负责入口与轻量治理，LiteLLM 负责模型接入</footer>
  </main>
</body>
</html>`;
}

export async function registerUi(app: FastifyInstance, cfg: Config): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  app.get("/", async (_req, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(buildHomeHtml(cfg));
  });

  const redirectToConsole = async (_req: any, reply: any) => {
    if (!cfg.consoleUrl) {
      return reply
        .status(503)
        .type("text/plain; charset=utf-8")
        .send("控制台未配置：请在 YAML 的 app.console_url 填写 LiteLLM 控制台地址，例如 http://localhost:3005/ui");
    }
    return reply.redirect(cfg.consoleUrl, 302);
  };

  // The console is LiteLLM's own Admin UI (keys / budgets / spend / logs).
  app.get("/ui", redirectToConsole);
  app.get("/dashboard", redirectToConsole);

  const chatRoot = path.resolve(__dirname, "../chat-ui/dist");
  if (fs.existsSync(chatRoot)) {
    const assetsRoot = path.join(chatRoot, "assets");
    if (fs.existsSync(assetsRoot)) {
      await app.register(fastifyStatic, { root: assetsRoot, prefix: "/chat/assets/" });
    }

    const sendChat = async (_req: any, reply: any) => {
      const html = fs.readFileSync(path.join(chatRoot, "index.html"), "utf8");
      reply.type("text/html; charset=utf-8");
      return reply.send(
        injectNav(html, { active: "chat", consoleHref: cfg.consoleUrl ?? "/ui" }),
      );
    };

    app.get("/chat", sendChat);
    app.get("/chat/*", sendChat);
  } else {
    app.get("/chat", async (_req, reply) => reply.status(503).send("Chat UI not built"));
  }
}

function injectNav(html: string, options: { active: "chat"; consoleHref: string }): string {
  const withTheme = html.includes("window.EasyAITheme")
    ? html
    : html.replace(/<head([^>]*)>/i, `<head$1>${buildThemeInitScript()}`);
  if (withTheme.includes("data-easyai-global-nav")) return withTheme;
  return withTheme.replace(/<body([^>]*)>/i, (_m, attrs) => {
    const bodyAttrs = String(attrs ?? "");
    if (/\bclass\s*=\s*["'][^"']*["']/i.test(bodyAttrs)) {
      return `<body${bodyAttrs.replace(
        /\bclass\s*=\s*(["'])([^"']*)\1/i,
        (_cm, q, cls) => ` class=${q}${cls} easyai-page-${options.active}${q}`,
      )}>${buildGlobalNav(options)}`;
    }
    return `<body${bodyAttrs} class="easyai-page-${options.active}">${buildGlobalNav(options)}`;
  });
}

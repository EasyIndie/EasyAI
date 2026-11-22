import type { FastifyInstance } from "fastify";
import type { Config } from "./config.js";

function buildHomeHtml(cfg: Config): string {
  const consoleHref = cfg.consoleUrl ?? "/ui";
  const chatHref = cfg.chatUrl ?? "/chat";
  const gateway = "http://localhost:3004";
  const deepseekNote = "把 providers.deepseek.api_key 和 models 填好后，客户端只需要改 model 名。";

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>EasyAI · 统一 LLM 接入层</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f8fb; --fg:#0f172a; --muted:#5b6b82; --card:#fff; --line:#dbe3ee; --brand:#2563eb; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0a1220; --fg:#e6edf7; --muted:#93a4bd; --card:#101a2b; --line:#22304a; --brand:#7aa7ff; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:32px 20px 56px; background:var(--bg); color:var(--fg);
         font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif; }
  main { max-width: 880px; margin: 0 auto; display: grid; gap: 16px; }
  h1 { margin: 0 0 8px; font-size: 26px; }
  p { margin: 0; color: var(--muted); line-height: 1.7; font-size: 14px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
  .actions a { display:inline-flex; align-items:center; height: 38px; padding: 0 14px; border-radius: 8px;
               border: 1px solid var(--line); color: var(--fg); text-decoration: none; font-weight: 600; font-size: 14px; }
  .actions a.primary { background: var(--brand); border-color: var(--brand); color: #fff; }
  dialog { border: 1px solid var(--line); border-radius: 12px; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  pre { margin: 10px 0 0; padding: 12px; border-radius: 8px; background: color-mix(in srgb, var(--brand) 8%, transparent);
        overflow-x: auto; white-space: pre; }
  ol { margin: 0; padding-left: 20px; color: var(--muted); line-height: 1.9; font-size: 14px; }
  a { color: var(--brand); }
</style>
</head>
<body>
<main>
  <section class="card">
    <h1>EasyAI · 统一 LLM 接入层</h1>
    <p>一份 YAML 屏蔽不同厂商的协议差异。网关只做入口与限流，模型接入、缓存、护栏、密钥与用量交给 LiteLLM。</p>
    <div class="actions">
      <a class="primary" href="${chatHref}">开始对话</a>
      <a href="${consoleHref}">控制台</a>
      <a href="/docs">API 文档</a>
    </div>
  </section>

  <section class="card">
    <strong>三步上手</strong>
    <ol>
      <li>启动：<code>docker compose up -d --build</code></li>
      <li>拉模型：<code>docker compose exec -T ollama ollama pull qwen2.5:0.5b</code></li>
      <li>发请求（默认 key <code>dev-key</code>）：</li>
    </ol>
    <pre>curl ${gateway}/v1/chat/completions \\
  -H "Authorization: Bearer dev-key" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"chat","messages":[{"role":"user","content":"hello"}]}'</pre>
  </section>

  <section class="card">
    <strong>换成任意厂商</strong>
    <p>${deepseekNote}模型接入能力由 LiteLLM 提供（OpenAI、Anthropic、Gemini、DeepSeek、Bedrock、Ollama 等 100+）。</p>
  </section>
</main>
</body>
</html>`;
}

export async function registerUi(app: FastifyInstance, cfg: Config): Promise<void> {
  app.get("/", async (_req, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(buildHomeHtml(cfg));
  });

  const redirect = (target: string | undefined, hint: string) => async (_req: any, reply: any) => {
    if (!target) return reply.status(503).type("text/plain; charset=utf-8").send(hint);
    return reply.redirect(target, 302);
  };

  app.get(
    "/ui",
    redirect(cfg.consoleUrl, "控制台未配置：请在 YAML 的 app.console_url 填写 LiteLLM 控制台地址，例如 http://localhost:3005/ui"),
  );
  app.get("/dashboard", redirect(cfg.consoleUrl, "控制台未配置：请在 YAML 的 app.console_url 填写 LiteLLM 控制台地址"));
  app.get(
    "/chat",
    redirect(cfg.chatUrl, "聊天界面未配置：docker compose --profile chat up -d 启动 Open WebUI，并设置 app.chat_url"),
  );
}

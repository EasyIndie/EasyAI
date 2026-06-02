type NavItem = "home" | "chat" | "docs" | "dashboard";

type GlobalNavOptions = {
  active: NavItem;
  isAdmin?: boolean;
  loginState?: string;
};

function navLink(key: NavItem, active: NavItem, href: string, label: string): string {
  return `<a class="easyai-nav-link${key === active ? " is-active" : ""}" href="${href}">${label}</a>`;
}

function loginNotice(loginState?: string): string {
  if (loginState === "failed") return `<div class="easyai-notice error">账号或密码错误。</div>`;
  if (loginState === "required") return `<div class="easyai-notice">请先登录。</div>`;
  return "";
}

export function buildThemeInitScript(): string {
  return `<script>
(() => {
  const key = "easyai-ui-theme";
  const systemTheme = () => window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const readTheme = () => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === "light" || stored === "dark" || stored === "system") return stored;
    } catch {}
    return "system";
  };
  const applyTheme = () => {
    const mode = readTheme();
    const resolved = mode === "system" ? systemTheme() : mode;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.style.colorScheme = resolved;
    return resolved;
  };
  window.EasyAITheme = { key, applyTheme };
  applyTheme();
})();
</script>`;
}

export function buildGlobalNav(options: GlobalNavOptions): string {
  const { active, isAdmin = false, loginState } = options;
  const loginOpen = loginState === "failed" || loginState === "required" ? " open" : "";
  const adminControl = isAdmin
    ? `<a class="easyai-nav-link" href="/dashboard">Dashboard</a><form class="easyai-nav-form" action="/admin/session/logout" method="post"><button class="easyai-nav-link" type="submit">退出</button></form>`
    : `<details class="easyai-login-menu"${loginOpen}>
        <summary class="easyai-nav-link">管理员登录</summary>
        <div class="easyai-login-popover">
          <h2>管理员登录</h2>
          <p>登录后进入 Dashboard 管理 API Key、租户和用量。</p>
          ${loginNotice(loginState)}
          <form class="easyai-admin-form" id="admin-login-form">
            <label>账号<input name="username" autocomplete="username" required /></label>
            <label>密码<input name="password" type="password" autocomplete="current-password" required /></label>
            <button class="easyai-primary-button" type="submit">登录</button>
          </form>
        </div>
      </details>`;

  return `
<style>
  :root {
    --ui-font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --ui-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    --ui-radius-sm: 8px;
    --ui-radius-md: 10px;
    --ui-radius-lg: 14px;
    --ui-control-height: 40px;
    --ui-bg: #f4f7fb;
    --ui-bg-elevated: rgba(255, 255, 255, 0.86);
    --ui-bg-strong: #ffffff;
    --ui-text: #0f172a;
    --ui-text-muted: #64748b;
    --ui-border: rgba(148, 163, 184, 0.32);
    --ui-border-strong: rgba(148, 163, 184, 0.45);
    --ui-primary: #2563eb;
    --ui-primary-strong: #1d4ed8;
    --ui-danger: #dc2626;
    --ui-success: #15803d;
    --ui-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
    --ui-shadow-soft: 0 8px 24px rgba(15, 23, 42, 0.06);
  }
  html[data-theme="dark"] {
    --ui-bg: #08111f;
    --ui-bg-elevated: rgba(15, 23, 42, 0.86);
    --ui-bg-strong: #0f172a;
    --ui-text: #e2e8f0;
    --ui-text-muted: #94a3b8;
    --ui-border: rgba(148, 163, 184, 0.22);
    --ui-border-strong: rgba(148, 163, 184, 0.34);
    --ui-primary: #60a5fa;
    --ui-primary-strong: #93c5fd;
    --ui-danger: #f87171;
    --ui-success: #4ade80;
    --ui-shadow: 0 20px 48px rgba(0, 0, 0, 0.34);
    --ui-shadow-soft: 0 10px 28px rgba(0, 0, 0, 0.25);
  }
  body {
    color: var(--ui-text);
    background:
      radial-gradient(circle at top left, color-mix(in srgb, var(--ui-primary) 12%, transparent), transparent 28%),
      radial-gradient(circle at right top, rgba(14, 165, 233, 0.08), transparent 24%),
      var(--ui-bg);
  }
  .easyai-nav {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    min-height: 57px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--ui-border);
    background: var(--ui-bg-elevated);
    box-shadow: var(--ui-shadow-soft);
    backdrop-filter: blur(14px);
    position: fixed;
    left: 0;
    right: 0;
    top: 0;
    z-index: 1000;
    font-family: var(--ui-font-sans);
  }
  .easyai-nav *,
  .easyai-nav *::before,
  .easyai-nav *::after {
    box-sizing: border-box;
  }
  .easyai-nav-left,
  .easyai-nav-actions,
  .easyai-nav-tabs {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .easyai-nav-brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    text-decoration: none;
    color: var(--ui-text);
    font-size: 18px;
    font-weight: 700;
    white-space: nowrap;
  }
  .easyai-nav-logo {
    width: 36px;
    height: 36px;
    border-radius: var(--ui-radius-sm);
    background: var(--ui-primary);
    color: #fff;
    display: grid;
    place-items: center;
    font-size: 14px;
    font-weight: 800;
    line-height: 1;
  }
  .easyai-nav-link,
  .easyai-theme-toggle {
    min-height: var(--ui-control-height);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-md);
    padding: 0 12px;
    background: var(--ui-bg-elevated);
    color: var(--ui-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    text-decoration: none;
    white-space: nowrap;
    line-height: 1;
    transition:
      transform 120ms ease,
      border-color 120ms ease,
      box-shadow 120ms ease,
      background 120ms ease;
  }
  .easyai-nav-link:hover,
  .easyai-theme-toggle:hover {
    transform: translateY(-1px);
    border-color: var(--ui-border-strong);
  }
  .easyai-nav-link.is-active {
    color: #fff;
    border-color: transparent;
    background: var(--ui-primary);
  }
  .easyai-nav-form {
    margin: 0;
    display: inline-flex;
  }
  .easyai-theme-toggle {
    color: var(--ui-text);
  }
  .easyai-nav-spacer {
    height: var(--easyai-nav-height, 57px);
  }
  body.easyai-page-chat {
    overflow: hidden;
  }
  body.easyai-page-chat #root {
    height: calc(100dvh - var(--easyai-nav-height, 57px));
    min-height: calc(100dvh - var(--easyai-nav-height, 57px));
  }
  .easyai-login-menu {
    position: relative;
  }
  .easyai-login-menu summary {
    list-style: none;
  }
  .easyai-login-menu summary::-webkit-details-marker {
    display: none;
  }
  .easyai-login-popover {
    position: absolute;
    top: calc(100% + 10px);
    right: 0;
    z-index: 20;
    width: min(320px, calc(100vw - 32px));
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-lg);
    background: var(--ui-bg-strong);
    box-shadow: var(--ui-shadow);
    padding: 16px;
  }
  .easyai-login-popover h2 {
    margin: 0 0 6px;
    font-size: 18px;
    line-height: 1.3;
  }
  .easyai-login-popover p,
  .easyai-notice {
    color: var(--ui-text-muted);
    font-size: 13px;
    line-height: 1.5;
  }
  .easyai-admin-form {
    display: grid;
    gap: 10px;
    margin-top: 12px;
  }
  .easyai-admin-form label {
    display: grid;
    gap: 6px;
    color: var(--ui-text-muted);
    font-size: 13px;
    font-weight: 600;
  }
  .easyai-admin-form input {
    min-height: var(--ui-control-height);
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-md);
    padding: 0 12px;
    background: var(--ui-bg-elevated);
    color: var(--ui-text);
    font: inherit;
  }
  .easyai-primary-button {
    min-height: var(--ui-control-height);
    border: 0;
    border-radius: var(--ui-radius-md);
    background: var(--ui-primary);
    color: #fff;
    cursor: pointer;
    font: inherit;
    font-weight: 700;
  }
  .easyai-notice {
    margin: 10px 0 0;
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-md);
    background: var(--ui-bg-elevated);
    padding: 10px 12px;
  }
  .easyai-notice.error {
    color: var(--ui-danger);
  }
  @media (max-width: 760px) {
    .easyai-nav {
      align-items: flex-start;
      flex-direction: column;
      padding: 10px 12px;
    }
    .easyai-nav-actions {
      width: 100%;
      flex-wrap: wrap;
      align-items: stretch;
    }
    .easyai-nav-tabs {
      flex: 1 1 100%;
      flex-wrap: wrap;
    }
    .easyai-nav-link,
    .easyai-theme-toggle,
    .easyai-nav-form,
    .easyai-login-menu {
      flex: 1 1 auto;
    }
    .easyai-nav-form .easyai-nav-link,
    .easyai-login-menu .easyai-nav-link,
    .easyai-theme-toggle {
      width: 100%;
    }
    .easyai-login-popover {
      left: 0;
      right: auto;
    }
  }
</style>
<nav class="easyai-nav" data-easyai-global-nav="1">
  <div class="easyai-nav-left">
    <a class="easyai-nav-brand" href="/" aria-label="返回首页" title="返回首页">
      <span class="easyai-nav-logo">AI</span>
      <span>EasyAI Console</span>
    </a>
  </div>
  <div class="easyai-nav-actions">
    <div class="easyai-nav-tabs">
      ${navLink("home", active, "/", "首页")}
      ${navLink("chat", active, "/chat", "会话")}
      ${navLink("docs", active, "/docs", "API 文档")}
      ${active === "home" ? adminControl : navLink("dashboard", active, "/dashboard", "Dashboard")}
    </div>
    <button class="easyai-theme-toggle" type="button" data-easyai-theme-toggle>主题</button>
  </div>
</nav>
<div class="easyai-nav-spacer" aria-hidden="true"></div>
<script>
(() => {
  const nav = document.querySelector(".easyai-nav[data-easyai-global-nav='1']");
  const button = document.querySelector("[data-easyai-theme-toggle]");
  const apply = () => {
    const h = nav ? nav.getBoundingClientRect().height : 57;
    if (h > 0) document.documentElement.style.setProperty("--easyai-nav-height", h + "px");
    const theme = window.EasyAITheme && window.EasyAITheme.applyTheme ? window.EasyAITheme.applyTheme() : document.documentElement.dataset.theme || "light";
    if (button) {
      button.textContent = theme === "dark" ? "亮色模式" : "暗色模式";
      button.setAttribute("aria-label", theme === "dark" ? "切换到亮色模式" : "切换到暗色模式");
    }
  };
  apply();
  button && button.addEventListener("click", () => {
    const key = "easyai-ui-theme";
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    try { window.localStorage.setItem(key, current === "dark" ? "light" : "dark"); } catch {}
    apply();
  });
  window.addEventListener("resize", apply, { passive: true });
})();
</script>`;
}

export function injectGlobalNav(html: string, options: GlobalNavOptions): string {
  const withTheme = html.includes("window.EasyAITheme")
    ? html
    : html.replace(/<head([^>]*)>/i, `<head$1>${buildThemeInitScript()}`);
  if (withTheme.includes("data-easyai-global-nav")) return withTheme;
  return withTheme.replace(/<body([^>]*)>/i, (_m, attrs) => {
    const bodyAttrs = String(attrs ?? "");
    if (/\bclass\s*=\s*["'][^"']*["']/i.test(bodyAttrs)) {
      return `<body${bodyAttrs.replace(/\bclass\s*=\s*(["'])([^"']*)\1/i, (_cm, q, cls) => ` class=${q}${cls} easyai-page-${options.active}${q}`)}>${buildGlobalNav(options)}`;
    }
    return `<body${bodyAttrs} class="easyai-page-${options.active}">${buildGlobalNav(options)}`;
  });
}

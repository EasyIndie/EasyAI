import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

type Tab = "usage" | "keys" | "tenants";

type UsageRow = {
  principal: string;
  auth_mode: string;
  tenant_id: string | null;
  api_key_id: number | null;
  api_key_prefix: string | null;
  requests: number;
  errors: number;
  cached: number;
  p95_latency_ms: number | null;
  total_tokens: number | null;
};

type ApiKeyRow = {
  id: number;
  name: string | null;
  key_prefix: string;
  key_suffix: string | null;
  masked_key: string;
  environment: string;
  scopes: string[] | null;
  created_at: string;
  revoked_at: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  revocation_scheduled_at: string | null;
  auto_revoke_after_unused_days: number | null;
  ip_allow_cidrs: string[] | null;
  status: string;
  rpm_limit: number | null;
  tenant_id: string | null;
};

type TenantRow = {
  tenant_id: string;
  created_at: string;
  rpm_limit: number | null;
  tpm_limit: number | null;
  disabled: boolean;
};

type HealthStatus = {
  ok: boolean;
  service: string;
  appEnv?: string;
  upstreams: string[];
  authModes: string[];
  cacheEnabled: boolean;
};

function formatTime(s: string) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function extractAssistantText(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        try {
          return JSON.stringify(part);
        } catch {
          return String(part ?? "");
        }
      })
      .join("\n");
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload ?? "");
  }
}

function formatUsage(payload: any): string {
  const usage = payload?.usage;
  if (!usage || typeof usage !== "object") return "";
  const prompt = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : "-";
  const completion = typeof usage.completion_tokens === "number" ? usage.completion_tokens : "-";
  const total = typeof usage.total_tokens === "number" ? usage.total_tokens : "-";
  return `Prompt ${prompt} / Completion ${completion} / Total ${total}`;
}

function extractStreamChunkText(payload: any): string {
  const delta = payload?.choices?.[0]?.delta;
  if (typeof delta?.content === "string") return delta.content;
  if (Array.isArray(delta?.content)) {
    return delta.content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  const message = payload?.choices?.[0]?.message;
  if (typeof message?.content === "string") return message.content;
  return "";
}

function getDeploymentLabel(appEnv?: string | null): { text: string; tone: string } {
  if (appEnv === undefined) return { text: "环境检测中", tone: "#6b7280" };
  if (appEnv === null) return { text: "环境未知", tone: "#6b7280" };
  return appEnv === "production"
    ? { text: "线上环境", tone: "#137333" }
    : { text: "开发环境", tone: "#b45309" };
}

function DeploymentBadge(props: { appEnv?: string }) {
  const { text, tone } = getDeploymentLabel(props.appEnv);
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: 999,
        background: "#fff",
        border: `1px solid ${tone}33`,
        boxShadow: "0 6px 20px rgba(0,0,0,0.08)",
        color: tone,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: tone,
          flexShrink: 0,
        }}
      />
      <span>{text}</span>
    </div>
  );
}

async function fetchJson(url: string, init?: RequestInit) {
  const method = (init?.method ?? "GET").toUpperCase();
  const needsAdminAction = url.startsWith("/admin/api/") && method !== "GET";
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      accept: "application/json",
      ...(needsAdminAction ? { "x-oneapi-admin-action": "1" } : {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || String(res.status));
  return text ? JSON.parse(text) : null;
}

const SCOPE_OPTIONS = [
  { value: "model:invoke", label: "模型调用" },
  { value: "chat:read", label: "聊天读取" },
  { value: "chat:write", label: "聊天写入" },
  { value: "batch:read", label: "Batch 读取" },
  { value: "batch:write", label: "Batch 写入" },
  { value: "*", label: "全部权限" },
];

const DEFAULT_KEY_SCOPES = ["model:invoke", "chat:read", "chat:write", "batch:read", "batch:write"];

function scopeDisplayName(scope: string): string {
  return SCOPE_OPTIONS.find((opt) => opt.value === scope)?.label ?? scope;
}

const dateInputStyle = {
  width: "100%",
  minWidth: 0,
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  fontVariantNumeric: "tabular-nums",
  letterSpacing: 0,
} as const;

function datePart(value: string | null | undefined): string {
  if (!value) return "";
  const raw = String(value);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? "";
}

function timePart(value: string | null | undefined): string {
  if (!value) return "00:00";
  const raw = String(value);
  const match = raw.match(/[T\s](\d{2}:\d{2})/);
  return match?.[1] ?? "00:00";
}

function composeDateTimeForApi(date: string, time: string): string | null {
  if (!date) return null;
  return `${date}T${time || "00:00"}`;
}

type DateTimeInputProps = {
  value?: string | null;
  disabled?: boolean;
  style?: CSSProperties;
  onDraftChange?: (value: string) => void;
  onCommit: (value: string | null) => void;
};

function DateTimeInput(props: DateTimeInputProps) {
  const { value, disabled, style, onDraftChange, onCommit } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [popover, setPopover] = useState<{ top: number; left: number; width: number } | null>(null);
  const [date, setDate] = useState(datePart(value));
  const [time, setTime] = useState(timePart(value));
  const label = date ? `${date} ${time || "00:00"}` : "选择过期时间";

  useEffect(() => {
    setDate(datePart(value));
    setTime(timePart(value));
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function updatePopover() {
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const width = Math.min(280, window.innerWidth - 32);
      const left = Math.min(Math.max(16, rect.left), window.innerWidth - width - 16);
      const panelHeight = 188;
      const belowTop = rect.bottom + 6;
      const aboveTop = rect.top - panelHeight - 6;
      const top = belowTop + panelHeight <= window.innerHeight || aboveTop < 16
        ? Math.min(belowTop, window.innerHeight - panelHeight - 16)
        : aboveTop;
      setPopover({ top: Math.max(16, top), left, width });
    }
    updatePopover();
    function onPointerDown(event: MouseEvent | TouchEvent) {
      const root = rootRef.current;
      if (!root || root.contains(event.target as Node)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updatePopover);
    window.addEventListener("scroll", updatePopover, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePopover);
      window.removeEventListener("scroll", updatePopover, true);
    };
  }, [open]);

  function commit(nextDate: string, nextTime: string) {
    const normalized = composeDateTimeForApi(nextDate, nextTime);
    onDraftChange?.(normalized ?? "");
    onCommit(normalized);
  }

  return (
    <div ref={rootRef} style={{ position: "relative", minWidth: 0, ...style }}>
      <button
        type="button"
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
        disabled={disabled}
        style={{
          ...dateInputStyle,
          boxSizing: "border-box",
          minHeight: 34,
          padding: "7px 10px",
          border: "1px solid #d1d5db",
          borderRadius: 4,
          background: disabled ? "#f6f7f8" : "#fff",
          color: date ? "#111" : "#666",
          cursor: disabled ? "not-allowed" : "pointer",
          textAlign: "left",
        }}
      >
        {label}
      </button>
      {open && !disabled ? (
        <div
          style={{
            position: "fixed",
            top: popover?.top ?? 16,
            left: popover?.left ?? 16,
            zIndex: 1000,
            width: popover?.width ?? 280,
            padding: 10,
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            background: "#fff",
            boxShadow: "0 10px 30px rgba(0,0,0,0.10)",
          }}
        >
          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ display: "grid", gap: 5 }}>
              <span style={{ color: "#666", fontSize: 12 }}>日期</span>
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  const nextDate = e.currentTarget.value;
                  setDate(nextDate);
                  commit(nextDate, time);
                }}
                style={{ ...dateInputStyle, boxSizing: "border-box" }}
              />
            </label>
            <label style={{ display: "grid", gap: 5 }}>
              <span style={{ color: "#666", fontSize: 12 }}>时间</span>
              <input
                type="time"
                value={time}
                onChange={(e) => {
                  const nextTime = e.currentTarget.value || "00:00";
                  setTime(nextTime);
                  commit(date, nextTime);
                }}
                disabled={!date}
                style={{ ...dateInputStyle, boxSizing: "border-box" }}
              />
            </label>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 2 }}>
              <button
                type="button"
                onClick={() => {
                  setDate("");
                  setTime("00:00");
                  onDraftChange?.("");
                  onCommit(null);
                  setOpen(false);
                }}
              >
                清空
              </button>
              <button type="button" onClick={() => setOpen(false)}>
                完成
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type ScopeMultiSelectProps = {
  value: string[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
};

function ScopeMultiSelect(props: ScopeMultiSelectProps) {
  const { value, disabled, onChange } = props;
  const [open, setOpen] = useState(false);
  const [popover, setPopover] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = new Set(value);
  const label = value.length ? value.map(scopeDisplayName).join("、") : "全部权限";

  useEffect(() => {
    if (!open) return;
    function updatePopover() {
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 32);
      const left = Math.min(Math.max(16, rect.left), window.innerWidth - width - 16);
      const preferredHeight = 270;
      const belowTop = rect.bottom + 6;
      const belowSpace = window.innerHeight - belowTop - 16;
      const aboveSpace = rect.top - 22;
      const openUp = belowSpace < preferredHeight && aboveSpace > belowSpace;
      const maxHeight = Math.max(160, Math.min(preferredHeight, openUp ? aboveSpace : belowSpace));
      const top = openUp ? Math.max(16, rect.top - maxHeight - 6) : belowTop;
      setPopover({ top, left, width, maxHeight });
    }
    updatePopover();
    function onPointerDown(event: MouseEvent | TouchEvent) {
      const root = rootRef.current;
      if (!root || root.contains(event.target as Node)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updatePopover);
    window.addEventListener("scroll", updatePopover, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePopover);
      window.removeEventListener("scroll", updatePopover, true);
    };
  }, [open]);

  function toggle(scope: string) {
    const next = new Set(selected);
    if (scope === "*") {
      onChange(selected.has("*") ? [] : ["*"]);
      return;
    }
    next.delete("*");
    if (next.has(scope)) next.delete(scope);
    else next.add(scope);
    onChange(Array.from(next));
  }

  return (
    <div ref={rootRef} style={{ position: "relative", width: "100%", minWidth: 0 }}>
      <button
        type="button"
        style={{
          boxSizing: "border-box",
          width: "100%",
          minHeight: 34,
          padding: "7px 10px",
          border: "1px solid #d1d5db",
          borderRadius: 4,
          background: disabled ? "#f6f7f8" : "#fff",
          color: disabled ? "#777" : "#111",
          cursor: disabled ? "not-allowed" : "pointer",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textAlign: "left",
        }}
        onClick={(e) => {
          e.preventDefault();
          if (!disabled) setOpen((v) => !v);
        }}
        disabled={disabled}
        title={label}
      >
        {label}
      </button>
      {open && !disabled ? (
        <div
          style={{
            position: "fixed",
            top: popover?.top ?? 16,
            left: popover?.left ?? 16,
            width: popover?.width ?? 280,
            maxHeight: popover?.maxHeight ?? 270,
            overflow: "auto",
            zIndex: 1000,
            padding: 8,
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            background: "#fff",
            boxShadow: "0 10px 30px rgba(0,0,0,0.10)",
          }}
        >
          {SCOPE_OPTIONS.map((opt) => (
            <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 4px", cursor: "pointer" }}>
              <input type="checkbox" checked={selected.has(opt.value)} onChange={() => toggle(opt.value)} />
              <span>{opt.label}</span>
              <code style={{ color: "#666" }}>{opt.value}</code>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type TenantPickerProps = {
  value: string | null;
  disabled: boolean;
  tenants: string[];
  boundCountByTenant: Map<string, number>;
  onCommit: (tenantId: string | null) => void;
};

function TenantPicker(props: TenantPickerProps) {
  const { value, disabled, tenants, boundCountByTenant, onCommit } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [popover, setPopover] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState<number>(-1);

  const items = useMemo(() => {
    const query = q.trim().toLowerCase();
    const filtered = query ? tenants.filter((t) => t.toLowerCase().includes(query)) : tenants;
    return filtered.slice(0, 30);
  }, [q, tenants]);

  const display = value ?? "";
  const bound = value ? boundCountByTenant.get(value) ?? 0 : 0;

  useEffect(() => {
    if (!open) return;
    function updatePopover() {
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 260), window.innerWidth - 32);
      const left = Math.min(Math.max(16, rect.left), window.innerWidth - width - 16);
      const preferredHeight = 280;
      const belowTop = rect.bottom + 6;
      const belowSpace = window.innerHeight - belowTop - 16;
      const aboveSpace = rect.top - 22;
      const openUp = belowSpace < preferredHeight && aboveSpace > belowSpace;
      const maxHeight = Math.max(140, Math.min(preferredHeight, openUp ? aboveSpace : belowSpace));
      const top = openUp ? Math.max(16, rect.top - maxHeight - 6) : belowTop;
      setPopover({ top, left, width, maxHeight });
    }
    updatePopover();
    window.addEventListener("resize", updatePopover);
    window.addEventListener("scroll", updatePopover, true);
    return () => {
      window.removeEventListener("resize", updatePopover);
      window.removeEventListener("scroll", updatePopover, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative", width: "100%", minWidth: 0 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="text"
          placeholder="未绑定"
          value={open ? q : display}
          onFocus={() => {
            if (disabled) return;
            setQ(display);
            setOpen(true);
            setActive(-1);
          }}
          onChange={(e) => {
            setQ(e.currentTarget.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={(e) => {
            if (disabled) return;
            if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              setOpen(true);
              setQ(display);
              setActive(-1);
              e.preventDefault();
              return;
            }
            if (!open) return;
            if (e.key === "Escape") {
              setOpen(false);
              setQ("");
              setActive(-1);
              e.preventDefault();
              return;
            }
            if (e.key === "ArrowDown") {
              const max = items.length - 1;
              setActive((a) => Math.min(max, a + 1));
              e.preventDefault();
              return;
            }
            if (e.key === "ArrowUp") {
              setActive((a) => Math.max(-1, a - 1));
              e.preventDefault();
              return;
            }
            if (e.key === "Enter") {
              if (active === -1) onCommit(null);
              else if (active >= 0 && active < items.length) onCommit(items[active] ?? null);
              setOpen(false);
              setQ("");
              setActive(-1);
              e.preventDefault();
              return;
            }
          }}
          onBlur={() => {
            setOpen(false);
            setQ("");
            setActive(-1);
          }}
          disabled={disabled}
          style={{ width: "100%" }}
        />
        {value ? <span style={{ color: "#666", fontSize: 12, whiteSpace: "nowrap" }}>{bound} 个密钥</span> : null}
      </div>

      {open && !disabled ? (
        <div
          style={{
            position: "fixed",
            top: popover?.top ?? 16,
            left: popover?.left ?? 16,
            width: popover?.width ?? 260,
            background: "#fff",
            border: "1px solid #eee",
            borderRadius: 8,
            boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
            zIndex: 1000,
            maxHeight: popover?.maxHeight ?? 280,
            overflow: "auto",
          }}
        >
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              onCommit(null);
              setOpen(false);
              setQ("");
              setActive(-1);
            }}
            style={{
              padding: "10px 12px",
              cursor: "pointer",
              borderBottom: "1px solid #f2f2f2",
              background: active === -1 ? "#f6f7f8" : "#fff",
            }}
          >
            未绑定
          </div>
          {items.map((t) => (
            <div
              key={t}
              onMouseDown={(e) => {
                e.preventDefault();
                onCommit(t);
                setOpen(false);
                setQ("");
                setActive(-1);
              }}
              style={{
                padding: "10px 12px",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                background: items[active] === t ? "#f6f7f8" : "#fff",
              }}
            >
              <span>{t}</span>
              <span style={{ color: "#666" }}>{boundCountByTenant.get(t) ?? 0} 个密钥</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function App() {
  const playgroundAbortRef = useRef<AbortController | null>(null);
  const [tab, setTab] = useState<Tab>("usage");
  const [sinceMinutes, setSinceMinutes] = useState(60);
  const [usageRows, setUsageRows] = useState<UsageRow[]>([]);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [newTenantId, setNewTenantId] = useState<string>("");
  const [tenantSearch, setTenantSearch] = useState<string>("");
  const [tenantPage, setTenantPage] = useState<number>(1);
  const [keySearch, setKeySearch] = useState<string>("");
  const [keyPage, setKeyPage] = useState<number>(1);
  const [newKeyName, setNewKeyName] = useState<string>("");
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(DEFAULT_KEY_SCOPES);
  const [newKeyExpiresAt, setNewKeyExpiresAt] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [playgroundModels, setPlaygroundModels] = useState<string[]>([]);
  const [playgroundModel, setPlaygroundModel] = useState<string>("");
  const [playgroundSystemPrompt, setPlaygroundSystemPrompt] = useState<string>("你是一个有帮助的 AI 助手。");
  const [playgroundUserPrompt, setPlaygroundUserPrompt] = useState<string>("");
  const [playgroundTemperature, setPlaygroundTemperature] = useState<string>("0");
  const [playgroundMaxTokens, setPlaygroundMaxTokens] = useState<string>("512");
  const [playgroundStream, setPlaygroundStream] = useState<boolean>(false);
  const [playgroundLoading, setPlaygroundLoading] = useState<boolean>(false);
  const [playgroundResult, setPlaygroundResult] = useState<string>("");
  const [playgroundRaw, setPlaygroundRaw] = useState<string>("");
  const [playgroundUsage, setPlaygroundUsage] = useState<string>("");
  const [playgroundLatencyMs, setPlaygroundLatencyMs] = useState<number | null>(null);
  const [health, setHealth] = useState<HealthStatus | null | undefined>(undefined);

  function stopPlayground() {
    const controller = playgroundAbortRef.current;
    if (!controller) return;
    controller.abort();
    playgroundAbortRef.current = null;
    setPlaygroundLoading(false);
    setStatus("已停止");
  }

  const title = useMemo(() => {
    if (tab === "usage") return "用量统计";
    if (tab === "keys") return "API 密钥";
    return "租户管理";
  }, [tab]);

  async function loadUsage() {
    setStatus("加载中...");
    try {
      const data = await fetchJson(`/admin/api/usage?sinceMinutes=${encodeURIComponent(String(sinceMinutes))}`);
      setUsageRows((data?.rows ?? []) as UsageRow[]);
      setStatus("成功");
    } catch (e: any) {
      setStatus(e?.message ?? "失败");
    }
  }

  async function loadHealth() {
    try {
      const res = await fetch("/healthz", { headers: { accept: "application/json" } });
      const data = await res.json();
      if (!res.ok) throw new Error(String(res.status));
      setHealth(data as HealthStatus);
    } catch {
      setHealth(null);
    }
  }

  async function loadKeys() {
    setStatus("加载中...");
    try {
      const data = await fetchJson("/admin/api/keys");
      setKeys((data?.keys ?? []) as ApiKeyRow[]);
      setStatus("成功");
    } catch (e: any) {
      setStatus(e?.message ?? "失败");
    }
  }

  async function loadTenants() {
    setStatus("加载中...");
    try {
      const data = await fetchJson("/admin/api/tenants");
      setTenants((data?.tenants ?? []) as TenantRow[]);
      setStatus("成功");
    } catch (e: any) {
      setStatus(e?.message ?? "失败");
    }
  }

  async function loadPlaygroundModels() {
    setStatus("加载中...");
    try {
      const data = await fetchJson("/admin/api/playground/models");
      const models = Array.isArray(data?.data)
        ? (data.data as any[])
            .map((item) => String(item?.id ?? "").trim())
            .filter(Boolean)
        : [];
      setPlaygroundModels(models);
      setPlaygroundModel((current) => current || models[0] || "");
      setStatus("成功");
    } catch (e: any) {
      setStatus(e?.message ?? "失败");
    }
  }

  async function runPlayground() {
    const model = playgroundModel.trim();
    const userPrompt = playgroundUserPrompt.trim();
    if (!model) {
      setStatus("请先选择模型");
      return;
    }
    if (!userPrompt) {
      setStatus("请输入用户消息");
      return;
    }

    const messages: Array<{ role: string; content: string }> = [];
    if (playgroundSystemPrompt.trim()) {
      messages.push({ role: "system", content: playgroundSystemPrompt.trim() });
    }
    messages.push({ role: "user", content: userPrompt });

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: playgroundStream,
    };
    if (playgroundTemperature.trim()) body.temperature = Number(playgroundTemperature);
    if (playgroundMaxTokens.trim()) body.max_tokens = Number(playgroundMaxTokens);

    setPlaygroundLoading(true);
    setPlaygroundResult("");
    setPlaygroundRaw("");
    setPlaygroundUsage("");
    setPlaygroundLatencyMs(null);
    setStatus("请求中...");

    const startedAt = performance.now();
    const controller = new AbortController();
    playgroundAbortRef.current = controller;
    try {
      if (playgroundStream) {
        const res = await fetch("/admin/api/playground/chat", {
          method: "POST",
          headers: {
            accept: "text/event-stream",
            "content-type": "application/json",
            "x-oneapi-admin-action": "1",
          },
          signal: controller.signal,
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || String(res.status));
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("stream not supported by browser");
        const decoder = new TextDecoder();
        let buffer = "";
        let raw = "";
        let output = "";
        let usageText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          raw += chunk;
          buffer += chunk;
          setPlaygroundRaw(raw);

          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const event of events) {
            const lines = event
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.startsWith("data: "));
            for (const line of lines) {
              const dataText = line.slice(6);
              if (dataText === "[DONE]") continue;
              let parsed: any;
              try {
                parsed = JSON.parse(dataText);
              } catch {
                continue;
              }
              if (parsed?.error?.message) {
                throw new Error(String(parsed.error.message));
              }
              const text = extractStreamChunkText(parsed);
              if (text) {
                output += text;
                setPlaygroundResult(output);
              }
              const nextUsage = formatUsage(parsed);
              if (nextUsage) {
                usageText = nextUsage;
                setPlaygroundUsage(nextUsage);
              }
            }
          }
        }

        const latency = Math.round(performance.now() - startedAt);
        setPlaygroundLatencyMs(latency);
        setPlaygroundUsage((current) => current || usageText);
        setStatus("成功");
      } else {
        const data = await fetchJson("/admin/api/playground/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(body),
        });
        const latency = Math.round(performance.now() - startedAt);
        setPlaygroundLatencyMs(latency);
        setPlaygroundResult(extractAssistantText(data));
        setPlaygroundRaw(JSON.stringify(data, null, 2));
        setPlaygroundUsage(formatUsage(data));
        setStatus("成功");
      }
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setStatus("已停止");
      } else {
        setStatus(e?.message ?? "失败");
      }
    } finally {
      if (playgroundAbortRef.current === controller) {
        playgroundAbortRef.current = null;
      }
      setPlaygroundLoading(false);
    }
  }

  async function createKey() {
    setStatus("创建中...");
    try {
      const data = await fetchJson("/admin/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: newKeyName.trim() || null,
          scopes: newKeyScopes,
          expires_at: newKeyExpiresAt || null,
        }),
      });
      setCreatedKey(String(data?.api_key ?? ""));
      setNewKeyName("");
      await loadKeys();
      setStatus("成功");
    } catch (e: any) {
      setStatus(e?.message ?? "失败");
    }
  }

  async function revokeKey(id: number) {
    setStatus("撤销中...");
    try {
      await fetchJson(`/admin/api/keys/${id}/revoke`, { method: "POST" });
      await loadKeys();
      setStatus("成功");
    } catch (e: any) {
      setStatus(e?.message ?? "失败");
    }
  }

  async function scheduleRevokeKey(id: number) {
    const raw = prompt("延迟撤销小时数，例如 24 或 168");
    if (!raw) return;
    const hours = Number(raw);
    if (!Number.isFinite(hours) || hours <= 0) {
      setStatus("请输入有效小时数");
      return;
    }
    setStatus("设置中...");
    try {
      await fetchJson(`/admin/api/keys/${id}/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "scheduled", delay_hours: hours }),
      });
      await loadKeys();
      setStatus("成功");
    } catch (e: any) {
      setStatus(e?.message ?? "失败");
    }
  }

  async function autoRevokeKey(id: number) {
    const raw = prompt("连续多少天无调用后自动撤销，例如 7");
    if (!raw) return;
    const days = Number(raw);
    if (!Number.isFinite(days) || days <= 0) {
      setStatus("请输入有效天数");
      return;
    }
    setStatus("设置中...");
    try {
      await fetchJson(`/admin/api/keys/${id}/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "unused", unused_days: days }),
      });
      await loadKeys();
      setStatus("成功");
    } catch (e: any) {
      setStatus(e?.message ?? "失败");
    }
  }

  async function deleteKey(id: number, force: boolean) {
    setStatus("删除中...");
    try {
      await fetchJson(`/admin/api/keys/${id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      await loadKeys();
      setStatus("成功");
    } catch (e: any) {
      setStatus(e?.message ?? "失败");
    }
  }

  async function updateRpm(id: number, rpm: number | null) {
    setStatus("保存中...");
    try {
      await fetchJson(`/admin/api/keys/${id}/rpm`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rpm_limit: rpm }),
      });
      await loadKeys();
      setStatus("成功");
    } catch (e: any) {
      setStatus(e?.message ?? "失败");
    }
  }

  async function updateKeyTenant(id: number, tenantId: string | null) {
    setStatus("保存中...");
    try {
      await fetchJson(`/admin/api/keys/${id}/tenant`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      await loadKeys();
      setStatus("成功");
    } catch (e: any) {
      setStatus(e?.message ?? "失败");
    }
  }

  async function updateKeyMetadata(k: ApiKeyRow, patch: Partial<ApiKeyRow>) {
    setStatus("保存中...");
    try {
      const next = { ...k, ...patch };
      await fetchJson(`/admin/api/keys/${k.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: next.name,
          scopes: next.scopes ?? null,
          expires_at: next.expires_at,
        }),
      });
      await loadKeys();
      setStatus("成功");
    } catch (e: any) {
      setStatus(e?.message ?? "失败");
    }
  }

  async function upsertTenant(tenantId: string, rpm: number | null, tpm: number | null, disabled: boolean) {
    setStatus("保存中...");
    try {
      await fetchJson(`/admin/api/tenants/${encodeURIComponent(tenantId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rpm_limit: rpm, tpm_limit: tpm, disabled }),
      });
      await loadTenants();
      setStatus("成功");
    } catch (e: any) {
      setStatus(e?.message ?? "失败");
    }
  }

  async function deleteTenant(tenantId: string, force: boolean) {
    setStatus("删除中...");
    try {
      await fetchJson(`/admin/api/tenants/${encodeURIComponent(tenantId)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      await loadTenants();
      await loadKeys();
      setStatus("成功");
    } catch (e: any) {
      setStatus(e?.message ?? "失败");
    }
  }

  async function unbindTenantKeys(tenantId: string) {
    setStatus("解绑中...");
    try {
      await fetchJson(`/admin/api/tenants/${encodeURIComponent(tenantId)}/unbind_keys`, { method: "POST" });
      await loadTenants();
      await loadKeys();
      setStatus("成功");
    } catch (e: any) {
      setStatus(e?.message ?? "失败");
    }
  }

  useEffect(() => {
    if (tab === "usage") loadUsage();
    if (tab === "keys") {
      loadKeys();
      loadTenants();
    }
    if (tab === "tenants") {
      loadTenants();
      loadKeys();
    }
  }, [tab]);

  useEffect(() => {
    loadHealth();
    return () => {
      playgroundAbortRef.current?.abort();
      playgroundAbortRef.current = null;
    };
  }, []);

  const boundKeyCountByTenant = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of keys) {
      const tid = k.tenant_id;
      if (!tid) continue;
      m.set(tid, (m.get(tid) ?? 0) + 1);
    }
    return m;
  }, [keys]);

  const tenantOptions = useMemo(() => tenants.map((t) => t.tenant_id).sort((a, b) => a.localeCompare(b)), [tenants]);

  const filteredTenants = useMemo(() => {
    const q = tenantSearch.trim().toLowerCase();
    const base = q ? tenants.filter((t) => t.tenant_id.toLowerCase().includes(q)) : tenants;
    return base;
  }, [tenants, tenantSearch]);

  const tenantPageSize = 20;
  const tenantTotalPages = Math.max(1, Math.ceil(filteredTenants.length / tenantPageSize));
  const tenantPageClamped = Math.min(Math.max(1, tenantPage), tenantTotalPages);
  const tenantPageRows = useMemo(() => {
    const start = (tenantPageClamped - 1) * tenantPageSize;
    return filteredTenants.slice(start, start + tenantPageSize);
  }, [filteredTenants, tenantPageClamped]);

  const filteredKeys = useMemo(() => {
    const q = keySearch.trim().toLowerCase();
    if (!q) return keys;
    return keys.filter((k) => {
      const id = String(k.id);
      const prefix = k.key_prefix.toLowerCase();
      const suffix = (k.key_suffix ?? "").toLowerCase();
      const name = (k.name ?? "").toLowerCase();
      const tenant = (k.tenant_id ?? "").toLowerCase();
      const status = k.status.toLowerCase();
      return id.includes(q) || prefix.includes(q) || suffix.includes(q) || name.includes(q) || tenant.includes(q) || status.includes(q);
    });
  }, [keys, keySearch]);

  const keyPageSize = 20;
  const keyTotalPages = Math.max(1, Math.ceil(filteredKeys.length / keyPageSize));
  const keyPageClamped = Math.min(Math.max(1, keyPage), keyTotalPages);
  const keyPageRows = useMemo(() => {
    const start = (keyPageClamped - 1) * keyPageSize;
    return filteredKeys.slice(start, start + keyPageSize);
  }, [filteredKeys, keyPageClamped]);

  return (
    <div style={{
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      margin: "clamp(12px, 3vw, 24px)",
      maxWidth: "100%",
      overflowX: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>OneAPI 管理台</h1>
        <DeploymentBadge appEnv={health?.appEnv} />
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 12,
        margin: "12px 0 18px",
      }}>
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 14, background: "#fff" }}>
          <div style={{ color: "#666", fontSize: 12, marginBottom: 6 }}>网关状态</div>
          <strong style={{ color: health?.ok ? "#137333" : "#999" }}>{health?.ok ? "Gateway online" : "Unknown"}</strong>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 14, background: "#fff" }}>
          <div style={{ color: "#666", fontSize: 12, marginBottom: 6 }}>认证模式</div>
          <strong>{health?.authModes?.join(", ") || "-"}</strong>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 14, background: "#fff" }}>
          <div style={{ color: "#666", fontSize: 12, marginBottom: 6 }}>缓存</div>
          <strong>{health ? (health.cacheEnabled ? "enabled" : "disabled") : "-"}</strong>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 14, background: "#fff" }}>
          <div style={{ color: "#666", fontSize: 12, marginBottom: 6 }}>上游</div>
          <strong style={{ wordBreak: "break-word" }}>{health?.upstreams?.join(", ") || "-"}</strong>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={() => setTab("usage")} disabled={tab === "usage"}>
          用量统计
        </button>
        <button onClick={() => setTab("keys")} disabled={tab === "keys"}>
          API 密钥
        </button>
        <button onClick={() => setTab("tenants")} disabled={tab === "tenants"}>
          租户管理
        </button>
        <span style={{ marginLeft: 8, color: "#666" }}>{status}</span>
      </div>

      <h2>{title}</h2>

      {tab === "usage" ? (
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
            <label>
              时间窗口（分钟）：{" "}
              <input
                type="number"
                min={1}
                max={1440}
                value={sinceMinutes}
                onChange={(e) => setSinceMinutes(Number(e.target.value))}
              />
            </label>
            <button onClick={loadUsage}>刷新</button>
          </div>

          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                {["主体", "鉴权方式", "租户", "API 密钥", "请求数", "错误数", "缓存命中", "P95 延迟（毫秒）", "总 Tokens"].map((h) => (
                  <th key={h} style={{ borderBottom: "1px solid #eee", padding: 10, textAlign: "left" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usageRows.map((r) => (
                <tr key={`${r.principal}:${r.auth_mode}:${r.tenant_id ?? ""}:${r.api_key_id ?? ""}`}>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
                    <code>{r.principal}</code>
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
                    <code>{r.auth_mode}</code>
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
                    {r.tenant_id ? <code>{r.tenant_id}</code> : <span style={{ color: "#999" }}>-</span>}
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
                    {r.api_key_id ? (
                      <code>
                        #{r.api_key_id}
                        {r.api_key_prefix ? ` (${r.api_key_prefix})` : ""}
                      </code>
                    ) : (
                      <span style={{ color: "#999" }}>-</span>
                    )}
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>{r.requests}</td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>{r.errors}</td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>{r.cached}</td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
                    {r.p95_latency_ms ? Math.round(r.p95_latency_ms) : ""}
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>{r.total_tokens ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "keys" ? (
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <input
              type="text"
              placeholder="名称，例如 prod-service"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.currentTarget.value)}
              style={{ flex: "1 1 180px", minWidth: 0 }}
            />
            <div style={{ flex: "2 1 280px", minWidth: 0 }}>
              <ScopeMultiSelect
              value={newKeyScopes}
                onChange={setNewKeyScopes}
              />
            </div>
            <DateTimeInput
              value={newKeyExpiresAt}
              onDraftChange={setNewKeyExpiresAt}
              onCommit={(value) => setNewKeyExpiresAt(value ?? "")}
              style={{ ...dateInputStyle, flex: "1 1 190px" }}
            />
            <button onClick={createKey}>创建密钥</button>
            <input
              type="text"
              placeholder="搜索密钥"
              value={keySearch}
              onChange={(e) => {
                setKeySearch(e.currentTarget.value);
                setKeyPage(1);
              }}
              style={{ flex: "1 1 180px", minWidth: 0 }}
            />
            <button onClick={loadKeys}>刷新</button>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <button onClick={() => setKeyPage(Math.max(1, keyPageClamped - 1))} disabled={keyPageClamped <= 1}>
              上一页
            </button>
            <span style={{ color: "#666" }}>
              第 {keyPageClamped} / {keyTotalPages} 页（共 {filteredKeys.length} 个密钥）
            </span>
            <button onClick={() => setKeyPage(Math.min(keyTotalPages, keyPageClamped + 1))} disabled={keyPageClamped >= keyTotalPages}>
              下一页
            </button>
          </div>

          {createdKey ? (
            <div style={{ marginBottom: 12, padding: 12, background: "#f6f7f8", borderRadius: 8 }}>
              <div style={{ marginBottom: 6 }}>新建 API 密钥（仅展示一次）：</div>
              <code style={{ display: "block", overflowWrap: "anywhere", wordBreak: "break-word" }}>{createdKey}</code>
              <div style={{ marginTop: 10 }}>
                <button onClick={() => setCreatedKey(null)}>关闭</button>
              </div>
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 12 }}>
            {keyPageRows.map((k) => (
              <div key={k.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 14, background: "#fff", minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <input
                      type="text"
                      placeholder="未命名"
                      defaultValue={k.name ?? ""}
                      onBlur={(e) => updateKeyMetadata(k, { name: e.currentTarget.value.trim() || null })}
                      disabled={Boolean(k.revoked_at)}
                      style={{ display: "block", marginBottom: 6, width: "min(100%, 260px)" }}
                    />
                    <code style={{ display: "block", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                      {k.masked_key || `${k.key_prefix}...${k.key_suffix ?? ""}`}
                    </code>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ color: "#666", fontSize: 12 }}>#{k.id}</div>
                    <code>{k.status}</code>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, alignItems: "start" }}>
                  <label style={{ display: "grid", gap: 6, minWidth: 0 }}>
                    <span style={{ color: "#666", fontSize: 12 }}>RPM 限制</span>
                    <input
                      type="number"
                      min={1}
                      placeholder="继承默认"
                      defaultValue={k.rpm_limit ?? undefined}
                      onBlur={(e) => {
                        const v = e.currentTarget.value.trim();
                        updateRpm(k.id, v ? Number(v) : null);
                      }}
                      disabled={Boolean(k.revoked_at)}
                    />
                  </label>

                  <label style={{ display: "grid", gap: 6, minWidth: 0 }}>
                    <span style={{ color: "#666", fontSize: 12 }}>过期时间</span>
                    <DateTimeInput
                      value={k.expires_at ? k.expires_at.slice(0, 16) : ""}
                      onCommit={(value) => updateKeyMetadata(k, { expires_at: value })}
                      disabled={Boolean(k.revoked_at)}
                      style={dateInputStyle}
                    />
                  </label>

                  <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                    <span style={{ color: "#666", fontSize: 12 }}>租户</span>
                    <TenantPicker
                      value={k.tenant_id}
                      disabled={Boolean(k.revoked_at)}
                      tenants={tenantOptions}
                      boundCountByTenant={boundKeyCountByTenant}
                      onCommit={(tenantId) => updateKeyTenant(k.id, tenantId)}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 12 }}>
                  <label style={{ display: "grid", gap: 6, minWidth: 0 }}>
                    <span style={{ color: "#666", fontSize: 12 }}>Scopes</span>
                    <ScopeMultiSelect
                      value={k.scopes ?? []}
                      disabled={Boolean(k.revoked_at)}
                      onChange={(scopes) => updateKeyMetadata(k, { scopes })}
                    />
                  </label>

                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 12, color: "#444", fontSize: 13 }}>
                  <div>
                    <div style={{ color: "#666", fontSize: 12 }}>创建时间</div>
                    <div>{formatTime(k.created_at)}</div>
                  </div>
                  <div>
                    <div style={{ color: "#666", fontSize: 12 }}>最后使用</div>
                    <div style={{ overflowWrap: "anywhere" }}>{k.last_used_at ? `${formatTime(k.last_used_at)} ${k.last_used_ip ?? ""}` : "尚无调用"}</div>
                  </div>
                  <div>
                    <div style={{ color: "#666", fontSize: 12 }}>撤销策略</div>
                    <div>
                      {k.revoked_at
                        ? `已撤销 ${formatTime(k.revoked_at)}`
                        : k.revocation_scheduled_at
                          ? `计划撤销 ${formatTime(k.revocation_scheduled_at)}`
                          : k.auto_revoke_after_unused_days
                            ? `${k.auto_revoke_after_unused_days} 天无调用自动撤销`
                            : "-"}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                  <button onClick={() => revokeKey(k.id)} disabled={Boolean(k.revoked_at)}>
                    立即撤销
                  </button>
                  <button onClick={() => scheduleRevokeKey(k.id)} disabled={Boolean(k.revoked_at)}>
                    延迟撤销
                  </button>
                  <button onClick={() => autoRevokeKey(k.id)} disabled={Boolean(k.revoked_at)}>
                    闲置撤销
                  </button>
                  <button
                    onClick={() => {
                      if (k.revoked_at) return;
                      if (!k.tenant_id) return;
                      if (!confirm("确认解绑该密钥当前绑定的租户吗？")) return;
                      updateKeyTenant(k.id, null);
                    }}
                    disabled={Boolean(k.revoked_at) || !k.tenant_id}
                  >
                    解绑
                  </button>
                  <button
                    onClick={() => {
                      if (!confirm("确认删除该 API 密钥吗？")) return;
                      const force = !k.revoked_at;
                      if (force) {
                        if (!confirm("该密钥尚未撤销，是否仍要强制删除？")) return;
                      }
                      deleteKey(k.id, force);
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === "tenants" ? (
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
            <input
              type="text"
              placeholder="租户 ID"
              value={newTenantId}
              onChange={(e) => setNewTenantId(e.target.value)}
            />
            <button
              onClick={() => {
                const t = newTenantId.trim();
                if (!t) return;
                upsertTenant(t, null, null, false);
                setNewTenantId("");
              }}
            >
              创建或更新
            </button>
            <input
              type="text"
              placeholder="搜索租户"
              value={tenantSearch}
              onChange={(e) => {
                setTenantSearch(e.currentTarget.value);
                setTenantPage(1);
              }}
              style={{ marginLeft: 10 }}
            />
            <button onClick={loadTenants}>刷新</button>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
            <button onClick={() => setTenantPage(Math.max(1, tenantPageClamped - 1))} disabled={tenantPageClamped <= 1}>
              上一页
            </button>
            <span style={{ color: "#666" }}>
              第 {tenantPageClamped} / {tenantTotalPages} 页（共 {filteredTenants.length} 个租户）
            </span>
            <button
              onClick={() => setTenantPage(Math.min(tenantTotalPages, tenantPageClamped + 1))}
              disabled={tenantPageClamped >= tenantTotalPages}
            >
              下一页
            </button>
          </div>

          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                {["租户", "创建时间", "已绑定密钥", "RPM 限制", "TPM 限制", "禁用", "操作"].map((h) => (
                  <th key={h} style={{ borderBottom: "1px solid #eee", padding: 10, textAlign: "left" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tenantPageRows.map((t) => (
                <tr key={t.tenant_id}>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
                    <code>{t.tenant_id}</code>
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>{formatTime(t.created_at)}</td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>{boundKeyCountByTenant.get(t.tenant_id) ?? 0}</td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
                    <input type="number" min={1} defaultValue={t.rpm_limit ?? undefined} id={`rpm-${t.tenant_id}`} />
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
                    <input type="number" min={1} defaultValue={t.tpm_limit ?? undefined} id={`tpm-${t.tenant_id}`} />
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
                    <input type="checkbox" defaultChecked={t.disabled} id={`dis-${t.tenant_id}`} />
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
                    <button
                      onClick={() => {
                        const rpmEl = document.getElementById(`rpm-${t.tenant_id}`) as HTMLInputElement | null;
                        const tpmEl = document.getElementById(`tpm-${t.tenant_id}`) as HTMLInputElement | null;
                        const disEl = document.getElementById(`dis-${t.tenant_id}`) as HTMLInputElement | null;
                        const rpmV = rpmEl?.value?.trim() ?? "";
                        const tpmV = tpmEl?.value?.trim() ?? "";
                        const rpm = rpmV ? Number(rpmV) : null;
                        const tpm = tpmV ? Number(tpmV) : null;
                        const dis = Boolean(disEl?.checked);
                        upsertTenant(t.tenant_id, rpm, tpm, dis);
                      }}
                    >
                      保存
                    </button>
                    <button
                      style={{ marginLeft: 8 }}
                      onClick={() => {
                        if (!confirm(`确认删除租户 "${t.tenant_id}" 吗？`)) return;
                        const bound = boundKeyCountByTenant.get(t.tenant_id) ?? 0;
                        if (bound > 0) {
                          if (!confirm(`该租户仍绑定 ${bound} 个密钥，是否强制删除并解绑全部密钥？`)) return;
                          deleteTenant(t.tenant_id, true);
                          return;
                        }
                        deleteTenant(t.tenant_id, false);
                      }}
                    >
                      删除
                    </button>
                    <button
                      style={{ marginLeft: 8 }}
                      onClick={() => {
                        const bound = boundKeyCountByTenant.get(t.tenant_id) ?? 0;
                        if (bound <= 0) return;
                        if (!confirm(`确认解绑租户 "${t.tenant_id}" 下的全部密钥吗？`)) return;
                        unbindTenantKeys(t.tenant_id);
                      }}
                      disabled={(boundKeyCountByTenant.get(t.tenant_id) ?? 0) <= 0}
                    >
                      解绑全部密钥
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

    </div>
  );
}

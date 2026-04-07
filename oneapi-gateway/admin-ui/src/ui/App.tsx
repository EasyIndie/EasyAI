import { useEffect, useMemo, useState } from "react";

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
  key_prefix: string;
  created_at: string;
  revoked_at: string | null;
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

function formatTime(s: string) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toISOString().replace("T", " ").slice(0, 19);
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

type TenantPickerProps = {
  value: string | null;
  disabled: boolean;
  tenants: string[];
  boundCountByTenant: Map<string, number>;
  onCommit: (tenantId: string | null) => void;
};

function TenantPicker(props: TenantPickerProps) {
  const { value, disabled, tenants, boundCountByTenant, onCommit } = props;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState<number>(-1);

  const items = useMemo(() => {
    const query = q.trim().toLowerCase();
    const filtered = query ? tenants.filter((t) => t.toLowerCase().includes(query)) : tenants;
    return filtered.slice(0, 30);
  }, [q, tenants]);

  const display = value ?? "";
  const bound = value ? boundCountByTenant.get(value) ?? 0 : 0;

  return (
    <div style={{ position: "relative", minWidth: 220 }}>
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
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 6,
            background: "#fff",
            border: "1px solid #eee",
            borderRadius: 8,
            boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
            zIndex: 10,
            maxHeight: 280,
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
  const [status, setStatus] = useState<string>("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

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

  async function createKey() {
    setStatus("创建中...");
    try {
      const data = await fetchJson("/admin/api/keys", { method: "POST" });
      setCreatedKey(String(data?.api_key ?? ""));
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
      const tenant = (k.tenant_id ?? "").toLowerCase();
      const revoked = k.revoked_at ? "已撤销" : "";
      return id.includes(q) || prefix.includes(q) || tenant.includes(q) || revoked.includes(q);
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
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", margin: 24 }}>
      <h1>OneAPI 管理台</h1>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
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
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
            <button onClick={createKey}>创建密钥</button>
            <input
              type="text"
              placeholder="搜索密钥"
              value={keySearch}
              onChange={(e) => {
                setKeySearch(e.currentTarget.value);
                setKeyPage(1);
              }}
              style={{ marginLeft: 10 }}
            />
            <button onClick={loadKeys}>刷新</button>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
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
              <code>{createdKey}</code>
              <div style={{ marginTop: 10 }}>
                <button onClick={() => setCreatedKey(null)}>关闭</button>
              </div>
            </div>
          ) : null}

          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                {["ID", "前缀", "创建时间", "撤销时间", "租户", "RPM 限制", "操作"].map((h) => (
                  <th key={h} style={{ borderBottom: "1px solid #eee", padding: 10, textAlign: "left" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keyPageRows.map((k) => (
                <tr key={k.id}>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>{k.id}</td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
                    <code>{k.key_prefix}</code>
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>{formatTime(k.created_at)}</td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>{k.revoked_at ? formatTime(k.revoked_at) : ""}</td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
                    <TenantPicker
                      value={k.tenant_id}
                      disabled={Boolean(k.revoked_at)}
                      tenants={tenantOptions}
                      boundCountByTenant={boundKeyCountByTenant}
                      onCommit={(tenantId) => updateKeyTenant(k.id, tenantId)}
                    />
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
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
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
                    <button onClick={() => revokeKey(k.id)} disabled={Boolean(k.revoked_at)}>
                      撤销
                    </button>
                    <button
                      style={{ marginLeft: 8 }}
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
                      style={{ marginLeft: 8 }}
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

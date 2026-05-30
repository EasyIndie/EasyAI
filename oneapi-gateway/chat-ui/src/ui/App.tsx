import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Conversation = {
  id: string;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
};

type Message = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  model: string | null;
  created_at: string;
};

type ViewMode = "chat" | "test";

const LS_KEY = "easyai_chat_api_key";

function getStoredKey(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

function setStoredKey(k: string) {
  try {
    localStorage.setItem(LS_KEY, k);
  } catch {}
}

function clearStoredKey() {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {}
}

function authHeaders(): Record<string, string> {
  const k = getStoredKey();
  if (!k) return {};
  return { authorization: `Bearer ${k}` };
}

async function fetchJson(url: string, init?: RequestInit) {
  const headers: Record<string, string> = {
    ...authHeaders(),
    accept: "application/json",
  };
  if (init?.method !== "GET" && init?.body !== undefined && init?.body !== null) {
    headers["content-type"] = "application/json";
  }

  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text || String(res.status);
    try {
      const j = JSON.parse(text);
      msg = j.error || msg;
    } catch {}
    throw new Error(msg);
  }
  return text ? JSON.parse(text) : null;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function formatTime(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return d.toISOString().replace("T", " ").slice(0, 16);
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

export function App() {
  const [apiKey, setApiKey] = useState<string | null>(getStoredKey);
  const [keyInput, setKeyInput] = useState(getStoredKey() ?? "");
  const [loginError, setLoginError] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("chat");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [inputText, setInputText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [status, setStatus] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [temperature, setTemperature] = useState("0.7");
  const [maxTokens, setMaxTokens] = useState("2048");
  const [testSystemPrompt, setTestSystemPrompt] = useState("你是一个有帮助的 AI 助手。");
  const [testUserPrompt, setTestUserPrompt] = useState("");
  const [testStream, setTestStream] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState("");
  const [testRaw, setTestRaw] = useState("");
  const [testUsage, setTestUsage] = useState("");
  const [testLatencyMs, setTestLatencyMs] = useState<number | null>(null);
  const [convLoading, setConvLoading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const testAbortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const currentConv = useMemo(
    () => conversations.find((c) => c.id === currentId) ?? null,
    [conversations, currentId],
  );

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamContent, scrollToBottom]);

  const loadModels = useCallback(async () => {
    try {
      const data = await fetchJson("/chat-api/models");
      const list = Array.isArray(data?.data)
        ? (data.data as any[]).map((m) => String(m?.id ?? "").trim()).filter(Boolean)
        : [];
      setModels(list);
      if (list.length > 0 && !selectedModel) setSelectedModel(list[0]!);
    } catch {}
  }, []);

  const loadConversations = useCallback(async () => {
    setConvLoading(true);
    try {
      const data = await fetchJson("/chat-api/conversations");
      setConversations(data?.conversations ?? []);
    } catch (e: any) {
      if (e?.message?.includes("unauthorized")) {
        setLoginError("登录已失效，请重新输入 API Key。");
        handleLogout();
        return;
      }
    } finally {
      setConvLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (convId: string) => {
    try {
      const data = await fetchJson(`/chat-api/conversations/${encodeURIComponent(convId)}/messages`);
      setMessages(data?.messages ?? []);
    } catch {}
  }, []);

  const handleLogin = useCallback(async () => {
    const key = keyInput.trim();
    if (!key) return;
    setLoginError("");
    try {
      const res = await fetch("/chat-api/models", {
        headers: {
          authorization: `Bearer ${key}`,
          accept: "application/json",
        },
      });
      if (!res.ok) throw new Error("invalid_api_key");
      setStoredKey(key);
      setApiKey(key);
    } catch {
      setLoginError("API Key 无效或服务未就绪，请检查后重试。");
    }
  }, [keyInput]);

  function handleLogout() {
    clearStoredKey();
    setApiKey(null);
    setKeyInput("");
    setViewMode("chat");
    setConversations([]);
    setCurrentId(null);
    setMessages([]);
    setIsStreaming(false);
    setStreamContent("");
    setTestLoading(false);
    setTestResult("");
    setTestRaw("");
    setTestUsage("");
    setTestLatencyMs(null);
    setTestUserPrompt("");
    testAbortRef.current?.abort();
    testAbortRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
  }

  const handleNewConversation = useCallback(async () => {
    if (isStreaming) return;
    try {
      const data = await fetchJson("/chat-api/conversations", { method: "POST" });
      const id = data?.id;
      if (id) {
        setCurrentId(id);
        setMessages([]);
        setStreamContent("");
        await loadConversations();
      }
    } catch (e: any) {
      setStatus(e?.message ?? "创建失败");
    }
  }, [isStreaming, loadConversations]);

  const handleSelectConversation = useCallback(
    async (id: string) => {
      if (isStreaming) return;
      setCurrentId(id);
      setMessages([]);
      setStreamContent("");
      await loadMessages(id);
    },
    [isStreaming, loadMessages],
  );

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      if (isStreaming) return;
      try {
        await fetchJson(`/chat-api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (currentId === id) {
          setCurrentId(null);
          setMessages([]);
          setStreamContent("");
          setStatus("会话已删除");
        }
        await loadConversations();
      } catch (e: any) {
        setStatus(e?.message ?? "删除失败");
      }
    },
    [isStreaming, currentId, loadConversations],
  );

  const handleCloseConversation = useCallback(() => {
    if (isStreaming) return;
    setCurrentId(null);
    setMessages([]);
    setStreamContent("");
    setStatus("");
  }, [isStreaming]);

  const requestDeleteConversation = useCallback(
    (id: string, title?: string) => {
      if (isStreaming) return;
      setPendingDelete({ id, title: title?.trim() || "新对话" });
    },
    [isStreaming],
  );

  const confirmDeleteConversation = useCallback(async () => {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    await handleDeleteConversation(target.id);
  }, [pendingDelete, handleDeleteConversation]);

  useEffect(() => {
    if (apiKey) {
      loadConversations();
      loadModels();
    }
  }, [apiKey, loadConversations, loadModels]);

  useEffect(() => {
    if (currentId) {
      loadMessages(currentId);
    } else {
      setMessages([]);
    }
  }, [currentId, loadMessages]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      testAbortRef.current?.abort();
      testAbortRef.current = null;
    };
  }, []);

  const handleSend = useCallback(async () => {
    const msg = inputText.trim();
    if (!msg || isStreaming || !selectedModel) return;

    setInputText("");
    setIsStreaming(true);
    setStreamContent("");
    setStatus("发送中...");

    let activeConvId: string;
    if (!currentId) {
      try {
        const created = await fetchJson("/chat-api/conversations", { method: "POST" });
        const createdId = created?.id;
        if (!createdId || typeof createdId !== "string") throw new Error("创建会话失败");
        activeConvId = createdId;
        setCurrentId(activeConvId);
        await loadConversations();
      } catch (e: any) {
        setIsStreaming(false);
        setStatus(e?.message ?? "创建会话失败");
        return;
      }
    } else {
      activeConvId = currentId;
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      conversation_id: activeConvId,
      role: "user",
      content: msg,
      model: selectedModel,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const body = JSON.stringify({
        model: selectedModel,
        message: msg,
        temperature: Number(temperature) || undefined,
        max_tokens: Number(maxTokens) || undefined,
        stream: true,
      });

      const res = await fetch(`/chat-api/conversations/${encodeURIComponent(activeConvId)}/chat`, {
        method: "POST",
        headers: {
          ...authHeaders(),
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || String(res.status));
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("stream not available");

      const decoder = new TextDecoder();
      let buffer = "";
      let output = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          for (const line of event.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const dataText = trimmed.slice(6);
            if (dataText === "[DONE]") continue;
            let parsed: any;
            try {
              parsed = JSON.parse(dataText);
            } catch {
              continue;
            }
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (typeof delta === "string") {
              output += delta;
              setStreamContent(output);
            }
          }
        }
      }

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        conversation_id: activeConvId,
        role: "assistant",
        content: output,
        model: selectedModel,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setStreamContent("");
      setStatus("");
      await loadConversations();
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setStatus("已停止");
      } else {
        setStatus(e?.message ?? "请求失败");
        const errMsg: Message = {
          id: crypto.randomUUID(),
          conversation_id: activeConvId,
          role: "assistant",
          content: `**错误:** ${e?.message ?? "请求失败"}`,
          model: selectedModel,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errMsg]);
        setStreamContent("");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsStreaming(false);
    }
  }, [inputText, isStreaming, currentId, selectedModel, temperature, maxTokens, loadConversations]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setStatus("已停止");
  }, []);

  const handleStopTest = useCallback(() => {
    testAbortRef.current?.abort();
    testAbortRef.current = null;
    setTestLoading(false);
    setStatus("已停止");
  }, []);

  const runTest = useCallback(async () => {
    const model = selectedModel.trim();
    const userPrompt = testUserPrompt.trim();
    if (!model) {
      setStatus("请先选择模型");
      return;
    }
    if (!userPrompt) {
      setStatus("请输入用户消息");
      return;
    }

    const messagesPayload: Array<{ role: string; content: string }> = [];
    if (testSystemPrompt.trim()) {
      messagesPayload.push({ role: "system", content: testSystemPrompt.trim() });
    }
    messagesPayload.push({ role: "user", content: userPrompt });

    const body: Record<string, unknown> = {
      model,
      messages: messagesPayload,
      stream: testStream,
    };
    if (temperature.trim()) body.temperature = Number(temperature);
    if (maxTokens.trim()) body.max_tokens = Number(maxTokens);

    setTestLoading(true);
    setTestResult("");
    setTestRaw("");
    setTestUsage("");
    setTestLatencyMs(null);
    setStatus("请求中...");

    const startedAt = performance.now();
    const controller = new AbortController();
    testAbortRef.current = controller;

    try {
      if (testStream) {
        const res = await fetch("/v1/chat/completions", {
          method: "POST",
          headers: {
            ...authHeaders(),
            accept: "text/event-stream",
            "content-type": "application/json",
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
          setTestRaw(raw);

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
                setTestResult(output);
              }
              const nextUsage = formatUsage(parsed);
              if (nextUsage) {
                usageText = nextUsage;
                setTestUsage(nextUsage);
              }
            }
          }
        }

        const latency = Math.round(performance.now() - startedAt);
        setTestLatencyMs(latency);
        setTestUsage((current) => current || usageText);
        setStatus("成功");
      } else {
        const data = await fetchJson("/v1/chat/completions", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify(body),
        });
        const latency = Math.round(performance.now() - startedAt);
        setTestLatencyMs(latency);
        setTestResult(extractAssistantText(data));
        setTestRaw(JSON.stringify(data, null, 2));
        setTestUsage(formatUsage(data));
        setStatus("成功");
      }
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setStatus("已停止");
      } else {
        setStatus(e?.message ?? "失败");
      }
    } finally {
      if (testAbortRef.current === controller) {
        testAbortRef.current = null;
      }
      setTestLoading(false);
    }
  }, [maxTokens, selectedModel, temperature, testStream, testSystemPrompt, testUserPrompt]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleUpdateTitle = useCallback(
    async (id: string, title: string) => {
      try {
        await fetchJson(`/chat-api/conversations/${encodeURIComponent(id)}/title`, {
          method: "PUT",
          body: JSON.stringify({ title }),
        });
        await loadConversations();
      } catch {}
    },
    [loadConversations],
  );

  if (!apiKey) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#f5f5f5",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}>
        <div style={{
          background: "#fff",
          padding: 40,
          borderRadius: 16,
          boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
          width: 400,
          maxWidth: "90vw",
        }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 700 }}>EasyAI Chat</h1>
          <p style={{ margin: "0 0 24px", color: "#666", fontSize: 14 }}>请输入你的 API 密钥开始使用</p>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="sk-..."
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: 8,
              border: "1px solid #ddd",
              fontSize: 14,
              boxSizing: "border-box",
              marginBottom: 16,
            }}
          />
          <button
            onClick={handleLogin}
            disabled={!keyInput.trim()}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: 8,
              border: "none",
              background: keyInput.trim() ? "#1a73e8" : "#ccc",
              color: "#fff",
              fontSize: 15,
              fontWeight: 600,
              cursor: keyInput.trim() ? "pointer" : "default",
            }}
          >
            登录
          </button>
          {loginError && (
            <div style={{ marginTop: 12, color: "#d93025", fontSize: 13 }}>
              {loginError}
            </div>
          )}
        </div>
      </div>
    );
  }

  const sidebarWidth = 280;
  const modelList = models;

  return (
    <div style={{
      display: "flex",
      height: "100vh",
      fontFamily: "system-ui, -apple-system, sans-serif",
      color: "#1a1a1a",
    }}>
      {/* Sidebar */}
      <div style={{
        width: sidebarWidth,
        minWidth: sidebarWidth,
        background: "#f8f9fa",
        borderRight: "1px solid #e8e8e8",
        display: "flex",
        flexDirection: "column",
      }}>
        <div style={{ padding: 16, borderBottom: "1px solid #e8e8e8" }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 700 }}>EasyAI Chat</h2>
          <button
            onClick={handleNewConversation}
            disabled={isStreaming}
            style={{
              width: "100%",
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px dashed #ccc",
              background: "transparent",
              color: isStreaming ? "#999" : "#1a73e8",
              fontSize: 14,
              cursor: isStreaming ? "default" : "pointer",
            }}
          >
            + 新建对话
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
          {convLoading && conversations.length === 0 ? (
            <div style={{ padding: 16, color: "#999", fontSize: 13, textAlign: "center" }}>加载中...</div>
          ) : conversations.length === 0 ? (
            <div style={{ padding: 16, color: "#999", fontSize: 13, textAlign: "center" }}>暂无对话</div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => handleSelectConversation(conv.id)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  marginBottom: 4,
                  cursor: isStreaming ? "default" : "pointer",
                  background: conv.id === currentId ? "#e8f0fe" : "transparent",
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  opacity: isStreaming ? 0.6 : 1,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  {renamingId === conv.id ? (
                    <input
                      value={renameInput}
                      onChange={(e) => setRenameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.stopPropagation();
                          const trimmed = renameInput.trim();
                          if (trimmed) handleUpdateTitle(conv.id, trimmed);
                          setRenamingId(null);
                        }
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setRenamingId(null);
                        }
                      }}
                      onBlur={() => {
                        const trimmed = renameInput.trim();
                        if (trimmed) handleUpdateTitle(conv.id, trimmed);
                        setRenamingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                      style={{
                        width: "100%",
                        padding: "2px 6px",
                        borderRadius: 4,
                        border: "1px solid #1a73e8",
                        fontSize: 14,
                        fontFamily: "inherit",
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  ) : (
                    <div
                      onClick={() => {
                        if (isStreaming) return;
                        setRenamingId(conv.id);
                        setRenameInput(conv.title || "");
                      }}
                      style={{
                        fontSize: 14,
                        fontWeight: conv.id === currentId ? 600 : 400,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        cursor: isStreaming ? "default" : "text",
                      }}
                      title="点击重命名"
                    >
                      {conv.title || "新对话"}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>
                    {conv.message_count} 条消息 · {formatTime(conv.updated_at)}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    requestDeleteConversation(conv.id, conv.title);
                  }}
                  disabled={isStreaming}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#ccc",
                    cursor: isStreaming ? "default" : "pointer",
                    fontSize: 16,
                    padding: "2px 4px",
                    lineHeight: 1,
                    flexShrink: 0,
                  }}
                  title="删除对话"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>

        <div style={{
          padding: "12px 16px",
          borderTop: "1px solid #e8e8e8",
          fontSize: 12,
          color: "#999",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span title={apiKey}>{truncate(apiKey, 24)}</span>
          <button
            onClick={handleLogout}
            style={{
              border: "none",
              background: "transparent",
              color: "#999",
              cursor: "pointer",
              fontSize: 12,
              textDecoration: "underline",
            }}
          >
            退出
          </button>
        </div>
      </div>

      {/* Main area */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        background: "#fff",
      }}>
        {/* Top bar */}
        <div style={{
          padding: "12px 24px",
          borderBottom: "1px solid #e8e8e8",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}>
          <button
            onClick={() => setViewMode("chat")}
            style={{
              border: "1px solid #ddd",
              background: viewMode === "chat" ? "#1a73e8" : "transparent",
              color: viewMode === "chat" ? "#fff" : "#666",
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            对话
          </button>
          <button
            onClick={() => setViewMode("test")}
            style={{
              border: "1px solid #ddd",
              background: viewMode === "test" ? "#1a73e8" : "transparent",
              color: viewMode === "test" ? "#fff" : "#666",
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            模型测试
          </button>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={isStreaming || modelList.length === 0}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #ddd",
              fontSize: 13,
              minWidth: 200,
            }}
          >
            {modelList.length === 0 && <option value="">无可用模型</option>}
            {modelList.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              border: "1px solid #ddd",
              background: "transparent",
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 12,
              color: "#666",
              cursor: "pointer",
            }}
          >
            {showSettings ? "收起" : "参数"}
          </button>

          {isStreaming && (
            <button
              onClick={handleStop}
              style={{
                border: "none",
                background: "#e74c3c",
                color: "#fff",
                borderRadius: 6,
                padding: "4px 14px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              停止
            </button>
          )}

          {viewMode === "test" && testLoading && (
            <button
              onClick={handleStopTest}
              style={{
                border: "none",
                background: "#e74c3c",
                color: "#fff",
                borderRadius: 6,
                padding: "4px 14px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              停止测试
            </button>
          )}

          {status && (
            <span style={{ fontSize: 12, color: "#999", marginLeft: "auto" }}>{status}</span>
          )}
          {currentConv && (
            <button
              onClick={handleCloseConversation}
              disabled={isStreaming}
              style={{
                border: "1px solid #ddd",
                background: "transparent",
                borderRadius: 6,
                padding: "4px 10px",
                fontSize: 12,
                color: isStreaming ? "#999" : "#666",
                cursor: isStreaming ? "default" : "pointer",
              }}
            >
              关闭会话
            </button>
          )}
          {currentConv && (
            <button
              onClick={() => requestDeleteConversation(currentConv.id, currentConv.title)}
              disabled={isStreaming}
              style={{
                border: "1px solid #f5c2c2",
                background: "#fff5f5",
                borderRadius: 6,
                padding: "4px 10px",
                fontSize: 12,
                color: isStreaming ? "#caa" : "#d93025",
                cursor: isStreaming ? "default" : "pointer",
              }}
            >
              删除会话
            </button>
          )}
        </div>

        {viewMode === "chat" ? (
          <>
            {/* Settings panel */}
            {showSettings && (
              <div style={{
                padding: "12px 24px",
                borderBottom: "1px solid #e8e8e8",
                display: "flex",
                gap: 24,
                fontSize: 13,
                background: "#fafafa",
                flexWrap: "wrap",
              }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#666" }}>温度:</span>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    max={2}
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                    style={{ width: 70, padding: "4px 8px", borderRadius: 4, border: "1px solid #ddd", fontSize: 13 }}
                  />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#666" }}>最大 Tokens:</span>
                  <input
                    type="number"
                    min={1}
                    max={32768}
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(e.target.value)}
                    style={{ width: 90, padding: "4px 8px", borderRadius: 4, border: "1px solid #ddd", fontSize: 13 }}
                  />
                </label>
              </div>
            )}

            {/* Messages */}
            <div style={{
              flex: 1,
              overflow: "auto",
              padding: 24,
            }}>
              {!currentConv && (
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  color: "#ccc",
                  fontSize: 16,
                }}>
                  <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>💬</div>
                  <div>选择或创建一个对话开始聊天</div>
                </div>
              )}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    marginBottom: 20,
                    display: "flex",
                    justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                  }}
                >
                  <div style={{
                    maxWidth: "75%",
                    padding: "12px 16px",
                    borderRadius: 12,
                    background: msg.role === "user" ? "#1a73e8" : "#f0f0f0",
                    color: msg.role === "user" ? "#fff" : "#1a1a1a",
                    fontSize: 14,
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "break-word",
                  }}>
                    {msg.content}
                  </div>
                </div>
              ))}

              {isStreaming && streamContent && (
                <div style={{
                  marginBottom: 20,
                  display: "flex",
                  justifyContent: "flex-start",
                }}>
                  <div style={{
                    maxWidth: "75%",
                    padding: "12px 16px",
                    borderRadius: 12,
                    background: "#f0f0f0",
                    color: "#1a1a1a",
                    fontSize: 14,
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "break-word",
                  }}>
                    {streamContent}
                    <span style={{
                      display: "inline-block",
                      width: 8,
                      height: 16,
                      background: "#1a73e8",
                      marginLeft: 2,
                      animation: "blink 1s infinite",
                      verticalAlign: "middle",
                    }} />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div style={{
              padding: "16px 24px",
              borderTop: "1px solid #e8e8e8",
              background: "#fafafa",
            }}>
              <div style={{
                display: "flex",
                gap: 12,
                alignItems: "flex-end",
              }}>
                <textarea
                  ref={inputRef}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入消息，Enter 发送，Shift+Enter 换行..."
                  disabled={isStreaming}
                  rows={2}
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid #ddd",
                    fontSize: 14,
                    fontFamily: "inherit",
                    resize: "none",
                    lineHeight: 1.5,
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={!inputText.trim() || isStreaming || !selectedModel}
                  style={{
                    padding: "10px 24px",
                    borderRadius: 8,
                    border: "none",
                    background: inputText.trim() && !isStreaming && selectedModel ? "#1a73e8" : "#ccc",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: inputText.trim() && !isStreaming && selectedModel ? "pointer" : "default",
                    whiteSpace: "nowrap",
                  }}
                >
                  发送
                </button>
              </div>
            </div>
          </>
        ) : (
          <div style={{
            flex: 1,
            overflow: "auto",
            padding: 24,
          }}>
            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "#666", fontSize: 13 }}>系统提示词</span>
                <textarea
                  value={testSystemPrompt}
                  onChange={(e) => setTestSystemPrompt(e.target.value)}
                  rows={4}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid #ddd",
                    fontSize: 14,
                    fontFamily: "inherit",
                    resize: "vertical",
                    lineHeight: 1.5,
                    boxSizing: "border-box",
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "#666", fontSize: 13 }}>用户消息</span>
                <textarea
                  value={testUserPrompt}
                  onChange={(e) => setTestUserPrompt(e.target.value)}
                  rows={8}
                  placeholder="请输入要测试的问题或指令"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid #ddd",
                    fontSize: 14,
                    fontFamily: "inherit",
                    resize: "vertical",
                    lineHeight: 1.5,
                    boxSizing: "border-box",
                  }}
                />
              </label>
            </div>

            <div style={{
              display: "flex",
              gap: 16,
              alignItems: "center",
              marginTop: 14,
              color: "#666",
              fontSize: 13,
              flexWrap: "wrap",
            }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={testStream}
                  onChange={(e) => setTestStream(e.currentTarget.checked)}
                />
                流式输出
              </label>
              <span>模型数量：{modelList.length}</span>
              <span>调用模型：{selectedModel || "未选择"}</span>
              <span>温度：{temperature}</span>
              <span>最大 Tokens：{maxTokens}</span>
              {testLatencyMs !== null ? <span>耗时：{testLatencyMs} ms</span> : null}
              {testUsage ? <span>{testUsage}</span> : null}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
              <button
                onClick={runTest}
                disabled={testLoading || !selectedModel.trim()}
                style={{
                  padding: "10px 18px",
                  borderRadius: 8,
                  border: "none",
                  background: testLoading || !selectedModel.trim() ? "#ccc" : "#1a73e8",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: testLoading || !selectedModel.trim() ? "default" : "pointer",
                }}
              >
                {testLoading ? "请求中..." : "发送测试请求"}
              </button>
              <button
                onClick={handleStopTest}
                disabled={!testLoading}
                style={{
                  padding: "10px 18px",
                  borderRadius: 8,
                  border: "1px solid #ddd",
                  background: "#fff",
                  color: "#666",
                  fontSize: 14,
                  cursor: testLoading ? "pointer" : "default",
                }}
              >
                停止输出
              </button>
              <button
                onClick={() => {
                  setTestUserPrompt("");
                  setTestResult("");
                  setTestRaw("");
                  setTestUsage("");
                  setTestLatencyMs(null);
                }}
                disabled={testLoading}
                style={{
                  padding: "10px 18px",
                  borderRadius: 8,
                  border: "1px solid #ddd",
                  background: "#fff",
                  color: "#666",
                  fontSize: 14,
                  cursor: testLoading ? "default" : "pointer",
                }}
              >
                清空结果
              </button>
            </div>

            <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
              <div>
                <div style={{ marginBottom: 6, fontWeight: 600 }}>模型返回</div>
                <textarea
                  readOnly
                  value={testResult}
                  rows={10}
                  placeholder="请求返回内容会显示在这里"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid #ddd",
                    fontSize: 14,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    resize: "vertical",
                    lineHeight: 1.5,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <div style={{ marginBottom: 6, fontWeight: 600 }}>原始 JSON</div>
                <textarea
                  readOnly
                  value={testRaw}
                  rows={16}
                  placeholder="原始响应 JSON 会显示在这里"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid #ddd",
                    fontSize: 13,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    resize: "vertical",
                    lineHeight: 1.5,
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
      {pendingDelete && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setPendingDelete(null)}
        >
          <div
            style={{
              width: 420,
              maxWidth: "92vw",
              background: "#fff",
              borderRadius: 12,
              boxShadow: "0 12px 36px rgba(0,0,0,0.2)",
              padding: 20,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>确认删除会话？</div>
            <div style={{ fontSize: 14, color: "#555", lineHeight: 1.6, marginBottom: 16 }}>
              该操作不可撤销。将删除会话及其全部消息：<br />
              <span style={{ color: "#111", fontWeight: 600 }}>{pendingDelete.title}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                onClick={() => setPendingDelete(null)}
                style={{
                  border: "1px solid #ddd",
                  background: "#fff",
                  borderRadius: 8,
                  padding: "8px 14px",
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                取消
              </button>
              <button
                onClick={confirmDeleteConversation}
                style={{
                  border: "1px solid #d93025",
                  background: "#d93025",
                  color: "#fff",
                  borderRadius: 8,
                  padding: "8px 14px",
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

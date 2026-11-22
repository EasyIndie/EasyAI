import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionBar, Button, Center, Field, Grid, Input, Inline, Select, Section, Stack, TextArea } from "@easyai/ui";
import { createClientId } from "./id";
import { shouldApplyLoadedMessages } from "./messageLoad";
import { parseSseDataEvents } from "./stream";

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

type HealthStatus = {
  ok: boolean;
  service: string;
  appEnv?: string;
  modelPlane?: string;
  consoleUrl?: string | null;
};

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

function cx(...parts: Array<string | undefined | false | null>) {
  return parts.filter(Boolean).join(" ");
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
    <div className="ui-badge" style={{ color: tone }}>
      <span className="ui-badge-dot" style={{ background: tone }} />
      <span>{text}</span>
    </div>
  );
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
  const [health, setHealth] = useState<HealthStatus | null | undefined>(undefined);
  const [convLoading, setConvLoading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const testAbortRef = useRef<AbortController | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const currentIdRef = useRef<string | null>(null);
  const isStreamingRef = useRef(false);
  const messageLoadSeqRef = useRef(0);

  const currentConv = useMemo(
    () => conversations.find((c) => c.id === currentId) ?? null,
    [conversations, currentId],
  );

  const scrollToBottom = useCallback(() => {
    const panel = messagesScrollRef.current;
    if (!panel) return;
    panel.scrollTo({ top: panel.scrollHeight, behavior: "auto" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamContent, scrollToBottom]);

  useEffect(() => {
    currentIdRef.current = currentId;
  }, [currentId]);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

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

  const loadHealth = useCallback(async () => {
    try {
      const res = await fetch("/healthz", { headers: { accept: "application/json" } });
      const data = await res.json();
      if (!res.ok) throw new Error(String(res.status));
      setHealth(data as HealthStatus);
    } catch {
      setHealth(null);
    }
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
    const seq = ++messageLoadSeqRef.current;
    try {
      const data = await fetchJson(`/chat-api/conversations/${encodeURIComponent(convId)}/messages`);
      if (!shouldApplyLoadedMessages({
        requestSeq: seq,
        currentSeq: messageLoadSeqRef.current,
        requestedConversationId: convId,
        currentConversationId: currentIdRef.current,
        isStreaming: isStreamingRef.current,
      })) return;
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
    loadHealth();
  }, [loadHealth]);

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
    messageLoadSeqRef.current += 1;
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
      id: createClientId(),
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
      let doneSeen = false;

      while (!doneSeen) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        const parsedEvents = parseSseDataEvents(buffer);
        buffer = parsedEvents.rest;
        for (const dataText of parsedEvents.dataEvents) {
          if (dataText === "[DONE]") {
            doneSeen = true;
            break;
          }
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
            setStreamContent(output);
          }
        }
      }
      if (buffer) {
        const parsedEvents = parseSseDataEvents(buffer, true);
        buffer = parsedEvents.rest;
        for (const dataText of parsedEvents.dataEvents) {
          if (dataText === "[DONE]") break;
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
            setStreamContent(output);
          }
        }
      }
      if (doneSeen) {
        await reader.cancel().catch(() => {});
      }

      const assistantMsg: Message = {
        id: createClientId(),
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
          id: createClientId(),
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
        let doneSeen = false;

        while (!doneSeen) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          raw += chunk;
          buffer += chunk;
          setTestRaw(raw);

          const parsedEvents = parseSseDataEvents(buffer);
          buffer = parsedEvents.rest;
          for (const dataText of parsedEvents.dataEvents) {
            if (dataText === "[DONE]") {
              doneSeen = true;
              break;
            }
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
        if (buffer) {
          const parsedEvents = parseSseDataEvents(buffer, true);
          buffer = parsedEvents.rest;
          for (const dataText of parsedEvents.dataEvents) {
            if (dataText === "[DONE]") break;
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
        if (doneSeen) {
          await reader.cancel().catch(() => {});
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
      <Center className="ui-shell">
        <Section
          className="ui-surface ui-chat-login"
          title="EasyAI Chat"
          description="请输入 API Key 开始使用。若聊天返回 model not found，请先在服务端拉取配置中的 Ollama 模型。"
        >
          <ActionBar style={{ marginBottom: 8 }}>
            <DeploymentBadge appEnv={health?.appEnv} />
          </ActionBar>
          <Field label="API Key" hint="本地仅保存到浏览器 localStorage。">
            <Input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder="sk-..."
              fullWidth
            />
          </Field>
          <Button onClick={handleLogin} disabled={!keyInput.trim()} variant="primary" block>
            登录
          </Button>
          {loginError && (
            <div style={{ marginTop: 12, color: "var(--ui-danger)", fontSize: "var(--ui-font-size-sm)", lineHeight: 1.5 }}>
              {loginError}
            </div>
          )}
        </Section>
      </Center>
    );
  }

  const sidebarWidth = 280;
  const modelList = models;

  return (
    <div className="ui-shell ui-layout-chat">
      {/* Sidebar */}
      <div className="ui-sidebar" style={{ minHeight: 0 }}>
        <Section className="ui-chat-sidebar-header">
          <Inline style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: "var(--ui-font-size-xl)", fontWeight: 700 }}>EasyAI Chat</h2>
            <DeploymentBadge appEnv={health?.appEnv} />
          </Inline>
          <Button
            onClick={handleNewConversation}
            disabled={isStreaming}
            variant="dashed"
            block
            style={{
              color: isStreaming ? "var(--ui-text-muted)" : "var(--ui-primary)",
              fontSize: "var(--ui-font-size-md)",
            }}
          >
            + 新建对话
          </Button>
        </Section>

        <div className="ui-chat-conversation-list">
          {convLoading && conversations.length === 0 ? (
            <div className="ui-muted" style={{ padding: 16, fontSize: "var(--ui-font-size-sm)", textAlign: "center" }}>加载中...</div>
          ) : conversations.length === 0 ? (
            <div className="ui-muted" style={{ padding: 16, fontSize: "var(--ui-font-size-sm)", textAlign: "center" }}>暂无对话</div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => handleSelectConversation(conv.id)}
                className={cx(
                  "ui-chat-conversation-item",
                  conv.id === currentId && "ui-chat-conversation-active",
                )}
                style={{
                  cursor: isStreaming ? "default" : "pointer",
                  opacity: isStreaming ? 0.6 : 1,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  {renamingId === conv.id ? (
                    <Input
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
                      className="ui-input"
                      style={{ width: "100%", padding: "2px 6px", fontSize: "var(--ui-font-size-md)" }}
                    />
                  ) : (
                    <div
                      onClick={() => {
                        if (isStreaming) return;
                        setRenamingId(conv.id);
                        setRenameInput(conv.title || "");
                      }}
                      className="ui-chat-conversation-name"
                      style={{
                        fontWeight: conv.id === currentId ? 600 : 400,
                        cursor: isStreaming ? "default" : "text",
                      }}
                      title="点击重命名"
                    >
                      {conv.title || "新对话"}
                    </div>
                  )}
                  <div className="ui-chat-conversation-meta">
                    {conv.message_count} 条消息 · {formatTime(conv.updated_at)}
                  </div>
                </div>
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    requestDeleteConversation(conv.id, conv.title);
                  }}
                  disabled={isStreaming}
                  variant="ghost"
                  size="sm"
                  style={{ color: "#94a3b8", padding: "2px 4px", lineHeight: 1, flexShrink: 0 }}
                  title="删除对话"
                >
                  ×
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="ui-chat-footer">
          <span title={apiKey}>{truncate(apiKey, 24)}</span>
          <Button
            onClick={handleLogout}
            variant="ghost"
            style={{
              fontSize: "var(--ui-font-size-xs)",
              textDecoration: "underline",
            }}
          >
            退出
          </Button>
        </div>
      </div>

      {/* Main area */}
      <div className="ui-main ui-chat-main">
        {/* Top bar */}
        <ActionBar className="ui-chat-topbar">
          <Button
            onClick={() => setViewMode("chat")}
            variant={viewMode === "chat" ? "primary" : "ghost"}
            size="sm"
            style={{
              fontSize: "var(--ui-font-size-xs)",
            }}
          >
            对话
          </Button>
          <Button
            onClick={() => setViewMode("test")}
            variant={viewMode === "test" ? "primary" : "ghost"}
            size="sm"
            style={{
              fontSize: "var(--ui-font-size-xs)",
            }}
          >
            模型测试
          </Button>
          <Select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={isStreaming || modelList.length === 0}
            style={{
              fontSize: "var(--ui-font-size-sm)",
              minWidth: 200,
            }}
          >
            {modelList.length === 0 && <option value="">无可用模型</option>}
            {modelList.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </Select>

          <Button
            onClick={() => setShowSettings(!showSettings)}
            variant="ghost"
            size="sm"
            style={{
              fontSize: "var(--ui-font-size-xs)",
              color: "var(--ui-text-muted)",
            }}
          >
            {showSettings ? "收起" : "参数"}
          </Button>

          {isStreaming && (
            <Button
              onClick={handleStop}
              variant="danger"
              size="sm"
              style={{ fontSize: "var(--ui-font-size-xs)" }}
            >
              停止
            </Button>
          )}

          {viewMode === "test" && testLoading && (
            <Button
              onClick={handleStopTest}
              variant="danger"
              size="sm"
              style={{ fontSize: "var(--ui-font-size-xs)" }}
            >
              停止测试
            </Button>
          )}

          {status && <span className="ui-muted ui-spacer" style={{ fontSize: "var(--ui-font-size-xs)" }}>{status}</span>}
          {currentConv && (
            <Button
              onClick={handleCloseConversation}
              disabled={isStreaming}
              variant="ghost"
              size="sm"
              style={{
                fontSize: "var(--ui-font-size-xs)",
                color: "var(--ui-text-muted)",
              }}
            >
              关闭会话
            </Button>
          )}
          {currentConv && (
            <Button
              onClick={() => requestDeleteConversation(currentConv.id, currentConv.title)}
              disabled={isStreaming}
              variant="danger"
              size="sm"
              style={{
                fontSize: "var(--ui-font-size-xs)",
                color: "#fff",
              }}
              >
                删除会话
              </Button>
          )}
        </ActionBar>

        {viewMode === "chat" ? (
          <>
            {/* Settings panel */}
            {showSettings && (
              <ActionBar className="ui-chat-settings">
                <Field label="温度" style={{ minWidth: 130 }}>
                  <Input
                    type="number"
                    step="0.1"
                    min={0}
                    max={2}
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                    style={{ width: 70, fontSize: "var(--ui-font-size-sm)" }}
                  />
                </Field>
                <Field label="最大 Tokens" style={{ minWidth: 160 }}>
                  <Input
                    type="number"
                    min={1}
                    max={32768}
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(e.target.value)}
                    style={{ width: 90, fontSize: "var(--ui-font-size-sm)" }}
                  />
                </Field>
              </ActionBar>
            )}

            {/* Messages */}
              <div className="ui-chat-messages" ref={messagesScrollRef}>
              {!currentConv && (
                <Center className="ui-chat-empty">
                  <div className="ui-chat-empty-icon">💬</div>
                  <div>选择或创建一个对话开始聊天</div>
                </Center>
              )}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cx(
                    "ui-chat-message-row",
                    msg.role === "user" ? "ui-chat-message-row--user" : "ui-chat-message-row--assistant",
                  )}
                >
                  <div
                    className={cx(
                      "ui-chat-message-bubble",
                      msg.role === "user" ? "ui-chat-message-bubble--user" : "ui-chat-message-bubble--assistant",
                    )}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {isStreaming && (
                <div className="ui-chat-message-row ui-chat-message-row--assistant">
                  <div className="ui-chat-message-bubble ui-chat-message-bubble--assistant">
                    {streamContent}
                    <span className="ui-chat-message-caret" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="ui-chat-input-panel">
              <Inline gap={12} align="flex-end">
                <TextArea
                  ref={inputRef}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入消息，Enter 发送，Shift+Enter 换行..."
                  disabled={isStreaming}
                  rows={2}
                  style={{
                    flex: 1,
                    fontSize: "var(--ui-font-size-md)",
                    resize: "none",
                    lineHeight: 1.5,
                  }}
                />
                <Button
                  onClick={handleSend}
                  disabled={!inputText.trim() || isStreaming || !selectedModel}
                  variant="primary"
                  style={{
                    fontSize: "var(--ui-font-size-md)",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  发送
                </Button>
              </Inline>
            </div>
          </>
        ) : (
          <Section
            className="ui-chat-test-panel"
            title="模型测试"
            description="用于快速验证系统提示词、用户输入和模型输出。"
          >
            <Stack gap={12} className="ui-chat-test-grid">
              <Field label="系统提示词">
                <TextArea
                  value={testSystemPrompt}
                  onChange={(e) => setTestSystemPrompt(e.target.value)}
                  rows={4}
                  style={{
                    width: "100%",
                    fontSize: "var(--ui-font-size-md)",
                    resize: "vertical",
                    lineHeight: 1.5,
                  }}
                />
              </Field>

              <Field label="用户消息">
                <TextArea
                  value={testUserPrompt}
                  onChange={(e) => setTestUserPrompt(e.target.value)}
                  rows={8}
                  placeholder="请输入要测试的问题或指令"
                  style={{
                    width: "100%",
                    fontSize: "var(--ui-font-size-md)",
                    resize: "vertical",
                    lineHeight: 1.5,
                  }}
                />
              </Field>
            </Stack>

            <ActionBar style={{ marginTop: 14, color: "var(--ui-text-muted)", fontSize: "var(--ui-font-size-sm)" }}>
              <Inline gap={8} wrap={false}>
                <Input
                  type="checkbox"
                  checked={testStream}
                  onChange={(e) => setTestStream(e.currentTarget.checked)}
                />
                流式输出
              </Inline>
              <span>模型数量：{modelList.length}</span>
              <span>调用模型：{selectedModel || "未选择"}</span>
              {modelList.length === 0 ? <span style={{ color: "var(--ui-warning)" }}>提示：当前没有可调用模型</span> : null}
              <span>温度：{temperature}</span>
              <span>最大 Tokens：{maxTokens}</span>
              {testLatencyMs !== null ? <span>耗时：{testLatencyMs} ms</span> : null}
              {testUsage ? <span>{testUsage}</span> : null}
            </ActionBar>

            <ActionBar style={{ marginTop: 16 }}>
              <Button
                onClick={runTest}
                disabled={testLoading || !selectedModel.trim()}
                variant="primary"
                style={{
                  fontSize: "var(--ui-font-size-md)",
                  fontWeight: 600,
                }}
              >
                {testLoading ? "请求中..." : "发送测试请求"}
              </Button>
              <Button
                onClick={handleStopTest}
                disabled={!testLoading}
                variant="secondary"
                style={{
                  fontSize: "var(--ui-font-size-md)",
                }}
              >
                停止输出
              </Button>
              <Button
                onClick={() => {
                  setTestUserPrompt("");
                  setTestResult("");
                  setTestRaw("");
                  setTestUsage("");
                  setTestLatencyMs(null);
                }}
                disabled={testLoading}
                variant="secondary"
                style={{
                  fontSize: "var(--ui-font-size-md)",
                }}
              >
                清空结果
              </Button>
            </ActionBar>

            <Grid gap={12} style={{ marginTop: 18 }}>
              <Section title="模型返回">
                <TextArea
                  readOnly
                  value={testResult}
                  rows={10}
                  placeholder="请求返回内容会显示在这里"
                  style={{
                    width: "100%",
                    fontSize: "var(--ui-font-size-md)",
                    resize: "vertical",
                    lineHeight: 1.5,
                  }}
                />
              </Section>

              <Section title="原始 JSON">
                <TextArea
                  readOnly
                  value={testRaw}
                  rows={16}
                  placeholder="原始响应 JSON 会显示在这里"
                  style={{
                    width: "100%",
                    fontSize: "var(--ui-font-size-sm)",
                    resize: "vertical",
                    lineHeight: 1.5,
                  }}
                />
              </Section>
            </Grid>
          </Section>
        )}
      </div>
      {pendingDelete && (
        <div className="ui-dialog-overlay" onClick={() => setPendingDelete(null)}>
          <div
            className="ui-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <Stack gap={10} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: "var(--ui-font-size-xl)", fontWeight: 700 }}>确认删除会话？</div>
              <div style={{ fontSize: "var(--ui-font-size-md)", color: "var(--ui-text-muted)", lineHeight: 1.6 }}>
                该操作不可撤销。将删除会话及其全部消息：<br />
                <span style={{ color: "var(--ui-text)", fontWeight: 600 }}>{pendingDelete.title}</span>
              </div>
            </Stack>
            <div className="ui-dialog-actions">
              <Button
                onClick={() => setPendingDelete(null)}
                variant="secondary"
                style={{
                  fontSize: "var(--ui-font-size-md)",
                }}
              >
                取消
              </Button>
              <Button
                onClick={confirmDeleteConversation}
                variant="danger"
                style={{
                  fontSize: "var(--ui-font-size-md)",
                }}
              >
                确认删除
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

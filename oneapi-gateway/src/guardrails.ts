export type GuardrailsConfig = {
  enabled: boolean;
  blockInternalIp: boolean;
  injectionKeywords: string[];
  piiMaskEnabled: boolean;
};

function normalize(s: string): string {
  return s.toLowerCase();
}

function uniqueNonEmpty(arr: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    const t = v.trim();
    if (!t) continue;
    const k = normalize(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function buildDefaultGuardrails(): GuardrailsConfig {
  return {
    enabled: false,
    blockInternalIp: true,
    injectionKeywords: [
      "ignore all previous instructions",
      "system prompt",
      "developer message",
      "jailbreak",
      "do anything now",
      "reveal your instructions",
      "prompt injection",
    ],
    piiMaskEnabled: true,
  };
}

function extractTextFromBody(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b: any = body;
  const parts: string[] = [];

  if (typeof b.prompt === "string") parts.push(b.prompt);
  if (Array.isArray(b.messages)) {
    for (const m of b.messages) {
      if (!m || typeof m !== "object") continue;
      const c = (m as any).content;
      if (typeof c === "string") parts.push(c);
      if (Array.isArray(c)) {
        for (const item of c) {
          if (item && typeof item === "object" && typeof (item as any).text === "string") parts.push((item as any).text);
        }
      }
    }
  }

  return parts.join("\n");
}

function parseIpv4(s: string): number[] | undefined {
  const parts = s.split(".");
  if (parts.length !== 4) return;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return;
  return nums;
}

function isPrivateIpv4(o: number[]): boolean {
  const [a, b] = o;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function containsInternalIp(text: string): boolean {
  const t = text;
  if (!t) return false;
  const lower = normalize(t);
  if (lower.includes("localhost")) return true;
  if (lower.includes("0.0.0.0")) return true;
  if (lower.includes("::1")) return true;
  if (lower.includes("fe80:")) return true;
  if (lower.includes("fc00:") || lower.includes("fd00:")) return true;

  const ipv4Re = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  const matches = t.match(ipv4Re);
  if (!matches) return false;
  for (const m of matches) {
    const o = parseIpv4(m);
    if (o && isPrivateIpv4(o)) return true;
  }
  return false;
}

export function containsInjection(text: string, keywords: string[]): boolean {
  const k = uniqueNonEmpty(keywords);
  if (!text || !k.length) return false;
  const lower = normalize(text);
  for (const kw of k) {
    if (lower.includes(normalize(kw))) return true;
  }
  return false;
}

export type GuardrailsResult = { ok: true } | { ok: false; reason: "internal_ip" | "prompt_injection" };

export function checkInputGuardrails(cfg: GuardrailsConfig, body: unknown): GuardrailsResult {
  if (!cfg.enabled) return { ok: true };
  const text = extractTextFromBody(body);
  if (cfg.blockInternalIp && containsInternalIp(text)) return { ok: false, reason: "internal_ip" };
  if (containsInjection(text, cfg.injectionKeywords)) return { ok: false, reason: "prompt_injection" };
  return { ok: true };
}

function maskKeepStartEnd(s: string, start: number, end: number, maskChar: string): string {
  if (s.length <= start + end) return s;
  return s.slice(0, start) + maskChar.repeat(Math.max(1, s.length - start - end)) + s.slice(s.length - end);
}

export function maskPiiText(text: string): string {
  if (!text) return text;
  let out = text;
  out = out.replace(/\b1[3-9]\d{9}\b/g, (m) => maskKeepStartEnd(m, 3, 4, "*"));
  out = out.replace(/\b\d{17}[\dXx]\b/g, (m) => maskKeepStartEnd(m, 4, 4, "*"));
  out = out.replace(/\b\d{3}[- ]?\d{3}[- ]?\d{4}\b/g, (m) => maskKeepStartEnd(m.replace(/[- ]/g, ""), 3, 4, "*"));
  out = out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, (m) => {
    const idx = m.indexOf("@");
    if (idx <= 1) return "***" + m.slice(idx);
    return m[0] + "***" + m.slice(idx - 1);
  });
  return out;
}

export function maskPiiJson(value: any): any {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return maskPiiText(value);
  if (Array.isArray(value)) return value.map(maskPiiJson);
  if (typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "usage") {
        out[k] = v;
        continue;
      }
      out[k] = maskPiiJson(v);
    }
    return out;
  }
  return value;
}


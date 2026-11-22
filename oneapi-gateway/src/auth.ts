import { sha256Hex } from "./crypto.js";
import type { Config } from "./config.js";

export type AuthContext = {
  /** Stable identity used to scope conversations and batches. */
  principal: string;
  /**
   * true  -> the gateway authenticates the key itself and talks to LiteLLM with the master key
   * false -> the client presented a LiteLLM virtual key; forward it and let LiteLLM validate
   */
  useMasterKey: boolean;
  token?: string;
};

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const raw = headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.trim() ? value.trim() : undefined;
}

export function apiKeyFromHeaders(headers: Record<string, string | string[] | undefined>): string | undefined {
  const direct = headerValue(headers, "x-api-key");
  if (direct) return direct;
  const auth = headerValue(headers, "authorization");
  if (!auth) return;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

/**
 * Single auth entrypoint.
 *
 * - internal token: used by the batch worker (trusted, no client key involved)
 * - `secrets.api_keys`: simple keys for individuals / small teams, defined in YAML
 * - anything else: treated as a LiteLLM virtual key and forwarded untouched, so the
 *   LiteLLM console owns key lifecycle, budgets and rate limits
 */
export function authenticate(cfg: Config, headers: Record<string, string | string[] | undefined>): AuthContext {
  const internal = headerValue(headers, "x-oneapi-internal-token");
  if (cfg.internalToken && internal && internal === cfg.internalToken) {
    const principal = headerValue(headers, "x-oneapi-principal") ?? "internal";
    return { principal, useMasterKey: true };
  }

  const token = apiKeyFromHeaders(headers);
  if (!token) throw new Error("missing credentials");

  const hash = sha256Hex(token);
  if (cfg.apiKeys.has(token)) {
    return { principal: `key:${hash.slice(0, 12)}`, useMasterKey: true, token };
  }
  return { principal: `litellm:${hash.slice(0, 12)}`, useMasterKey: false, token };
}

import type { RedisClient } from "./redis.js";
import { sha256Hex } from "./crypto.js";

export type CacheDecision = { shouldCache: false } | { shouldCache: true; cacheKey: string };

export function decideCache(path: string, body: unknown): CacheDecision {
  if (path !== "/v1/chat/completions" && path !== "/v1/embeddings") return { shouldCache: false };
  if (!body || typeof body !== "object") return { shouldCache: false };
  const b = body as Record<string, unknown>;
  const temperature = b["temperature"];
  if (typeof temperature === "number" && temperature > 0) return { shouldCache: false };
  const model = b["model"];
  if (typeof model !== "string" || !model.length) return { shouldCache: false };
  const stream = b["stream"] === true;

  const keyPayload =
    path === "/v1/embeddings"
      ? { path, model, input: b["input"], encoding_format: b["encoding_format"] }
      : {
          path,
          model,
          messages: b["messages"],
          temperature: b["temperature"] ?? 0,
          top_p: b["top_p"],
          max_tokens: b["max_tokens"],
          response_format: b["response_format"],
          seed: b["seed"],
          stream,
        };

  const cacheKey = `cache:v1:${sha256Hex(JSON.stringify(keyPayload))}`;
  return { shouldCache: true, cacheKey };
}

export async function cacheGet(redis: RedisClient, key: string): Promise<string | undefined> {
  const v = await redis.get(key);
  return v ?? undefined;
}

export async function cacheSet(redis: RedisClient, key: string, value: string, ttlSeconds: number): Promise<void> {
  await redis.set(key, value, { EX: ttlSeconds });
}

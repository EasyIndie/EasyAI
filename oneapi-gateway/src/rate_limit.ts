import type { RedisClient } from "./redis.ts";

export type RateLimitResult =
  | { ok: true; limit: number; remaining: number; resetSeconds: number }
  | { ok: false; limit: number; remaining: number; resetSeconds: number };

export async function enforceRpm(
  redis: RedisClient,
  principal: string,
  rpm: number,
  nowMs: number,
): Promise<RateLimitResult> {
  const windowSeconds = 60;
  const bucket = Math.floor(nowMs / 1000 / windowSeconds);
  const key = `rl:v1:${principal}:${bucket}`;

  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);

  const remaining = Math.max(0, rpm - count);
  const resetSeconds = windowSeconds - (Math.floor(nowMs / 1000) % windowSeconds);
  if (count > rpm) return { ok: false, limit: rpm, remaining, resetSeconds };
  return { ok: true, limit: rpm, remaining, resetSeconds };
}

export type TokenLimitResult = { ok: true } | { ok: false; limit: number; used: number; resetSeconds: number };

export async function checkTpm(redis: RedisClient, tenantKey: string, tpm: number, nowMs: number): Promise<TokenLimitResult> {
  const windowSeconds = 60;
  const bucket = Math.floor(nowMs / 1000 / windowSeconds);
  const key = `tpm:v1:${tenantKey}:${bucket}`;
  const usedStr = await redis.get(key);
  const used = usedStr ? Number(usedStr) : 0;
  const resetSeconds = windowSeconds - (Math.floor(nowMs / 1000) % windowSeconds);
  if (used > tpm) return { ok: false, limit: tpm, used, resetSeconds };
  return { ok: true };
}

export async function recordTpm(redis: RedisClient, tenantKey: string, tokens: number, nowMs: number): Promise<void> {
  const windowSeconds = 60;
  const bucket = Math.floor(nowMs / 1000 / windowSeconds);
  const key = `tpm:v1:${tenantKey}:${bucket}`;
  const v = await redis.incrBy(key, tokens);
  if (v === tokens) await redis.expire(key, windowSeconds);
}

import type { RedisClient } from "./redis.js";

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

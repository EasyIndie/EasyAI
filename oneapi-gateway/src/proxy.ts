import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import type { Config } from "./config.js";
import type { RedisClient } from "./redis.js";
import { enforceRpm } from "./rate_limit.js";
import { authenticate } from "./auth.js";

export type ProxyDeps = {
  cfg: Config;
  redis: RedisClient;
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Thin `/v1/*` passthrough.
 *
 * Model routing, retries, fallbacks, caching, guardrails, spend tracking and
 * request logs are all handled by LiteLLM. This layer only adds EasyAI's
 * rate limit and key delegation.
 */
export async function registerProxyRoutes(app: FastifyInstance, deps: ProxyDeps): Promise<void> {
  app.route({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    url: "/v1/*",
    handler: async (req, reply) => {
      reply.header("X-Request-Id", String((req as any).id ?? ""));

      let auth;
      try {
        auth = authenticate(deps.cfg, req.headers as any);
      } catch {
        return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
      }

      const rl = await enforceRpm(deps.redis, auth.principal, deps.cfg.rateLimitRpm, Date.now());
      reply.header("X-RateLimit-Limit", rl.limit);
      reply.header("X-RateLimit-Remaining", rl.remaining);
      reply.header("X-RateLimit-Reset", rl.resetSeconds);
      if (!rl.ok) {
        return reply.status(429).send({ error: { message: "rate limited", type: "rate_limit_error" } });
      }

      const headers: Record<string, string> = {
        "x-request-id": String((req as any).id ?? ""),
      };
      const contentType = req.headers["content-type"];
      if (typeof contentType === "string") headers["content-type"] = contentType;
      const traceparent = req.headers["traceparent"];
      if (typeof traceparent === "string") headers["traceparent"] = traceparent;

      if (auth.useMasterKey) {
        headers["authorization"] = `Bearer ${deps.cfg.litellmMasterKey}`;
      } else {
        const authorization = req.headers["authorization"];
        if (typeof authorization === "string") headers["authorization"] = authorization;
        const xApiKey = req.headers["x-api-key"];
        if (typeof xApiKey === "string") headers["x-api-key"] = xApiKey;
      }

      const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.body !== undefined;

      let res: Response;
      try {
        res = await fetchWithTimeout(
          `${deps.cfg.litellmBaseUrl}${req.url}`,
          {
            method: req.method,
            headers,
            body: hasBody ? JSON.stringify(req.body) : undefined,
          },
          deps.cfg.upstreamTimeoutMs,
        );
      } catch (e: any) {
        if (e?.name === "AbortError") {
          return reply.status(504).send({ error: { message: "upstream timeout", type: "timeout_error" } });
        }
        return reply.status(502).send({ error: { message: "model service unavailable", type: "upstream_error" } });
      }

      const resContentType = res.headers.get("content-type") ?? "application/json";
      reply.status(res.status).header("content-type", resContentType);
      for (const header of ["x-ratelimit-remaining", "x-ratelimit-limit", "retry-after", "x-litellm-model-id"]) {
        const value = res.headers.get(header);
        if (value) reply.header(header, value);
      }

      if (resContentType.includes("text/event-stream") && res.body) {
        async function* streamGenerator() {
          const reader = res.body!.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) yield Buffer.from(value);
            }
          } finally {
            reader.releaseLock();
          }
        }
        return reply.status(res.status).send(Readable.from(streamGenerator()));
      }

      const text = await res.text();
      if (resContentType.includes("application/json") && text) {
        try {
          return reply.status(res.status).send(JSON.parse(text));
        } catch {
          return reply.status(res.status).send(text);
        }
      }
      return reply.status(res.status).send(text);
    },
  });
}

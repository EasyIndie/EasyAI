import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import { cacheGet, cacheSet, decideCache } from "./cache.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { insertUsageEvent } from "./db.js";
import type { RedisClient } from "./redis.js";
import { checkTpm, enforceRpm, recordTpm } from "./rate_limit.js";
import {
  httpRequestDurationSeconds,
  httpRequestsTotal,
  upstreamRequestsTotal,
  cacheHitsTotal,
  ttftDurationSeconds,
  tpsTokensPerSecond,
} from "./metrics.js";
import { hasScope, type AuthContext } from "./auth.js";
import { UpstreamPool } from "./upstreams.js";
import { checkInputGuardrails, maskPiiJson, maskPiiText } from "./guardrails.js";

function jsonBytes(v: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(v));
  } catch {
    return 0;
  }
}

function parseModelFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return;
  const m = (body as any).model;
  return typeof m === "string" ? m : undefined;
}

function updateModelInBody(body: any, newModel: string): any {
  if (body && typeof body === "object") {
    return { ...body, model: newModel };
  }
  return body;
}

function parseTokensFromResponse(body: any): { prompt?: number; completion?: number; total?: number } {
  const usage = body?.usage;
  if (!usage || typeof usage !== "object") return {};
  const p = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
  const c = typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined;
  const t = typeof usage.total_tokens === "number" ? usage.total_tokens : undefined;
  return { prompt: p, completion: c, total: t };
}

function shouldFailover(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function computeTps(totalTokens: number | undefined, startMs: number, firstTokenMs: number | undefined, endMs: number): number | undefined {
  if (typeof totalTokens !== "number" || !Number.isFinite(totalTokens) || totalTokens <= 0) return;
  const baseMs = typeof firstTokenMs === "number" && Number.isFinite(firstTokenMs) ? firstTokenMs : startMs;
  const seconds = Math.max(0.001, (endMs - baseMs) / 1000);
  return totalTokens / seconds;
}

type CachedSseV1 = {
  kind: "sse_v1";
  delays_ms: number[];
  chunks: string[];
};

function parseCachedSseV1(hit: string): CachedSseV1 | undefined {
  if (!hit || hit[0] !== "{") return;
  try {
    const j = JSON.parse(hit);
    if (!j || typeof j !== "object") return;
    if (j.kind !== "sse_v1") return;
    if (!Array.isArray(j.delays_ms) || !Array.isArray(j.chunks)) return;
    if (j.delays_ms.length !== j.chunks.length) return;
    return j as CachedSseV1;
  } catch {
    return;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

export type ProxyDeps = {
  cfg: Config;
  redis: RedisClient;
  db: Db;
  pool: UpstreamPool;
  authenticateRequest: (headers: Record<string, any>, reqIp?: string) => Promise<AuthContext>;
};

export async function registerProxyRoutes(app: FastifyInstance, deps: ProxyDeps): Promise<void> {
  app.route({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    url: "/v1/*",
    handler: async (req, reply) => {
      const route = req.url.split("?")[0] ?? req.url;
      const timer = httpRequestDurationSeconds.labels(route, req.method).startTimer();
      const startMs = Date.now();
      reply.header("X-Request-Id", String((req as any).id ?? ""));

      let auth: AuthContext | undefined;
      let cached = false;
      let upstreamUsed: string | undefined;
      let status = 500;
      let error: string | undefined;

      try {
        auth = await deps.authenticateRequest(req.headers as any, (req as any).ip);
        if (!hasScope(auth, "model:invoke")) {
          status = 403;
          httpRequestsTotal.labels(route, req.method, String(status)).inc();
          timer();
          await insertUsageEvent(deps.db, {
            principal: auth.principal,
            apiKeyId: auth.apiKeyId,
            apiKeyHash: auth.apiKeyHash,
            tenantId: auth.tenantId,
            authMode: auth.authMode,
            endpoint: route,
            method: req.method,
            status,
            latencyMs: Date.now() - startMs,
            cached: false,
            error: "scope_denied",
          });
          return reply.status(403).send({ error: { message: "insufficient scope", type: "auth_error" } });
        }
        let body: unknown = req.body;
        if (body && typeof body === "object") {
          const m = (body as any).model;
          if (typeof m === "string" && deps.cfg.modelMap[m]) {
            body = { ...(body as any), model: deps.cfg.modelMap[m] };
          }
        }

        const gr = checkInputGuardrails(deps.cfg.guardrails, body);
        if (!gr.ok) {
          status = 400;
          httpRequestsTotal.labels(route, req.method, String(status)).inc();
          timer();
          await insertUsageEvent(deps.db, {
            principal: auth.principal,
            apiKeyId: auth.apiKeyId,
            apiKeyHash: auth.apiKeyHash,
            tenantId: auth.tenantId,
            authMode: auth.authMode,
            model: parseModelFromBody(body),
            endpoint: route,
            method: req.method,
            status,
            latencyMs: Date.now() - startMs,
            cached: false,
            error: gr.reason,
          });
          return reply.status(400).send({ error: { message: "bad request", type: "guardrails_error" } });
        }

        if (auth.tenantDisabled) {
          status = 403;
          httpRequestsTotal.labels(route, req.method, String(status)).inc();
          timer();
          await insertUsageEvent(deps.db, {
            principal: auth.principal,
            apiKeyId: auth.apiKeyId,
            apiKeyHash: auth.apiKeyHash,
            tenantId: auth.tenantId,
            authMode: auth.authMode,
            model: parseModelFromBody(body),
            endpoint: route,
            method: req.method,
            status,
            latencyMs: Date.now() - startMs,
            cached: false,
            error: "tenant_disabled",
          });
          return reply.status(403).send({ error: { message: "tenant disabled", type: "auth_error" } });
        }

        const tenantKey = auth.tenantId ? `tenant:${auth.tenantId}` : auth.principal;
        const rpm =
          typeof auth.tenantRpmLimit === "number"
            ? auth.tenantRpmLimit
            : typeof auth.rpmLimit === "number"
              ? auth.rpmLimit
              : deps.cfg.rateLimitRpm;

        const rl = await enforceRpm(deps.redis, tenantKey, rpm, Date.now());
        reply.header("X-RateLimit-Limit", rl.limit);
        reply.header("X-RateLimit-Remaining", rl.remaining);
        reply.header("X-RateLimit-Reset", rl.resetSeconds);
        if (!rl.ok) {
          status = 429;
          httpRequestsTotal.labels(route, req.method, String(status)).inc();
          timer();
          await insertUsageEvent(deps.db, {
            principal: auth.principal,
            apiKeyId: auth.apiKeyId,
            apiKeyHash: auth.apiKeyHash,
            tenantId: auth.tenantId,
            authMode: auth.authMode,
            model: parseModelFromBody(body),
            endpoint: route,
            method: req.method,
            status,
            latencyMs: Date.now() - startMs,
            cached: false,
            error: "rate_limited",
          });
          return reply.status(429).send({ error: { message: "rate limited", type: "rate_limit_error" } });
        }

        if (typeof auth.tenantTpmLimit === "number") {
          const tr = await checkTpm(deps.redis, tenantKey, auth.tenantTpmLimit, Date.now());
          if (!tr.ok) {
            status = 429;
            reply.header("X-TokenLimit-Limit", tr.limit);
            reply.header("X-TokenLimit-Used", tr.used);
            reply.header("X-TokenLimit-Reset", tr.resetSeconds);
            httpRequestsTotal.labels(route, req.method, String(status)).inc();
            timer();
            await insertUsageEvent(deps.db, {
              principal: auth.principal,
              apiKeyHash: auth.apiKeyHash,
              authMode: auth.authMode,
              model: parseModelFromBody(body),
              endpoint: route,
              method: req.method,
              status,
              latencyMs: Date.now() - startMs,
              cached: false,
              error: "token_rate_limited",
            });
            return reply.status(429).send({ error: { message: "token rate limited", type: "rate_limit_error" } });
          }
        }

        if (deps.cfg.cacheEnabled && req.method === "POST") {
          const decision = decideCache(route, body);
          if (decision.shouldCache) {
            const hit = await cacheGet(deps.redis, decision.cacheKey);
            if (hit) {
              cached = true;
              cacheHitsTotal.labels(route).inc();
              status = 200;
              reply.header("X-Cache", "hit");

              const isStream = (body as any)?.stream === true;
              const modelName = parseModelFromBody(body) ?? "unknown";
              const a = auth!;

              if (isStream) {
                reply.header("content-type", "text/event-stream");
                const cachedSse = parseCachedSseV1(hit);
                const hitText = cachedSse ? cachedSse.chunks.join("") : hit;
                let tokens: any = {};
                const lines = hitText.split("\n");
                for (let i = lines.length - 1; i >= 0; i--) {
                  if (lines[i].startsWith("data: ") && lines[i] !== "data: [DONE]") {
                    try {
                      const j = JSON.parse(lines[i].slice(6));
                      if (j.usage) {
                        tokens = parseTokensFromResponse(j);
                        break;
                      }
                    } catch {}
                  }
                }

                const maxTotalMs = Number.isFinite(deps.cfg.cacheReplayMaxTotalMs) ? deps.cfg.cacheReplayMaxTotalMs : 0;
                const baseDelayMs = Number.isFinite(deps.cfg.cacheReplayChunkDelayMs) ? deps.cfg.cacheReplayChunkDelayMs : 0;

                let firstChunkTime: number | undefined;
                let streamError: any;

                async function* cachedStreamGenerator() {
                  try {
                    if (deps.cfg.cacheReplayMode === "original" && cachedSse) {
                      const totalOriginalMs = cachedSse.delays_ms.reduce((s, v) => s + (Number.isFinite(v) ? Math.max(0, v) : 0), 0);
                      const scale = maxTotalMs > 0 && totalOriginalMs > 0 ? Math.min(1, maxTotalMs / totalOriginalMs) : 1;
                      for (let i = 0; i < cachedSse.chunks.length; i++) {
                        const d = cachedSse.delays_ms[i];
                        if (Number.isFinite(d) && d > 0) await sleep(Math.floor(d * scale));
                        if (firstChunkTime === undefined) {
                          firstChunkTime = Date.now();
                          ttftDurationSeconds.labels(route, modelName, "true").observe((firstChunkTime - startMs) / 1000);
                        }
                        let chunk = cachedSse.chunks[i];
                        if (deps.cfg.guardrails.enabled && deps.cfg.guardrails.piiMaskEnabled) chunk = maskPiiText(chunk);
                        if (chunk) yield Buffer.from(chunk);
                      }
                    } else {
                      const rawChunks = hitText.split("\n\n");
                      const nonEmptyChunks = rawChunks.filter((c) => c && c.length);
                      const delayMs =
                        baseDelayMs > 0 && maxTotalMs > 0
                          ? Math.min(baseDelayMs, Math.floor(maxTotalMs / Math.max(1, nonEmptyChunks.length)))
                          : baseDelayMs;
                      for (let i = 0; i < rawChunks.length; i++) {
                        if (!rawChunks[i]) continue;
                        if (firstChunkTime === undefined) {
                          firstChunkTime = Date.now();
                          ttftDurationSeconds.labels(route, modelName, "true").observe((firstChunkTime - startMs) / 1000);
                        }
                        let chunk = rawChunks[i] + "\n\n";
                        if (deps.cfg.guardrails.enabled && deps.cfg.guardrails.piiMaskEnabled) chunk = maskPiiText(chunk);
                        yield Buffer.from(chunk);
                        if (delayMs > 0) await sleep(delayMs);
                      }
                    }
                  } catch (err) {
                    streamError = err;
                    throw err;
                  } finally {
                    const endMs = Date.now();
                    const ttftMs = firstChunkTime ? firstChunkTime - startMs : undefined;
                    const tps = computeTps(tokens.total, startMs, firstChunkTime, endMs);
                    if (typeof tps === "number") tpsTokensPerSecond.labels(route, modelName, "true").observe(tps);

                    httpRequestsTotal.labels(route, req.method, String(status)).inc();
                    timer();

                    await insertUsageEvent(deps.db, {
                      principal: a.principal,
              apiKeyId: a.apiKeyId,
                      apiKeyHash: a.apiKeyHash,
              tenantId: a.tenantId,
                      authMode: a.authMode,
                      model: modelName,
                      endpoint: route,
                      method: req.method,
                      status: streamError ? 499 : status,
                      latencyMs: endMs - startMs,
                      cached: true,
                      ttftMs,
                      tps,
                      requestBytes: jsonBytes(body),
                      responseBytes: Buffer.byteLength(hitText),
                      promptTokens: tokens.prompt,
                      completionTokens: tokens.completion,
                      totalTokens: tokens.total,
                      error: streamError ? "client_disconnected" : undefined,
                    }).catch(console.error);

                    if (typeof a.tenantTpmLimit === "number" && typeof tokens.total === "number" && !streamError) {
                      await recordTpm(deps.redis, tenantKey, tokens.total, Date.now());
                    }
                  }
                }
                return reply.status(200).send(Readable.from(cachedStreamGenerator()));
              } else {
                const payload = JSON.parse(hit);
                const t = parseTokensFromResponse(payload);
                const tps = computeTps(t.total, startMs, undefined, Date.now());
                if (typeof tps === "number") tpsTokensPerSecond.labels(route, modelName, "true").observe(tps);
                const ttftMs = Date.now() - startMs;
                ttftDurationSeconds.labels(route, modelName, "true").observe(ttftMs / 1000);
                httpRequestsTotal.labels(route, req.method, String(status)).inc();
                timer();
                const safePayload = deps.cfg.guardrails.enabled && deps.cfg.guardrails.piiMaskEnabled ? maskPiiJson(payload) : payload;
                await insertUsageEvent(deps.db, {
                  principal: a.principal,
                  apiKeyId: a.apiKeyId,
                  apiKeyHash: a.apiKeyHash,
                  tenantId: a.tenantId,
                  authMode: a.authMode,
                  model: modelName,
                  endpoint: route,
                  method: req.method,
                  status,
                  latencyMs: Date.now() - startMs,
                  cached: true,
                  ttftMs,
                  requestBytes: jsonBytes(body),
                  responseBytes: jsonBytes(safePayload),
                  promptTokens: t.prompt,
                  completionTokens: t.completion,
                  totalTokens: t.total,
                  tps,
                });
                if (typeof a.tenantTpmLimit === "number" && typeof payload?.usage?.total_tokens === "number") {
                  await recordTpm(deps.redis, tenantKey, payload.usage.total_tokens, Date.now());
                }
                return reply.status(200).send(safePayload);
              }
            }
          }
        }

        const originalModel = parseModelFromBody(body) ?? "unknown";
        const fallbacks = deps.cfg.fallbackMap[originalModel] ?? [];
        const modelsToTry = [originalModel, ...fallbacks];

        const headers: Record<string, string> = {
          "content-type": "application/json",
          "x-oneapi-principal": auth.principal,
          "x-request-id": String((req as any).id ?? ""),
        };
        const tp = req.headers["traceparent"];
        if (typeof tp === "string" && tp.length) headers["traceparent"] = tp;

        const poolList = deps.pool.list();
        const maxUpstreamAttempts = Math.max(1, Math.min(poolList.length, 3));

        let lastResponse: Response | undefined;
        let lastText: string | undefined;
        let finalModelUsed = originalModel;

        outer: for (const currentModel of modelsToTry) {
          finalModelUsed = currentModel;
          const currentBody = updateModelInBody(body, currentModel);
          const requestBody = currentBody ? JSON.stringify(currentBody) : undefined;

          for (let attempt = 0; attempt < maxUpstreamAttempts; attempt++) {
            const upstream = deps.pool.pick(Date.now());
            if (!upstream) break;
            upstreamUsed = upstream.baseUrl;

            const upstreamUrl = `${upstream.baseUrl}${route}${req.url.includes("?") ? "?" + req.url.split("?")[1] : ""}`;
            try {
              const res = await fetchWithTimeout(
                upstreamUrl,
                {
                  method: req.method,
                  headers,
                  body: requestBody,
                },
                deps.cfg.upstreamTimeoutMs,
              );
              status = res.status;
              upstreamRequestsTotal.labels(upstream.baseUrl, String(status)).inc();
              lastResponse = res;
              lastText = undefined;

              if (status >= 200 && status < 300) {
                deps.pool.reportSuccess(upstream.baseUrl);
                break outer;
              }

              lastText = await res.text();

              if (shouldFailover(status)) {
                deps.pool.reportFailure(upstream.baseUrl, Date.now());
                continue;
              }
              deps.pool.reportFailure(upstream.baseUrl, Date.now());
              break; // Not a failover-able error, stop trying this model
            } catch (e: any) {
              deps.pool.reportFailure(upstream.baseUrl, Date.now());
              error = e?.name === "AbortError" ? "upstream_timeout" : "upstream_error";
              status = 504;
              upstreamRequestsTotal.labels(upstream.baseUrl, String(status)).inc();
              continue;
            }
          }
        }

        if (!lastResponse) {
          status = 503;
          httpRequestsTotal.labels(route, req.method, String(status)).inc();
          timer();
          await insertUsageEvent(deps.db, {
            principal: auth!.principal,
            apiKeyId: auth!.apiKeyId,
            apiKeyHash: auth!.apiKeyHash,
            tenantId: auth!.tenantId,
            authMode: auth!.authMode,
            model: finalModelUsed,
            endpoint: route,
            method: req.method,
            status,
            latencyMs: Date.now() - startMs,
            cached,
            upstream: upstreamUsed,
            error: error ?? "no_upstream",
          });
          
          let parsedErrorMsg = "no upstream available: Failed to connect to any upstream service (e.g., litellm).";
          let parsedErrorType = "upstream_error";
          let details: any = error;
          
          if (lastText) {
             try {
                 const upstreamJson = JSON.parse(lastText);
                 if (upstreamJson && upstreamJson.error) {
                     parsedErrorMsg = upstreamJson.error.message || parsedErrorMsg;
                     parsedErrorType = upstreamJson.error.type || parsedErrorType;
                     details = upstreamJson.error.details || details;
                     if (status === 503 && (parsedErrorMsg.includes("Model not found") || parsedErrorMsg.includes("Upstream connection error") || parsedErrorMsg.includes("Insufficient memory") || parsedErrorMsg.includes("Upstream internal error"))) {
                        // pass through upstream status codes
                        if (parsedErrorMsg.includes("Model not found")) status = 404;
                        if (parsedErrorMsg.includes("Upstream connection error")) status = 502;
                        if (parsedErrorMsg.includes("Insufficient memory")) status = 507;
                        if (parsedErrorMsg.includes("Upstream internal error")) status = 500;
                     }
                 }
             } catch(e) {}
          } else if (error === "upstream_timeout") {
             parsedErrorMsg = "upstream timeout: The gateway timed out waiting for the upstream service.";
             status = 504;
          }

          return reply.status(status).send({ error: { message: parsedErrorMsg, type: parsedErrorType, details: details } });
        }

        const responseContentType = lastResponse.headers.get("content-type") ?? "application/json";
        reply.header("content-type", responseContentType);
        reply.header("X-Cache", "miss");
        if (upstreamUsed) reply.header("X-Upstream", upstreamUsed);
        if (finalModelUsed !== originalModel) reply.header("X-Model-Fallback", finalModelUsed);

        const isStreamResponse = responseContentType.includes("text/event-stream");

        if (status >= 200 && status < 300 && isStreamResponse && lastResponse.body) {
          async function* streamGenerator() {
            const reader = lastResponse!.body!.getReader();
            const decoder = new TextDecoder("utf-8");
            let responseText = "";
            let streamError: any;
            let firstTokenTime: number | undefined;
            const chunks: string[] = [];
            const delaysMs: number[] = [];
            let lastChunkAt: number | undefined;
            const modelName = finalModelUsed;
            const piiEnabled = deps.cfg.guardrails.enabled && deps.cfg.guardrails.piiMaskEnabled;

            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) {
                  const now = Date.now();
                  if (firstTokenTime === undefined) {
                    firstTokenTime = now;
                    const ttftMs = firstTokenTime - startMs;
                    ttftDurationSeconds.labels(route, modelName, "false").observe(ttftMs / 1000);
                  }
                  const d = lastChunkAt === undefined ? now - startMs : now - lastChunkAt;
                  delaysMs.push(d);
                  lastChunkAt = now;
                  let chunkStr = decoder.decode(value, { stream: true });
                  if (piiEnabled) chunkStr = maskPiiText(chunkStr);
                  responseText += chunkStr;
                  chunks.push(chunkStr);
                  yield Buffer.from(chunkStr);
                }
              }
              const finalChunk = decoder.decode();
              if (finalChunk) {
                const maskedFinal = piiEnabled ? maskPiiText(finalChunk) : finalChunk;
                responseText += maskedFinal;
                chunks.push(maskedFinal);
                delaysMs.push(0);
                yield Buffer.from(maskedFinal);
              }
            } catch (err) {
              streamError = err;
              throw err;
            } finally {
              reader.releaseLock();
              const isComplete = responseText.includes("data: [DONE]");

              if (isComplete && !streamError && deps.cfg.cacheEnabled && req.method === "POST") {
                const decision = decideCache(route, updateModelInBody(body, finalModelUsed));
                if (decision.shouldCache) {
                  await cacheSet(
                    deps.redis,
                    decision.cacheKey,
                    JSON.stringify({ kind: "sse_v1", delays_ms: delaysMs, chunks } satisfies CachedSseV1),
                    deps.cfg.cacheTtlSeconds,
                  );
                }
              }

              httpRequestsTotal.labels(route, req.method, String(status)).inc();
              timer();

              let tokens: any = {};
              const lines = responseText.split("\n");
              for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i].startsWith("data: ") && lines[i] !== "data: [DONE]") {
                  try {
                    const j = JSON.parse(lines[i].slice(6));
                    if (j.usage) {
                      tokens = parseTokensFromResponse(j);
                      break;
                    }
                  } catch {}
                }
              }

              const endMs = Date.now();
              const tps = computeTps(tokens.total, startMs, firstTokenTime, endMs);
              if (typeof tps === "number") tpsTokensPerSecond.labels(route, modelName, "false").observe(tps);

              await insertUsageEvent(deps.db, {
                principal: auth!.principal,
                apiKeyId: auth!.apiKeyId,
                apiKeyHash: auth!.apiKeyHash,
                tenantId: auth!.tenantId,
                authMode: auth!.authMode,
                model: finalModelUsed,
                endpoint: route,
                method: req.method,
                status: streamError ? 499 : status,
                latencyMs: endMs - startMs,
                cached: false,
                upstream: upstreamUsed,
                ttftMs: firstTokenTime ? firstTokenTime - startMs : undefined,
                tps,
                requestBytes: body ? Buffer.byteLength(JSON.stringify(updateModelInBody(body, finalModelUsed))) : undefined,
                responseBytes: Buffer.byteLength(responseText),
                promptTokens: tokens.prompt,
                completionTokens: tokens.completion,
                totalTokens: tokens.total,
                error: streamError ? "client_disconnected" : undefined,
              }).catch(console.error);
              if (typeof auth!.tenantTpmLimit === "number" && typeof tokens.total === "number" && !streamError) {
                await recordTpm(deps.redis, tenantKey, tokens.total, Date.now());
              }
            }
          }
          return reply.status(status).send(Readable.from(streamGenerator()));
        } else {
          if (lastText === undefined) {
            lastText = await lastResponse.text();
          }
          const ttftMs = Date.now() - startMs;
          const modelName = finalModelUsed;
          ttftDurationSeconds.labels(route, modelName, "false").observe(ttftMs / 1000);

          let responseJson: any | undefined;
          if (responseContentType.includes("application/json")) {
            try {
              responseJson = JSON.parse(lastText);
            } catch {
              responseJson = undefined;
            }
          }
          if (deps.cfg.guardrails.enabled && deps.cfg.guardrails.piiMaskEnabled) {
            if (responseJson !== undefined) {
              responseJson = maskPiiJson(responseJson);
              try {
                lastText = JSON.stringify(responseJson);
              } catch {}
            } else {
              lastText = maskPiiText(lastText);
            }
          }

          if (deps.cfg.cacheEnabled && req.method === "POST" && status >= 200 && status < 300) {
            const decision = decideCache(route, updateModelInBody(body, finalModelUsed));
            if (decision.shouldCache) {
              await cacheSet(deps.redis, decision.cacheKey, lastText, deps.cfg.cacheTtlSeconds);
            }
          }

          httpRequestsTotal.labels(route, req.method, String(status)).inc();
          timer();

          const tokens = responseJson ? parseTokensFromResponse(responseJson) : {};
          const endMs = Date.now();
          const tps = computeTps(tokens.total, startMs, undefined, endMs);
          if (typeof tps === "number") tpsTokensPerSecond.labels(route, modelName, "false").observe(tps);
          await insertUsageEvent(deps.db, {
            principal: auth!.principal,
            apiKeyId: auth!.apiKeyId,
            apiKeyHash: auth!.apiKeyHash,
            tenantId: auth!.tenantId,
            authMode: auth!.authMode,
            model: finalModelUsed,
            endpoint: route,
            method: req.method,
            status,
            latencyMs: endMs - startMs,
            cached,
            upstream: upstreamUsed,
            requestBytes: body ? Buffer.byteLength(JSON.stringify(updateModelInBody(body, finalModelUsed))) : undefined,
            responseBytes: Buffer.byteLength(lastText),
            promptTokens: tokens.prompt,
            completionTokens: tokens.completion,
            totalTokens: tokens.total,
            tps,
            error: status >= 400 ? JSON.stringify(responseJson ?? { raw: lastText }).slice(0, 2000) : undefined,
          });
          if (typeof auth!.tenantTpmLimit === "number" && typeof tokens.total === "number" && status >= 200 && status < 300) {
            await recordTpm(deps.redis, tenantKey, tokens.total, Date.now());
          }

          return reply.status(status).send(responseJson ?? lastText);
        }
      } catch (e: any) {
        status = status === 500 ? 401 : status;
        httpRequestsTotal.labels(route, req.method, String(status)).inc();
        timer();

        if (auth) {
          await insertUsageEvent(deps.db, {
            principal: auth.principal,
            apiKeyId: auth.apiKeyId,
            apiKeyHash: auth.apiKeyHash,
            tenantId: auth.tenantId,
            authMode: auth.authMode,
            model: parseModelFromBody(req.body),
            endpoint: route,
            method: req.method,
            status,
            latencyMs: Date.now() - startMs,
            cached,
            upstream: upstreamUsed,
            error: String(e?.message ?? "error").slice(0, 2000),
          });
        }

        if (status === 401) {
          return reply.status(401).send({ error: { message: "unauthorized", type: "auth_error" } });
        }
        return reply.status(502).send({ error: { message: "gateway error", type: "gateway_error" } });
      }
    },
  });
}

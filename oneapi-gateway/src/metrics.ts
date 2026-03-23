import client from "prom-client";

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpRequestsTotal = new client.Counter({
  name: "oneapi_http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["route", "method", "status"] as const,
  registers: [registry],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: "oneapi_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["route", "method"] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20],
  registers: [registry],
});

export const upstreamRequestsTotal = new client.Counter({
  name: "oneapi_upstream_requests_total",
  help: "Upstream requests",
  labelNames: ["upstream", "status"] as const,
  registers: [registry],
});

export const cacheHitsTotal = new client.Counter({
  name: "oneapi_cache_hits_total",
  help: "Cache hits",
  labelNames: ["route"] as const,
  registers: [registry],
});

export const ttftDurationSeconds = new client.Histogram({
  name: "easyai_ttft_seconds",
  help: "Time to first token in seconds",
  labelNames: ["route", "model", "cached"] as const,
  buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

export const tpsTokensPerSecond = new client.Histogram({
  name: "easyai_tps",
  help: "Tokens per second (total_tokens / (latency - ttft))",
  labelNames: ["route", "model", "cached"] as const,
  buckets: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000],
  registers: [registry],
});

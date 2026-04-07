# Technical Architecture

## Components

### LiteLLM Service (standalone)
- Purpose: lightweight OpenAI-compatible API surface backed by configurable providers (local or remote).
- Responsibilities:
  - Model aliasing and allow-listing
  - OpenAI endpoints (`/v1/chat/completions`, `/v1/embeddings`, `/v1/models`)
  - Health + Prometheus metrics
  - Structured request/latency logging

### OneAPI Gateway (standalone)
- Purpose: unified gateway for personal use and external API access.
- Responsibilities:
  - Authentication (API keys, OAuth JWT via JWKS)
  - Rate limiting (Redis, per principal)
  - Request routing + load balancing
  - Cache layer (Redis) for deterministic requests
  - Failover/circuit-breaker style fallback across upstreams
  - Usage analytics (Postgres) + basic dashboard
  - Batch API (`/v1/batches`) + async worker (optional)
  - User-facing OpenAPI docs (`/docs`, `/openapi.json`)
  - Prometheus metrics

## Combined Mode (OneAPI → LiteLLM)

```mermaid
flowchart LR
  C[Clients / Tenants] -->|OpenAI API| G[OneAPI Gateway]
  G -->|Cache hit| R[(Redis)]
  G -->|Cache miss| LB[Upstream Pool]
  LB --> L[LiteLLM Service]
  L --> O[Local Provider: Ollama]
  G --> P[(Postgres: usage_events)]
  G --> M[Prometheus]
  L --> M
```

## Request Flow (Chat Completions)
1. Client calls `POST /v1/chat/completions` on OneAPI with either:
   - `Authorization: Bearer <api-key>`, or
   - `Authorization: Bearer <oauth-jwt>`
2. Gateway authenticates principal and enforces RPM (per tenant if bound, otherwise per principal).
3. Gateway computes a cache key for deterministic calls (`temperature: 0`) and returns cached result if present (supports both streaming and non-streaming).
4. Gateway selects an upstream (round-robin with circuit-breaker skip) and forwards the request.
5. On transient failure codes/timeouts (429/502/503/504), gateway retries other upstreams (bounded attempts).
6. Gateway records a usage event in Postgres and exports metrics.

## Configuration

### LiteLLM-specific parameters
- Config file: [litellm.yaml](../config/litellm/litellm.yaml)
- Runtime env:
  - `LITELLM_CONFIG_PATH`
  - `OLLAMA_HOST`

### OneAPI gateway settings
- Config file: [config/oneapi/oneapi.yaml](../config/oneapi/oneapi.yaml)
- Key parameters:
  - `auth_mode`, `api_keys`
  - `oauth_jwks_url`, `oauth_audience`, `oauth_issuer`
  - `upstreams`, `upstream_timeout_ms`
  - `rate_limit_rpm`
  - `cache_enabled`, `cache_ttl_seconds`
  - `model_map`

### Combined operation parameters
- Combined env template: [config/combined/env.example](../config/combined/env.example)
- Combined deployment manifests: [k8s/combined](../k8s/combined)

## Observability

### Metrics (Prometheus)
- LiteLLM: `/metrics` with request counters and latency histograms.
- OneAPI: `/metrics` with HTTP request latency + cache hits + upstream request counters.

### Tracing
- Gateway currently does not implement distributed tracing propagation; rely on upstream/provider logs and gateway metrics for correlation.

### Error Tracking
- Errors are recorded into `usage_events.error` and counted via metrics labels.

## Availability and Performance Targets
- p95 < 500ms: achieved via Redis caching (for eligible deterministic requests), upstream keep-alive via Node fetch, and horizontal scaling.
- 99.9% availability in combined mode: achieved via multiple upstream replicas and bounded failover across upstreams.

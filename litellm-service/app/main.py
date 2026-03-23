import hashlib
import json
import os
import time
from typing import Any, Dict, Optional, Tuple

import yaml
from fastapi import Body, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from litellm import acompletion, aembedding
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from pythonjsonlogger import jsonlogger

import logging


logger = logging.getLogger("litellm-service")
handler = logging.StreamHandler()
handler.setFormatter(jsonlogger.JsonFormatter("%(message)s %(levelname)s %(name)s %(asctime)s"))
logger.addHandler(handler)
logger.setLevel(os.getenv("LITELLM_LOG_LEVEL", "info").upper())


REQUESTS_TOTAL = Counter(
    "litellm_requests_total",
    "Total requests",
    ["endpoint", "status"],
)
REQUEST_LATENCY_SECONDS = Histogram(
    "litellm_request_latency_seconds",
    "Request latency in seconds",
    ["endpoint"],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20),
)


def _load_config(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


CONFIG_PATH = os.getenv("LITELLM_CONFIG_PATH", "/app/config/litellm.yaml")
CONFIG = _load_config(CONFIG_PATH)


_RR_COUNTERS: Dict[str, int] = {}


def _pick_backend(input_model: str, backends: list[dict], selection: Optional[str], selector_key: Optional[str]) -> dict:
    if not backends:
        raise ValueError(f"no backends configured for model: {input_model}")
    if len(backends) == 1:
        return backends[0]
    strategy = (selection or "hash").lower()
    if strategy == "round_robin":
        idx = _RR_COUNTERS.get(input_model, 0)
        _RR_COUNTERS[input_model] = idx + 1
        return backends[idx % len(backends)]
    key = selector_key or str(time.time_ns())
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    idx = int(digest, 16) % len(backends)
    return backends[idx]


def _resolve_backend(backend: dict) -> Tuple[str, Optional[str]]:
    provider = backend.get("provider")
    model = backend.get("model")
    api_base = backend.get("api_base")
    api_base_env = backend.get("api_base_env")
    if not provider or not model:
        raise ValueError("backend must include provider and model")
    if not api_base and api_base_env:
        api_base = os.getenv(api_base_env)
    if provider == "ollama":
        if not api_base:
            api_base_env = (CONFIG.get("providers", {}).get("ollama", {}) or {}).get("api_base_env", "OLLAMA_HOST")
            api_base = os.getenv(api_base_env)
        if not api_base:
            raise ValueError("OLLAMA_HOST is required for ollama provider")
        return f"ollama/{model}", api_base
    return f"{provider}/{model}", api_base


def _resolve_model(input_model: str, selector_key: Optional[str] = None) -> Tuple[str, Optional[str]]:
    aliases = (CONFIG.get("model_aliases") or {})
    if input_model in aliases:
        alias = aliases[input_model] or {}
        backends = alias.get("backends")
        if isinstance(backends, list):
            backend = _pick_backend(input_model, backends, alias.get("selection"), selector_key)
            return _resolve_backend(backend)
        provider = alias.get("provider")
        model = alias.get("model")
        if provider == "ollama":
            api_base = os.getenv((CONFIG.get("providers", {}).get("ollama", {}) or {}).get("api_base_env", "OLLAMA_HOST"))
            if not api_base:
                raise ValueError("OLLAMA_HOST is required for ollama provider")
            return f"ollama/{model}", api_base
        return f"{provider}/{model}", None
    return input_model, None


def _allowed_models() -> list[str]:
    return list(((CONFIG.get("service") or {}).get("allowed_models") or []))


app = FastAPI(title="LiteLLM Service", version="0.1.0")


@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    endpoint = request.url.path
    start = time.perf_counter()
    status = "500"
    try:
        response = await call_next(request)
        status = str(response.status_code)
        return response
    finally:
        elapsed = time.perf_counter() - start
        REQUESTS_TOTAL.labels(endpoint=endpoint, status=status).inc()
        REQUEST_LATENCY_SECONDS.labels(endpoint=endpoint).observe(elapsed)


@app.get("/healthz")
async def healthz():
    return {
        "ok": True,
        "service": "litellm-service",
        "allowed_models": _allowed_models(),
    }


@app.get("/metrics")
async def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/v1/models")
async def list_models():
    return {"object": "list", "data": [{"id": m, "object": "model"} for m in _allowed_models()]}


def _validate_model(model: str):
    allowed = set(_allowed_models())
    if allowed and model not in allowed:
        raise HTTPException(status_code=400, detail={"error": {"message": "model not allowed", "type": "invalid_request_error"}})


def _stable_hash(payload: Any) -> str:
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()

def _safe_json(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "model_dump"):
        try:
            return value.model_dump()
        except Exception:
            return str(value)
    return value


@app.post("/v1/chat/completions")
async def chat_completions(body: Dict[str, Any] = Body(...)):
    model = body.get("model")
    if not isinstance(model, str) or not model:
        raise HTTPException(status_code=400, detail={"error": {"message": "model is required", "type": "invalid_request_error"}})
    _validate_model(model)

    selector_key = _stable_hash({"m": model, "p": {k: body.get(k) for k in ("messages", "temperature", "top_p", "max_tokens")}})
    resolved_model, api_base = _resolve_model(model, selector_key)
    params = dict(body)
    params["model"] = resolved_model
    if api_base:
        params["api_base"] = api_base
    extra_headers: Dict[str, str] = {}
    if api_base:
        extra_headers["X-Backend-Base"] = str(api_base)

    timeout_ms = int(((CONFIG.get("service") or {}).get("default_timeout_ms") or 20000))
    params.setdefault("timeout", timeout_ms / 1000.0)

    req_id = selector_key
    start = time.perf_counter()
    is_stream = params.get("stream") is True
    try:
        out = await acompletion(**params)
        latency_ms = int((time.perf_counter() - start) * 1000)

        if is_stream:
            logger.info(
                json.dumps(
                    {
                        "event": "chat_completion_stream_start",
                        "request_id": req_id,
                        "input_model": model,
                        "resolved_model": resolved_model,
                        "latency_ms": latency_ms,
                    },
                    ensure_ascii=False,
                )
            )

            async def _stream_generator():
                async for chunk in out:
                    yield f"data: {json.dumps(chunk.model_dump() if hasattr(chunk, 'model_dump') else chunk, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"

            return StreamingResponse(_stream_generator(), media_type="text/event-stream", headers=extra_headers)

        logger.info(
            json.dumps(
                {
                    "event": "chat_completion",
                    "request_id": req_id,
                    "input_model": model,
                    "resolved_model": resolved_model,
                    "latency_ms": latency_ms,
                    "usage": _safe_json(getattr(out, "usage", None)),
                },
                ensure_ascii=False,
            )
        )
        return JSONResponse(content=out.model_dump() if hasattr(out, "model_dump") else out, headers=extra_headers)
    except Exception as e:
        latency_ms = int((time.perf_counter() - start) * 1000)
        logger.error(
            json.dumps(
                {
                    "event": "chat_completion_error",
                    "request_id": req_id,
                    "input_model": model,
                    "resolved_model": resolved_model,
                    "latency_ms": latency_ms,
                    "error": str(e),
                },
                ensure_ascii=False,
            )
        )
        raise HTTPException(status_code=502, detail={"error": {"message": "upstream error", "type": "api_error"}})


@app.post("/v1/embeddings")
async def embeddings(body: Dict[str, Any] = Body(...)):
    model = body.get("model")
    if not isinstance(model, str) or not model:
        raise HTTPException(status_code=400, detail={"error": {"message": "model is required", "type": "invalid_request_error"}})
    _validate_model(model)

    selector_key = _stable_hash({"m": model, "p": {k: body.get(k) for k in ("input", "encoding_format")}})
    resolved_model, api_base = _resolve_model(model, selector_key)
    params = dict(body)
    params["model"] = resolved_model
    if api_base:
        params["api_base"] = api_base
    extra_headers: Dict[str, str] = {}
    if api_base:
        extra_headers["X-Backend-Base"] = str(api_base)

    timeout_ms = int(((CONFIG.get("service") or {}).get("default_timeout_ms") or 20000))
    params.setdefault("timeout", timeout_ms / 1000.0)

    req_id = selector_key
    start = time.perf_counter()
    try:
        out = await aembedding(**params)
        latency_ms = int((time.perf_counter() - start) * 1000)
        logger.info(
            json.dumps(
                {
                    "event": "embedding",
                    "request_id": req_id,
                    "input_model": model,
                    "resolved_model": resolved_model,
                    "latency_ms": latency_ms,
                },
                ensure_ascii=False,
            )
        )
        return JSONResponse(content=out.model_dump() if hasattr(out, "model_dump") else out, headers=extra_headers)
    except Exception as e:
        latency_ms = int((time.perf_counter() - start) * 1000)
        logger.error(
            json.dumps(
                {
                    "event": "embedding_error",
                    "request_id": req_id,
                    "input_model": model,
                    "resolved_model": resolved_model,
                    "latency_ms": latency_ms,
                    "error": str(e),
                },
                ensure_ascii=False,
            )
        )
        raise HTTPException(status_code=502, detail={"error": {"message": "upstream error", "type": "api_error"}})

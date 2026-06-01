import hashlib
import json
import time
from typing import Any, Dict, Optional, Tuple

import yaml
from fastapi import Body, FastAPI, HTTPException, Request, Response, BackgroundTasks
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from litellm import acompletion, aembedding
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from pythonjsonlogger import jsonlogger

import logging
from pathlib import Path


logger = logging.getLogger("litellm-service")
handler = logging.StreamHandler()
handler.setFormatter(jsonlogger.JsonFormatter("%(message)s %(levelname)s %(name)s %(asctime)s"))
logger.addHandler(handler)


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

def _validate_config(cfg: Dict[str, Any]) -> None:
    app_cfg = cfg.get("app") or {}
    if not isinstance(app_cfg, dict):
        raise ValueError("app must be a map")
    env = str(app_cfg.get("env") or "development").lower()
    models = cfg.get("models") or {}
    if not isinstance(models, dict) or not models:
        raise ValueError("models must be a non-empty map")
    for name, alias in models.items():
        if not isinstance(name, str) or not name.strip():
            raise ValueError("models keys must be non-empty strings")
        if not isinstance(alias, dict):
            raise ValueError(f"models['{name}'] must be a map")
        provider = alias.get("provider")
        model = alias.get("model")
        if not provider or not model:
            raise ValueError(f"models['{name}'] must include provider and model")
    if env == "production":
        providers = cfg.get("providers") or {}
        if not isinstance(providers, dict):
            raise ValueError("providers must be a map")
        placeholders = {"", "change-me", "changeme", "replace-me"}
        referenced_providers = {str(alias.get("provider")) for alias in models.values() if isinstance(alias, dict) and alias.get("provider")}
        for provider_name in referenced_providers:
            if provider_name == "ollama":
                continue
            provider_cfg = providers.get(provider_name) or {}
            if not isinstance(provider_cfg, dict):
                provider_cfg = {}
            api_key = provider_cfg.get("api_key")
            api_key_value = str(api_key).strip().lower()
            if api_key is None or api_key_value in placeholders or api_key_value.startswith("replace_with_"):
                raise ValueError(f"providers.{provider_name}.api_key must not be a placeholder in production")


def _resolve_config_path(path: str) -> str:
    if Path(path).exists():
        return path
    for fallback in (Path("config/easyai.development.yaml"), Path("../config/easyai.development.yaml")):
        if fallback.exists():
            return str(fallback)
    return path


CONFIG_PATH = _resolve_config_path("/app/config/easyai.yaml")
CONFIG = _load_config(CONFIG_PATH)
_validate_config(CONFIG)
logger.setLevel(str((CONFIG.get("app") or {}).get("log_level", "info")).upper())


def _provider_config(provider: str) -> dict:
    providers = CONFIG.get("providers") or {}
    cfg = providers.get(provider) or {}
    return cfg if isinstance(cfg, dict) else {}


def _resolve_model(input_model: str, selector_key: Optional[str] = None) -> Tuple[str, Optional[str], Optional[str]]:
    aliases = (CONFIG.get("models") or {})
    if input_model in aliases:
        alias = aliases[input_model] or {}
        provider = alias.get("provider")
        model = alias.get("model")
        provider_cfg = _provider_config(str(provider))
        api_base = alias.get("api_base") or provider_cfg.get("api_base")
        api_key = alias.get("api_key") or provider_cfg.get("api_key")
        if provider == "ollama":
            if not api_base:
                raise ValueError("providers.ollama.api_base is required for ollama provider")
            return f"ollama/{model}", api_base, None
        return f"{provider}/{model}", api_base, api_key
    return input_model, None, None


def _models() -> list[str]:
    return list((CONFIG.get("models") or {}).keys())


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
        "models": _models(),
    }


@app.get("/metrics")
async def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/v1/models")
async def list_models():
    return {"object": "list", "data": [{"id": m, "object": "model"} for m in _models()]}


def _validate_model(model: str):
    allowed = set(_models())
    if allowed and model not in allowed:
        return JSONResponse(status_code=400, content={"error": {"message": "model not allowed", "type": "invalid_request_error"}})
    return None


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


def _parse_upstream_error(e: Exception) -> Tuple[int, str]:
    err_str = str(e).lower()
    if "cancel" in err_str or "disconnect" in err_str or "abort" in err_str:
        return 499, f"Client Disconnected: The request was cancelled by the client before completion. (Details: {str(e)})"
    if "connection timed out" in err_str or "timeout" in err_str:
        return 504, f"Upstream timeout: The model took too long to respond. Please check if the model is loading or increase the timeout setting. (Details: {str(e)})"
    if "connection refused" in err_str or "all connection attempts failed" in err_str or "errno -2" in err_str or "name or service not known" in err_str:
        return 502, f"Upstream connection error: Failed to connect to upstream service. Please check if the upstream service is running. (Details: {str(e)})"
    if "not found" in err_str:
        return 404, f"Model not found: The requested model might not be pulled locally. Try running 'ollama pull <model_name>'. (Details: {str(e)})"
    if "system memory" in err_str or "out of memory" in err_str or "oom" in err_str or "allocation failed" in err_str:
        return 507, f"Insufficient memory: The system does not have enough memory to run this model. (Details: {str(e)})"
    if "internal server error" in err_str or "server error" in err_str:
        return 500, f"Upstream internal error: The model service encountered an internal error during generation. (Details: {str(e)})"
    return 502, f"Upstream error: {str(e)}"


async def _trigger_model_unload(model_name: str, api_base: Optional[str]) -> None:
    import httpx
    if not api_base:
        return
    logger.warning(f"Triggering auto-unload for model '{model_name}' due to OOM/Memory issue...")
    try:
        # According to Ollama API, setting keep_alive=0 will unload the model immediately
        async with httpx.AsyncClient() as client:
            payload = {"model": model_name.replace("ollama/", ""), "keep_alive": 0}
            await client.post(f"{api_base}/api/generate", json=payload, timeout=5.0)
        logger.info(f"Model '{model_name}' successfully unloaded to free up memory.")
    except Exception as e:
        logger.error(f"Failed to auto-unload model '{model_name}': {e}")


@app.post("/v1/chat/completions")
async def chat_completions(body: Dict[str, Any] = Body(...), background_tasks: BackgroundTasks = BackgroundTasks()):
    model = body.get("model")
    if not isinstance(model, str) or not model:
        return JSONResponse(status_code=400, content={"error": {"message": "model is required", "type": "invalid_request_error"}})
    err_resp = _validate_model(model)
    if err_resp: return err_resp

    selector_key = _stable_hash({"m": model, "p": {k: body.get(k) for k in ("messages", "temperature", "top_p", "max_tokens")}})
    resolved_model, api_base, api_key = _resolve_model(model, selector_key)
    params = dict(body)
    params["model"] = resolved_model
    if api_base:
        params["api_base"] = api_base
    if api_key:
        params["api_key"] = api_key
    extra_headers: Dict[str, str] = {}
    if api_base:
        extra_headers["X-Backend-Base"] = str(api_base)

    timeout_ms = int(((CONFIG.get("app") or {}).get("default_timeout_ms") or 120000))
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
                try:
                    async for chunk in out:
                        yield f"data: {json.dumps(chunk.model_dump() if hasattr(chunk, 'model_dump') else chunk, ensure_ascii=False)}\n\n"
                    yield "data: [DONE]\n\n"
                except Exception as stream_err:
                    logger.error(
                        json.dumps(
                            {
                                "event": "chat_completion_stream_error",
                                "request_id": req_id,
                                "input_model": model,
                                "resolved_model": resolved_model,
                                "error": str(stream_err),
                            },
                            ensure_ascii=False,
                        )
                    )
                    status_code, msg = _parse_upstream_error(stream_err)
                    if status_code == 507:
                        background_tasks.add_task(_trigger_model_unload, resolved_model, api_base)
                    
                    yield f"data: {json.dumps({'error': {'message': msg, 'type': 'api_error'}})}\n\n"
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
        status_code, msg = _parse_upstream_error(e)
        
        # Self-healing logic: If OOM detected, trigger model unload in background
        if status_code == 507:
            background_tasks.add_task(_trigger_model_unload, resolved_model, api_base)
            
        return JSONResponse(status_code=status_code, content={"error": {"message": msg, "type": "api_error"}})


@app.post("/v1/embeddings")
async def embeddings(body: Dict[str, Any] = Body(...), background_tasks: BackgroundTasks = BackgroundTasks()):
    model = body.get("model")
    if not isinstance(model, str) or not model:
        return JSONResponse(status_code=400, content={"error": {"message": "model is required", "type": "invalid_request_error"}})
    err_resp = _validate_model(model)
    if err_resp: return err_resp

    selector_key = _stable_hash({"m": model, "p": {k: body.get(k) for k in ("input", "encoding_format")}})
    resolved_model, api_base, api_key = _resolve_model(model, selector_key)
    params = dict(body)
    params["model"] = resolved_model
    if api_base:
        params["api_base"] = api_base
    if api_key:
        params["api_key"] = api_key
    extra_headers: Dict[str, str] = {}
    if api_base:
        extra_headers["X-Backend-Base"] = str(api_base)

    timeout_ms = int(((CONFIG.get("app") or {}).get("default_timeout_ms") or 120000))
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
        status_code, msg = _parse_upstream_error(e)

        # Self-healing logic: If OOM detected, trigger model unload in background
        if status_code == 507:
            background_tasks.add_task(_trigger_model_unload, resolved_model, api_base)

        return JSONResponse(status_code=status_code, content={"error": {"message": msg, "type": "api_error"}})

#!/usr/bin/env python3
"""Render a LiteLLM Proxy config from the single EasyAI YAML.

EasyAI keeps one user-facing YAML (`config/easyai.yaml`). LiteLLM (the model
access plane) needs its own `model_list` format, so we translate at container
start instead of maintaining a second config file.

Usage:
  python3 scripts/render-litellm-config.py config/easyai.development.yaml > litellm.yaml
  python3 scripts/render-litellm-config.py --print-master-key config/easyai.development.yaml
  python3 scripts/render-litellm-config.py --print-database-url config/easyai.development.yaml
  python3 scripts/render-litellm-config.py --print-salt-key config/easyai.development.yaml
"""
from __future__ import annotations

import hashlib
import sys
from typing import Any, Dict, List

import yaml

REDIS_HOST = "redis"
REDIS_PORT = 6379


def load(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}
    if not isinstance(cfg, dict):
        raise SystemExit("invalid config: expected a mapping at the top level")
    return cfg


def master_key(cfg: Dict[str, Any]) -> str:
    secrets = cfg.get("secrets") or {}
    return str(secrets.get("master_key") or secrets.get("internal_token") or "").strip()


def database_url(cfg: Dict[str, Any]) -> str:
    secrets = cfg.get("secrets") or {}
    app_cfg = cfg.get("app") or {}
    password = str(secrets.get("postgres_password") or "oneapi")
    return f"postgresql://oneapi:{password}@postgres:5432/oneapi"


def salt_key(cfg: Dict[str, Any]) -> str:
    """LiteLLM uses this to encrypt provider keys stored in its database.

    It must stay stable: rotating it makes stored credentials unreadable.
    """
    secrets = cfg.get("secrets") or {}
    explicit = str(secrets.get("salt_key") or "").strip()
    if explicit:
        return explicit
    return "sk-" + hashlib.sha256(master_key(cfg).encode("utf-8")).hexdigest()[:48]


def litellm_model(provider: str, model: str, alias: Dict[str, Any]) -> str:
    explicit = alias.get("litellm")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    provider = str(provider or "").strip()
    model = str(model or "").strip()
    if not provider:
        return model
    if model.startswith(f"{provider}/"):
        return model
    return f"{provider}/{model}"


def render_model_list(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    aliases = cfg.get("models") or {}
    providers = cfg.get("providers") or {}
    if not isinstance(aliases, dict) or not aliases:
        raise SystemExit("config error: models must be a non-empty mapping")

    out: List[Dict[str, Any]] = []
    for name, alias in aliases.items():
        if not isinstance(alias, dict):
            raise SystemExit(f"config error: models['{name}'] must be a mapping")
        provider = str(alias.get("provider") or "").strip()
        model = str(alias.get("model") or "").strip()
        if not provider or not model:
            raise SystemExit(f"config error: models['{name}'] must set provider and model")

        provider_cfg = providers.get(provider) or {}
        if not isinstance(provider_cfg, dict):
            provider_cfg = {}

        params: Dict[str, Any] = {"model": litellm_model(provider, model, alias)}
        api_base = alias.get("api_base") or provider_cfg.get("api_base")
        if api_base:
            params["api_base"] = str(api_base)
        api_key = alias.get("api_key") or provider_cfg.get("api_key")
        if api_key:
            params["api_key"] = str(api_key)
        api_version = alias.get("api_version") or provider_cfg.get("api_version")
        if api_version:
            params["api_version"] = str(api_version)

        out.append({"model_name": str(name), "litellm_params": params})
    return out


def render_fallbacks(cfg: Dict[str, Any]) -> List[Dict[str, List[str]]]:
    aliases = cfg.get("models") or {}
    fallbacks: List[Dict[str, List[str]]] = []
    for name, alias in aliases.items():
        if not isinstance(alias, dict):
            continue
        targets = alias.get("fallback")
        if isinstance(targets, str):
            targets = [targets]
        if isinstance(targets, list) and targets:
            fallbacks.append({str(name): [str(t) for t in targets]})
    return fallbacks


def render_guardrails(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    g = cfg.get("guardrails") or {}
    if not isinstance(g, dict) or not g.get("enabled"):
        return []

    params: Dict[str, Any] = {
        "guardrail": "litellm_content_filter",
        "mode": "pre_call",
        # Apply to every request, so clients do not have to opt in per call.
        "default_on": True,
    }

    keywords = g.get("blocked_keywords") or []
    if isinstance(keywords, list) and keywords:
        params["blocked_words"] = [{"keyword": str(k), "action": "BLOCK"} for k in keywords if str(k).strip()]

    mask = g.get("mask_pii") or []
    if isinstance(mask, list) and mask:
        params["patterns"] = [
            {"pattern_type": "prebuilt", "pattern_name": str(p), "action": "MASK"} for p in mask if str(p).strip()
        ]

    custom = g.get("patterns")
    if isinstance(custom, list) and custom:
        params["patterns"] = list(params.get("patterns") or []) + custom

    if len(params) <= 3:
        return []
    return [{"guardrail_name": "easyai-content-filter", "litellm_params": params}]


def render(cfg: Dict[str, Any]) -> Dict[str, Any]:
    app_cfg = cfg.get("app") or {}
    if not isinstance(app_cfg, dict):
        app_cfg = {}

    out: Dict[str, Any] = {"model_list": render_model_list(cfg)}

    guardrails = render_guardrails(cfg)
    if guardrails:
        out["guardrails"] = guardrails

    litellm_settings: Dict[str, Any] = {
        "drop_params": True,
        "num_retries": int(app_cfg.get("num_retries") or 2),
        "request_timeout": float(app_cfg.get("timeout_ms") or 120000) / 1000.0,
    }

    cache_enabled = app_cfg.get("cache_enabled", True)
    if cache_enabled:
        litellm_settings["cache"] = True
        litellm_settings["cache_params"] = {
            "type": "redis",
            "host": REDIS_HOST,
            "port": REDIS_PORT,
            "ttl": int(app_cfg.get("cache_ttl_seconds") or 60),
        }
    out["litellm_settings"] = litellm_settings

    fallbacks = render_fallbacks(cfg)
    if fallbacks:
        out["router_settings"] = {"fallbacks": fallbacks}

    out["general_settings"] = {"master_key": "os.environ/LITELLM_MASTER_KEY"}
    return out


def main(argv: List[str]) -> int:
    flags = {a for a in argv if a.startswith("--")}
    args = [a for a in argv if not a.startswith("--")]
    path = args[0] if args else "/app/config/easyai.yaml"
    cfg = load(path)

    if "--print-master-key" in flags:
        print(master_key(cfg), end="")
        return 0

    if "--print-database-url" in flags:
        print(database_url(cfg), end="")
        return 0

    if "--print-salt-key" in flags:
        print(salt_key(cfg), end="")
        return 0

    if not master_key(cfg):
        raise SystemExit("config error: secrets.master_key is required")

    sys.stdout.write(yaml.safe_dump(render(cfg), sort_keys=False, allow_unicode=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

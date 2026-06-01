# YAML Secret Management

This project keeps configuration YAML as the source of truth, but committed YAML files must not contain deployable secrets.

## Files

- `config/easyai.development.yaml`: committed development config with non-secret defaults.
- `config/easyai.production.local.yaml`: real deployment config. Ignored by Git.
- `docker-compose.local.yml`: generated Compose overrides for Postgres password and mounting the local YAML. Ignored by Git.

Development uses Compose project `easyai-dev` and volumes `easyai_dev_*`. The generated production override uses Compose project `easyai-prod` and volumes `easyai_prod_*`.

Start a private deployment config from the tracked examples:

```bash
cp config/easyai.production.example.yaml config/easyai.production.local.yaml
# Edit config/easyai.production.local.yaml and replace REPLACE_WITH_* first.
python3 scripts/render-local-compose.py config/easyai.production.local.yaml > docker-compose.local.yml
```

Rerun the render command whenever `secrets.postgres_password` changes.

## Run With Local YAML

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

The override mounts `*.local.yaml` into the containers at the same paths the services already read, so application code still uses YAML-only configuration.

## OpenAI And DeepSeek

Put provider credentials in `config/easyai.production.local.yaml`:

```yaml
providers:
  openai:
    api_key: "sk-..."
  deepseek:
    api_base: "https://api.deepseek.com/v1"
    api_key: "sk-..."

models:
  gpt:
    provider: openai
    model: gpt-4o-mini
  chat:
    provider: deepseek
    model: deepseek-chat
```

The keys under `models` are the model names clients send to `/v1/chat/completions`.

## Production Guards

`oneapi-gateway` refuses to start in production when admin passwords, API keys, internal tokens, or the database password still use placeholder/default values.

`litellm-service` refuses placeholder provider API keys when `app.env: "production"` is set.

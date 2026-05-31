#!/usr/bin/env python3
import sys
from pathlib import Path


def read_postgres_password(config_path: Path) -> str:
    in_secrets = False
    for raw in config_path.read_text(encoding="utf-8").splitlines():
        if raw.strip() == "secrets:":
            in_secrets = True
            continue
        if in_secrets and raw and not raw.startswith(" "):
            in_secrets = False
        if in_secrets and raw.lstrip().startswith("postgres_password:"):
            value = raw.split(":", 1)[1].strip()
            return value.strip("'\"")
    return ""


def main() -> int:
    config_path = Path(sys.argv[1] if len(sys.argv) > 1 else "config/easyai.local.yaml")
    if not config_path.exists():
        print(f"config file not found: {config_path}", file=sys.stderr)
        return 1

    password = read_postgres_password(config_path)
    if not password:
        print("missing secrets.postgres_password", file=sys.stderr)
        return 1

    cfg = config_path.as_posix()
    print(
        f"""name: easyai-prod

services:
  postgres:
    environment:
      POSTGRES_PASSWORD: "{password}"

  litellm:
    volumes:
      - ./{cfg}:/app/config/easyai.yaml:ro

  oneapi:
    ports: !override
      - "3003:3003"
    volumes:
      - ./{cfg}:/app/config/easyai.yaml:ro

  batch_worker:
    volumes:
      - ./{cfg}:/app/config/easyai.yaml:ro

volumes:
  postgres_data:
    name: easyai_prod_postgres_data
  ollama_data:
    name: easyai_prod_ollama_data
""",
        end="",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

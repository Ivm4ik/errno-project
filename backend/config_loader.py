import os
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent


def load_dotenv() -> None:
    """Fill missing variables from the repo .env. Does not override the process environment."""
    for path in (ROOT.parent / ".env", ROOT / ".env"):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            text = line.strip()
            if not text or text.startswith("#") or "=" not in text:
                continue
            key, value = text.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
        break


load_dotenv()


def load_yaml(name: str) -> dict:
    return yaml.safe_load((ROOT / "config" / name).read_text(encoding="utf-8"))


def db_path() -> Path:
    raw = os.environ.get("DATABASE_PATH") or os.environ.get("DATABASE_URL") or ""
    if not raw:
        return ROOT / "astrohealth.db"
    if raw.startswith("sqlite"):
        return Path(raw.split("///", 1)[-1])
    return Path(raw)


def data_dir() -> Path:
    """Where demo sandboxes live. Mount a Railway volume here to keep them across deploys."""
    raw = os.environ.get("DATA_DIR", "").strip()
    return Path(raw) if raw else ROOT / "data"


def env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def demo_mode() -> bool:
    """Demo helpers such as POST /audit/tamper. Account picking never needs it."""
    return env_bool("DEMO_MODE", True)


def env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    return default if raw is None or raw == "" else float(raw)


def metric_source(metric: dict) -> str:
    return os.environ.get(f"SOURCE_{metric['id'].upper()}") or os.environ.get(f"SOURCE_{metric['id']}") or metric["source"]

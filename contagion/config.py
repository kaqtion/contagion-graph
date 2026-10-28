"""Runtime configuration, read from environment variables (and .env / .env.local when present)."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def _load_dotenv() -> None:
    for name in (".env.local", ".env"):
        path = ROOT / name
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


def pg_url(url: str) -> str:
    """Neon/Heroku style URLs -> SQLAlchemy psycopg3 driver."""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def _database_url() -> str:
    # CG_DB=sqlite keeps local graph-building on the SQLite file even when `neon env pull` has written
    # DATABASE_URL into .env.local; scripts.sync_db then pushes the result to Neon.
    url = "" if os.getenv("CG_DB") == "sqlite" else os.getenv("DATABASE_URL", "").strip()
    if url:
        return pg_url(url)
    bundled = DATA / "contagion.db"
    if os.getenv("VERCEL"):
        # Serverless filesystem is read-only except /tmp: run from a copy of the bundled snapshot.
        tmp = Path("/tmp/contagion.db")
        if not tmp.exists() and bundled.exists():
            shutil.copy(bundled, tmp)
        return f"sqlite:///{tmp}"
    return f"sqlite:///{bundled}"


DATABASE_URL = _database_url()
IS_SQLITE = DATABASE_URL.startswith("sqlite")
# Direct (non-pooler) connection for DDL; Neon's pooler runs PgBouncer in transaction mode.
DATABASE_URL_DIRECT = (pg_url(os.environ["DATABASE_URL_UNPOOLED"])
                       if not IS_SQLITE and os.getenv("DATABASE_URL_UNPOOLED") else DATABASE_URL)

# Models. Haiku is the default everywhere to fit a small API budget; override per stage if you have more credit.
MODEL_EVENT = os.getenv("CG_MODEL_EVENT", "claude-haiku-5-5")
MODEL_EXPLAIN = os.getenv("CG_MODEL_EXPLAIN", "claude-haiku-5-5")
MODEL_EXTRACT = os.getenv("CG_MODEL_EXTRACT", "claude-haiku-5-5")

# $ per million tokens (input, output). Batch API is billed at half of these.
PRICES = {
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-opus-5-5": (4.00, 20.00),
}

# Spend guards for the public demo
DAILY_BUDGET_USD = float(os.getenv("CG_DAILY_BUDGET_USD", "0.20"))
RUNS_PER_IP_PER_HOUR = int(os.getenv("CG_RUNS_PER_IP_PER_HOUR", "8"))
DEMO_PASSCODE = os.getenv("CG_DEMO_PASSCODE", "")  # if set, live runs require it
ADMIN_TOKEN = os.getenv("CG_ADMIN_TOKEN", "")

SEC_USER_AGENT = os.getenv("SEC_USER_AGENT", "")

# Scoring parameters
HOP_DECAY = float(os.getenv("CG_HOP_DECAY", "0.5"))
MAX_HOPS = 3
BEAM_PER_HOP = 40  # partial paths kept per hop
MIN_PATH_WEIGHT = 0.02
STALE_MONTHS = 18
FRESH_MONTHS = 12
TIER_WEIGHTS = {"sole": 0.9, "major": 0.6, "minor": 0.3, "unknown": 0.3}


def llm_enabled() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))

"""Vercel Python entrypoint: exposes the FastAPI app for every /api/py/* request."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from contagion.api import app  # noqa: E402,F401

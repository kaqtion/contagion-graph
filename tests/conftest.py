import os
import tempfile
from pathlib import Path

# Point the app at a throwaway database before any contagion module is imported.
_tmp = Path(tempfile.mkdtemp()) / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}"
os.environ["ANTHROPIC_API_KEY"] = ""

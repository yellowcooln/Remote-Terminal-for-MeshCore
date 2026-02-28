"""Pytest configuration and shared fixtures."""

import os
import shutil
import tempfile
from pathlib import Path

import pytest

# Use an isolated file-backed SQLite DB for tests that import app.main/TestClient.
# This must be set before app.config/app.database are imported, otherwise the global
# Database instance will bind to the default runtime DB (data/meshcore.db).
_TEST_DB_DIR = Path(tempfile.mkdtemp(prefix="meshcore-pytest-"))
_TEST_DB_PATH = _TEST_DB_DIR / "meshcore.db"
os.environ.setdefault("MESHCORE_DATABASE_PATH", str(_TEST_DB_PATH))


@pytest.fixture(scope="session", autouse=True)
def cleanup_test_db_dir():
    """Clean up temporary pytest DB directory after the test session."""
    yield
    shutil.rmtree(_TEST_DB_DIR, ignore_errors=True)

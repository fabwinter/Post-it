"""Vercel serverless entrypoint. Exposes the existing FastAPI app from
backend/server.py as an ASGI function under /api/*.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from server import app  # noqa: E402

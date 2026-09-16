"""Tests for the Visual Studio endpoint POST /api/ai/visual."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://single-to-carousel.preview.emergentagent.com").rstrip("/")
VISUAL = f"{BASE_URL}/api/ai/visual"
TIMEOUT = 90


def _post(payload):
    return requests.post(VISUAL, json=payload, timeout=TIMEOUT)


def test_visual_quote():
    r = _post({"template": "quote", "topic": "consistency for creators"})
    assert r.status_code == 200, r.text
    data = r.json().get("data") or {}
    assert data.get("quote"), f"missing quote: {data}"
    assert data.get("author"), f"missing author: {data}"


def test_visual_tweet():
    r = _post({"template": "tweet", "topic": "consistency for creators"})
    assert r.status_code == 200, r.text
    data = r.json().get("data") or {}
    assert data.get("name")
    assert data.get("handle")
    assert data.get("text")


def test_visual_infographic():
    r = _post({"template": "infographic", "topic": "why creators fail"})
    assert r.status_code == 200, r.text
    data = r.json().get("data") or {}
    assert data.get("title")
    pts = data.get("points")
    assert isinstance(pts, list) and len(pts) >= 2, f"points invalid: {data}"


def test_visual_carousel():
    r = _post({"template": "carousel", "topic": "content batching tips", "count": 5})
    assert r.status_code == 200, r.text
    data = r.json().get("data") or {}
    assert data.get("title")
    slides = data.get("slides")
    assert isinstance(slides, list) and len(slides) >= 2, f"slides invalid: {data}"
    s0 = slides[0]
    assert s0.get("heading") and s0.get("body")


def test_visual_slideshow():
    r = _post({"template": "slideshow", "topic": "morning routine for creators", "count": 4})
    assert r.status_code == 200, r.text
    data = r.json().get("data") or {}
    assert data.get("title")
    slides = data.get("slides")
    assert isinstance(slides, list) and len(slides) >= 2

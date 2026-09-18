import json
import pathlib
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.persistence.d1 import d1_query_sync
from app.services.generations import row_to_generation
from app.services.projects import post_row, row_to_post
from app.services.templates import row_to_visual_template
from app.utils.json_utils import maybe_json
from app.utils.time import now_iso


def test_now_iso_is_utc_isoformat():
    ts = now_iso()
    assert ts.endswith("+00:00")
    assert "T" in ts


def test_maybe_json_parses_and_falls_back():
    assert maybe_json('{"a":1}', "{}") == {"a": 1}
    assert maybe_json("{invalid", "[]") == []


def test_post_row_and_row_to_post_roundtrip():
    post = {
        "id": "p1",
        "title": "T",
        "content": "C",
        "platforms": ["twitter"],
        "status": "draft",
        "scheduled_time": None,
        "media_urls": ["https://x"],
        "media_type": "image",
        "assets": [{"type": "image", "url": "https://x"}],
        "format": "single",
        "hashtags": ["#x"],
        "alt_text": "alt",
        "content_by_platform": {"twitter": "C"},
        "brand_kit_id": None,
        "music": {},
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
    }
    row_values = post_row(post)
    row = {
        "id": row_values[0],
        "title": row_values[1],
        "content": row_values[2],
        "platforms": row_values[3],
        "status": row_values[4],
        "scheduled_time": row_values[5],
        "media_urls": row_values[6],
        "media_type": row_values[7],
        "assets": row_values[8],
        "format": row_values[9],
        "hashtags": row_values[10],
        "alt_text": row_values[11],
        "content_by_platform": row_values[12],
        "brand_kit_id": row_values[13],
        "music": row_values[14],
        "created_at": row_values[15],
        "updated_at": row_values[16],
    }
    parsed = row_to_post(row)
    assert parsed["platforms"] == ["twitter"]
    assert parsed["assets"][0]["type"] == "image"
    assert parsed["hashtags"] == ["#x"]


def test_row_to_generation_normalizes_defaults():
    row = {
        "id": "g1",
        "kind": "ideate",
        "prompt": "Prompt",
        "model": "m",
        "task_id": "",
        "status": "finished",
        "files": "[]",
        "progress": None,
        "error_message": None,
        "output": "out",
        "title": None,
        "meta": '{"a":1}',
        "favorite": 1,
        "updated_at": None,
        "created_at": "2026-01-01T00:00:00+00:00",
    }
    parsed = row_to_generation(row)
    assert parsed["title"] == "Prompt"
    assert parsed["meta"] == {"a": 1}
    assert parsed["favorite"] is True
    assert parsed["updated_at"] == row["created_at"]


def test_row_to_visual_template_accepts_json_or_parsed_values():
    row = {
        "id": "t1",
        "name": "Template",
        "source_kind": "upload",
        "source_url": "https://x",
        "format": "carousel",
        "theme": "midnight",
        "colors": '{"a":"b"}',
        "slides": json.dumps([{"heading": "h"}]),
        "layouts": {},
        "bg_colors": None,
        "clips": None,
        "created_at": "2026-01-01T00:00:00+00:00",
    }
    parsed = row_to_visual_template(row)
    assert parsed["colors"] == {"a": "b"}
    assert parsed["slides"][0]["heading"] == "h"
    assert parsed["layouts"] == {}
    assert parsed["bg_colors"] == {}


def test_d1_query_sync_requires_configuration():
    with pytest.raises(HTTPException) as exc:
        d1_query_sync("SELECT 1", None, None, None, None)
    assert "Cloudflare D1 is not configured" in exc.value.detail

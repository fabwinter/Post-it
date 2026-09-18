import json
from typing import Any


def maybe_json(value: Any, default: str):
    try:
        return value if isinstance(value, (list, dict)) else json.loads(value or default)
    except Exception:
        return json.loads(default)

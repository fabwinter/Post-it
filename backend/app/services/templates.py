from app.utils.json_utils import maybe_json


def row_to_visual_template(row: dict):
    return {
        "id": row["id"], "name": row["name"], "source_kind": row["source_kind"],
        "source_url": row["source_url"], "format": row["format"], "theme": row["theme"],
        "colors": maybe_json(row.get("colors"), "{}"),
        "slides": maybe_json(row.get("slides"), "[]"),
        "layouts": maybe_json(row.get("layouts"), "{}"),
        "bg_colors": maybe_json(row.get("bg_colors"), "{}"),
        "clips": maybe_json(row.get("clips"), "{}"), "created_at": row["created_at"],
    }

import json


def row_to_generation(row: dict):
    return {
        "id": row["id"],
        "kind": row["kind"],
        "title": row.get("title") or (row.get("prompt") or "")[:80],
        "prompt": row["prompt"],
        "model": row["model"],
        "task_id": row["task_id"],
        "status": row["status"],
        "files": json.loads(row["files"] or "[]"),
        "progress": row.get("progress") or 0,
        "error_message": row.get("error_message"),
        "output": row.get("output"),
        "meta": json.loads(row.get("meta") or "{}"),
        "favorite": bool(row.get("favorite") or 0),
        "updated_at": row.get("updated_at") or row["created_at"],
        "created_at": row["created_at"],
    }

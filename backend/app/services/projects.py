import json

JSON_POST_FIELDS = ("platforms", "media_urls", "assets", "hashtags", "content_by_platform", "music")


def post_row(post: dict):
    return [
        post["id"], post.get("title") or "Untitled post", post.get("content") or "",
        json.dumps(post.get("platforms") or []), post.get("status") or "draft", post.get("scheduled_time"),
        json.dumps(post.get("media_urls") or []), post.get("media_type"),
        json.dumps(post.get("assets") or []), post.get("format") or "single",
        json.dumps(post.get("hashtags") or []), post.get("alt_text") or "",
        json.dumps(post.get("content_by_platform") or {}), post.get("brand_kit_id"),
        json.dumps(post.get("music") or {}),
        post["created_at"], post["updated_at"],
    ]


def row_to_post(row: dict):
    return {
        "id": row["id"],
        "title": row["title"],
        "content": row["content"],
        "platforms": json.loads(row["platforms"] or "[]"),
        "status": row["status"],
        "scheduled_time": row["scheduled_time"],
        "media_urls": json.loads(row["media_urls"] or "[]"),
        "media_type": row["media_type"],
        "assets": json.loads(row.get("assets") or "[]"),
        "format": row.get("format") or "single",
        "hashtags": json.loads(row.get("hashtags") or "[]"),
        "alt_text": row.get("alt_text") or "",
        "content_by_platform": json.loads(row.get("content_by_platform") or "{}"),
        "brand_kit_id": row.get("brand_kit_id"),
        "music": json.loads(row.get("music") or "{}"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }

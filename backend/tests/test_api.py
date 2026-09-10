"""Offline harness: D1 is backed by a real in-memory sqlite3 so the SQL is
genuinely validated; PoYo is faked."""
import json, os, pathlib, sqlite3, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
os.environ.update(CF_ACCOUNT_ID="a", CF_D1_DATABASE_ID="d", CF_API_TOKEN="t", POYO_API_KEY="k",
                  PEXELS_API_KEY="p", BLOB_READ_WRITE_TOKEN="b")

DB = sqlite3.connect(":memory:", check_same_thread=False)
DB.row_factory = sqlite3.Row

CHAT_REPLY = {"value": "hello"}

class Resp:
    def __init__(self, body, code=200):
        self._b, self.status_code, self.text = body, code, json.dumps(body)
        self.headers = {"content-type": "application/json"}
    def json(self): return self._b

def fake_post(url, headers=None, json=None, timeout=None, **kw):
    body = json or {}
    if "/d1/database/" in url:
        sql, params = body["sql"], body.get("params", [])
        cur = DB.cursor()
        try:
            cur.execute(sql, params)
        except sqlite3.Error as e:
            return Resp({"success": False, "errors": [str(e)]}, 200)
        rows = [dict(r) for r in cur.fetchall()] if cur.description else []
        DB.commit()
        return Resp({"success": True, "result": [{"results": rows, "meta": {}}]})
    if "/v1/chat/completions" in url or "/v1/responses" in url:
        txt = CHAT_REPLY["value"]
        if "/v1/responses" in url:
            return Resp({"data": {"output": [{"content": [{"type": "output_text", "text": txt}]}]}})
        return Resp({"data": {"choices": [{"message": {"content": txt}}]}})
    if "/api/generate/submit" in url:
        SUBMITTED.append(body)
        return Resp({"data": {"task_id": "task-123", "status": "running"}})
    raise AssertionError("unexpected POST " + url)

def fake_get(url, headers=None, timeout=None, params=None, **kw):
    if "/api/generate/status/" in url:
        return Resp({"data": {"status": "finished", "progress": 100,
                              "files": [{"file_url": "https://cdn/x.png"}]}})
    if "/v1/models" in url:
        return Resp({"data": []})
    if "api.pexels.com/v1/search" in url:
        return Resp({"total_results": 1, "photos": [{
            "id": 111, "width": 1000, "height": 1000, "url": "https://pexels.com/photo/111",
            "photographer": "Ada Lovelace", "photographer_url": "https://pexels.com/@ada",
            "src": {"large2x": "https://images.pexels.com/111-large2x.jpg", "medium": "https://images.pexels.com/111-medium.jpg"},
        }]})
    if "api.pexels.com/videos/search" in url:
        return Resp({"total_results": 1, "videos": [{
            "id": 222, "width": 1920, "height": 1080, "image": "https://images.pexels.com/222.jpg",
            "url": "https://pexels.com/video/222", "user": {"name": "Grace Hopper", "url": "https://pexels.com/@grace"},
            "video_files": [
                {"file_type": "video/mp4", "width": 640, "link": "https://videos.pexels.com/222-sd.mp4"},
                {"file_type": "video/mp4", "width": 1920, "link": "https://videos.pexels.com/222-hd.mp4"},
            ],
        }]})
    raise AssertionError("unexpected GET " + url)

BLOBS = {}
def fake_put(url, headers=None, data=None, timeout=None, **kw):
    assert "blob.vercel-storage.com" in url
    pathname = url.split("blob.vercel-storage.com/")[-1] + "-rand"
    blob_url = f"https://blob.example/{pathname}"
    BLOBS[blob_url] = data
    return Resp({"url": blob_url, "pathname": pathname, "contentType": headers.get("x-content-type")})

DELETED_BLOBS = []
def fake_delete(url, headers=None, json=None, timeout=None, **kw):
    assert url.endswith("/delete")
    DELETED_BLOBS.extend(json.get("urls", []))
    return Resp({})

SUBMITTED = []
import requests
requests.post, requests.get, requests.put, requests.delete = fake_post, fake_get, fake_put, fake_delete

import server
from fastapi.testclient import TestClient
c = TestClient(server.app)

def check(name, cond, extra=""):
    print(("PASS  " if cond else "FAIL  ") + name + ("" if cond else f"  -> {extra}"))
    if not cond: FAILS.append(name)
FAILS = []

# --- schema self-provisioning ---
r = c.get("/api/stats")
check("stats boots & provisions schema", r.status_code == 200, r.text)
tables = {r[0] for r in DB.execute("SELECT name FROM sqlite_master WHERE type='table'")}
check("all tables created", {"posts", "generations", "connections", "brand_kits"} <= tables, tables)
cols = {r[1] for r in DB.execute("PRAGMA table_info(posts)")}
check("posts has assets/format/hashtags", {"assets", "format", "hashtags"} <= cols, cols)

# --- brand kit ---
r = c.get("/api/brand-kit")
check("brand kit defaults", r.status_code == 200 and r.json()["colors"]["accent"] == "#E2FF3D", r.text)
r = c.put("/api/brand-kit", json={"name": "Acme", "voice": "dry and technical",
                                  "hashtags": ["#acme"], "banned_words": ["synergy"]})
check("brand kit saves", r.status_code == 200 and r.json()["name"] == "Acme", r.text)
r = c.get("/api/brand-kit")
check("brand kit persists", r.json()["voice"] == "dry and technical", r.text)
check("brand_prompt renders", "dry and technical" in server.brand_prompt(r.json()), server.brand_prompt(r.json()))

# --- auto-saved text generations ---
CHAT_REPLY["value"] = "1. First idea\n2. Second idea"
r = c.post("/api/ai/ideate", json={"topic": "distribution", "count": 2})
check("ideate returns ideas", r.json()["ideas"] == ["First idea", "Second idea"], r.text)
check("ideate auto-saved", bool(r.json().get("generation_id")), r.text)

CHAT_REPLY["value"] = "A great post about things."
r = c.post("/api/ai/write", json={"brief": "b", "platform": "linkedin"})
check("write auto-saved", bool(r.json().get("generation_id")), r.text)

CHAT_REPLY["value"] = '{"score": 80, "strengths": ["a"], "improvements": ["b"], "hook_rewrite": "x"}'
r = c.post("/api/ai/coach", json={"content": "draft"})
check("coach auto-saved", bool(r.json().get("generation_id")), r.text)

CHAT_REPLY["value"] = '{"title":"T","slides":[{"heading":"h","body":"b"}]}'
r = c.post("/api/ai/visual", json={"template": "carousel", "topic": "x", "count": 3})
check("visual auto-saved", bool(r.json().get("generation_id")), r.text)

r = c.get("/api/generations?group=text")
gens = r.json()
check("history lists text generations", len(gens) >= 4, len(gens))
check("history carries output", any(g["kind"] == "ideate" and "First idea" in (g["output"] or "") for g in gens), gens[:1])

gid = gens[0]["id"]
r = c.put(f"/api/generations/{gid}", json={"title": "Renamed", "favorite": True})
check("generation edit", r.json()["title"] == "Renamed" and r.json()["favorite"] is True, r.text)
check("favorite filter", len(c.get("/api/generations?favorite=true").json()) == 1, c.get("/api/generations?favorite=true").text)
check("generation delete", c.delete(f"/api/generations/{gid}").status_code == 200)
check("deleted is gone", c.get(f"/api/generations/{gid}").status_code == 404)

# --- media generation + reconcile ---
r = c.post("/api/ai/generate", json={"kind": "image", "prompt": "a cat", "options": {"model": "gpt-image-2", "use_brand": True}})
check("image submit", r.json()["task_id"] == "task-123", r.text)
check("brand palette injected into image prompt", "Colour palette" in SUBMITTED[-1]["input"]["prompt"], SUBMITTED[-1])
check("use_brand not leaked to PoYo", "use_brand" not in SUBMITTED[-1]["input"], SUBMITTED[-1])
row = DB.execute("SELECT status FROM generations WHERE task_id='task-123'").fetchone()
check("media row stored running", row["status"] == "running", dict(row))
r = c.get("/api/generations?group=media")
check("reconcile flips to finished", r.json()[0]["status"] == "finished", r.text[:200])
check("reconcile stored files", r.json()[0]["files"][0]["file_url"] == "https://cdn/x.png", r.text[:200])

# --- platform specs + build-post ---
r = c.get("/api/platform-specs")
check("platform specs", "instagram" in r.json()["platforms"], r.text[:120])

CHAT_REPLY["value"] = json.dumps({
    "format": "carousel", "title": "Ship weekly", "hook": "Consistency wins",
    "caption": "Here is why shipping weekly beats going viral.", "hashtags": ["creators", "#growth"],
    "cta": "Follow for more", "alt_text": "carousel", "why_it_works": "specific",
    "visual": {"style": "carousel", "theme": "chalkboard", "title": "Ship weekly",
               "cover_image_prompt": "a workshop bench",
               "slides": [{"heading": "H1", "body": "B1", "image_prompt": "p1"},
                          {"heading": "H2", "body": "B2"},
                          {"heading": "H3", "body": "B3"}]}})
r = c.post("/api/ai/build-post", json={"topic": "shipping weekly", "platform": "instagram", "format": "carousel", "slides": 3})
b = r.json()
check("build-post format", b["format"] == "carousel", b)
check("build-post normalises hashtags", b["hashtags"][0] == "#creators", b["hashtags"])
check("build-post merges brand hashtag", "#acme" in b["hashtags"], b["hashtags"])
check("build-post theme", b["theme"] == "chalkboard", b["theme"])
check("build-post assets = cover + slides", len(b["assets"]) == 4, [a["spec"]["template"] for a in b["assets"]])
check("cover first", b["assets"][0]["spec"]["template"] == "cover", b["assets"][0])
check("slide indices", [a["spec"]["index"] for a in b["assets"]] == [0, 1, 2, 3], b["assets"])
check("assets carry no data URLs", "data:image" not in json.dumps(b["assets"]))
check("build-post auto-saved", bool(b.get("generation_id")), b)

CHAT_REPLY["value"] = json.dumps({
    "format": "reel", "title": "R", "caption": "cap", "hashtags": [],
    "visual": {"style": "video", "theme": "midnight",
               "script": [{"scene": "s1", "on_screen_text": "T1", "voiceover": "V1", "video_prompt": "vp1"},
                          {"scene": "s2", "on_screen_text": "T2", "voiceover": "V2", "video_prompt": "vp2"}]}})
r = c.post("/api/ai/build-post", json={"topic": "x", "platform": "tiktok", "format": "reel", "slides": 3})
b = r.json()
check("reel assets are scenes", [a["type"] for a in b["assets"]] == ["scene", "scene"], b["assets"])
check("scene keeps video prompt", b["assets"][0]["spec"]["video_prompt"] == "vp1", b["assets"][0])

CHAT_REPLY["value"] = "not json at all"
r = c.post("/api/ai/build-post", json={"topic": "x", "platform": "linkedin"})
check("build-post survives non-JSON", r.status_code == 200 and r.json()["caption"] == "not json at all", r.text[:200])

# --- posts with assets ---
r = c.post("/api/posts", json={"title": "P", "content": "c", "platforms": ["instagram"],
                               "format": "carousel", "hashtags": ["#a"],
                               "assets": [{"type": "visual", "spec": {"template": "cover", "title": "T"}}]})
check("post create with assets", r.status_code == 200 and r.json()["assets"][0]["spec"]["title"] == "T", r.text[:200])
pid = r.json()["id"]
r = c.put(f"/api/posts/{pid}", json={"assets": [{"type": "visual", "spec": {"template": "slide"}}], "format": "reel"})
check("post update assets", r.json()["assets"][0]["spec"]["template"] == "slide" and r.json()["format"] == "reel", r.text[:200])
r = c.get(f"/api/posts/{pid}")
check("post round-trips assets", r.json()["assets"][0]["spec"]["template"] == "slide", r.text[:200])

# --- legacy: media library still only shows real media ---
r = c.get("/api/media")
check("media excludes text generations", all(m["task_id"] for m in r.json()), r.text[:200])

# --- template styles + restyle ---
r = c.get("/api/template-styles")
keys = [t["key"] for t in r.json()["templates"]]
check("template styles listed", set(keys) == {"hooks", "story", "listicle", "contrarian", "how_to"}, keys)
check("template styles carry display copy", all("label" in t and "desc" in t for t in r.json()["templates"]))

CHAT_REPLY["value"] = "Nobody remembers safe. Ship the ugly version today."
r = c.post("/api/ai/restyle", json={"content": "You should post consistently.", "template": "contrarian", "platform": "linkedin"})
check("restyle rewrites the draft", r.json()["content"] == "Nobody remembers safe. Ship the ugly version today.", r.text[:200])
check("restyle auto-saved", bool(r.json().get("generation_id")), r.text)
gid = r.json()["generation_id"]
saved = c.get(f"/api/generations/{gid}").json()
check("restyle recorded under its own kind", saved["kind"] == "restyle", saved)
check("restyle keeps original prompt for context", saved["prompt"] == "You should post consistently.", saved)
r = c.get("/api/generations?group=text")
check("restyle shows up in text history", any(g["kind"] == "restyle" for g in r.json()))

# --- stock media (Pexels) ---
server.PEXELS_API_KEY = None
r = c.get("/api/stock/search", params={"q": "sunset", "type": "image"})
check("stock search reports not configured", r.status_code == 500 and "not configured" in r.json()["detail"], r.text)

server.PEXELS_API_KEY = "test-key"
r = c.get("/api/stock/search", params={"q": "sunset", "type": "image"})
b = r.json()
check("stock image search", len(b["results"]) == 1 and b["results"][0]["type"] == "image", b)
check("stock image picks large url + credit", b["results"][0]["url"].endswith("large2x.jpg") and b["results"][0]["credit"] == "Ada Lovelace", b["results"][0])

r = c.get("/api/stock/search", params={"q": "ocean", "type": "video", "orientation": "portrait"})
b = r.json()
check("stock video search", len(b["results"]) == 1 and b["results"][0]["type"] == "video", b)
check("stock video prefers the hd file", b["results"][0]["url"].endswith("hd.mp4"), b["results"][0])
check("stock video carries thumbnail + credit", b["results"][0]["thumbnail"] and b["results"][0]["credit"] == "Grace Hopper", b["results"][0])

r = c.get("/api/stock/search", params={"q": "x", "type": "bogus"})
check("stock search rejects a bad type", r.status_code == 400, r.text)

# --- uploads (Vercel Blob) ---
server.BLOB_READ_WRITE_TOKEN = None
r = c.post("/api/upload", files={"file": ("photo.png", b"fakepngbytes", "image/png")})
check("upload reports not configured", r.status_code == 500 and "not configured" in r.json()["detail"], r.text)

server.BLOB_READ_WRITE_TOKEN = "test-token"
r = c.post("/api/upload", files={"file": ("my photo!!.png", b"fakepngbytes", "image/png")})
up = r.json()
check("upload stores in blob and D1", r.status_code == 200 and up["url"].startswith("https://blob.example/"), r.text)
check("upload infers kind from content-type", up["kind"] == "image", up)
check("upload sanitises the filename", up["filename"] == "my-photo-.png", up["filename"])
check("upload sends the real bytes to blob", BLOBS[up["url"]] == b"fakepngbytes")
image_upload_id = up["id"]

r = c.post("/api/upload", files={"file": ("clip.mp4", b"fakevideobytes", "video/mp4")})
video_upload = r.json()
check("upload of a video infers kind", video_upload["kind"] == "video", video_upload)

r = c.post("/api/upload", files={"file": ("empty.png", b"", "image/png")})
check("upload rejects an empty file", r.status_code == 400, r.text)

r = c.get("/api/uploads")
check("uploads list returns newest first", [u["id"] for u in r.json()][:2] == [video_upload["id"], image_upload_id], r.text[:200])
r = c.get("/api/uploads", params={"kind": "video"})
check("uploads list filters by kind", len(r.json()) == 1 and r.json()[0]["kind"] == "video", r.text[:200])

r = c.delete(f"/api/uploads/{image_upload_id}")
check("upload delete succeeds", r.status_code == 200, r.text)
check("upload delete removes the blob too", up["url"] in DELETED_BLOBS, DELETED_BLOBS)
check("deleted upload is gone from the list", all(u["id"] != image_upload_id for u in c.get("/api/uploads").json()))
r = c.delete(f"/api/uploads/{image_upload_id}")
check("deleting twice 404s", r.status_code == 404, r.text)

# --- an uploaded image as a reference for image generation ---
r = c.post("/api/ai/generate", json={
    "kind": "image", "prompt": "restyle this product shot",
    "options": {"model": "gpt-image-2", "image_urls": [video_upload["url"]]},
})
check("reference image forwarded to PoYo", SUBMITTED[-1]["input"]["image_urls"] == [video_upload["url"]], SUBMITTED[-1])

# a video model's own reference fields pass straight through untouched
r = c.post("/api/ai/generate", json={
    "kind": "video", "prompt": "animate this photo",
    "options": {"model": "seedance-2-fast", "resolution": "720p", "duration": 5, "image_urls": [video_upload["url"]]},
})
check("video image_urls (first-frame) forwarded", SUBMITTED[-1]["input"]["image_urls"] == [video_upload["url"]], SUBMITTED[-1])

# --- music mashup from two uploaded tracks ---
r = c.post("/api/ai/generate", json={
    "kind": "music", "prompt": "blend these into something upbeat",
    "options": {"reference_urls": ["https://blob.example/a.mp3", "https://blob.example/b.mp3"], "mv": "V4_5"},
})
check("mashup switches to generate-mashup", r.json()["task_id"] == "task-123" and SUBMITTED[-1]["model"] == "generate-mashup", SUBMITTED[-1])
check("mashup sends exactly the two tracks", SUBMITTED[-1]["input"]["upload_url_list"] == ["https://blob.example/a.mp3", "https://blob.example/b.mp3"])

r = c.post("/api/ai/generate", json={
    "kind": "music", "prompt": "x", "options": {"reference_urls": ["https://blob.example/only-one.mp3"]},
})
check("mashup rejects anything but exactly two tracks", r.status_code == 400, r.text)

# plain music generation (no references) still works unchanged
r = c.post("/api/ai/generate", json={"kind": "music", "prompt": "a calm piano piece", "options": {"mv": "V4_5"}})
check("plain music generation still uses generate-music", SUBMITTED[-1]["model"] == "generate-music", SUBMITTED[-1])

print("\n" + ("ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: {FAILS}"))
sys.exit(1 if FAILS else 0)

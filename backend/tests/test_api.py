"""Offline harness: D1 is backed by a real in-memory sqlite3 so the SQL is
genuinely validated; PoYo is faked."""
import io, json, os, pathlib, sqlite3, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
os.environ.update(CF_ACCOUNT_ID="a", CF_D1_DATABASE_ID="d", CF_API_TOKEN="t", POYO_API_KEY="k",
                  PEXELS_API_KEY="p", BLOB_READ_WRITE_TOKEN="b")

DB = sqlite3.connect(":memory:", check_same_thread=False)
DB.row_factory = sqlite3.Row

CHAT_REPLY = {"value": "hello"}
RAISE_TIMEOUT = {"value": False}

class Resp:
    def __init__(self, body, code=200):
        self._b, self.status_code = body, code
        if isinstance(body, bytes):
            self.content, self.text = body, ""
        elif isinstance(body, str):
            self.content, self.text = body.encode(), body
        else:
            self.text = json.dumps(body)
            self.content = self.text.encode()
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
        if RAISE_TIMEOUT["value"]:
            import requests as _requests
            raise _requests.exceptions.ReadTimeout("Read timed out. (read timeout=110)")
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
    if url in BLOBS:
        return Resp(BLOBS[url])
    if url == FAKE_WEBSITE_URL:
        return Resp(FAKE_WEBSITE_HTML)
    raise AssertionError("unexpected GET " + url)

FAKE_WEBSITE_URL = "https://example-brand.test/"
FAKE_WEBSITE_HTML = """<html><head>
<title>Acme Coffee Co.</title>
<meta name="description" content="Small-batch coffee, roasted for people who read the label.">
<meta property="og:image" content="/static/logo.png">
<style>.hero{color:#1a2b3c;background:#f5e6c8;} .cta{font-family: 'Poppins', sans-serif;}</style>
</head><body>
<p>We roast in small batches every Tuesday. No jargon, no nonsense — just really good coffee
made by people who care about where it comes from and who it reaches.</p>
</body></html>"""

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

# --- brand kits (multiple, named, one default) ---
# Acme ends this block back as the default kit — later tests (brand hashtag
# merge, palette injection) expect it active, same as when this was a
# singleton.
r = c.get("/api/brand-kits")
check("brand kits default list", r.status_code == 200 and len(r.json()) == 1
      and r.json()[0]["colors"]["dark"]["accent"] == "#E2FF3D" and r.json()[0]["color_mode"] == "dark", r.text)

r = c.post("/api/brand-kits", json={"name": "Acme", "voice": "dry and technical",
                                     "hashtags": ["#acme"], "banned_words": ["synergy"]})
check("brand kit creates and becomes default (first kit)", r.status_code == 200 and r.json()["name"] == "Acme" and r.json()["is_default"] is True, r.text)
acme_id = r.json()["id"]
r = c.get(f"/api/brand-kits/{acme_id}")
check("brand kit persists", r.json()["voice"] == "dry and technical", r.text)
check("brand_prompt renders", "dry and technical" in server.brand_prompt(r.json()), server.brand_prompt(r.json()))

r = c.post("/api/brand-kits", json={"name": "Side project"})
check("second brand kit creates, not default", r.status_code == 200 and r.json()["is_default"] is False, r.text)
side_id = r.json()["id"]
r = c.get("/api/brand-kits")
check("brand kits list has both, default first", len(r.json()) == 2 and r.json()[0]["id"] == acme_id, r.text)

r = c.put(f"/api/brand-kits/{side_id}", json={"is_default": True})
check("set-default switches it", r.status_code == 200 and r.json()["is_default"] is True, r.text)
r = c.get(f"/api/brand-kits/{acme_id}")
check("old default is demoted", r.json()["is_default"] is False, r.text)

r = c.put(f"/api/brand-kits/{acme_id}", json={"is_default": True, "color_mode": "light", "colors": {"light": {"bg": "#FFFFFF"}}})
check("color_mode switches, light palette merges without clobbering dark, and default moves back",
      r.json()["color_mode"] == "light" and r.json()["colors"]["light"]["bg"] == "#FFFFFF"
      and r.json()["colors"]["dark"]["accent"] == "#E2FF3D" and r.json()["is_default"] is True, r.text)

r = c.get("/api/brand-kits/does-not-exist")
check("unknown brand kit 404s", r.status_code == 404, r.text)

r = c.delete(f"/api/brand-kits/{side_id}")
check("delete a non-default kit", r.status_code == 200, r.text)
r = c.get("/api/brand-kits")
check("acme remains, still the default", len(r.json()) == 1 and r.json()[0]["id"] == acme_id and r.json()[0]["is_default"] is True, r.text)

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

# --- a PoYo timeout must surface as a clean 504, never a raw exception string ---
RAISE_TIMEOUT["value"] = True
r = c.post("/api/ai/build-post", json={"topic": "x", "platform": "instagram"})
RAISE_TIMEOUT["value"] = False
check("PoYo timeout returns 504", r.status_code == 504, r.text)
check("timeout detail is a clean message, not a raw exception repr", "ReadTimeout" not in r.json()["detail"] and "didn't respond" in r.json()["detail"], r.text)

# --- brand kit: logo upload + a style field ---
r = c.post("/api/upload", files={"file": ("logo.png", b"fakepngbytes", "image/png")})
logo_upload = r.json()
r = c.post("/api/brand-kits", json={"name": "Logo test kit"})
logo_kit_id = r.json()["id"]
r = c.put(f"/api/brand-kits/{logo_kit_id}", json={"logo_url": logo_upload["url"], "style": "Minimal, high-contrast, lots of negative space."})
check("brand kit accepts a logo_url and a style field", r.json()["logo_url"] == logo_upload["url"] and "negative space" in r.json()["style"], r.text[:200])
r = c.get(f"/api/brand-kits/{logo_kit_id}")
check("brand kit style persists", "negative space" in r.json()["style"], r.text[:200])
check("brand_prompt includes style", "Visual style" in server.brand_prompt(r.json()))

# --- brand kit analysis: image (real pixel colors, no AI) ---
from PIL import Image as _Image
buf = io.BytesIO()
img = _Image.new("RGB", (40, 20))
for x in range(40):
    for y in range(20):
        img.putpixel((x, y), (10, 10, 10) if x < 20 else (226, 255, 61))  # half dark, half lime
img.save(buf, format="PNG")
r = c.post("/api/upload", files={"file": ("brandimg.png", buf.getvalue(), "image/png")})
img_upload = r.json()

r = c.post("/api/brand-kit/analyze", json={"source_type": "image", "source_url": img_upload["url"]})
b = r.json()
check("image analysis extracts real colors", set(b["colors"].keys()) == {"bg", "fg", "accent", "sub"}, b["colors"])
check("image analysis colors are actually the two pixel colors", set(b["colors"].values()) <= {"#0a0a0a", "#e2ff3d"}, b["colors"])
check("image analysis sets logo_url to the image itself", b["logo_url"] == img_upload["url"], b)
check("image analysis is honest about not reading fonts/voice", "can't be read from a picture" in b["source_note"], b["source_note"])
check("brand analysis auto-saved", bool(b.get("generation_id")), b)

# --- brand kit analysis: SVG (real markup parsing, no AI) ---
svg_bytes = b"""<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
<rect width="100" height="100" fill="#1a2b3c"/><circle cx="50" cy="50" r="30" fill="#ffcc00"/>
<text font-family="Poppins, sans-serif" fill="#ffffff">Acme</text></svg>"""
r = c.post("/api/upload", files={"file": ("logo.svg", svg_bytes, "image/svg+xml")})
svg_upload = r.json()
r = c.post("/api/brand-kit/analyze", json={"source_type": "svg", "source_url": svg_upload["url"]})
b = r.json()
check("svg analysis finds real hex colors", "#1a2b3c" in b["colors"].values(), b["colors"])
check("svg analysis finds the real font-family", b["fonts"]["display"] == "Poppins", b["fonts"])
check("svg analysis sets logo_url to the svg itself", b["logo_url"] == svg_upload["url"])

# --- brand kit analysis: PDF (real text extraction feeds a text-only AI call) ---
minimal_pdf = (
    b"%PDF-1.4\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n"
    b"2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n"
    b"3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] "
    b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>endobj\n"
    b"4 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n"
    b"5 0 obj<< /Length 60 >>\nstream\nBT /F1 18 Tf 10 100 Td (Bold modern coffee brand) Tj ET\nendstream\nendobj\n"
    b"xref\n0 6\n0000000000 65535 f \n"
    b"trailer<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF"
)
r = c.post("/api/upload", files={"file": ("deck.pdf", minimal_pdf, "application/pdf")})
pdf_upload = r.json()
CHAT_REPLY["value"] = '{"voice": "Direct, technical, confident.", "style": "Bold and modern.", "suggested_name": "Acme"}'
r = c.post("/api/brand-kit/analyze", json={"source_type": "pdf", "source_url": pdf_upload["url"]})
b = r.json()
check("pdf analysis infers voice from real extracted text", b["voice"] == "Direct, technical, confident.", b)
check("pdf analysis infers a suggested name", b["detected_name"] == "Acme", b)
check("pdf source_note mentions page count", "1-page" in b["source_note"] or "1 page" in b["source_note"], b["source_note"])

# --- brand kit analysis: URL (real page fetch, regex colors, text-only AI) ---
CHAT_REPLY["value"] = '{"voice": "Warm, unpretentious, a little wry.", "style": "Earthy and handcrafted.", "suggested_name": "Acme Coffee Co."}'
r = c.post("/api/brand-kit/analyze", json={"source_type": "url", "source_url": FAKE_WEBSITE_URL})
b = r.json()
check("url analysis reads real page colors", "#1a2b3c" in b["colors"].values(), b["colors"])
check("url analysis reads a real font-family from CSS", b["fonts"]["display"] == "Poppins", b["fonts"])
check("url analysis resolves a relative og:image to an absolute logo_url", b["logo_url"] == "https://example-brand.test/static/logo.png", b["logo_url"])
check("url analysis infers voice from the real page text", "wry" in b["voice"], b)

r = c.post("/api/brand-kit/analyze", json={"source_type": "bogus", "source_url": "x"})
check("brand analysis rejects a bad source_type", r.status_code == 400, r.text)

# --- templates from a file: PPTX (real per-slide text, abstracted by AI) ---
from pptx import Presentation as _Presentation
pptx_buf = io.BytesIO()
prs = _Presentation()
layout = prs.slide_layouts[1]
s1 = prs.slides.add_slide(layout)
s1.shapes.title.text = "Why consistency wins"
s1.placeholders[1].text_frame.text = "Most people quit in week 6."
s2 = prs.slides.add_slide(layout)
s2.shapes.title.text = "The 20-week curve"
s2.placeholders[1].text_frame.text = "Growth looks flat until it doesn't."
prs.save(pptx_buf)
r = c.post("/api/upload", files={"file": ("deck.pptx", pptx_buf.getvalue(),
                                          "application/vnd.openxmlformats-officedocument.presentationml.presentation")})
pptx_upload = r.json()

CHAT_REPLY["value"] = '{"slides": [{"heading": "State the core claim", "body": "Name the timeframe when most people quit."}, {"heading": "Show the payoff curve", "body": "Describe what changes once you push past that point."}]}'
r = c.post("/api/templates/from-file", json={"source_type": "pptx", "source_url": pptx_upload["url"], "name": "Consistency deck"})
tpl = r.json()
check("pptx template has the right slide count", len(tpl["slides"]) == 2, tpl["slides"])
check("pptx template slides are abstracted, not the deck's literal words", tpl["slides"][0]["heading"] == "State the core claim", tpl["slides"])
check("pptx template format defaults to carousel", tpl["format"] == "carousel", tpl)
pptx_template_id = tpl["id"]

# --- templates from a file: PDF (falls back to real text if AI abstraction misbehaves) ---
CHAT_REPLY["value"] = "not valid json"
r = c.post("/api/templates/from-file", json={"source_type": "pdf", "source_url": pdf_upload["url"]})
tpl = r.json()
check("pdf template falls back to the real page text when AI output can't be parsed", tpl["slides"][0]["heading"] == "Page 1", tpl["slides"])

# --- templates from a file: image (palette only, no slides) ---
r = c.post("/api/templates/from-file", json={"source_type": "image", "source_url": img_upload["url"]})
tpl = r.json()
check("image template has no slide structure", tpl["slides"] == [], tpl)
check("image template format is single", tpl["format"] == "single", tpl)
check("image template carries the real extracted palette", set(tpl["colors"].values()) <= {"#0a0a0a", "#e2ff3d"}, tpl["colors"])

r = c.get("/api/templates/custom")
check("custom templates list returns saved templates", len(r.json()) == 3, len(r.json()))

r = c.delete(f"/api/templates/custom/{pptx_template_id}")
check("custom template delete succeeds", r.status_code == 200, r.text)
check("deleted template is gone from the list", all(t["id"] != pptx_template_id for t in c.get("/api/templates/custom").json()))
r = c.delete(f"/api/templates/custom/{pptx_template_id}")
check("deleting twice 404s", r.status_code == 404)

r = c.post("/api/templates/from-file", json={"source_type": "bogus", "source_url": "x"})
check("templates-from-file rejects a bad source_type", r.status_code == 400, r.text)

# --- build-post follows a saved template's outline ---
remaining = c.get("/api/templates/custom").json()
image_template_id = next(t["id"] for t in remaining if t["source_kind"] == "image")
r = c.post("/api/ai/build-post", json={"topic": "y", "platform": "instagram", "custom_template_id": "does-not-exist"})
check("build-post 404s on an unknown template id", r.status_code == 404, r.text)

CHAT_REPLY["value"] = json.dumps({
    "format": "single", "title": "T", "caption": "c", "hashtags": [], "visual": {"style": "quote"},
})
r = c.post("/api/ai/build-post", json={"topic": "why coffee matters", "platform": "instagram", "custom_template_id": image_template_id})
b = r.json()
check("build-post with an image template uses the template's theme", b["theme"] == "midnight", b)

print("\n" + ("ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: {FAILS}"))
sys.exit(1 if FAILS else 0)

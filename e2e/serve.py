"""Local end-to-end stack: real backend + real built frontend, with D1 backed by
sqlite and PoYo faked so no network or keys are needed."""
import json, math, os, re, sqlite3, struct, sys, threading, time, itertools, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
sys.path.insert(0, os.path.join(ROOT, "backend"))
os.environ.update(CF_ACCOUNT_ID="a", CF_D1_DATABASE_ID="d", CF_API_TOKEN="t", POYO_API_KEY="k", PEXELS_API_KEY="p", BLOB_READ_WRITE_TOKEN="b", ALLOW_LOOPBACK_FETCH="1")
_DB_DIR = os.environ.get("E2E_RUN_DIR") or tempfile.mkdtemp(prefix="createos-e2e-")
os.makedirs(_DB_DIR, exist_ok=True)
DB = sqlite3.connect(os.path.join(_DB_DIR, "e2e.db"), check_same_thread=False); DB.row_factory = sqlite3.Row
LOCK = threading.Lock()

PLAN = {
    "format": "carousel", "title": "Ship weekly", "hook": "Consistency beats virality",
    "caption": "Nobody remembers the post that went viral. They remember the person who kept showing up.",
    "hashtags": ["#buildinpublic", "#creators"], "cta": "Follow for the weekly log",
    "alt_text": "carousel about shipping", "why_it_works": "specificity",
    "visual": {"style": "carousel", "theme": "chalkboard", "title": "Ship weekly",
               "cover_image_prompt": "a lit workshop bench at dawn",
               "slides": [{"heading": "Week 1", "body": "You publish. Nobody claps.", "image_prompt": "empty room"},
                          {"heading": "Week 6", "body": "Three people reply. One is real.", "image_prompt": "three chairs"},
                          {"heading": "Week 20", "body": "The compounding starts.", "image_prompt": "a rising line"}]}}
REEL = {"format": "reel", "title": "Ship weekly", "caption": "Week 6 is where everyone quits.",
        "hashtags": ["#buildinpublic"], "cta": "Follow",
        "visual": {"style": "video", "theme": "midnight",
                   "script": [{"scene": "hands on a keyboard", "on_screen_text": "Week 1", "voiceover": "You publish. Nobody claps.", "video_prompt": "close-up hands typing at dawn"},
                              {"scene": "empty inbox", "on_screen_text": "Week 6", "voiceover": "Three people reply.", "video_prompt": "an inbox with three unread"},
                              {"scene": "a rising line", "on_screen_text": "Week 20", "voiceover": "It compounds.", "video_prompt": "a chart line rising over a city"}]}}
SINGLE = {"format": "single", "title": "Coffee at dawn", "hook": "The first cup is the only meeting that matters",
          "caption": "Nobody talks about the quiet hour before the day starts.", "hashtags": ["#morningroutine"],
          "cta": "Save this for tomorrow", "alt_text": "a warm coffee shop at dawn", "why_it_works": "specificity",
          "visual": {"style": "photo", "theme": "midnight", "title": "Coffee at dawn",
                     "cover_image_prompt": "a warm coffee shop at dawn, steam rising from a cup"}}
IDEAS = "1. Why consistency beats virality\n2. The 20-week compounding curve\n3. What nobody tells you about week 6"

# A real, decodable WAV — silent, but a browser plays and probes it exactly
# like a real recorded take, which is the point: the reel-voice feature is
# supposed to size each scene from the ACTUAL duration of its take, and a
# fake that always returned the same file couldn't tell that logic apart
# from one that just kept the old flat default.
def _wav_bytes(seconds, rate=8000, freq=440.0):
    n = max(1, int(rate * seconds))
    # An actual tone, not silence. This used to be n frames of \x00 — a valid
    # WAV of nothing at all — which meant no test could ever tell a reel whose
    # voiceover and score reached the exported file from one whose didn't, and
    # a silent export shipped. Same blind spot the 14-byte clip.mp4 had.
    data = b"".join(
        struct.pack("<h", int(12000 * math.sin(2 * math.pi * freq * i / rate)))
        for i in range(n)
    )
    block_align = 2
    return struct.pack(
        "<4sI4s4sIHHIIHH4sI", b"RIFF", 36 + len(data), b"WAVE",
        b"fmt ", 16, 1, 1, rate, rate * block_align, block_align, 16,
        b"data", len(data),
    ) + data

# task_id -> the file_url its /api/generate/status poll should answer with,
# for jobs where that has to vary per submission (voice, so far) rather than
# the one static /e2e-asset.png every other kind is happy to share.
TASK_FILES = {}

# task_id -> a fake ElevenLabs-shaped character alignment, for a voice
# generation that asked for timestamps=true. Structurally the real API's
# shape (parallel characters/start/end arrays) so the frontend's real
# alignment-parsing path gets exercised, even though the timing itself is
# just spread evenly across characters rather than phoneme-accurate.
TASK_ALIGNMENT = {}

class Resp:
    def __init__(s, b, c=200, content_type=None, headers=None):
        s.status_code = c
        if isinstance(b, (bytes, bytearray)):
            s._b, s.content = None, bytes(b)
            s.text = s.content.decode("utf-8", "replace")
            s.headers = {"content-type": content_type or "application/octet-stream"}
        else:
            s._b, s.text = b, json.dumps(b)
            s.content = s.text.encode()
            s.headers = {"content-type": content_type or "application/json"}
        if headers:
            s.headers = {**s.headers, **headers}
        # _safe_get (server.py's SSRF-safe fetch) reads these to walk
        # redirects itself; every fake response here is a real 200/error,
        # never a redirect, so both are always false.
        s.is_redirect = False
        s.is_permanent_redirect = False
    def json(s): return s._b
    def close(s): pass
    def iter_content(s, chunk_size=65536):
        for i in range(0, len(s.content), chunk_size):
            yield s.content[i:i + chunk_size]

def fake_post(url, headers=None, json=None, timeout=None, **kw):
    b = json or {}
    if "/d1/database/" in url:
        with LOCK:
            cur = DB.cursor()
            try: cur.execute(b["sql"], b.get("params", []))
            except sqlite3.Error as e: return Resp({"success": False, "errors": [str(e)]})
            rows = [dict(r) for r in cur.fetchall()] if cur.description else []
            DB.commit()
        return Resp({"success": True, "result": [{"results": rows, "meta": {}}]})
    if "/chat/completions" in url or "/v1/responses" in url:
        msgs = b.get("messages") or b.get("input") or []
        sysmsg = " ".join(m.get("content", "") for m in msgs if m.get("role") == "system")
        if "social creative director" in sysmsg:
            plan = REEL if 'Use format "reel"' in sysmsg else SINGLE if 'Use format "single"' in sysmsg else PLAN
            txt = __import__("json").dumps(plan)
        elif "ideator" in sysmsg: txt = IDEAS
        elif "coach" in sysmsg: txt = '{"score": 72, "strengths": ["clear hook"], "improvements": ["cut the last line"], "hook_rewrite": "Week 6 is where everyone quits."}'
        elif "elite editor" in sysmsg: txt = "Nobody remembers safe. Ship the ugly version today."
        # Saving a deck as a design normally reworks its copy into generic
        # instructions, so the design is reusable for a new topic. Answering
        # that for real (rather than letting the unparseable default fall
        # back to the literal text) is what lets the suite tell the two
        # apart: a carousel design should come back abstracted, a reel
        # design should come back word-for-word.
        elif "reusable content template" in sysmsg:
            usermsg = " ".join(m.get("content", "") for m in msgs if m.get("role") == "user")
            n = len(re.findall(r"Slide \d+:", usermsg)) or 1
            # `json` is this function's own request-body parameter, not the
            # module — same reason the plan branch above reaches for it this way.
            txt = __import__("json").dumps({"slides": [{"heading": "ABSTRACTED", "body": "ABSTRACTED"} for _ in range(n)]})
        elif "carousel" in sysmsg or "infographic" in sysmsg or "quote" in sysmsg or "tweet" in sysmsg:
            txt = '{"quote":"Consistency compounds.","author":"CreateOS","title":"Ship weekly","points":["a","b","c"],"name":"Creator","handle":"@creator","text":"tweet text","slides":[{"heading":"H1","body":"B1"},{"heading":"H2","body":"B2"},{"heading":"H3","body":"B3"}]}'
        else: txt = "Here is a post about shipping weekly. It compounds."
        if "/v1/responses" in url:
            return Resp({"data": {"output": [{"content": [{"type": "output_text", "text": txt}]}]}})
        return Resp({"data": {"choices": [{"message": {"content": txt}}]}})
    if "/api/generate/submit" in url:
        task_id = f"task-{next(COUNTER)}"
        model = b.get("model") or ""
        if "elevenlabs" in model or "tts" in model:
            input_payload = b.get("input") or {}
            text = input_payload.get("text") or ""
            # ~2.5 spoken words/sec, the same rough rate the plan's own
            # timing math uses — different lines really do come back as
            # different lengths, not one fixed "voice clip" duration.
            seconds = max(0.5, min(14.0, len(text.split()) / 2.5))
            file_url = f"/e2e-voice-{task_id}.wav"
            BLOB_STORE[f"http://127.0.0.1:8123{file_url}"] = _wav_bytes(seconds, freq=440.0)
            TASK_FILES[task_id] = file_url
            if input_payload.get("timestamps") and text:
                chars = list(text)
                n = len(chars)
                per = seconds / n
                TASK_ALIGNMENT[task_id] = {
                    "characters": chars,
                    "character_start_times_seconds": [round(i * per, 4) for i in range(n)],
                    "character_end_times_seconds": [round((i + 1) * per, 4) for i in range(n)],
                }
        elif "generate-music" in model or "generate-mashup" in model:
            # PoYo's own docs for generate-music: instrumental=true needs
            # custom_mode=true with style+title ("other parameters should be
            # left empty" in non-custom mode) — a real production run once
            # hit exactly this by sending custom_mode=false with
            # instrumental=true. Enforced here so a regression fails loudly
            # in this suite instead of only in production.
            music_input = b.get("input") or {}
            if music_input.get("instrumental") and not music_input.get("custom_mode"):
                return Resp({"code": 400, "message": "instrumental=true requires custom_mode=true"}, 400)
            if music_input.get("custom_mode") and not (music_input.get("style") and music_input.get("title")):
                return Resp({"code": 400, "message": "custom_mode=true requires style and title"}, 400)
            file_url = f"/e2e-music-{task_id}.wav"
            BLOB_STORE[f"http://127.0.0.1:8123{file_url}"] = _wav_bytes(8.0, freq=220.0)
            TASK_FILES[task_id] = file_url
        return Resp({"data": {"task_id": task_id, "status": "running"}})
    return Resp({"error": "unhandled"}, 500)

COUNTER = itertools.count(1)
def fake_get(url, headers=None, timeout=None, params=None, **kw):
    if url in BLOB_STORE:
        # A real proxied fetch gets back whatever content-type the origin
        # actually served — matched here by extension so /proxy-image's own
        # content-type handling (image/video/audio) is exercised faithfully
        # rather than everything looking like application/octet-stream.
        ext = os.path.splitext(url)[1].lower()
        return Resp(BLOB_STORE[url], content_type=MIME.get(ext, "application/octet-stream"))
    # requests.get is monkey-patched process-wide, so the backend's OWN
    # outgoing fetches (uploads/from-url, proxy-image, _safe_get generally)
    # land here too, never touching the real network — this is what makes a
    # server-side "download this stock pick" actually get real bytes back
    # instead of the SPA catch-all's index.html.
    if url == "http://127.0.0.1:8123/e2e-asset.png":
        return Resp(open(os.path.join(FIXTURES, "stock_photo.png"), "rb").read(), content_type="image/png")
    if url == "http://127.0.0.1:8123/e2e-video.mp4":
        return Resp(open(os.path.join(FIXTURES, "clip.webm"), "rb").read(), content_type="video/webm")
    # The Music Series isn't queried through the generic status endpoint —
    # PoYo's docs give it its own "Query Music Detail" endpoint, task_id as
    # a query param, and audio_url instead of file_url. Faked distinctly so
    # the backend's kind-aware routing (and its audio_url -> file_url
    # normalization) is actually exercised rather than accidentally passing
    # against the generic handler's shape.
    if "/api/generate/detail/music" in url:
        task_id = (params or {}).get("task_id")
        file_url = TASK_FILES.get(task_id, "/e2e-asset.png")
        return Resp({"data": {
            "task_id": task_id, "status": "finished", "credits_amount": 8, "progress": 100,
            "files": [{"audio_id": task_id, "audio_url": file_url, "title": "Score", "tags": "", "duration": 8, "prompt": ""}],
            "created_time": "2026-01-01T00:00:00", "error_message": None,
        }})
    if "/api/generate/status/" in url:
        task_id = url.rstrip("/").rsplit("/", 1)[-1]
        file_url = TASK_FILES.get(task_id, "/e2e-asset.png")
        data = {"status": "finished", "progress": 100, "files": [{"file_url": file_url}]}
        if task_id in TASK_ALIGNMENT:
            data["normalized_alignment"] = TASK_ALIGNMENT[task_id]
        return Resp({"data": data})
    if "/v1/models" in url: return Resp({"data": []})
    if "api.pexels.com/v1/search" in url:
        page = int((params or {}).get("page") or 1)
        pid = 110 + page
        # Absolute (loopback) URLs, not relative ones: the browser renders
        # either fine, but a real Pexels response is always absolute, and a
        # server-side download (see /api/uploads/from-url) needs a real
        # host+scheme to fetch at all.
        return Resp({"total_results": 3, "photos": [{
            "id": pid, "width": 1000, "height": 1000, "url": f"https://pexels.com/photo/{pid}",
            "photographer": "Ada Lovelace", "photographer_url": "https://pexels.com/@ada",
            "src": {"large2x": "http://127.0.0.1:8123/e2e-asset.png", "medium": "http://127.0.0.1:8123/e2e-asset.png"},
        }]})
    if "api.pexels.com/videos/search" in url:
        return Resp({"total_results": 1, "videos": [{
            "id": 222, "width": 1920, "height": 1080, "image": "http://127.0.0.1:8123/e2e-asset.png",
            "url": "https://pexels.com/video/222", "user": {"name": "Grace Hopper", "url": "https://pexels.com/@grace"},
            "video_files": [{"file_type": "video/mp4", "width": 1920, "link": "http://127.0.0.1:8123/e2e-video.mp4"}],
        }]})
    return Resp({"data": {}})

BLOB_COUNTER = itertools.count(1)
BLOB_STORE = {}

# A deliberately cross-origin-looking fixture (real fixtures all live under
# 127.0.0.1:8123, same-origin with the app itself, so the frontend's own
# proxied() helper skips routing them through /proxy-image at all) — the
# one way to actually exercise that endpoint's content-type handling for
# audio, the way a real voiceover or score URL (always a different origin)
# does during export.
BLOB_STORE["http://poyo-storage.e2e-fixture.test/voice-check.wav"] = _wav_bytes(1.0)

def fake_put(url, headers=None, data=None, timeout=None, **kw):
    n = next(BLOB_COUNTER)
    ct = (headers or {}).get("x-content-type", "")
    name = url.split("blob.vercel-storage.com/")[-1].split("/")[-1]
    stem, ext = os.path.splitext(name)
    if not ext:
        ext = ".mp3" if ct.startswith("audio") else ".mp4" if ct.startswith("video") else \
              ".pdf" if ct == "application/pdf" else ".svg" if "svg" in ct else \
              ".pptx" if "presentation" in ct else ".png"
    # Real Blob URLs are absolute and keep the original filename with a random
    # suffix wedged in before the extension — the backend re-fetches uploads by
    # URL (brand analysis, file-to-template, knowledge ingest), and derives a
    # default title from that filename, so both have to be faithful.
    blob_url = f"http://127.0.0.1:8123/{stem or 'e2e-upload'}-{n:04d}c3f9a1b7d2e6{ext}"
    BLOB_STORE[blob_url] = bytes(data) if data else b""
    return Resp({"url": blob_url, "pathname": url.split("blob.vercel-storage.com/")[-1]})

def fake_delete(url, headers=None, json=None, timeout=None, **kw):
    return Resp({})

import requests
requests.post, requests.get, requests.put, requests.delete = fake_post, fake_get, fake_put, fake_delete
import server
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
BUILD = os.path.join(ROOT, "frontend", "build")
server.app.mount("/static", StaticFiles(directory=f"{BUILD}/static"), name="static")

MIME = {".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf",
        ".mp4": "video/mp4", ".webm": "video/webm", ".png": "image/png", ".jpg": "image/jpeg",
        ".wav": "audio/wav", ".svg": "image/svg+xml"}

@server.app.get("/{full_path:path}")
async def spa(full_path: str):
    # Blob storage is faked in-process, but the BROWSER fetches uploads back
    # over HTTP like it would in production — without this they fell through
    # to the SPA's index.html and an uploaded font quietly failed to decode.
    from fastapi.responses import Response as _R
    url = f"http://127.0.0.1:8123/{full_path}"
    if url in BLOB_STORE:
        ext = os.path.splitext(full_path)[1].lower()
        return _R(BLOB_STORE[url], media_type=MIME.get(ext, "application/octet-stream"),
                  headers={"Access-Control-Allow-Origin": "*"})
    # A stock pick's "download" url (see the pexels fake above) needs to be
    # a real, fetchable file — both for the browser <img>/<video> tag AND for
    # a server-side fetch (uploads/from-url) — which frontend/build never
    # contains since it's a stock-media fixture, not a build artifact.
    if full_path in ("e2e-asset.png", "e2e-video.mp4"):
        # A real, colorful photo (not the 1x1 black photo.png used for
        # lightweight upload-flow tests elsewhere) — anything that actually
        # samples pixels from a "stock photo" pick needs real content to see.
        # Pexels only ever lists mp4 and the backend filters on that, so the
        # link keeps the .mp4 name — but the bytes are a real, decodable webm
        # recorded by Chromium itself (see make-fixture-clip.js), served under
        # its true content-type. The browser plays what it is told it is
        # getting, not what the path is called, and a fixture that actually
        # decodes is the whole point: the 14-byte placeholder this replaced
        # meant no export ever composited real footage.
        if full_path.endswith(".png"):
            return FileResponse(os.path.join(FIXTURES, "stock_photo.png"), media_type="image/png")
        return FileResponse(os.path.join(FIXTURES, "clip.webm"), media_type="video/webm")
    if full_path == "e2e-logo.svg":
        # Deliberately has NO width/height on the root — only a viewBox, which
        # is a perfectly valid SVG and exactly how a lot of real logo exports
        # (Figma, Illustrator "responsive" exports) come out. Chrome reports
        # naturalWidth/naturalHeight as 0 for an <img> pointed at one of these
        # even though it decodes and paints fine, which is the case that
        # falsely flagged a real brand logo as "failed to load" and dropped
        # it from the PNG export (cardExport.js's imageSettled/decode() path).
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
            '<rect width="100" height="100" fill="#ff3366"/>'
            '<circle cx="50" cy="50" r="35" fill="#22cc88"/>'
            '</svg>'
        )
        from fastapi.responses import Response as _R
        return _R(svg, media_type="image/svg+xml")
    f = os.path.join(BUILD, full_path)
    if full_path and os.path.isfile(f): return FileResponse(f)
    return FileResponse(os.path.join(BUILD, "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(server.app, host="127.0.0.1", port=8123, log_level="warning")

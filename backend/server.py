from fastapi import FastAPI, APIRouter, HTTPException, Request
from fastapi.responses import Response, JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import asyncio
import json
import re
import logging
import requests
import xml.etree.ElementTree as ET
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

CF_ACCOUNT_ID = os.environ.get('CF_ACCOUNT_ID')
CF_D1_DATABASE_ID = os.environ.get('CF_D1_DATABASE_ID')
CF_API_TOKEN = os.environ.get('CF_API_TOKEN')

POYO_API_KEY = os.environ.get('POYO_API_KEY')
POYO_BASE_URL = os.environ.get('POYO_BASE_URL', 'https://api.poyo.ai')

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled error on {request.method} {request.url.path}")
    return JSONResponse(status_code=500, content={"detail": f"{type(exc).__name__}: {exc}"})


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# ---------------- Cloudflare D1 client (HTTP query API, run in threadpool) ----------------
def _d1_query(sql: str, params: Optional[list] = None):
    if not (CF_ACCOUNT_ID and CF_D1_DATABASE_ID and CF_API_TOKEN):
        raise HTTPException(
            status_code=500,
            detail="Cloudflare D1 is not configured (need CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_API_TOKEN)",
        )
    url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/d1/database/{CF_D1_DATABASE_ID}/query"
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "application/json"},
        json={"sql": sql, "params": params or []},
        timeout=30,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"D1 error {resp.status_code}: {resp.text[:400]}")
    body = resp.json()
    if not body.get("success"):
        raise HTTPException(status_code=502, detail=f"D1 query failed: {str(body.get('errors'))[:400]}")
    result = (body.get("result") or [{}])[0]
    return result.get("results", []), result.get("meta", {})


async def d1_query(sql: str, params: Optional[list] = None):
    return await asyncio.to_thread(_d1_query, sql, params)


# ---------------- PoYo client (sync helpers, run in threadpool) ----------------
def _poyo_headers():
    return {"Authorization": f"Bearer {POYO_API_KEY}", "Content-Type": "application/json"}


def _poyo_chat(messages: List[Dict[str, str]], model: str, temperature: float = 0.8, max_tokens: int = 1200):
    resp = requests.post(
        f"{POYO_BASE_URL}/v1/chat/completions",
        headers=_poyo_headers(),
        json={"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens},
        timeout=90,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"PoYo chat error {resp.status_code}: {resp.text[:400]}")
    body = resp.json()
    data = body.get("data", body)
    choices = data.get("choices") or []
    if not choices:
        raise HTTPException(status_code=502, detail=f"PoYo chat returned no choices: {str(body)[:300]}")
    return choices[0]["message"]["content"]


def _poyo_models():
    resp = requests.get(f"{POYO_BASE_URL}/v1/models", headers=_poyo_headers(), timeout=30)
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"PoYo models error {resp.status_code}: {resp.text[:400]}")
    return resp.json()


# Models whose PoYo catalog entry only lists "openai-responses" (not
# "openai-chat") among supported_protocols — /v1/chat/completions returns a
# 400 "Supported URIs" error for these, so they need /v1/responses instead.
RESPONSES_ONLY_MODELS = {"gpt-5-6-luna", "gpt-5-6-sol", "gpt-5-6-terra"}


def _poyo_responses(messages: List[Dict[str, str]], model: str, temperature: float = 0.8, max_tokens: int = 1200):
    resp = requests.post(
        f"{POYO_BASE_URL}/v1/responses",
        headers=_poyo_headers(),
        json={"model": model, "input": messages, "temperature": temperature, "max_output_tokens": max_tokens},
        timeout=90,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"PoYo responses error {resp.status_code}: {resp.text[:400]}")
    body = resp.json()
    data = body.get("data", body)
    for item in data.get("output") or []:
        for block in item.get("content") or []:
            if block.get("type") == "output_text" and block.get("text"):
                return block["text"]
    raise HTTPException(status_code=502, detail=f"PoYo responses returned no text: {str(body)[:300]}")


def _poyo_submit(model: str, input_payload: Dict[str, Any]):
    resp = requests.post(
        f"{POYO_BASE_URL}/api/generate/submit",
        headers=_poyo_headers(),
        json={"model": model, "input": input_payload},
        timeout=60,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"PoYo submit error {resp.status_code}: {resp.text[:400]}")
    body = resp.json()
    data = body.get("data", {})
    task_id = data.get("task_id")
    if not task_id:
        raise HTTPException(status_code=502, detail=f"PoYo submit missing task_id: {str(body)[:300]}")
    return task_id, data.get("status", "not_started")


def _poyo_status(task_id: str):
    resp = requests.get(
        f"{POYO_BASE_URL}/api/generate/status/{task_id}",
        headers=_poyo_headers(),
        timeout=60,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"PoYo status error {resp.status_code}: {resp.text[:400]}")
    return resp.json().get("data", {})


async def chat(messages, model, temperature=0.8, max_tokens=1200):
    fn = _poyo_responses if model in RESPONSES_ONLY_MODELS else _poyo_chat
    return await asyncio.to_thread(fn, messages, model, temperature, max_tokens)


CHAT_MODEL = "gemini-3-flash-preview"

PLATFORM_GUIDE = {
    "twitter": "X/Twitter: punchy, <=280 chars, strong hook first line, 1-2 relevant hashtags max.",
    "linkedin": "LinkedIn: professional but human, short paragraphs, a hook, insight, and a soft CTA. Use line breaks.",
    "instagram": "Instagram: warm and visual, a scroll-stopping first line, emojis sparingly, 5-10 hashtags at the end.",
    "tiktok": "TikTok: casual, trend-aware caption, hook + payoff, 3-5 hashtags.",
    "youtube": "YouTube: a compelling video title/description, keyword-aware, clear value proposition.",
    "threads": "Threads: conversational, authentic, concise, minimal hashtags.",
    "facebook": "Facebook: friendly, story-driven, medium length, clear CTA.",
}


# ---------------- Models ----------------
class ChatRequest(BaseModel):
    prompt: Optional[str] = None
    messages: Optional[List[Dict[str, str]]] = None
    system: Optional[str] = None
    model: Optional[str] = None


class IdeateRequest(BaseModel):
    topic: str
    platform: Optional[str] = "general"
    count: Optional[int] = 6
    model: Optional[str] = None


class WriteRequest(BaseModel):
    brief: str
    platform: str = "twitter"
    tone: Optional[str] = "engaging"
    model: Optional[str] = None


class RepurposeRequest(BaseModel):
    source: str
    platforms: List[str] = Field(default_factory=lambda: ["twitter", "linkedin", "instagram", "threads"])
    model: Optional[str] = None


class GenerateRequest(BaseModel):
    kind: str  # image | video | music | voice
    prompt: str
    options: Optional[Dict[str, Any]] = Field(default_factory=dict)


class PostContent(BaseModel):
    text: str = ""


class Post(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str = "Untitled post"
    content: str = ""
    platforms: List[str] = Field(default_factory=list)
    status: str = "draft"  # draft | scheduled | published
    scheduled_time: Optional[str] = None
    media_urls: List[str] = Field(default_factory=list)
    media_type: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class PostCreate(BaseModel):
    title: Optional[str] = "Untitled post"
    content: Optional[str] = ""
    platforms: Optional[List[str]] = Field(default_factory=list)
    status: Optional[str] = "draft"
    scheduled_time: Optional[str] = None
    media_urls: Optional[List[str]] = Field(default_factory=list)
    media_type: Optional[str] = None


class PostUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    platforms: Optional[List[str]] = None
    status: Optional[str] = None
    scheduled_time: Optional[str] = None
    media_urls: Optional[List[str]] = None
    media_type: Optional[str] = None


def _post_row(post: dict):
    return [
        post["id"], post.get("title") or "Untitled post", post.get("content") or "",
        json.dumps(post.get("platforms") or []), post.get("status") or "draft", post.get("scheduled_time"),
        json.dumps(post.get("media_urls") or []), post.get("media_type"),
        post["created_at"], post["updated_at"],
    ]


def _row_to_post(row: dict):
    return {
        "id": row["id"],
        "title": row["title"],
        "content": row["content"],
        "platforms": json.loads(row["platforms"] or "[]"),
        "status": row["status"],
        "scheduled_time": row["scheduled_time"],
        "media_urls": json.loads(row["media_urls"] or "[]"),
        "media_type": row["media_type"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _row_to_generation(row: dict):
    return {
        "id": row["id"],
        "kind": row["kind"],
        "prompt": row["prompt"],
        "model": row["model"],
        "task_id": row["task_id"],
        "status": row["status"],
        "files": json.loads(row["files"] or "[]"),
        "created_at": row["created_at"],
    }


# ---------------- AI routes ----------------
@api_router.get("/")
async def root():
    return {"message": "CreateOS API"}


@api_router.get("/ai/models")
async def ai_models():
    try:
        body = await asyncio.to_thread(_poyo_models)
    except HTTPException:
        return {"models": [], "default": CHAT_MODEL}
    raw = body.get("data", body.get("models", body))
    items = raw if isinstance(raw, list) else raw.get("data", [])
    ids = sorted({m.get("id") if isinstance(m, dict) else m for m in items if m})
    return {"models": ids, "default": CHAT_MODEL}


@api_router.post("/ai/chat")
async def ai_chat(req: ChatRequest):
    model = req.model or CHAT_MODEL
    messages = req.messages
    if not messages:
        messages = []
        if req.system:
            messages.append({"role": "system", "content": req.system})
        messages.append({"role": "user", "content": req.prompt or ""})
    content = await chat(messages, model)
    return {"content": content}


@api_router.post("/ai/ideate")
async def ai_ideate(req: IdeateRequest):
    platform_note = "" if req.platform in (None, "general") else f" tailored for {req.platform}"
    system = (
        "You are a world-class social media strategist and viral content ideator. "
        "You output ONLY a numbered list of distinct, specific, scroll-stopping content ideas. "
        "No preamble, no closing remarks. Each idea is one line: a punchy hook or angle."
    )
    user = f"Give me {req.count} fresh content ideas{platform_note} about: {req.topic}"
    content = await chat([{"role": "system", "content": system}, {"role": "user", "content": user}], req.model or CHAT_MODEL, 0.95)
    ideas = []
    for line in content.splitlines():
        line = line.strip()
        if not line:
            continue
        # strip leading numbering / bullets
        cleaned = line.lstrip("0123456789.)-•* ").strip()
        if cleaned:
            ideas.append(cleaned)
    return {"ideas": ideas[: req.count] if ideas else [content]}


@api_router.post("/ai/write")
async def ai_write(req: WriteRequest):
    guide = PLATFORM_GUIDE.get(req.platform, "Write a high-quality social media post.")
    system = (
        f"You are an elite copywriter. Write a single ready-to-publish {req.platform} post. "
        f"Tone: {req.tone}. Platform rules: {guide} "
        "Return ONLY the post text, no explanations, no quotation marks, no markdown headers."
    )
    content = await chat([{"role": "system", "content": system}, {"role": "user", "content": req.brief}], req.model or CHAT_MODEL, 0.85)
    return {"content": content.strip()}


@api_router.post("/ai/repurpose")
async def ai_repurpose(req: RepurposeRequest):
    results = {}
    async def one(platform):
        guide = PLATFORM_GUIDE.get(platform, "Write a high-quality social media post.")
        system = (
            f"You repurpose source content into a native {platform} post. {guide} "
            "Return ONLY the post text, no explanations, no quotes."
        )
        txt = await chat(
            [{"role": "system", "content": system}, {"role": "user", "content": f"Source content:\n{req.source}"}],
            req.model or CHAT_MODEL, 0.8,
        )
        results[platform] = txt.strip()
    await asyncio.gather(*[one(p) for p in req.platforms])
    return {"posts": results}


def _extract_json(text):
    if not text:
        return None
    text = text.strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    return None


class VisualRequest(BaseModel):
    template: str  # quote | tweet | infographic | carousel | slideshow
    topic: str
    count: Optional[int] = 5
    model: Optional[str] = None


@api_router.post("/ai/visual")
async def ai_visual(req: VisualRequest):
    t = req.template
    n = max(3, min(int(req.count or 5), 8))
    if t == "quote":
        system = ('You craft punchy, original social quotes. Return ONLY JSON: '
                  '{"quote": "a single powerful sentence, max 140 chars", "author": "a fitting short attribution"}')
        user = f"Topic: {req.topic}"
    elif t == "tweet":
        system = ('You write a viral-style tweet. Return ONLY JSON: '
                  '{"name": "display name", "handle": "@handle", "text": "the tweet, max 260 chars"}')
        user = f"Topic: {req.topic}"
    elif t == "infographic":
        system = ('You design infographic copy. Return ONLY JSON: '
                  '{"title": "short punchy title, max 50 chars", "points": ["3 to 5 concise bullet points, each max 70 chars"]}')
        user = f"Topic: {req.topic}"
    else:  # carousel / slideshow / photo
        if t == "photo":
            system = ('You plan a photo slideshow. Return ONLY JSON: '
                      f'{{"title": "short cover title, max 50 chars", "slides": [{n} objects each '
                      '{"caption": "short on-image caption, max 60 chars", "image_prompt": "a vivid, cinematic, '
                      'detailed image-generation prompt for this slide; do NOT include any text or words in the image"}]}}')
        else:
            system = ('You design a swipeable social carousel. Return ONLY JSON: '
                      f'{{"title": "hook cover title, max 50 chars", "slides": [{n} objects each '
                      '{"heading": "max 40 chars", "body": "max 120 chars"}]}. The first slide is the hook/cover.')
        user = f"Topic: {req.topic}. Make exactly {n} slides."

    content = await chat([{"role": "system", "content": system}, {"role": "user", "content": user}], req.model or CHAT_MODEL, 0.85)
    data = _extract_json(content)
    if not data:
        # graceful fallback
        if t == "quote":
            data = {"quote": content.strip()[:140], "author": "CreateOS"}
        elif t == "tweet":
            data = {"name": "Creator", "handle": "@creator", "text": content.strip()[:260]}
        elif t == "infographic":
            lines = [l.strip("-• ").strip() for l in content.splitlines() if l.strip()]
            data = {"title": (lines[0] if lines else req.topic)[:50], "points": lines[1:6] or [req.topic]}
        elif t == "photo":
            data = {"title": req.topic[:50], "slides": [{"caption": req.topic[:60], "image_prompt": req.topic} for _ in range(n)]}
        else:
            data = {"title": req.topic[:50], "slides": [{"heading": req.topic[:40], "body": content.strip()[:120]}]}
    return {"data": data}


TEMPLATE_GUIDES = {
    "hooks": "a punchy, scroll-stopping single-line hook followed by 1-2 sentences of payoff. No fluff.",
    "story": "a short narrative arc: a specific moment, the tension or mistake, what changed, and the lesson.",
    "listicle": "a numbered list post (e.g. '5 things...'), each point a single punchy line.",
    "contrarian": "a contrarian take that challenges a common belief in the topic's space, backed by one sharp reason.",
    "how_to": "a clear how-to post: the outcome promised in the first line, then 3-5 concrete steps.",
}


class TemplateRequest(BaseModel):
    topic: str
    template: str = "hooks"  # hooks | story | listicle | contrarian | how_to
    platform: str = "twitter"
    count: Optional[int] = 7
    model: Optional[str] = None


@api_router.post("/ai/templates")
async def ai_templates(req: TemplateRequest):
    style = TEMPLATE_GUIDES.get(req.template, TEMPLATE_GUIDES["hooks"])
    guide = PLATFORM_GUIDE.get(req.platform, "Write a high-quality social media post.")
    n = max(1, min(int(req.count or 7), 14))
    system = (
        f"You are a viral content strategist. Write {n} distinct {req.platform} posts about the given topic, "
        f"each following this template: {style} Platform rules: {guide} "
        f'Return ONLY JSON: {{"posts": [{n} strings, each a complete ready-to-publish post]}}. No explanations.'
    )
    content = await chat(
        [{"role": "system", "content": system}, {"role": "user", "content": req.topic}],
        req.model or CHAT_MODEL, 0.9, 2200,
    )
    data = _extract_json(content)
    posts = data.get("posts") if data else None
    if not posts:
        posts = [p.strip() for p in re.split(r"\n\s*\n|\n\d+[\.\)]\s*", content) if p.strip()]
    return {"posts": [{"day": i + 1, "content": p} for i, p in enumerate(posts[:n])]}


class CoachRequest(BaseModel):
    content: str
    platform: Optional[str] = "general"
    model: Optional[str] = None


@api_router.post("/ai/coach")
async def ai_coach(req: CoachRequest):
    guide = PLATFORM_GUIDE.get(req.platform, "General social media best practices.")
    system = (
        "You are a blunt, expert social media coach who has studied a million viral posts. "
        f"Critique the given draft honestly. Platform context: {guide} "
        'Return ONLY JSON: {"score": integer 0-100, "strengths": [2-3 short strings], '
        '"improvements": [2-3 short specific actionable strings], "hook_rewrite": "a stronger rewritten opening line"}'
    )
    content = await chat(
        [{"role": "system", "content": system}, {"role": "user", "content": req.content}],
        req.model or CHAT_MODEL, 0.7,
    )
    data = _extract_json(content)
    if not data:
        data = {"score": None, "strengths": [], "improvements": [content.strip()], "hook_rewrite": ""}
    return {"data": data}


@api_router.get("/proxy-image")
async def proxy_image(url: str):
    r = await asyncio.to_thread(lambda: requests.get(url, timeout=90))
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="Could not fetch image")
    return Response(content=r.content, media_type=r.headers.get("content-type", "image/png"))


@api_router.post("/ai/generate")
async def ai_generate(req: GenerateRequest):
    opts = req.options or {}
    if req.kind == "image":
        model = opts.get("model", "gpt-image-2")
        payload = {"prompt": req.prompt, "size": opts.get("size", "1:1")}
        if model.startswith("gpt-image"):
            payload["quality"] = opts.get("quality", "medium")
        if opts.get("resolution"):
            payload["resolution"] = opts["resolution"]
    elif req.kind == "video":
        # Video models differ a lot in accepted fields (resolution/aspect_ratio/
        # duration ranges, and the audio flag is named generate_audio, sound, or
        # audio depending on the model) — the frontend already knows the selected
        # model's real shape, so forward whatever it sent rather than guessing a
        # one-size-fits-all payload here.
        model = opts.get("model", "seedance-2-fast")
        payload = {"prompt": req.prompt, **{k: v for k, v in opts.items() if k != "model"}}
        if "duration" in payload:
            payload["duration"] = int(payload["duration"])
    elif req.kind == "music":
        model = "generate-music"
        payload = {
            "prompt": req.prompt,
            "custom_mode": False,
            "instrumental": bool(opts.get("instrumental", False)),
            "mv": opts.get("mv", "V4_5"),
        }
    elif req.kind == "voice":
        model = opts.get("model", "elevenlabs-tts-turbo-2-5")
        payload = {"text": req.prompt, **{k: v for k, v in opts.items() if k != "model"}}
    else:
        raise HTTPException(status_code=400, detail="kind must be image, video, music, or voice")

    task_id, status = await asyncio.to_thread(_poyo_submit, model, payload)
    record = {
        "id": str(uuid.uuid4()),
        "kind": req.kind,
        "prompt": req.prompt,
        "model": model,
        "task_id": task_id,
        "status": status,
        "files": [],
        "created_at": now_iso(),
    }
    await d1_query(
        "INSERT INTO generations (id, kind, prompt, model, task_id, status, files, progress, error_message, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [record["id"], record["kind"], record["prompt"], record["model"], record["task_id"], record["status"],
         json.dumps(record["files"]), 0, None, record["created_at"]],
    )
    return {"id": record["id"], "task_id": task_id, "status": status, "kind": req.kind}


@api_router.get("/ai/task/{task_id}")
async def ai_task(task_id: str):
    data = await asyncio.to_thread(_poyo_status, task_id)
    status = data.get("status", "running")
    files = data.get("files", []) or []
    await d1_query(
        "UPDATE generations SET status = ?, files = ?, progress = ? WHERE task_id = ?",
        [status, json.dumps(files), data.get("progress", 0), task_id],
    )
    return {
        "task_id": task_id,
        "status": status,
        "progress": data.get("progress", 0),
        "files": files,
        "error_message": data.get("error_message"),
    }


@api_router.get("/media")
async def list_media(limit: int = 60):
    rows, _ = await d1_query(
        "SELECT * FROM generations WHERE status = 'finished' ORDER BY created_at DESC LIMIT ?", [limit]
    )
    return [_row_to_generation(r) for r in rows]


# ---------------- RSS import ----------------
def _local(tag: str) -> str:
    return tag.split("}")[-1] if "}" in tag else tag


def _child_text(el, name: str) -> str:
    for child in el:
        if _local(child.tag) == name and child.text:
            return child.text.strip()
    return ""


def _child_link(el) -> str:
    # RSS: <link>https://...</link> as element text. Atom: <link href="https://.../">.
    for child in el:
        if _local(child.tag) == "link":
            if child.text and child.text.strip():
                return child.text.strip()
            href = child.get("href")
            if href:
                return href
    return ""


def _parse_feed(xml_text: str, limit: int):
    root = ET.fromstring(xml_text)
    entries = [el for el in root.iter() if _local(el.tag) in ("item", "entry")]
    items = []
    for el in entries[:limit]:
        summary = _child_text(el, "description") or _child_text(el, "summary") or _child_text(el, "content")
        items.append({
            "title": _child_text(el, "title"),
            "link": _child_link(el),
            "summary": summary[:600],
            "published": _child_text(el, "pubDate") or _child_text(el, "updated") or _child_text(el, "published"),
        })
    return items


class RssImportRequest(BaseModel):
    url: str
    limit: Optional[int] = 10


@api_router.post("/rss/import")
async def rss_import(req: RssImportRequest):
    limit = max(1, min(int(req.limit or 10), 30))
    resp = await asyncio.to_thread(
        lambda: requests.get(req.url, timeout=30, headers={"User-Agent": "CreateOS/1.0"})
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Could not fetch that feed (HTTP {resp.status_code})")
    try:
        items = _parse_feed(resp.text, limit)
    except ET.ParseError as e:
        raise HTTPException(status_code=400, detail=f"That doesn't look like a valid RSS/Atom feed: {e}")
    if not items:
        raise HTTPException(status_code=400, detail="No items found in that feed")
    return {"items": items}


# ---------------- Posts CRUD ----------------
@api_router.post("/posts", response_model=Post)
async def create_post(inp: PostCreate):
    post = Post(**{k: v for k, v in inp.model_dump().items() if v is not None})
    await d1_query(
        "INSERT INTO posts (id, title, content, platforms, status, scheduled_time, media_urls, media_type, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        _post_row(post.model_dump()),
    )
    return post


@api_router.get("/posts", response_model=List[Post])
async def list_posts(status: Optional[str] = None):
    if status:
        rows, _ = await d1_query("SELECT * FROM posts WHERE status = ? ORDER BY created_at DESC LIMIT 500", [status])
    else:
        rows, _ = await d1_query("SELECT * FROM posts ORDER BY created_at DESC LIMIT 500")
    return [_row_to_post(r) for r in rows]


@api_router.get("/posts/{post_id}", response_model=Post)
async def get_post(post_id: str):
    rows, _ = await d1_query("SELECT * FROM posts WHERE id = ?", [post_id])
    if not rows:
        raise HTTPException(status_code=404, detail="Post not found")
    return _row_to_post(rows[0])


@api_router.put("/posts/{post_id}", response_model=Post)
async def update_post(post_id: str, upd: PostUpdate):
    changes = {k: v for k, v in upd.model_dump().items() if v is not None}
    changes["updated_at"] = now_iso()
    set_clauses = []
    params = []
    for k, v in changes.items():
        if k in ("platforms", "media_urls"):
            v = json.dumps(v)
        set_clauses.append(f"{k} = ?")
        params.append(v)
    params.append(post_id)
    rows, _ = await d1_query(f"UPDATE posts SET {', '.join(set_clauses)} WHERE id = ? RETURNING *", params)
    if not rows:
        raise HTTPException(status_code=404, detail="Post not found")
    return _row_to_post(rows[0])


@api_router.delete("/posts/{post_id}")
async def delete_post(post_id: str):
    rows, _ = await d1_query("DELETE FROM posts WHERE id = ? RETURNING id", [post_id])
    if not rows:
        raise HTTPException(status_code=404, detail="Post not found")
    return {"ok": True}


class BulkDeleteRequest(BaseModel):
    ids: List[str]


@api_router.post("/posts/bulk-delete")
async def bulk_delete_posts(req: BulkDeleteRequest):
    if not req.ids:
        return {"deleted": 0}
    placeholders = ",".join(["?"] * len(req.ids))
    rows, _ = await d1_query(f"DELETE FROM posts WHERE id IN ({placeholders}) RETURNING id", req.ids)
    return {"deleted": len(rows)}


@api_router.get("/stats")
async def get_stats():
    rows, _ = await d1_query(
        "SELECT "
        "(SELECT COUNT(*) FROM posts) AS total, "
        "(SELECT COUNT(*) FROM posts WHERE status='draft') AS drafts, "
        "(SELECT COUNT(*) FROM posts WHERE status='scheduled') AS scheduled, "
        "(SELECT COUNT(*) FROM posts WHERE status='published') AS published, "
        "(SELECT COUNT(*) FROM generations WHERE status='finished') AS media"
    )
    r = rows[0]
    return {
        "total": r["total"], "drafts": r["drafts"], "scheduled": r["scheduled"],
        "published": r["published"], "media": r["media"],
    }


# ---------------- Connections (Phase 0: status only, no OAuth yet) ----------------
SUPPORTED_PLATFORMS = ["twitter", "linkedin", "instagram", "tiktok", "youtube", "threads", "facebook"]


@api_router.get("/connections")
async def list_connections():
    rows, _ = await d1_query("SELECT * FROM connections")
    by_platform = {r["platform"]: r for r in rows}
    return [
        {
            "platform": p,
            "status": (by_platform.get(p) or {}).get("status", "not_connected"),
            "account_name": (by_platform.get(p) or {}).get("account_name"),
        }
        for p in SUPPORTED_PLATFORMS
    ]


# ---------------- Scheduler ----------------
# Wired to Vercel Cron (see vercel.json). Reports which scheduled posts are
# due and why they weren't published, rather than faking a "published" state
# — there is no real publisher yet (Phase 1: needs OAuth per platform).
@api_router.get("/cron/publish-due")
async def cron_publish_due(request: Request):
    secret = os.environ.get("CRON_SECRET")
    if secret and request.headers.get("authorization") != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    rows, _ = await d1_query(
        "SELECT * FROM posts WHERE status = 'scheduled' AND scheduled_time <= ? ORDER BY scheduled_time ASC LIMIT 50",
        [now_iso()],
    )
    conn_rows, _ = await d1_query("SELECT * FROM connections WHERE status = 'connected'")
    connected_platforms = {r["platform"] for r in conn_rows}

    results = []
    for row in rows:
        post = _row_to_post(row)
        live = [p for p in post["platforms"] if p in connected_platforms]
        outcome = "not_yet_implemented" if live else "no_connected_platform"
        results.append({"id": post["id"], "outcome": outcome, "platforms": post["platforms"]})
    return {"checked_at": now_iso(), "due_count": len(rows), "results": results}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi import FastAPI, APIRouter, HTTPException, Request, UploadFile, File, Form
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
import colorsys
import io
import math
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone
from urllib.parse import urljoin
from PIL import Image
from pypdf import PdfReader
from pptx import Presentation

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

CF_ACCOUNT_ID = os.environ.get('CF_ACCOUNT_ID')
CF_D1_DATABASE_ID = os.environ.get('CF_D1_DATABASE_ID')
CF_API_TOKEN = os.environ.get('CF_API_TOKEN')

POYO_API_KEY = os.environ.get('POYO_API_KEY')
POYO_BASE_URL = os.environ.get('POYO_BASE_URL', 'https://api.poyo.ai')

PEXELS_API_KEY = os.environ.get('PEXELS_API_KEY')

# Vercel Blob — where a user's own uploads live. Enabled per-project in the
# Vercel dashboard (Storage -> Blob -> Create), which sets this token
# automatically; no separate third-party account needed since the app is
# already hosted on Vercel.
BLOB_READ_WRITE_TOKEN = os.environ.get('BLOB_READ_WRITE_TOKEN')

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


# The app provisions its own tables and columns. D1's dashboard console silently
# swallows multi-statement pastes, so relying on a human to run schema.sql by
# hand has already cost us two rounds of "no such table" — this runs once per
# cold start instead. Every statement is IF NOT EXISTS or an idempotent ALTER
# whose "duplicate column name" error is expected and ignored.
_CREATE_TABLES = [
    """CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled post',
        content TEXT NOT NULL DEFAULT '', platforms TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft', scheduled_time TEXT,
        media_urls TEXT NOT NULL DEFAULT '[]', media_type TEXT,
        assets TEXT NOT NULL DEFAULT '[]', format TEXT NOT NULL DEFAULT 'single',
        hashtags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS generations (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, prompt TEXT NOT NULL,
        model TEXT NOT NULL, task_id TEXT NOT NULL, status TEXT NOT NULL,
        files TEXT NOT NULL DEFAULT '[]', progress INTEGER DEFAULT 0,
        error_message TEXT, output TEXT, title TEXT, meta TEXT,
        favorite INTEGER NOT NULL DEFAULT 0, updated_at TEXT,
        created_at TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY, platform TEXT NOT NULL UNIQUE, account_name TEXT,
        status TEXT NOT NULL DEFAULT 'not_connected',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS brand_kits (
        id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT 'Default brand',
        is_default INTEGER NOT NULL DEFAULT 1, colors TEXT NOT NULL DEFAULT '{}',
        fonts TEXT NOT NULL DEFAULT '{}', logo_url TEXT, handle TEXT, voice TEXT,
        audience TEXT, hashtags TEXT NOT NULL DEFAULT '[]', cta TEXT,
        banned_words TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS uploads (
        id TEXT PRIMARY KEY, url TEXT NOT NULL, pathname TEXT,
        filename TEXT NOT NULL, content_type TEXT, kind TEXT NOT NULL DEFAULT 'file',
        size INTEGER DEFAULT 0, created_at TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS visual_templates (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, source_kind TEXT NOT NULL,
        source_url TEXT NOT NULL, format TEXT NOT NULL DEFAULT 'carousel',
        theme TEXT NOT NULL DEFAULT 'midnight', colors TEXT NOT NULL DEFAULT '{}',
        slides TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL)""",
    # The brand's long-form memory. A kit says how the brand sounds; these say
    # what it actually knows, believes and has done. brand_kit_id NULL means
    # the document applies to every kit.
    """CREATE TABLE IF NOT EXISTS knowledge_docs (
        id TEXT PRIMARY KEY, brand_kit_id TEXT, title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'note', content TEXT NOT NULL DEFAULT '',
        summary TEXT, tags TEXT NOT NULL DEFAULT '[]',
        source_kind TEXT NOT NULL DEFAULT 'paste', source_url TEXT,
        pinned INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""",
    # One row per retrievable passage. `embedding` stays NULL under lexical
    # retrieval and is where vectors land if an embedding provider is ever
    # configured — the retriever reads whichever is present.
    """CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, brand_kit_id TEXT,
        seq INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL,
        embedding TEXT, created_at TEXT NOT NULL)""",
]

# Columns added after the first release. Existing databases predate them, so
# they arrive as ALTERs rather than being picked up from the CREATE above.
_ADD_COLUMNS = {
    "posts": [
        ("assets", "ALTER TABLE posts ADD COLUMN assets TEXT NOT NULL DEFAULT '[]'"),
        ("format", "ALTER TABLE posts ADD COLUMN format TEXT NOT NULL DEFAULT 'single'"),
        ("hashtags", "ALTER TABLE posts ADD COLUMN hashtags TEXT NOT NULL DEFAULT '[]'"),
        ("brand_kit_id", "ALTER TABLE posts ADD COLUMN brand_kit_id TEXT"),
    ],
    "generations": [
        ("output", "ALTER TABLE generations ADD COLUMN output TEXT"),
        ("title", "ALTER TABLE generations ADD COLUMN title TEXT"),
        ("meta", "ALTER TABLE generations ADD COLUMN meta TEXT"),
        ("favorite", "ALTER TABLE generations ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0"),
        ("updated_at", "ALTER TABLE generations ADD COLUMN updated_at TEXT"),
    ],
    "brand_kits": [
        ("style", "ALTER TABLE brand_kits ADD COLUMN style TEXT"),
        ("color_mode", "ALTER TABLE brand_kits ADD COLUMN color_mode TEXT NOT NULL DEFAULT 'dark'"),
    ],
}

_schema_ready = False


async def ensure_schema():
    global _schema_ready
    if _schema_ready:
        return
    await asyncio.gather(*[d1_query(sql) for sql in _CREATE_TABLES])
    infos = await asyncio.gather(
        *[d1_query(f"SELECT name FROM pragma_table_info('{t}')") for t in _ADD_COLUMNS]
    )
    pending = []
    for (table, cols), (rows, _meta) in zip(_ADD_COLUMNS.items(), infos):
        have = {r["name"] for r in rows}
        pending += [sql for name, sql in cols if name not in have]

    async def add(sql):
        try:
            await d1_query(sql)
        except HTTPException as e:
            # "duplicate column name" means another cold start beat us to it.
            if "duplicate column" not in str(e.detail).lower():
                raise

    if pending:
        await asyncio.gather(*[add(sql) for sql in pending])
    _schema_ready = True


# ---------------- PoYo client (sync helpers, run in threadpool) ----------------
def _poyo_headers():
    return {"Authorization": f"Bearer {POYO_API_KEY}", "Content-Type": "application/json"}


# A build-post/restyle/coach call that times out used to surface as a raw
# "ReadTimeout: HTTPSConnectionPool(...)" string straight from requests — every
# other PoYo error path already turns into a clean HTTPException, this is the
# one gap where the global exception handler was the thing actually reporting
# it. One call site for every PoYo request closes that gap for good.
def _poyo_call(method: str, path: str, *, timeout: int, **kwargs):
    url = f"{POYO_BASE_URL}{path}"
    fn = requests.post if method == "POST" else requests.get
    try:
        return fn(url, headers=_poyo_headers(), timeout=timeout, **kwargs)
    except requests.exceptions.Timeout:
        raise HTTPException(
            status_code=504,
            detail=(
                f"PoYo didn't respond within {timeout}s. This happens with long prompts, big media "
                "jobs, or a slower model — try again, or switch to a faster model."
            ),
        )
    except requests.exceptions.ConnectionError as e:
        raise HTTPException(status_code=502, detail=f"Could not reach PoYo: {e}")


def _poyo_chat(messages: List[Dict[str, str]], model: str, temperature: float = 0.8, max_tokens: int = 1200):
    resp = _poyo_call(
        "POST", "/v1/chat/completions",
        json={"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens},
        timeout=110,
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
    resp = _poyo_call("GET", "/v1/models", timeout=30)
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"PoYo models error {resp.status_code}: {resp.text[:400]}")
    return resp.json()


# Models whose PoYo catalog entry only lists "openai-responses" (not
# "openai-chat") among supported_protocols — /v1/chat/completions returns a
# 400 "Supported URIs" error for these, so they need /v1/responses instead.
RESPONSES_ONLY_MODELS = {"gpt-5-6-luna", "gpt-5-6-sol", "gpt-5-6-terra"}


def _poyo_responses(messages: List[Dict[str, str]], model: str, temperature: float = 0.8, max_tokens: int = 1200):
    resp = _poyo_call(
        "POST", "/v1/responses",
        json={"model": model, "input": messages, "temperature": temperature, "max_output_tokens": max_tokens},
        timeout=110,
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
    resp = _poyo_call("POST", "/api/generate/submit", json={"model": model, "input": input_payload}, timeout=60)
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"PoYo submit error {resp.status_code}: {resp.text[:400]}")
    body = resp.json()
    data = body.get("data", {})
    task_id = data.get("task_id")
    if not task_id:
        raise HTTPException(status_code=502, detail=f"PoYo submit missing task_id: {str(body)[:300]}")
    return task_id, data.get("status", "not_started")


def _poyo_status(task_id: str):
    resp = _poyo_call("GET", f"/api/generate/status/{task_id}", timeout=60)
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
    use_brand: bool = True
    brand_kit_id: Optional[str] = None
    use_knowledge: bool = True


class WriteRequest(BaseModel):
    brief: str
    platform: str = "twitter"
    tone: Optional[str] = "engaging"
    model: Optional[str] = None
    use_brand: bool = True
    brand_kit_id: Optional[str] = None
    use_knowledge: bool = True


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
    assets: List[Dict[str, Any]] = Field(default_factory=list)
    format: str = "single"  # single | carousel | reel | story | thread
    hashtags: List[str] = Field(default_factory=list)
    brand_kit_id: Optional[str] = None
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
    assets: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    format: Optional[str] = "single"
    hashtags: Optional[List[str]] = Field(default_factory=list)
    brand_kit_id: Optional[str] = None


class PostUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    platforms: Optional[List[str]] = None
    status: Optional[str] = None
    scheduled_time: Optional[str] = None
    media_urls: Optional[List[str]] = None
    media_type: Optional[str] = None
    assets: Optional[List[Dict[str, Any]]] = None
    format: Optional[str] = None
    hashtags: Optional[List[str]] = None
    brand_kit_id: Optional[str] = None


# Post columns whose Python value is a list/dict and whose D1 value is JSON text.
JSON_POST_FIELDS = ("platforms", "media_urls", "assets", "hashtags")


def _post_row(post: dict):
    return [
        post["id"], post.get("title") or "Untitled post", post.get("content") or "",
        json.dumps(post.get("platforms") or []), post.get("status") or "draft", post.get("scheduled_time"),
        json.dumps(post.get("media_urls") or []), post.get("media_type"),
        json.dumps(post.get("assets") or []), post.get("format") or "single",
        json.dumps(post.get("hashtags") or []), post.get("brand_kit_id"),
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
        "assets": json.loads(row.get("assets") or "[]"),
        "format": row.get("format") or "single",
        "hashtags": json.loads(row.get("hashtags") or "[]"),
        "brand_kit_id": row.get("brand_kit_id"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _row_to_generation(row: dict):
    return {
        "id": row["id"],
        "kind": row["kind"],
        "title": row.get("title") or (row["prompt"] or "")[:80],
        "prompt": row["prompt"],
        "model": row["model"],
        "task_id": row["task_id"],
        "status": row["status"],
        "files": json.loads(row["files"] or "[]"),
        "output": row.get("output"),
        "meta": json.loads(row.get("meta") or "{}"),
        "favorite": bool(row.get("favorite")),
        "progress": row.get("progress") or 0,
        "error_message": row.get("error_message"),
        "created_at": row["created_at"],
        "updated_at": row.get("updated_at") or row["created_at"],
    }


# Text kinds have no PoYo task behind them, so they land already finished with
# their result in `output`. task_id stays '' rather than NULL because the column
# predates them and is NOT NULL.
TEXT_KINDS = ("ideate", "write", "repurpose", "templates", "coach", "visual", "post_plan", "restyle", "brand_analysis")


async def record_generation(kind: str, prompt: str, model: str, output: Any = None,
                            title: Optional[str] = None, meta: Optional[dict] = None,
                            task_id: str = "", status: str = "finished",
                            files: Optional[list] = None) -> Optional[str]:
    """Persist one generation. Never raises: a history write failing must not
    cost the user the generation they just paid for and are looking at."""
    gid = str(uuid.uuid4())
    if not isinstance(output, (str, type(None))):
        output = json.dumps(output)
    ts = now_iso()
    try:
        await ensure_schema()
        await d1_query(
            "INSERT INTO generations (id, kind, prompt, model, task_id, status, files, progress, "
            "error_message, output, title, meta, favorite, updated_at, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [gid, kind, prompt or "", model, task_id, status, json.dumps(files or []), 0,
             None, output, (title or prompt or "")[:120], json.dumps(meta or {}), 0, ts, ts],
        )
        return gid
    except Exception:
        logger.exception(f"Could not record {kind} generation")
        return None


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
        + await brand_and_knowledge(req, req.topic)
    )
    user = f"Give me {req.count} fresh content ideas{platform_note} about: {req.topic}"
    model = req.model or CHAT_MODEL
    content = await chat([{"role": "system", "content": system}, {"role": "user", "content": user}], model, 0.95)
    ideas = []
    for line in content.splitlines():
        line = line.strip()
        if not line:
            continue
        # strip leading numbering / bullets
        cleaned = line.lstrip("0123456789.)-•* ").strip()
        if cleaned:
            ideas.append(cleaned)
    ideas = ideas[: req.count] if ideas else [content]
    gid = await record_generation(
        "ideate", req.topic, model, output=json.dumps({"ideas": ideas}),
        title=f"Ideas — {req.topic}", meta={"platform": req.platform, "count": req.count},
    )
    return {"ideas": ideas, "generation_id": gid}


@api_router.post("/ai/write")
async def ai_write(req: WriteRequest):
    guide = PLATFORM_GUIDE.get(req.platform, "Write a high-quality social media post.")
    system = (
        f"You are an elite copywriter. Write a single ready-to-publish {req.platform} post. "
        f"Tone: {req.tone}. Platform rules: {guide} "
        "Return ONLY the post text, no explanations, no quotation marks, no markdown headers."
        + await brand_and_knowledge(req, req.brief)
    )
    model = req.model or CHAT_MODEL
    content = await chat([{"role": "system", "content": system}, {"role": "user", "content": req.brief}], model, 0.85)
    text = content.strip()
    gid = await record_generation(
        "write", req.brief, model, output=text, title=text[:80],
        meta={"platform": req.platform, "tone": req.tone},
    )
    return {"content": text, "generation_id": gid}


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
    gid = await record_generation(
        "repurpose", req.source, req.model or CHAT_MODEL, output=json.dumps(results),
        title=f"Repurposed — {req.source[:60]}", meta={"platforms": req.platforms},
    )
    return {"posts": results, "generation_id": gid}


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
    gid = await record_generation(
        "visual", req.topic, req.model or CHAT_MODEL, output=json.dumps(data),
        title=f"{t.title()} — {req.topic[:60]}", meta={"template": t, "count": n},
    )
    return {"data": data, "generation_id": gid}


# Keyed the same as the frontend's TEMPLATES card list — style is the prompt
# instruction, label/desc are display copy served via GET /template-styles so
# the two never drift apart.
TEMPLATE_GUIDES = {
    "hooks": {"label": "Hooks", "desc": "Scroll-stopping one-liners",
              "style": "a punchy, scroll-stopping single-line hook followed by 1-2 sentences of payoff. No fluff."},
    "story": {"label": "Story Arc", "desc": "Moment, tension, lesson",
              "style": "a short narrative arc: a specific moment, the tension or mistake, what changed, and the lesson."},
    "listicle": {"label": "Listicle", "desc": "Numbered, punchy points",
                 "style": "a numbered list post (e.g. '5 things...'), each point a single punchy line."},
    "contrarian": {"label": "Contrarian", "desc": "Challenge the consensus",
                   "style": "a contrarian take that challenges a common belief in the topic's space, backed by one sharp reason."},
    "how_to": {"label": "How-To", "desc": "Outcome, then steps",
               "style": "a clear how-to post: the outcome promised in the first line, then 3-5 concrete steps."},
}


@api_router.get("/template-styles")
async def template_styles():
    return {"templates": [{"key": k, **v} for k, v in TEMPLATE_GUIDES.items()]}


class TemplateRequest(BaseModel):
    topic: str
    template: str = "hooks"  # hooks | story | listicle | contrarian | how_to
    platform: str = "twitter"
    count: Optional[int] = 7
    model: Optional[str] = None
    use_brand: bool = True
    brand_kit_id: Optional[str] = None
    use_knowledge: bool = True


@api_router.post("/ai/templates")
async def ai_templates(req: TemplateRequest):
    style = TEMPLATE_GUIDES.get(req.template, TEMPLATE_GUIDES["hooks"])["style"]
    guide = PLATFORM_GUIDE.get(req.platform, "Write a high-quality social media post.")
    n = max(1, min(int(req.count or 7), 14))
    system = (
        f"You are a viral content strategist. Write {n} distinct {req.platform} posts about the given topic, "
        f"each following this template: {style} Platform rules: {guide} "
        f'Return ONLY JSON: {{"posts": [{n} strings, each a complete ready-to-publish post]}}. No explanations.'
        + await brand_and_knowledge(req, req.topic)
    )
    content = await chat(
        [{"role": "system", "content": system}, {"role": "user", "content": req.topic}],
        req.model or CHAT_MODEL, 0.9, 2200,
    )
    data = _extract_json(content)
    posts = data.get("posts") if data else None
    if not posts:
        posts = [p.strip() for p in re.split(r"\n\s*\n|\n\d+[\.\)]\s*", content) if p.strip()]
    out = [{"day": i + 1, "content": p} for i, p in enumerate(posts[:n])]
    gid = await record_generation(
        "templates", req.topic, req.model or CHAT_MODEL, output=json.dumps({"posts": out}),
        title=f"{req.template.replace('_', ' ').title()} — {req.topic[:60]}",
        meta={"template": req.template, "platform": req.platform},
    )
    return {"posts": out, "generation_id": gid}


class RestyleRequest(BaseModel):
    content: str
    template: str = "hooks"  # one of TEMPLATE_GUIDES
    platform: str = "twitter"
    model: Optional[str] = None
    use_brand: bool = True
    brand_kit_id: Optional[str] = None
    use_knowledge: bool = True


@api_router.post("/ai/restyle")
async def ai_restyle(req: RestyleRequest):
    """Rewrite an existing draft into a template's voice, rather than
    generating fresh copy from a topic — the difference between ai_templates
    (topic -> N new posts) and this (one draft -> the same draft, restyled)."""
    tpl = TEMPLATE_GUIDES.get(req.template, TEMPLATE_GUIDES["hooks"])
    guide = PLATFORM_GUIDE.get(req.platform, "Write a high-quality social media post.")
    system = (
        f"You are an elite editor. Rewrite the given draft as {tpl['style']} "
        f"Keep the same core message and facts — restructure and rephrase the delivery, don't invent new claims. "
        f"Platform rules: {guide} "
        "Return ONLY the rewritten post text, no explanations, no quotation marks, no markdown headers."
        + await brand_and_knowledge(req, req.content)
    )
    model = req.model or CHAT_MODEL
    content = await chat(
        [{"role": "system", "content": system}, {"role": "user", "content": req.content}], model, 0.8,
    )
    text = content.strip()
    gid = await record_generation(
        "restyle", req.content, model, output=text, title=f"{tpl['label']} restyle — {req.content[:50]}",
        meta={"template": req.template, "platform": req.platform},
    )
    return {"content": text, "generation_id": gid}


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
    gid = await record_generation(
        "coach", req.content, req.model or CHAT_MODEL, output=json.dumps(data),
        title=f"Coach — {req.content[:60]}", meta={"platform": req.platform},
    )
    return {"data": data, "generation_id": gid}


@api_router.get("/proxy-image")
async def proxy_image(url: str):
    r = await asyncio.to_thread(lambda: requests.get(url, timeout=90))
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="Could not fetch image")
    return Response(content=r.content, media_type=r.headers.get("content-type", "image/png"))


# ---------------- Stock media (Pexels) ----------------
# Free stock photos and video, licensed for commercial use with no attribution
# required (credit is still returned so the UI can offer it). One provider
# covers both media types with one free API key, unlike Unsplash (photos only)
# — see backend/.env.example for how to get PEXELS_API_KEY.
def _pexels_headers():
    if not PEXELS_API_KEY:
        raise HTTPException(status_code=500, detail="Stock media is not configured (need PEXELS_API_KEY)")
    return {"Authorization": PEXELS_API_KEY}


def _pexels_photo(item: dict) -> dict:
    src = item.get("src", {})
    return {
        "id": f"photo-{item.get('id')}", "type": "image",
        "url": src.get("large2x") or src.get("large") or src.get("original"),
        "thumbnail": src.get("medium") or src.get("small"),
        "width": item.get("width"), "height": item.get("height"),
        "credit": item.get("photographer"), "credit_url": item.get("photographer_url"),
        "source_url": item.get("url"),
    }


def _pexels_video(item: dict) -> dict:
    files = sorted(
        [f for f in item.get("video_files", []) if f.get("file_type") == "video/mp4"],
        key=lambda f: f.get("width") or 0,
    )
    # Prefer a file around 720p — plenty for a social post and far lighter
    # than the 4K masters Pexels also lists — falling back to whatever exists.
    pick = next((f for f in files if (f.get("width") or 0) >= 1280), None) or (files[-1] if files else None)
    user = item.get("user") or {}
    return {
        "id": f"video-{item.get('id')}", "type": "video",
        "url": pick.get("link") if pick else None,
        "thumbnail": item.get("image"),
        "width": item.get("width"), "height": item.get("height"),
        "credit": user.get("name"), "credit_url": user.get("url"),
        "source_url": item.get("url"),
    }


@api_router.get("/stock/search")
async def stock_search(q: str, type: str = "image", page: int = 1, per_page: int = 24, orientation: Optional[str] = None):
    if type not in ("image", "video"):
        raise HTTPException(status_code=400, detail="type must be image or video")
    per_page = max(1, min(int(per_page), 40))
    params = {"query": q, "page": max(1, int(page)), "per_page": per_page}
    if orientation in ("landscape", "portrait", "square"):
        params["orientation"] = orientation
    base = "https://api.pexels.com/videos/search" if type == "video" else "https://api.pexels.com/v1/search"

    def call():
        r = requests.get(base, headers=_pexels_headers(), params=params, timeout=30)
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Pexels error {r.status_code}: {r.text[:400]}")
        return r.json()

    body = await asyncio.to_thread(call)
    items = body.get("videos" if type == "video" else "photos", [])
    mapper = _pexels_video if type == "video" else _pexels_photo
    results = [mapper(it) for it in items]
    return {"results": [r for r in results if r["url"]], "page": params["page"], "per_page": per_page,
            "total_results": body.get("total_results", len(results))}


# ---------------- Uploads (Vercel Blob) ----------------
# The user's own images, video and audio — not generated, not stock. Stored in
# Vercel Blob (the app is already hosted on Vercel, so this is a checkbox in
# the same dashboard rather than a new account) and tracked in D1 so the
# Library/pickers can list, filter and delete them like any other asset.
MAX_UPLOAD_BYTES = 40 * 1024 * 1024  # 40MB — generous for a phone photo or a short clip


def _upload_kind(content_type: str) -> str:
    ct = (content_type or "").lower()
    if ct.startswith("image/"):
        return "image"
    if ct.startswith("video/"):
        return "video"
    if ct.startswith("audio/"):
        return "audio"
    return "file"


def _safe_filename(name: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", (name or "upload").strip()) or "upload"
    return name[-120:]


def _blob_headers():
    if not BLOB_READ_WRITE_TOKEN:
        raise HTTPException(status_code=500, detail="Uploads are not configured (need BLOB_READ_WRITE_TOKEN)")
    return {"Authorization": f"Bearer {BLOB_READ_WRITE_TOKEN}", "x-api-version": "7"}


def _blob_put(pathname: str, content: bytes, content_type: str) -> dict:
    resp = requests.put(
        f"https://blob.vercel-storage.com/{pathname}",
        headers={**_blob_headers(), "x-content-type": content_type or "application/octet-stream",
                 "x-add-random-suffix": "1"},
        data=content, timeout=90,
    )
    if resp.status_code not in (200, 201):
        logger.error("Blob PUT failed pathname=%s status=%s body=%s", pathname, resp.status_code, resp.text[:800])
        raise HTTPException(status_code=502, detail=f"Upload storage error {resp.status_code}: {resp.text[:400]}")
    return resp.json()


def _blob_delete(urls: List[str]):
    if not urls:
        return
    requests.delete(
        "https://blob.vercel-storage.com/delete",
        headers={**_blob_headers(), "Content-Type": "application/json"},
        json={"urls": urls}, timeout=30,
    )


def _row_to_upload(row: dict):
    return {
        "id": row["id"], "url": row["url"], "filename": row["filename"],
        "content_type": row["content_type"], "kind": row["kind"],
        "size": row["size"], "created_at": row["created_at"],
    }


@api_router.post("/upload")
async def create_upload(file: UploadFile = File(...)):
    await ensure_schema()
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File is larger than {MAX_UPLOAD_BYTES // (1024*1024)}MB")
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    content_type = file.content_type or "application/octet-stream"
    filename = _safe_filename(file.filename)
    pathname = f"uploads/{filename}"
    blob = await asyncio.to_thread(_blob_put, pathname, content, content_type)
    record = {
        "id": str(uuid.uuid4()), "url": blob.get("url"), "pathname": blob.get("pathname"),
        "filename": filename, "content_type": content_type, "kind": _upload_kind(content_type),
        "size": len(content), "created_at": now_iso(),
    }
    await d1_query(
        "INSERT INTO uploads (id, url, pathname, filename, content_type, kind, size, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [record["id"], record["url"], record["pathname"], record["filename"], record["content_type"],
         record["kind"], record["size"], record["created_at"]],
    )
    return _row_to_upload(record)


@api_router.get("/uploads")
async def list_uploads(kind: Optional[str] = None, limit: int = 60):
    await ensure_schema()
    limit = max(1, min(int(limit), 200))
    if kind:
        rows, _ = await d1_query("SELECT * FROM uploads WHERE kind = ? ORDER BY created_at DESC LIMIT ?", [kind, limit])
    else:
        rows, _ = await d1_query("SELECT * FROM uploads ORDER BY created_at DESC LIMIT ?", [limit])
    return [_row_to_upload(r) for r in rows]


@api_router.delete("/uploads/{upload_id}")
async def delete_upload(upload_id: str):
    await ensure_schema()
    rows, _ = await d1_query("DELETE FROM uploads WHERE id = ? RETURNING *", [upload_id])
    if not rows:
        raise HTTPException(status_code=404, detail="Upload not found")
    try:
        await asyncio.to_thread(_blob_delete, [rows[0]["url"]])
    except Exception:
        logger.exception("Could not delete blob for upload %s (D1 row already removed)", upload_id)
    return {"ok": True}


# ---------------- Content extraction (brand analysis + file-to-template) ----------------
# Every extraction below is either deterministic (real pixels via Pillow, real
# markup via regex/XML) or reads real extracted text before ever reaching the
# model. That second part matters: PoYo's own catalog types every chat model's
# `content` field as a plain string (verified against the real schema of every
# model this app uses) — there is no documented way to hand one of these
# models an image and get a vision analysis back, so this deliberately never
# pretends to "look at" a picture. What it can do honestly: read a raster
# image's actual pixels for color, read an SVG's or a webpage's actual markup
# for color/fonts, and read a PDF's or webpage's actual text for voice/tone.

def _fetch_bytes(url: str, max_bytes: int = 20 * 1024 * 1024) -> bytes:
    r = requests.get(url, timeout=30)
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Could not fetch {url} ({r.status_code})")
    if len(r.content) > max_bytes:
        raise HTTPException(status_code=413, detail="That file is too large to analyze")
    return r.content


def _dominant_colors(image_bytes: bytes, n: int = 6) -> List[str]:
    """A small palette of an image's most common colors, by real pixel count."""
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img.thumbnail((150, 150))
    paletted = img.quantize(colors=min(n, 16), method=Image.MEDIANCUT)
    palette = paletted.getpalette()
    counts = sorted(paletted.getcolors(), reverse=True)
    colors = []
    for _count, idx in counts[:n]:
        r, g, b = palette[idx * 3:idx * 3 + 3]
        colors.append(f"#{r:02x}{g:02x}{b:02x}")
    return colors


def _suggest_palette(hexes: List[str]) -> Dict[str, str]:
    """Assigns bg/fg/accent/sub roles to a raw color list using real HSV
    brightness/saturation — a heuristic, not a guess: the darkest and
    brightest colors become background/text (whichever way the source
    leans), the most saturated becomes the accent."""
    if not hexes:
        return {}

    def hsv(hexcode):
        r, g, b = (int(hexcode[i:i + 2], 16) / 255 for i in (1, 3, 5))
        return colorsys.rgb_to_hsv(r, g, b)

    scored = [(hx, *hsv(hx)) for hx in hexes]  # (hex, h, s, v)
    by_v = sorted(scored, key=lambda t: t[3])
    darkest, brightest = by_v[0][0], by_v[-1][0]
    avg_v = sum(t[3] for t in scored) / len(scored)
    bg, fg = (darkest, brightest) if avg_v < 0.5 else (brightest, darkest)
    by_sat = sorted(scored, key=lambda t: t[2], reverse=True)
    accent = next((t[0] for t in by_sat if t[0] not in (bg, fg)), by_sat[0][0])
    sub = next((hx for hx in hexes if hx not in (bg, fg, accent)), fg)
    return {"bg": bg, "fg": fg, "accent": accent, "sub": sub}


_HEX_RE = re.compile(r"#(?:[0-9a-fA-F]{3}){1,2}\b")
_RGB_RE = re.compile(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)")
_FONT_FAMILY_RE = re.compile(r"font-family\s*[:=]\s*[\"']?([^;\"'>]+)", re.IGNORECASE)
_GENERIC_FONTS = {"inherit", "sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui"}


def _extract_colors_and_fonts(markup: str) -> (List[str], List[str]):
    """Shared regex pass over any color-bearing markup (SVG or HTML/CSS)."""
    hexes = []
    for m in _HEX_RE.finditer(markup):
        h = m.group(0).lower()
        if len(h) == 4:
            h = "#" + "".join(c * 2 for c in h[1:])
        if h not in hexes:
            hexes.append(h)
    for m in _RGB_RE.finditer(markup):
        r, g, b = (int(x) for x in m.groups())
        h = f"#{r:02x}{g:02x}{b:02x}"
        if h not in hexes:
            hexes.append(h)
    # Pure black/white are usually outlines or page background, not "the
    # brand's colors" — drop them unless they're all we found.
    filtered = [h for h in hexes if h not in ("#ffffff", "#000000")]
    hexes = filtered or hexes

    fonts = []
    for m in _FONT_FAMILY_RE.finditer(markup):
        name = m.group(1).split(",")[0].strip().strip("'\"")
        if name and name.lower() not in _GENERIC_FONTS and name not in fonts:
            fonts.append(name)
    return hexes[:8], fonts[:3]


def _pdf_extract(pdf_bytes: bytes, max_pages: int = 20) -> Dict[str, Any]:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    pages = reader.pages[:max_pages]
    page_texts = [(p.extract_text() or "").strip() for p in pages]
    full_text = "\n\n".join(t for t in page_texts if t)
    first_image = None
    for p in pages:
        try:
            for img in p.images:
                first_image = img.data
                break
        except Exception:
            pass
        if first_image:
            break
    return {"page_count": len(reader.pages), "text": full_text[:8000], "page_texts": page_texts, "first_image": first_image}


def _pptx_extract(pptx_bytes: bytes, max_slides: int = 30) -> List[Dict[str, str]]:
    prs = Presentation(io.BytesIO(pptx_bytes))
    slides = []
    for slide in list(prs.slides)[:max_slides]:
        title, body_parts = "", []
        for shape in slide.shapes:
            if not getattr(shape, "has_text_frame", False):
                continue
            text = "\n".join(p.text for p in shape.text_frame.paragraphs if p.text).strip()
            if not text:
                continue
            if shape == slide.shapes.title and not title:
                title = text
            else:
                body_parts.append(text)
        slides.append({"heading": title, "body": " ".join(body_parts)[:500]})
    return slides


_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_META_DESC_RE = re.compile(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)', re.IGNORECASE)
_OG_IMAGE_RE = re.compile(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)', re.IGNORECASE)
_ICON_RE = re.compile(r'<link[^>]+rel=["\'][^"\']*icon[^"\']*["\'][^>]+href=["\']([^"\']+)', re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")


def _url_analysis(url: str) -> Dict[str, Any]:
    r = requests.get(url, timeout=20, headers={"User-Agent": "Mozilla/5.0 (compatible; CreateOSBot/1.0)"})
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Could not fetch that page ({r.status_code})")
    html = r.text[:400000]
    title_m, desc_m = _TITLE_RE.search(html), _META_DESC_RE.search(html)
    og_m, icon_m = _OG_IMAGE_RE.search(html), _ICON_RE.search(html)
    logo_url = urljoin(url, (og_m or icon_m).group(1)) if (og_m or icon_m) else None
    hexes, fonts = _extract_colors_and_fonts(html)
    body_text = re.sub(r"\s+", " ", _TAG_RE.sub(" ", html)).strip()[:6000]
    return {
        "title": title_m.group(1).strip() if title_m else "",
        "description": desc_m.group(1).strip() if desc_m else "",
        "logo_url": logo_url, "colors": hexes, "fonts": fonts, "text": body_text,
    }


async def _infer_voice_style(text: str, context: str, model: str) -> Dict[str, str]:
    """The one AI call in this whole section — and it only ever reads text
    that was really extracted, never an image."""
    if not text or not text.strip():
        return {"voice": "", "style": "", "suggested_name": ""}
    system = (
        f"You are a brand strategist. Read this real text extracted from {context} and infer the "
        "brand's voice and style. Return ONLY JSON: "
        '{"voice": "2-3 sentences describing tone, vocabulary and personality, written as instructions '
        'for a copywriter", "style": "2-3 sentences describing visual/design style as implied by the '
        'words used (e.g. minimal, playful, technical, luxury) — note that this is inferred from text, '
        'not a visual inspection", "suggested_name": "a plausible brand name if one clearly appears in '
        'the text, else an empty string"}'
    )
    content = await chat(
        [{"role": "system", "content": system}, {"role": "user", "content": text[:6000]}], model, 0.6, 500
    )
    data = _extract_json(content) or {}
    return {
        "voice": data.get("voice", "") or "", "style": data.get("style", "") or "",
        "suggested_name": data.get("suggested_name", "") or "",
    }


class BrandAnalyzeRequest(BaseModel):
    source_type: str  # image | pdf | svg | url
    source_url: str
    model: Optional[str] = None


@api_router.post("/brand-kit/analyze")
async def analyze_brand_source(req: BrandAnalyzeRequest):
    """Never auto-saves — returns a preview the Brand Kit page lets you review
    (and edit) before Save actually commits anything."""
    model = req.model or CHAT_MODEL
    result = {"colors": {}, "fonts": {}, "style": "", "voice": "", "logo_url": None,
              "detected_name": "", "source_note": ""}

    if req.source_type == "image":
        data = await asyncio.to_thread(_fetch_bytes, req.source_url)
        try:
            hexes = await asyncio.to_thread(_dominant_colors, data)
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Couldn't read that image: {e}")
        result["colors"] = _suggest_palette(hexes)
        result["logo_url"] = req.source_url
        result["source_note"] = ("Palette extracted directly from the image's pixels. Fonts and voice "
                                 "can't be read from a picture — fill those in yourself, or analyze a "
                                 "PDF or website URL instead.")

    elif req.source_type == "svg":
        data = await asyncio.to_thread(_fetch_bytes, req.source_url, 2 * 1024 * 1024)
        hexes, fonts = _extract_colors_and_fonts(data.decode("utf-8", errors="ignore"))
        if hexes:
            result["colors"] = _suggest_palette(hexes)
        if fonts:
            result["fonts"] = {"display": fonts[0], "body": fonts[-1]}
        result["logo_url"] = req.source_url
        result["source_note"] = ("Colors and fonts read directly from the SVG's markup." if (hexes or fonts)
                                 else "No explicit colors or fonts found in this SVG's markup.")

    elif req.source_type == "pdf":
        data = await asyncio.to_thread(_fetch_bytes, req.source_url)
        pdf = await asyncio.to_thread(_pdf_extract, data)
        if pdf["first_image"]:
            try:
                hexes = await asyncio.to_thread(_dominant_colors, pdf["first_image"])
                result["colors"] = _suggest_palette(hexes)
            except Exception:
                pass
        voice = await _infer_voice_style(pdf["text"], f"a {pdf['page_count']}-page PDF", model)
        result["voice"], result["style"], result["detected_name"] = voice["voice"], voice["style"], voice["suggested_name"]
        note = f"Voice and style inferred from the PDF's actual text ({pdf['page_count']} pages read)."
        note += " A color palette was pulled from an image embedded in the PDF." if pdf["first_image"] else " No embedded image found to pull colors from."
        result["source_note"] = note

    elif req.source_type == "url":
        page = await asyncio.to_thread(_url_analysis, req.source_url)
        if page["colors"]:
            result["colors"] = _suggest_palette(page["colors"])
        if page["fonts"]:
            result["fonts"] = {"display": page["fonts"][0], "body": page["fonts"][-1]}
        result["logo_url"] = page["logo_url"]
        voice = await _infer_voice_style(f"{page['title']}\n{page['description']}\n{page['text']}", "a website's homepage", model)
        result["voice"], result["style"] = voice["voice"], voice["style"]
        result["detected_name"] = voice["suggested_name"] or page["title"]
        result["source_note"] = "Colors read from the page's own CSS/markup; voice inferred from its real text."

    else:
        raise HTTPException(status_code=400, detail="source_type must be image, pdf, svg, or url")

    result["generation_id"] = await record_generation(
        "brand_analysis", req.source_url, model, output=json.dumps(result),
        title=f"Brand analysis — {req.source_type}", meta={"source_type": req.source_type},
    )
    return result


# ---------------- Custom templates (from an uploaded file) ----------------
class TemplateFromFileRequest(BaseModel):
    source_type: str  # pdf | pptx | image
    source_url: str
    name: Optional[str] = None
    model: Optional[str] = None


def _maybe_json(v, default):
    """Accepts either an already-parsed value (building a response straight
    from a freshly-inserted record) or the JSON text a D1 row stores it as."""
    return v if isinstance(v, (list, dict)) else json.loads(v or default)


def _row_to_visual_template(row: dict):
    return {
        "id": row["id"], "name": row["name"], "source_kind": row["source_kind"],
        "source_url": row["source_url"], "format": row["format"], "theme": row["theme"],
        "colors": _maybe_json(row.get("colors"), "{}"),
        "slides": _maybe_json(row.get("slides"), "[]"), "created_at": row["created_at"],
    }


# ---------------- Starter templates ----------------
# Original layouts shipped with the app, so the template library isn't empty
# before you've converted anything. They live in code rather than as seeded
# rows: nothing to migrate, nothing to re-seed after a delete, and they
# improve with a deploy. Each carries both an OUTLINE (what each slide is
# for, which the model writes against) and a LAYOUT (where the words sit),
# expressed in the same percentage-based element model the Composer's slide
# editor uses — so a built post is fully draggable from the first render.
#
# Colors and fonts are referenced by ROLE (colorRole: fg/sub/accent/bg,
# fontKind: display/body) rather than baked as hexes, so a starter template
# re-themes itself when the brand kit or theme changes.
def _t(role, x, y, w, h, size, weight=800, color="fg", align="left", lh=1.1, font="display", text=None):
    e = {"type": "text", "role": role, "x": x, "y": y, "w": w, "h": h, "fontSize": size,
         "fontWeight": weight, "colorRole": color, "align": align, "lineHeight": lh, "fontKind": font}
    if text is not None:
        e["text"] = text
    return e


def _bar(x, y, w, h, color="accent", opacity=1.0, shape="rect"):
    return {"type": "shape", "shape": shape, "x": x, "y": y, "w": w, "h": h,
            "colorRole": color, "opacity": opacity}


STARTER_TEMPLATES = [
    {
        "id": "starter:bold-hook", "name": "Bold Hook", "format": "carousel", "theme": "midnight",
        "description": "One big promise on the cover, one idea per slide, a close that asks for something.",
        "slides": [
            {"heading": "Open with the sharpest promise", "body": "The single outcome this post delivers"},
            {"heading": "Name the problem", "body": "Why the usual approach falls short"},
            {"heading": "Give the turn", "body": "The shift in thinking that fixes it"},
            {"heading": "Make it concrete", "body": "A specific example or number"},
            {"heading": "Close with the ask", "body": "What to do next"},
        ],
        "layouts": {
            "cover": [_bar(8, 13, 14, 1.4), _t("title", 8, 21, 84, 40, 38, 800, lh=1.05),
                      _t("static", 8, 86, 44, 6, 12, 700, "accent", font="body", text="SWIPE →")],
            "slide": [_bar(8, 12, 9, 6), _t("number", 8, 13.2, 9, 5, 16, 800, "bg", align="center"),
                      _t("heading", 8, 24, 84, 22, 26, 800, lh=1.1),
                      _t("body", 8, 50, 84, 32, 16, 400, "sub", lh=1.45, font="body")],
            "outro": [_t("heading", 8, 34, 84, 24, 30, 800, lh=1.1),
                      _t("body", 8, 60, 84, 20, 16, 400, "sub", lh=1.4, font="body"),
                      _bar(8, 85, 20, 1.4)],
        },
    },
    {
        "id": "starter:listicle", "name": "Numbered Listicle", "format": "carousel", "theme": "midnight",
        "description": "A '5 ways to…' countdown — a giant numeral anchors every slide.",
        "slides": [
            {"heading": "Promise the list", "body": "How many, and what they get from it"},
            {"heading": "First item", "body": "The most obvious one, said better"},
            {"heading": "Second item", "body": "The one they've heard but do wrong"},
            {"heading": "Third item", "body": "The one nobody talks about"},
            {"heading": "Fourth item", "body": "The one that compounds"},
            {"heading": "Fifth item", "body": "The one that ties it together"},
        ],
        "layouts": {
            "cover": [_t("static", 8, 14, 60, 6, 12, 700, "accent", font="body", text="SAVE THIS"),
                      _t("title", 8, 26, 84, 40, 36, 800, lh=1.05)],
            "slide": [_t("number", 8, 15, 26, 26, 64, 900, "accent", lh=1),
                      _t("heading", 8, 44, 84, 18, 24, 800, lh=1.1),
                      _t("body", 8, 63, 84, 26, 15, 400, "sub", lh=1.45, font="body")],
        },
    },
    {
        "id": "starter:myth-fact", "name": "Myth vs Fact", "format": "carousel", "theme": "chalkboard",
        "description": "Correct a misconception per slide — the format people save and forward.",
        "slides": [
            {"heading": "Name the belief you're about to break", "body": "Why so many people hold it"},
            {"heading": "The first myth", "body": "What's actually true, and the evidence"},
            {"heading": "The second myth", "body": "What's actually true, and the evidence"},
            {"heading": "The third myth", "body": "What's actually true, and the evidence"},
            {"heading": "What to believe instead", "body": "The one rule that replaces all three"},
        ],
        "layouts": {
            "cover": [_t("static", 8, 16, 60, 6, 12, 700, "accent", font="body", text="MYTH vs FACT"),
                      _t("title", 8, 30, 84, 38, 34, 800, lh=1.05)],
            "slide": [_t("static", 8, 12, 24, 5, 12, 800, "accent", font="body", text="MYTH"),
                      _t("heading", 8, 19, 84, 22, 22, 700, "sub", lh=1.15),
                      _bar(8, 45, 84, 0.4, "sub", 0.4),
                      _t("static", 8, 51, 24, 5, 12, 800, "accent", font="body", text="FACT"),
                      _t("body", 8, 58, 84, 30, 18, 600, lh=1.35, font="body")],
        },
    },
    {
        "id": "starter:before-after", "name": "Before / After", "format": "carousel", "theme": "whiteboard",
        "description": "Two stacked panels per slide — the old way above, the better way below.",
        "slides": [
            {"heading": "Set up the transformation", "body": "Where people start and where they could be"},
            {"heading": "The old way", "body": "What replaces it"},
            {"heading": "The old habit", "body": "The new habit"},
            {"heading": "The old result", "body": "The new result"},
            {"heading": "How to start today", "body": "The first small step"},
        ],
        "layouts": {
            "cover": [_t("static", 8, 16, 60, 6, 12, 700, "accent", font="body", text="BEFORE / AFTER"),
                      _t("title", 8, 30, 84, 38, 34, 800, lh=1.05)],
            "slide": [_bar(8, 12, 84, 36, "sub", 0.12),
                      _t("static", 12, 15, 32, 5, 11, 800, "sub", font="body", text="BEFORE"),
                      _t("heading", 12, 22, 76, 24, 20, 700, lh=1.2),
                      _bar(8, 52, 84, 36, "accent", 0.15),
                      _t("static", 12, 55, 32, 5, 11, 800, "accent", font="body", text="AFTER"),
                      _t("body", 12, 62, 76, 24, 20, 700, lh=1.2, font="body")],
        },
    },
    {
        "id": "starter:how-to", "name": "How-To Steps", "format": "carousel", "theme": "whiteboard",
        "description": "Outcome first, then numbered steps someone can actually follow.",
        "slides": [
            {"heading": "Promise the outcome", "body": "What they'll be able to do by the end"},
            {"heading": "Step one", "body": "The setup nobody should skip"},
            {"heading": "Step two", "body": "The part that does the real work"},
            {"heading": "Step three", "body": "How to check it worked"},
            {"heading": "The mistake to avoid", "body": "What goes wrong and how to catch it"},
        ],
        "layouts": {
            "cover": [_t("static", 8, 14, 60, 6, 12, 700, "accent", font="body", text="STEP BY STEP"),
                      _t("title", 8, 24, 84, 40, 34, 800, lh=1.05)],
            "slide": [_bar(8, 12, 24, 6, "accent", 0.9),
                      _t("step", 8, 13.3, 24, 5, 12, 800, "bg", align="center", font="body"),
                      _t("heading", 8, 24, 84, 20, 24, 800, lh=1.1),
                      _t("body", 8, 47, 84, 36, 16, 400, "sub", lh=1.45, font="body")],
        },
    },
    {
        "id": "starter:stat-drop", "name": "Stat Drop", "format": "single", "theme": "midnight",
        "description": "One number, huge, with the context that makes it land.",
        "slides": [{"heading": "Lead with the number", "body": "The context that makes it matter"}],
        "layouts": {
            "cover": [_t("static", 8, 16, 60, 6, 12, 700, "accent", font="body", text="BY THE NUMBERS"),
                      _t("title", 8, 26, 84, 40, 46, 900, lh=1),
                      _t("body", 8, 70, 84, 16, 16, 400, "sub", lh=1.4, font="body"),
                      _bar(8, 88, 24, 1.4)],
        },
    },
    {
        "id": "starter:quote-card", "name": "Quote Card", "format": "single", "theme": "gradient",
        "description": "A single line worth screenshotting, with room to breathe.",
        "slides": [{"heading": "The line worth quoting", "body": "Who said it"}],
        "layouts": {
            "cover": [_t("static", 8, 10, 22, 20, 72, 800, "accent", lh=1, text="“"),
                      _t("title", 8, 32, 84, 40, 30, 700, lh=1.3),
                      _t("body", 8, 78, 84, 8, 14, 600, "sub", font="body")],
        },
    },
    {
        "id": "starter:reel-hook", "name": "Reel Hook Frames", "format": "reel", "theme": "midnight",
        "description": "Vertical frames: the hook up top, the spoken line in a lower third.",
        "slides": [
            {"heading": "Hook them in three seconds", "body": "The line you say over the opening shot"},
            {"heading": "Set the stakes", "body": "Why this matters right now"},
            {"heading": "Deliver the insight", "body": "The thing they came for"},
            {"heading": "Tell them what to do", "body": "The single next step"},
        ],
        "layouts": {
            "slide": [_t("heading", 8, 12, 84, 28, 32, 800, lh=1.1),
                      _bar(0, 74, 100, 26, "bg", 0.55),
                      _t("body", 8, 79, 84, 18, 16, 500, lh=1.35, font="body")],
        },
    },
]

STARTER_BY_ID = {t["id"]: t for t in STARTER_TEMPLATES}


def _starter_as_template(t: dict) -> dict:
    """A starter rendered in the same shape the library and the Composer's
    picker already speak, so neither needs to know it isn't a saved row."""
    return {
        "id": t["id"], "name": t["name"], "source_kind": "starter", "source_url": "",
        "format": t["format"], "theme": t["theme"], "colors": {}, "slides": t["slides"],
        "description": t["description"], "builtin": True, "created_at": "",
    }


def _fill_layout(layout: List[Dict[str, Any]], spec: dict, index: int) -> List[Dict[str, Any]]:
    """Pours a generated slide's copy into a starter layout. Roles that have
    no copy to receive are dropped rather than left as empty boxes."""
    out = []
    for src in layout:
        el = {**src, "id": f"el_{uuid.uuid4().hex[:7]}"}
        role = el.get("role")
        if el["type"] == "text" and "text" not in el:
            if role == "title":
                el["text"] = spec.get("title") or spec.get("heading") or ""
            elif role == "heading":
                el["text"] = spec.get("heading") or spec.get("title") or ""
            elif role == "body":
                el["text"] = spec.get("body") or ""
            elif role == "number":
                el["text"] = str(spec.get("index") or index)
            elif role == "step":
                el["text"] = f"STEP {spec.get('index') or index}"
            else:
                el["text"] = ""
        if el["type"] == "text" and not (el.get("text") or "").strip():
            continue
        out.append(el)
    return out


def _apply_template_layouts(assets: List[Dict[str, Any]], template: dict) -> List[Dict[str, Any]]:
    """Gives every generated slide the template's layout — the model writes
    the words, the template decides where they sit, and the result is still
    fully editable in the Composer."""
    layouts = (template or {}).get("layouts") or {}
    if not layouts:
        return assets
    last = len(assets) - 1
    for i, asset in enumerate(assets):
        spec = asset["spec"]
        if i == 0 and spec.get("template") == "cover" and layouts.get("cover"):
            key = "cover"
        elif i == last and last > 0 and layouts.get("outro"):
            key = "outro"
        else:
            key = "slide"
        layout = layouts.get(key) or layouts.get("slide") or layouts.get("cover")
        if layout:
            spec["elements"] = _fill_layout(layout, spec, i)
    return assets


async def _abstract_slides(slides: List[Dict[str, str]], model: str) -> List[Dict[str, str]]:
    """Turns a specific deck/PDF's real content into a reusable outline — e.g.
    "Q3 Revenue Growth" becomes "State the headline metric" — so the template
    fits any future topic, not just the document it came from."""
    raw = "\n\n".join(f"Slide {i+1}: {s['heading']}\n{s['body']}" for i, s in enumerate(slides) if s["heading"] or s["body"])
    if not raw.strip():
        return slides
    system = (
        "You turn a specific slide deck into a reusable content template. For each slide, replace its "
        "specific content with a short generic instruction describing that slide's PURPOSE in the "
        "narrative (e.g. 'State the headline metric', 'Introduce the problem', 'Give the contrarian "
        "take'), so someone could reuse this exact structure for a completely different topic. Keep the "
        f'same number of slides ({len(slides)}). Return ONLY JSON: {{"slides": [{{"heading": "short '
        'instruction for this slide\'s heading, max 50 chars", "body": "short instruction for this '
        'slide\'s body, max 100 chars"}}]}}'
    )
    content = await chat([{"role": "system", "content": system}, {"role": "user", "content": raw[:6000]}], model, 0.6, 1200)
    data = _extract_json(content)
    abstracted = data.get("slides") if data else None
    if not abstracted or len(abstracted) != len(slides):
        return slides  # fall back to the real content rather than lose slides
    return [{"heading": s.get("heading", ""), "body": s.get("body", "")} for s in abstracted]


@api_router.post("/templates/from-file")
async def create_template_from_file(req: TemplateFromFileRequest):
    await ensure_schema()
    model = req.model or CHAT_MODEL
    colors: Dict[str, str] = {}

    if req.source_type == "pptx":
        data = await asyncio.to_thread(_fetch_bytes, req.source_url)
        raw_slides = await asyncio.to_thread(_pptx_extract, data)
        if not raw_slides:
            raise HTTPException(status_code=422, detail="Couldn't find any slide text in that PPTX")
        slides = await _abstract_slides(raw_slides, model)
        fmt, theme, source_kind = "carousel", "midnight", "pptx"

    elif req.source_type == "pdf":
        data = await asyncio.to_thread(_fetch_bytes, req.source_url)
        pdf = await asyncio.to_thread(_pdf_extract, data)
        raw_slides = [{"heading": f"Page {i+1}", "body": t[:500]} for i, t in enumerate(pdf["page_texts"]) if t]
        if not raw_slides:
            raise HTTPException(status_code=422, detail="Couldn't find any text in that PDF")
        slides = await _abstract_slides(raw_slides, model)
        theme = "midnight"
        if pdf["first_image"]:
            try:
                hexes = await asyncio.to_thread(_dominant_colors, pdf["first_image"])
                colors = _suggest_palette(hexes)
            except Exception:
                pass
        fmt, source_kind = "carousel", "pdf"

    elif req.source_type == "image":
        data = await asyncio.to_thread(_fetch_bytes, req.source_url)
        try:
            hexes = await asyncio.to_thread(_dominant_colors, data)
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Couldn't read that image: {e}")
        colors = _suggest_palette(hexes)  # a single visual has no slide structure, just a palette
        slides, fmt, theme, source_kind = [], "single", "midnight", "image"

    else:
        raise HTTPException(status_code=400, detail="source_type must be pdf, pptx, or image")

    record = {
        "id": str(uuid.uuid4()), "name": req.name or f"{req.source_type.upper()} template",
        "source_kind": source_kind, "source_url": req.source_url, "format": fmt, "theme": theme,
        "colors": colors, "slides": slides, "created_at": now_iso(),
    }
    await d1_query(
        "INSERT INTO visual_templates (id, name, source_kind, source_url, format, theme, colors, slides, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [record["id"], record["name"], record["source_kind"], record["source_url"], record["format"],
         record["theme"], json.dumps(record["colors"]), json.dumps(record["slides"]), record["created_at"]],
    )
    return _row_to_visual_template(record)


@api_router.get("/templates/custom")
async def list_custom_templates():
    """The user's converted templates first (newest first), then the starters
    that ship with the app — one list, so the picker has something to offer
    on day one."""
    await ensure_schema()
    rows, _ = await d1_query("SELECT * FROM visual_templates ORDER BY created_at DESC LIMIT 100")
    return [_row_to_visual_template(r) for r in rows] + [_starter_as_template(t) for t in STARTER_TEMPLATES]


@api_router.delete("/templates/custom/{template_id}")
async def delete_custom_template(template_id: str):
    await ensure_schema()
    if template_id in STARTER_BY_ID:
        raise HTTPException(status_code=400, detail="Starter templates ship with the app and can't be deleted")
    rows, _ = await d1_query("DELETE FROM visual_templates WHERE id = ? RETURNING id", [template_id])
    if not rows:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"ok": True}


@api_router.post("/ai/generate")
async def ai_generate(req: GenerateRequest):
    opts = req.options or {}
    prompt = req.prompt
    if opts.get("use_brand"):
        brand = await load_brand(opts.get("brand_kit_id"))
        colors = (brand.get("colors") or {}).get(brand.get("color_mode") or "dark", {})
        palette = ", ".join(v for v in [colors.get("bg"), colors.get("accent"), colors.get("fg")] if v)
        if palette:
            prompt = f"{prompt}. Colour palette: {palette}. Keep the image free of any text or lettering."

    if req.kind == "image":
        model = opts.get("model", "gpt-image-2")
        payload = {"prompt": prompt, "size": opts.get("size", "1:1")}
        if model.startswith("gpt-image"):
            payload["quality"] = opts.get("quality", "medium")
        if opts.get("resolution"):
            payload["resolution"] = opts["resolution"]
        # A non-empty image_urls turns every one of these models from
        # text-to-image into reference-image editing (verified per-model:
        # gpt-image-2, nano-banana-2/-pro, qwen-image-3, flux-dev, z-image all
        # accept it under this exact field name).
        if opts.get("image_urls"):
            payload["image_urls"] = opts["image_urls"]
    elif req.kind == "video":
        # Video models differ a lot in accepted fields (resolution/aspect_ratio/
        # duration ranges, and the audio flag is named generate_audio, sound, or
        # audio depending on the model) — the frontend already knows the selected
        # model's real shape, so forward whatever it sent rather than guessing a
        # one-size-fits-all payload here.
        model = opts.get("model", "seedance-2-fast")
        payload = {"prompt": prompt, **{k: v for k, v in opts.items() if k not in ("model", "use_brand")}}
        if "duration" in payload:
            payload["duration"] = int(payload["duration"])
    elif req.kind == "music":
        reference_urls = opts.get("reference_urls") or []
        if reference_urls:
            # Mashup is a distinct PoYo model, not an option on generate-music:
            # it blends exactly two uploaded tracks into a new one.
            if len(reference_urls) != 2:
                raise HTTPException(status_code=400, detail="Mashup needs exactly two reference tracks")
            model = "generate-mashup"
            payload = {
                "prompt": prompt,
                "custom_mode": False,
                "instrumental": bool(opts.get("instrumental", False)),
                "mv": opts.get("mv", "V4_5"),
                "upload_url_list": reference_urls,
            }
        else:
            model = "generate-music"
            payload = {
                "prompt": prompt,
                "custom_mode": False,
                "instrumental": bool(opts.get("instrumental", False)),
                "mv": opts.get("mv", "V4_5"),
            }
    elif req.kind == "voice":
        model = opts.get("model", "elevenlabs-tts-turbo-2-5")
        payload = {"text": req.prompt, **{k: v for k, v in opts.items() if k not in ("model", "use_brand")}}
    else:
        raise HTTPException(status_code=400, detail="kind must be image, video, music, or voice")

    task_id, status = await asyncio.to_thread(_poyo_submit, model, payload)
    gid = await record_generation(req.kind, req.prompt, model, task_id=task_id,
                                  status=status, meta={"options": opts})
    return {"id": gid, "task_id": task_id, "status": status, "kind": req.kind}


@api_router.get("/ai/task/{task_id}")
async def ai_task(task_id: str):
    data = await asyncio.to_thread(_poyo_status, task_id)
    status = data.get("status", "running")
    files = data.get("files", []) or []
    await d1_query(
        "UPDATE generations SET status = ?, files = ?, progress = ?, error_message = ?, updated_at = ? "
        "WHERE task_id = ?",
        [status, json.dumps(files), data.get("progress", 0), data.get("error_message"), now_iso(), task_id],
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
    await ensure_schema()
    rows, _ = await d1_query(
        "SELECT * FROM generations WHERE status = 'finished' AND task_id != '' "
        "ORDER BY created_at DESC LIMIT ?", [limit]
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


# ---------------- Brand kit ----------------
# Any number of named kits per workspace, one marked default. Each kit feeds
# three consumers: copy prompts, image prompts, and the client-side visual
# renderer. Colors are two full palettes (dark/light) under the bg/fg/accent/
# sub role names every renderer already speaks — labeled to the user as
# Primary/Secondary/Tertiary/Muted, but kept under those keys so VisualCard,
# PostPreview and the image-prompt palette injection don't need to know about
# the rename. color_mode picks which palette this kit currently renders with.
DEFAULT_DARK_COLORS = {"bg": "#0A0A0A", "fg": "#FFFFFF", "accent": "#E2FF3D", "sub": "#a1a1aa"}
DEFAULT_LIGHT_COLORS = {"bg": "#FFFFFF", "fg": "#0A0A0A", "accent": "#0047FF", "sub": "#6b7280"}
DEFAULT_BRAND = {
    "name": "Default brand",
    "colors": {"dark": DEFAULT_DARK_COLORS, "light": DEFAULT_LIGHT_COLORS},
    "color_mode": "dark",
    "fonts": {"display": "Inter", "body": "Inter"},
    "logo_url": None,
    "handle": "",
    "voice": "",
    "style": "",
    "audience": "",
    "hashtags": [],
    "cta": "",
    "banned_words": [],
}


class BrandKitUpdate(BaseModel):
    name: Optional[str] = None
    colors: Optional[Dict[str, Dict[str, str]]] = None
    color_mode: Optional[str] = None
    fonts: Optional[Dict[str, str]] = None
    logo_url: Optional[str] = None
    handle: Optional[str] = None
    voice: Optional[str] = None
    style: Optional[str] = None
    audience: Optional[str] = None
    hashtags: Optional[List[str]] = None
    cta: Optional[str] = None
    banned_words: Optional[List[str]] = None
    is_default: Optional[bool] = None


def _normalize_colors(raw) -> dict:
    """Upgrades a legacy flat {bg,fg,accent,sub} palette (every kit saved
    before dark/light existed) into {dark:{...}, light:{...}}."""
    if isinstance(raw, dict) and "dark" in raw:
        return {
            "dark": {**DEFAULT_DARK_COLORS, **(raw.get("dark") or {})},
            "light": {**DEFAULT_LIGHT_COLORS, **(raw.get("light") or {})},
        }
    flat = raw if isinstance(raw, dict) else {}
    return {"dark": {**DEFAULT_DARK_COLORS, **flat}, "light": DEFAULT_LIGHT_COLORS}


def _row_to_brand(row: dict):
    return {
        "id": row["id"],
        "name": row["name"],
        "is_default": bool(row.get("is_default")),
        "colors": _normalize_colors(json.loads(row["colors"] or "{}")),
        "color_mode": row.get("color_mode") or "dark",
        "fonts": json.loads(row["fonts"] or "{}") or DEFAULT_BRAND["fonts"],
        "logo_url": row["logo_url"],
        "handle": row["handle"] or "",
        "voice": row["voice"] or "",
        "style": row["style"] or "",
        "audience": row["audience"] or "",
        "hashtags": json.loads(row["hashtags"] or "[]"),
        "cta": row["cta"] or "",
        "banned_words": json.loads(row["banned_words"] or "[]"),
        "updated_at": row["updated_at"],
    }


async def load_brand(brand_kit_id: Optional[str] = None) -> dict:
    """A brand kit, or sane defaults. Never raises — an unconfigured or
    unreachable kit degrades to generic copy rather than a failed generation.
    An id that no longer exists (a deleted kit an old post still points at)
    falls back to the account's default kit rather than failing."""
    try:
        await ensure_schema()
        if brand_kit_id:
            rows, _ = await d1_query("SELECT * FROM brand_kits WHERE id = ?", [brand_kit_id])
            if rows:
                return _row_to_brand(rows[0])
        rows, _ = await d1_query("SELECT * FROM brand_kits ORDER BY is_default DESC, created_at ASC LIMIT 1")
        if rows:
            return _row_to_brand(rows[0])
    except Exception:
        logger.exception("Could not load brand kit")
    return {"id": None, "is_default": True, **DEFAULT_BRAND, "updated_at": None}


def brand_prompt(brand: dict) -> str:
    """The brand kit rendered as prompt text. Returns '' when nothing is filled
    in, so an empty kit adds no noise to the prompt."""
    bits = []
    if brand.get("name") and brand["name"] != DEFAULT_BRAND["name"]:
        bits.append(f"Brand name: {brand['name']}.")
    if brand.get("voice"):
        bits.append(f"Brand voice: {brand['voice']}.")
    if brand.get("style"):
        bits.append(f"Visual style: {brand['style']}.")
    if brand.get("audience"):
        bits.append(f"Audience: {brand['audience']}.")
    if brand.get("cta"):
        bits.append(f"Preferred call to action: {brand['cta']}.")
    if brand.get("hashtags"):
        bits.append(f"Signature hashtags to consider: {' '.join(brand['hashtags'][:8])}.")
    if brand.get("banned_words"):
        bits.append(f"Never use these words or phrases: {', '.join(brand['banned_words'][:20])}.")
    if not bits:
        return ""
    return " BRAND CONTEXT — follow it closely: " + " ".join(bits)


@api_router.get("/brand-kits")
async def list_brand_kits():
    await ensure_schema()
    rows, _ = await d1_query("SELECT * FROM brand_kits ORDER BY is_default DESC, created_at ASC")
    if not rows:
        return [{"id": None, "is_default": True, **DEFAULT_BRAND, "updated_at": None}]
    return [_row_to_brand(r) for r in rows]


@api_router.post("/brand-kits")
async def create_brand_kit(upd: BrandKitUpdate):
    await ensure_schema()
    changes = {k: v for k, v in upd.model_dump().items() if v is not None and k != "is_default"}
    merged = {**DEFAULT_BRAND, **changes}
    if not changes.get("name"):
        merged["name"] = "New brand kit"
    merged["colors"] = _normalize_colors(merged["colors"])
    ts = now_iso()
    rows, _ = await d1_query("SELECT COUNT(*) AS n FROM brand_kits")
    is_first = not rows or not rows[0]["n"]
    out, _ = await d1_query(
        "INSERT INTO brand_kits (id, name, colors, color_mode, fonts, logo_url, handle, voice, style, audience, "
        "hashtags, cta, banned_words, is_default, updated_at, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
        [str(uuid.uuid4()), merged["name"], json.dumps(merged["colors"]), merged["color_mode"],
         json.dumps(merged["fonts"]), merged["logo_url"], merged["handle"], merged["voice"], merged["style"],
         merged["audience"], json.dumps(merged["hashtags"]), merged["cta"], json.dumps(merged["banned_words"]),
         1 if is_first else 0, ts, ts],
    )
    return _row_to_brand(out[0])


@api_router.get("/brand-kits/{kit_id}")
async def get_brand_kit(kit_id: str):
    await ensure_schema()
    rows, _ = await d1_query("SELECT * FROM brand_kits WHERE id = ?", [kit_id])
    if not rows:
        raise HTTPException(status_code=404, detail="Brand kit not found")
    return _row_to_brand(rows[0])


@api_router.put("/brand-kits/{kit_id}")
async def update_brand_kit(kit_id: str, upd: BrandKitUpdate):
    await ensure_schema()
    rows, _ = await d1_query("SELECT * FROM brand_kits WHERE id = ?", [kit_id])
    if not rows:
        raise HTTPException(status_code=404, detail="Brand kit not found")
    changes = {k: v for k, v in upd.model_dump().items() if v is not None and k != "is_default"}
    merged = {**_row_to_brand(rows[0]), **changes}
    merged["colors"] = _normalize_colors(merged["colors"])
    ts = now_iso()
    out, _ = await d1_query(
        "UPDATE brand_kits SET name=?, colors=?, color_mode=?, fonts=?, logo_url=?, handle=?, voice=?, style=?, "
        "audience=?, hashtags=?, cta=?, banned_words=?, updated_at=? WHERE id=? RETURNING *",
        [merged["name"], json.dumps(merged["colors"]), merged["color_mode"], json.dumps(merged["fonts"]),
         merged["logo_url"], merged["handle"], merged["voice"], merged["style"], merged["audience"],
         json.dumps(merged["hashtags"]), merged["cta"], json.dumps(merged["banned_words"]), ts, kit_id],
    )
    if upd.is_default:
        await d1_query("UPDATE brand_kits SET is_default = 0 WHERE id != ?", [kit_id])
        await d1_query("UPDATE brand_kits SET is_default = 1 WHERE id = ?", [kit_id])
        out, _ = await d1_query("SELECT * FROM brand_kits WHERE id = ?", [kit_id])
    return _row_to_brand(out[0])


@api_router.delete("/brand-kits/{kit_id}")
async def delete_brand_kit(kit_id: str):
    await ensure_schema()
    rows, _ = await d1_query("DELETE FROM brand_kits WHERE id = ? RETURNING is_default", [kit_id])
    if not rows:
        raise HTTPException(status_code=404, detail="Brand kit not found")
    if rows[0]["is_default"]:
        remaining, _ = await d1_query("SELECT id FROM brand_kits ORDER BY created_at ASC LIMIT 1")
        if remaining:
            await d1_query("UPDATE brand_kits SET is_default = 1 WHERE id = ?", [remaining[0]["id"]])
    return {"ok": True}


# ---------------- Brand knowledge base ----------------
# A brand kit captures how the brand SOUNDS. This captures what it KNOWS:
# values, philosophy, previous work, case studies, inspiration, audience
# research, offers, house rules. Documents belong to a kit (or to every kit
# when brand_kit_id is NULL) and reach a generation two different ways:
#
#   PINNED    — short, load-bearing truths (positioning, non-negotiables,
#               claims you must never make). Injected into every generation,
#               never left to a retriever's judgement.
#   RETRIEVED — everything else, scored against the topic at hand and
#               included only when relevant, within a character budget.
#
# Retrieval is lexical (BM25), not semantic: PoYo's catalogue is chat and
# media generation only — it publishes no embedding or reranking model — so
# there is no honest way to compute vectors with the provider this app
# already uses. BM25 over a brand's own corpus (tens to hundreds of
# documents, sharing the brand's vocabulary) is a genuinely good fit rather
# than a consolation prize, and it costs no extra model call or latency.
# The chunks table carries an `embedding` column so that if an embedding
# provider is ever configured, vectors slot in beside this without a
# migration or a change to any caller.
KNOWLEDGE_KINDS = [
    "values", "philosophy", "story", "product", "case_study",
    "inspiration", "audience", "offer", "faq", "guideline", "note",
]

# Deliberately small: the corpus is one brand's own writing, so common words
# carry less signal than they would across mixed domains, and IDF handles the
# rest without a big hand-maintained list.
_STOPWORDS = {
    "the", "and", "for", "are", "but", "not", "you", "your", "with", "that", "this", "from", "they",
    "have", "has", "was", "were", "our", "out", "how", "why", "what", "when", "who", "all", "can",
    "will", "just", "its", "it's", "about", "into", "than", "then", "them", "some", "more", "most",
    "any", "been", "being", "would", "could", "should", "there", "their", "these", "those", "over",
}


# Longest first, so "ization" is stripped before "tion" and "s". This is
# deliberately cruder than a Porter stemmer: retrieval only needs the query
# and the documents reduced the SAME way, so a linguistically wrong stem
# ("business" -> "busi") still matches correctly as long as it's consistent.
# Without it, a search for "discount" misses a document that says
# "discounting", which is exactly the miss that matters most here.
_SUFFIXES = ("ational", "iveness", "fulness", "ousness", "ization", "tional", "ements",
             "ement", "ments", "ances", "ences", "ingly", "ment", "ness", "tion", "sion",
             "able", "ible", "ance", "ence", "ing", "ies", "ied", "ers", "est", "ed", "ly", "er", "es", "s")


def _stem(token: str) -> str:
    for suffix in _SUFFIXES:
        if token.endswith(suffix) and len(token) - len(suffix) >= 3:
            return token[: -len(suffix)]
    return token


def _terms(text: str) -> List[str]:
    return [_stem(t) for t in re.findall(r"[a-z0-9][a-z0-9'\-]*", (text or "").lower())
            if len(t) > 2 and t not in _STOPWORDS]


def _chunk_text(text: str, target: int = 900, overlap: int = 150) -> List[str]:
    """Paragraph-aware chunking: keeps whole paragraphs together until the
    target size, then carries a little tail into the next chunk so a thought
    split across the boundary is still retrievable from either side."""
    text = (text or "").strip()
    if not text:
        return []
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: List[str] = []
    current = ""
    for para in paragraphs:
        # A single oversized paragraph is split on sentence boundaries.
        pieces = [para] if len(para) <= target else re.findall(r"[^.!?]+[.!?]*", para)
        for piece in pieces:
            piece = piece.strip()
            if not piece:
                continue
            if current and len(current) + len(piece) + 2 > target:
                chunks.append(current.strip())
                current = (current[-overlap:] + " " if overlap else "") + piece
            else:
                current = f"{current}\n\n{piece}".strip() if current else piece
    if current.strip():
        chunks.append(current.strip())
    return chunks[:120]  # a hard ceiling so one huge upload can't dominate a kit


def _bm25_rank(query: str, rows: List[Dict[str, Any]], k1: float = 1.5, b: float = 0.75) -> List[tuple]:
    """Classic BM25 over the candidate chunks. The corpus is one brand's own
    documents, so it comfortably fits in memory and needs no index."""
    q_terms = set(_terms(query))
    if not q_terms or not rows:
        return []
    docs = [_terms(r["text"]) for r in rows]
    lengths = [len(d) or 1 for d in docs]
    avg_len = sum(lengths) / len(lengths)
    df: Dict[str, int] = {}
    for d in docs:
        for t in set(d) & q_terms:
            df[t] = df.get(t, 0) + 1
    n = len(docs)
    scored = []
    for i, d in enumerate(docs):
        if not d:
            continue
        counts: Dict[str, int] = {}
        for t in d:
            counts[t] = counts.get(t, 0) + 1
        score = 0.0
        for t in q_terms:
            f = counts.get(t, 0)
            if not f:
                continue
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * lengths[i] / avg_len))
        if score > 0:
            scored.append((score, i))
    scored.sort(key=lambda s: s[0], reverse=True)
    return scored


def _row_to_doc(row: dict, include_content: bool = True) -> dict:
    out = {
        "id": row["id"], "brand_kit_id": row["brand_kit_id"], "title": row["title"],
        "kind": row["kind"], "summary": row["summary"] or "",
        "tags": _maybe_json(row.get("tags"), "[]"),
        "source_kind": row["source_kind"], "source_url": row["source_url"],
        "pinned": bool(row["pinned"]), "enabled": bool(row["enabled"]),
        "chars": len(row.get("content") or ""),
        "created_at": row["created_at"], "updated_at": row["updated_at"],
    }
    out["content"] = row["content"] if include_content else (row["content"] or "")[:280]
    return out


async def _store_chunks(doc_id: str, brand_kit_id: Optional[str], content: str):
    await d1_query("DELETE FROM knowledge_chunks WHERE doc_id = ?", [doc_id])
    ts = now_iso()
    for seq, chunk in enumerate(_chunk_text(content)):
        await d1_query(
            "INSERT INTO knowledge_chunks (id, doc_id, brand_kit_id, seq, text, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [str(uuid.uuid4()), doc_id, brand_kit_id, seq, chunk, ts],
        )


async def _summarise_doc(title: str, content: str, kind: str, model: Optional[str] = None) -> Dict[str, Any]:
    """One cheap call per document at ingest time — never per generation. Its
    output also feeds retrieval: the summary and tags are scored alongside the
    document's own chunks, which helps a document surface for a topic that
    uses different words than the document itself does."""
    if not (content or "").strip():
        return {"summary": "", "tags": []}
    # The tags are doing real retrieval work, not decoration. Lexical search
    # can only match words that are present, so this asks for the vocabulary
    # the document itself never uses — the synonyms and the questions someone
    # would actually type. Paying for that once at ingest is what stops a
    # search for "who is this for" missing a document titled "Who we serve".
    system = (
        "You catalogue a brand's internal reference material so it can be found again by keyword search. "
        "Return ONLY JSON: "
        '{"summary": "one sentence, max 160 chars, describing what this document tells a copywriter", '
        '"tags": ["8-14 lowercase search terms. Include the obvious topic words AND, importantly, words '
        'that do NOT appear in the document: synonyms, the plain-English question this document answers, '
        'and how someone might refer to this topic casually. One to three words each."]}'
    )
    try:
        raw = await chat(
            [{"role": "system", "content": system},
             {"role": "user", "content": f"Kind: {kind}\nTitle: {title}\n\n{content[:4000]}"}],
            model or CHAT_MODEL, 0.4, 300,
        )
        data = _extract_json(raw) or {}
        tags = [str(t).lower().strip() for t in (data.get("tags") or []) if str(t).strip()][:8]
        return {"summary": (data.get("summary") or "").strip()[:200], "tags": tags}
    except Exception:
        logger.exception("Could not summarise knowledge doc %s", title)
        return {"summary": "", "tags": []}


async def knowledge_context(brand_kit_id: Optional[str], topic: str, budget: int = 2600) -> Dict[str, Any]:
    """The brand's knowledge, rendered as prompt text for one topic.

    Never raises: a knowledge base that is empty, unreachable or malformed
    degrades to a generation without it rather than failing the generation —
    the same contract load_brand() keeps."""
    empty = {"block": "", "used": []}
    if not (topic or "").strip():
        return empty
    try:
        await ensure_schema()
        docs, _ = await d1_query(
            "SELECT * FROM knowledge_docs WHERE enabled = 1 AND (brand_kit_id = ? OR brand_kit_id IS NULL) "
            "ORDER BY pinned DESC, updated_at DESC LIMIT 200",
            [brand_kit_id],
        )
        if not docs:
            return empty
        by_id = {d["id"]: d for d in docs}
        used, parts, spent = [], [], 0

        # Tier 1 — pinned truths, always in, before anything is retrieved.
        for d in [x for x in docs if x["pinned"]]:
            text = (d["summary"] or "").strip() or (d["content"] or "").strip()
            if not text:
                continue
            text = text[: max(280, budget // 4)]
            cost = len(text) + len(d["title"]) + 16
            if spent + cost > budget * 0.6:
                break
            parts.append(f"- [{d['title']} · {d['kind']}] {text}")
            used.append({"id": d["id"], "title": d["title"], "kind": d["kind"], "pinned": True})
            spent += cost

        # Tier 2 — retrieved passages, scored against this topic.
        pinned_ids = {u["id"] for u in used}
        chunks, _ = await d1_query(
            "SELECT * FROM knowledge_chunks WHERE brand_kit_id = ? OR brand_kit_id IS NULL LIMIT 2000",
            [brand_kit_id],
        )
        candidates = [c for c in chunks if c["doc_id"] in by_id and c["doc_id"] not in pinned_ids]
        # Scoring each chunk together with its document's title, summary and
        # tags lets a passage match a topic phrased in the document's language
        # rather than only its own.
        enriched = []
        for c in candidates:
            d = by_id[c["doc_id"]]
            tags = " ".join(_maybe_json(d.get("tags"), "[]"))
            enriched.append({**c, "text": f"{d['title']} {d['kind']} {d['summary'] or ''} {tags} {c['text']}"})
        for score, i in _bm25_rank(topic, enriched)[:8]:
            c = candidates[i]
            d = by_id[c["doc_id"]]
            text = (c["text"] or "").strip()
            cost = len(text) + len(d["title"]) + 16
            if spent + cost > budget:
                continue
            parts.append(f"- [{d['title']} · {d['kind']}] {text}")
            if not any(u["id"] == d["id"] for u in used):
                used.append({"id": d["id"], "title": d["title"], "kind": d["kind"], "pinned": False})
            spent += cost

        if not parts:
            return empty
        block = (
            " BRAND KNOWLEDGE — real reference material from this brand. Ground what you write in it: "
            "reuse its specifics, positions and examples, and never contradict it. Do not quote these "
            "labels or mention that you were given reference material.\n" + "\n".join(parts) + "\n"
        )
        return {"block": block, "used": used}
    except Exception:
        logger.exception("Could not build knowledge context")
        return empty


async def brand_and_knowledge(req, topic: str) -> str:
    """The brand kit and its knowledge base as one prompt suffix — the single
    place every text endpoint picks up brand grounding."""
    if not getattr(req, "use_brand", True):
        return ""
    brand = await load_brand(getattr(req, "brand_kit_id", None))
    out = brand_prompt(brand)
    if getattr(req, "use_knowledge", True):
        out += (await knowledge_context(brand.get("id"), topic))["block"]
    return out


class KnowledgeDocIn(BaseModel):
    brand_kit_id: Optional[str] = None
    title: Optional[str] = None
    kind: str = "note"
    content: Optional[str] = None
    tags: Optional[List[str]] = None
    pinned: Optional[bool] = None
    enabled: Optional[bool] = None
    # Ingest sources — supply one of these instead of `content`.
    source_type: Optional[str] = None  # paste | pdf | pptx | url
    source_url: Optional[str] = None
    model: Optional[str] = None


class KnowledgeSearch(BaseModel):
    brand_kit_id: Optional[str] = None
    query: str
    budget: Optional[int] = None


async def _ingest_source(req: KnowledgeDocIn) -> Dict[str, str]:
    """Pulls real text out of whatever was handed over. Reuses the same
    extractors the brand analyser uses — nothing here invents content."""
    st = (req.source_type or "paste").lower()
    if st in ("paste", "", None):
        return {"content": req.content or "", "title": req.title or "Untitled note",
                "source_kind": "paste", "source_url": ""}
    if not req.source_url:
        raise HTTPException(status_code=400, detail="source_url is required for this source_type")
    if st == "url":
        page = await asyncio.to_thread(_url_analysis, req.source_url)
        text = "\n\n".join(t for t in [page.get("description", ""), page.get("text", "")] if t)
        return {"content": text, "title": req.title or page.get("title") or req.source_url,
                "source_kind": "url", "source_url": req.source_url}
    data = await asyncio.to_thread(_fetch_bytes, req.source_url)
    if st == "pdf":
        pdf = await asyncio.to_thread(_pdf_extract, data, 40)
        text = "\n\n".join(t for t in pdf["page_texts"] if t)
        return {"content": text, "title": req.title or "PDF document",
                "source_kind": "pdf", "source_url": req.source_url}
    if st == "pptx":
        slides = await asyncio.to_thread(_pptx_extract, data, 60)
        text = "\n\n".join(f"{s['heading']}\n{s['body']}".strip() for s in slides if s["heading"] or s["body"])
        return {"content": text, "title": req.title or "Deck",
                "source_kind": "pptx", "source_url": req.source_url}
    raise HTTPException(status_code=400, detail="source_type must be paste, pdf, pptx or url")


@api_router.post("/knowledge")
async def create_knowledge_doc(req: KnowledgeDocIn):
    await ensure_schema()
    src = await _ingest_source(req)
    content = (src["content"] or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Nothing readable came out of that source")
    kind = req.kind if req.kind in KNOWLEDGE_KINDS else "note"
    meta = await _summarise_doc(src["title"], content, kind, req.model)
    tags = req.tags if req.tags is not None else meta["tags"]
    ts = now_iso()
    record = {
        "id": str(uuid.uuid4()), "brand_kit_id": req.brand_kit_id, "title": src["title"][:200],
        "kind": kind, "content": content, "summary": meta["summary"], "tags": tags,
        "source_kind": src["source_kind"], "source_url": src["source_url"],
        "pinned": 1 if req.pinned else 0, "enabled": 1, "created_at": ts, "updated_at": ts,
    }
    await d1_query(
        "INSERT INTO knowledge_docs (id, brand_kit_id, title, kind, content, summary, tags, source_kind, "
        "source_url, pinned, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [record["id"], record["brand_kit_id"], record["title"], record["kind"], record["content"],
         record["summary"], json.dumps(tags), record["source_kind"], record["source_url"],
         record["pinned"], 1, ts, ts],
    )
    await _store_chunks(record["id"], req.brand_kit_id, content)
    return _row_to_doc(record)


@api_router.get("/knowledge")
async def list_knowledge_docs(brand_kit_id: Optional[str] = None):
    """Documents for one kit plus the ones shared across every kit."""
    await ensure_schema()
    rows, _ = await d1_query(
        "SELECT * FROM knowledge_docs WHERE brand_kit_id = ? OR brand_kit_id IS NULL "
        "ORDER BY pinned DESC, updated_at DESC LIMIT 200",
        [brand_kit_id],
    )
    return [_row_to_doc(r, include_content=False) for r in rows]


@api_router.get("/knowledge/{doc_id}")
async def get_knowledge_doc(doc_id: str):
    await ensure_schema()
    rows, _ = await d1_query("SELECT * FROM knowledge_docs WHERE id = ?", [doc_id])
    if not rows:
        raise HTTPException(status_code=404, detail="Knowledge document not found")
    return _row_to_doc(rows[0])


@api_router.put("/knowledge/{doc_id}")
async def update_knowledge_doc(doc_id: str, req: KnowledgeDocIn):
    await ensure_schema()
    rows, _ = await d1_query("SELECT * FROM knowledge_docs WHERE id = ?", [doc_id])
    if not rows:
        raise HTTPException(status_code=404, detail="Knowledge document not found")
    existing = _row_to_doc(rows[0])
    content = req.content if req.content is not None else existing["content"]
    merged = {
        "title": (req.title or existing["title"])[:200],
        "kind": req.kind if req.kind in KNOWLEDGE_KINDS else existing["kind"],
        "content": content,
        "tags": req.tags if req.tags is not None else existing["tags"],
        "pinned": existing["pinned"] if req.pinned is None else req.pinned,
        "enabled": existing["enabled"] if req.enabled is None else req.enabled,
        "brand_kit_id": req.brand_kit_id if req.brand_kit_id is not None else existing["brand_kit_id"],
    }
    ts = now_iso()
    out, _ = await d1_query(
        "UPDATE knowledge_docs SET title=?, kind=?, content=?, tags=?, pinned=?, enabled=?, "
        "brand_kit_id=?, updated_at=? WHERE id=? RETURNING *",
        [merged["title"], merged["kind"], merged["content"], json.dumps(merged["tags"]),
         1 if merged["pinned"] else 0, 1 if merged["enabled"] else 0, merged["brand_kit_id"], ts, doc_id],
    )
    # Only re-chunk when the text actually changed — re-chunking is the
    # expensive part and a pin/rename shouldn't pay for it.
    if req.content is not None and req.content != existing["content"]:
        await _store_chunks(doc_id, merged["brand_kit_id"], merged["content"])
    return _row_to_doc(out[0])


@api_router.delete("/knowledge/{doc_id}")
async def delete_knowledge_doc(doc_id: str):
    await ensure_schema()
    rows, _ = await d1_query("DELETE FROM knowledge_docs WHERE id = ? RETURNING id", [doc_id])
    if not rows:
        raise HTTPException(status_code=404, detail="Knowledge document not found")
    await d1_query("DELETE FROM knowledge_chunks WHERE doc_id = ?", [doc_id])
    return {"ok": True}


@api_router.post("/knowledge/search")
async def search_knowledge(req: KnowledgeSearch):
    """What the writer would actually be given for this topic. Exposed so the
    retrieval is inspectable rather than a black box."""
    ctx = await knowledge_context(req.brand_kit_id, req.query, req.budget or 2600)
    return {"used": ctx["used"], "block": ctx["block"], "chars": len(ctx["block"])}


# ---------------- Generation history ----------------
class BulkDeleteRequest(BaseModel):
    ids: List[str]


class GenerationUpdate(BaseModel):
    title: Optional[str] = None
    prompt: Optional[str] = None
    output: Optional[str] = None
    favorite: Optional[bool] = None


PENDING_STATUSES = ("not_started", "pending", "queued", "running", "processing", "in_progress")


async def _reconcile(rows: List[dict]) -> List[dict]:
    """Media rows are only ever advanced by the browser polling /ai/task. Close
    the tab mid-render and the row is stuck on 'running' forever, so re-check
    the still-pending ones server-side whenever history is read."""
    stale = [r for r in rows if r["task_id"] and (r["status"] or "") in PENDING_STATUSES][:8]
    if not stale:
        return rows

    async def refresh(row):
        try:
            data = await asyncio.to_thread(_poyo_status, row["task_id"])
        except Exception:
            return
        status = data.get("status", row["status"])
        files = data.get("files", []) or []
        if status == row["status"] and not files:
            return
        row["status"] = status
        row["files"] = json.dumps(files)
        row["progress"] = data.get("progress", 0)
        row["error_message"] = data.get("error_message")
        try:
            await d1_query(
                "UPDATE generations SET status=?, files=?, progress=?, error_message=?, updated_at=? WHERE id=?",
                [status, row["files"], row["progress"], row["error_message"], now_iso(), row["id"]],
            )
        except Exception:
            logger.exception("Could not persist reconciled generation")

    await asyncio.gather(*[refresh(r) for r in stale])
    return rows


@api_router.get("/generations")
async def list_generations(kind: Optional[str] = None, group: Optional[str] = None,
                           favorite: Optional[bool] = None, limit: int = 60):
    await ensure_schema()
    limit = max(1, min(int(limit), 200))
    where, params = [], []
    if kind:
        kinds = [k.strip() for k in kind.split(",") if k.strip()]
        where.append(f"kind IN ({','.join(['?'] * len(kinds))})")
        params += kinds
    elif group == "text":
        where.append(f"kind IN ({','.join(['?'] * len(TEXT_KINDS))})")
        params += list(TEXT_KINDS)
    elif group == "media":
        where.append("task_id != ''")
    if favorite:
        where.append("favorite = 1")
    sql = "SELECT * FROM generations"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY created_at DESC LIMIT ?"
    rows, _ = await d1_query(sql, params + [limit])
    rows = await _reconcile(rows)
    return [_row_to_generation(r) for r in rows]


@api_router.get("/generations/{gen_id}")
async def get_generation(gen_id: str):
    await ensure_schema()
    rows, _ = await d1_query("SELECT * FROM generations WHERE id = ?", [gen_id])
    if not rows:
        raise HTTPException(status_code=404, detail="Generation not found")
    rows = await _reconcile(rows)
    return _row_to_generation(rows[0])


@api_router.put("/generations/{gen_id}")
async def update_generation(gen_id: str, upd: GenerationUpdate):
    await ensure_schema()
    changes = {k: v for k, v in upd.model_dump().items() if v is not None}
    if not changes:
        return await get_generation(gen_id)
    if "favorite" in changes:
        changes["favorite"] = 1 if changes["favorite"] else 0
    changes["updated_at"] = now_iso()
    sets = ", ".join(f"{k} = ?" for k in changes)
    rows, _ = await d1_query(
        f"UPDATE generations SET {sets} WHERE id = ? RETURNING *", list(changes.values()) + [gen_id]
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Generation not found")
    return _row_to_generation(rows[0])


@api_router.delete("/generations/{gen_id}")
async def delete_generation(gen_id: str):
    await ensure_schema()
    rows, _ = await d1_query("DELETE FROM generations WHERE id = ? RETURNING id", [gen_id])
    if not rows:
        raise HTTPException(status_code=404, detail="Generation not found")
    return {"ok": True}


@api_router.post("/generations/bulk-delete")
async def bulk_delete_generations(req: BulkDeleteRequest):
    await ensure_schema()
    if not req.ids:
        return {"deleted": 0}
    placeholders = ",".join(["?"] * len(req.ids))
    rows, _ = await d1_query(
        f"DELETE FROM generations WHERE id IN ({placeholders}) RETURNING id", req.ids
    )
    return {"deleted": len(rows)}


# ---------------- Platform specs & one-shot post builder ----------------
# What each network actually wants, in one place. The build-post prompt reads
# from this so a plan comes back native to the platform instead of generic, and
# the frontend fetches the same map so slide counts and aspect ratios can never
# drift between the two.
PLATFORM_SPECS = {
    "instagram": {
        "label": "Instagram", "char_limit": 2200, "hashtags": 8,
        "formats": ["carousel", "reel", "single", "story"], "default_format": "carousel",
        "aspect": {"carousel": "4:5", "single": "4:5", "reel": "9:16", "story": "9:16"},
        "slides": {"min": 3, "max": 10, "default": 6},
        "notes": "Cover slide must stop the scroll on its own. Caption opens with a hook line, hashtags go at the end.",
    },
    "tiktok": {
        "label": "TikTok", "char_limit": 2200, "hashtags": 5,
        "formats": ["reel", "carousel", "single"], "default_format": "reel",
        "aspect": {"reel": "9:16", "carousel": "9:16", "single": "9:16"},
        "slides": {"min": 3, "max": 8, "default": 5},
        "notes": "Hook in the first 2 seconds. Casual, spoken-word voiceover, on-screen text every scene.",
    },
    "linkedin": {
        "label": "LinkedIn", "char_limit": 3000, "hashtags": 3,
        "formats": ["single", "carousel", "text"], "default_format": "carousel",
        "aspect": {"carousel": "1:1", "single": "1.91:1", "text": "1:1"},
        "slides": {"min": 4, "max": 10, "default": 7},
        "notes": "Professional but human. Short paragraphs, one insight per line, a soft CTA at the end.",
    },
    "twitter": {
        "label": "X / Twitter", "char_limit": 280, "hashtags": 2,
        "formats": ["single", "thread", "carousel"], "default_format": "thread",
        "aspect": {"single": "16:9", "thread": "16:9", "carousel": "1:1"},
        "slides": {"min": 3, "max": 8, "default": 5},
        "notes": "Every tweet stands alone and is under 280 characters. No hashtag spam.",
    },
    "threads": {
        "label": "Threads", "char_limit": 500, "hashtags": 1,
        "formats": ["single", "thread", "carousel"], "default_format": "single",
        "aspect": {"single": "1:1", "thread": "1:1", "carousel": "1:1"},
        "slides": {"min": 3, "max": 8, "default": 5},
        "notes": "Conversational and unpolished. Minimal hashtags.",
    },
    "youtube": {
        "label": "YouTube", "char_limit": 5000, "hashtags": 3,
        "formats": ["reel", "single"], "default_format": "reel",
        "aspect": {"reel": "9:16", "single": "16:9"},
        "slides": {"min": 3, "max": 8, "default": 5},
        "notes": "Title carries the click. Description is keyword-aware with a clear value proposition.",
    },
    "facebook": {
        "label": "Facebook", "char_limit": 5000, "hashtags": 2,
        "formats": ["single", "carousel", "reel"], "default_format": "single",
        "aspect": {"single": "1.91:1", "carousel": "1:1", "reel": "9:16"},
        "slides": {"min": 3, "max": 10, "default": 5},
        "notes": "Story-driven and friendly, medium length, clear CTA.",
    },
}

FORMAT_NOTES = {
    "carousel": "a swipeable multi-slide carousel: a cover slide that hooks, then one idea per slide",
    "reel": "a short-form vertical video: a scene-by-scene script with a voiceover line and on-screen text per scene",
    "single": "a single post with one strong visual",
    "story": "a vertical full-bleed story frame",
    "thread": "a numbered thread where each part stands alone",
    "text": "a text-only post with no visual",
}

THEME_KEYS = ["midnight", "whiteboard", "chalkboard", "gradient"]


class BuildPostRequest(BaseModel):
    topic: str
    platform: str = "instagram"
    format: str = "auto"  # auto | carousel | reel | single | story | thread | text
    tone: Optional[str] = None
    slides: Optional[int] = None
    model: Optional[str] = None
    use_brand: bool = True
    custom_template_id: Optional[str] = None
    brand_kit_id: Optional[str] = None
    use_knowledge: bool = True


@api_router.get("/platform-specs")
async def platform_specs():
    return {"platforms": PLATFORM_SPECS, "formats": FORMAT_NOTES, "themes": THEME_KEYS}


def _plan_to_assets(plan: dict, theme: str) -> List[Dict[str, Any]]:
    """Turn the model's visual plan into Composer assets.

    Each asset is a self-contained card spec rather than a rendered PNG: the
    browser renders it on demand, so a ten-slide carousel costs a few hundred
    bytes in D1 instead of ten multi-megabyte data URLs.
    """
    fmt = plan.get("format") or "single"
    visual = plan.get("visual") or {}
    style = visual.get("style") or ("carousel" if fmt in ("carousel", "thread") else "quote")
    assets: List[Dict[str, Any]] = []

    if fmt == "reel":
        for i, sc in enumerate(visual.get("script") or []):
            assets.append({
                "type": "scene",
                "caption": sc.get("voiceover", ""),
                "spec": {
                    "template": "slide", "theme": theme, "index": i + 1,
                    "total": len(visual.get("script") or []), "coverCounts": False,
                    "heading": sc.get("on_screen_text") or sc.get("scene", ""),
                    "body": sc.get("voiceover", ""),
                    "video_prompt": sc.get("video_prompt", ""),
                },
            })
        return assets

    slides = visual.get("slides") or []
    if slides:
        total = len(slides) + 1
        assets.append({
            "type": "visual", "caption": "",
            "spec": {"template": "cover", "theme": theme, "index": 0, "total": total,
                     "title": visual.get("title") or plan.get("title") or "",
                     "image_prompt": visual.get("cover_image_prompt", "")},
        })
        for i, sl in enumerate(slides):
            assets.append({
                "type": "visual", "caption": "",
                "spec": {"template": "slide", "theme": theme, "index": i + 1, "total": total,
                         "heading": sl.get("heading", ""), "body": sl.get("body", ""),
                         "image_prompt": sl.get("image_prompt", "")},
            })
        return assets

    if style == "quote":
        assets.append({"type": "visual", "caption": "", "spec": {
            "template": "quote", "theme": theme,
            "quote": visual.get("quote") or plan.get("hook") or "",
            "author": visual.get("author") or "",
        }})
    elif style == "infographic":
        assets.append({"type": "visual", "caption": "", "spec": {
            "template": "infographic", "theme": theme,
            "title": visual.get("title") or plan.get("title") or "",
            "points": visual.get("points") or [],
        }})
    elif visual.get("image_prompt"):
        assets.append({"type": "visual", "caption": "", "spec": {
            "template": "cover", "theme": theme, "index": 0, "total": 1,
            "title": visual.get("title") or plan.get("hook") or plan.get("title") or "",
            "image_prompt": visual.get("image_prompt", ""),
        }})
    return assets


@api_router.post("/ai/build-post")
async def ai_build_post(req: BuildPostRequest):
    """Topic in, publishable post out — copy, hashtags and a visual plan in one
    pass. This is the shortcut from the Idea Engine to something you can look
    at, instead of six manual hops through Studio and Visual Studio."""
    spec = PLATFORM_SPECS.get(req.platform) or PLATFORM_SPECS["instagram"]
    allowed = spec["formats"]
    fmt = req.format if req.format in allowed else ("auto" if req.format == "auto" else spec["default_format"])
    n = int(req.slides or spec["slides"]["default"])
    n = max(spec["slides"]["min"], min(n, spec["slides"]["max"]))

    # A template — one of the starters, or one converted from an uploaded
    # PDF/PPTX/image — pins the slide count and supplies a real outline to
    # follow, rather than leaving the model to invent a structure from nothing.
    template = None
    if req.custom_template_id:
        if req.custom_template_id in STARTER_BY_ID:
            starter = STARTER_BY_ID[req.custom_template_id]
            template = {**_starter_as_template(starter), "layouts": starter["layouts"]}
        else:
            rows, _ = await d1_query("SELECT * FROM visual_templates WHERE id = ?", [req.custom_template_id])
            if not rows:
                raise HTTPException(status_code=404, detail="That custom template no longer exists")
            template = _row_to_visual_template(rows[0])
        if template["format"] in allowed and fmt == "auto":
            fmt = template["format"]
        if template["slides"]:
            n = max(spec["slides"]["min"], min(len(template["slides"]), spec["slides"]["max"]))

    brand = await load_brand(req.brand_kit_id) if req.use_brand else {}
    brand_note = brand_prompt(brand) if brand else ""
    if brand and req.use_knowledge:
        brand_note += (await knowledge_context(brand.get("id"), req.topic))["block"]
    tone = req.tone or (brand.get("voice") if brand else "") or "confident, specific, no fluff"

    template_note = ""
    if template and template["slides"]:
        outline = "\n".join(f"- Slide {i+1}: {s.get('heading', '')} — {s.get('body', '')}" for i, s in enumerate(template["slides"]))
        template_note = (
            f" Follow this exact {len(template['slides'])}-slide OUTLINE (from a saved template) — use its "
            f"purpose for each slide but write fresh content about today's topic, do not copy its wording:\n{outline}\n"
        )

    if fmt == "auto":
        format_rule = (
            f"Pick the single best format for this topic from {allowed} and put it in \"format\". "
            + " ".join(f"'{f}' is {FORMAT_NOTES[f]}." for f in allowed if f in FORMAT_NOTES)
        )
    else:
        format_rule = f'Use format \"{fmt}\" — {FORMAT_NOTES.get(fmt, fmt)}.'

    system = (
        f"You are a senior social creative director producing a finished, ready-to-publish "
        f"{spec['label']} post. Tone: {tone}. Platform rules: {spec['notes']} "
        f"Caption must be under {spec['char_limit']} characters and use at most {spec['hashtags']} hashtags. "
        f"{format_rule} "
        f"If the format is carousel, thread or reel, produce exactly {n} slides/scenes (a carousel's cover "
        f"is separate and does not count). "
        f"{brand_note}{template_note}"
        "Return ONLY JSON with this exact shape:\n"
        '{"format": "one of ' + "|".join(allowed) + '", '
        '"title": "internal name for this post, max 60 chars", '
        '"hook": "the opening line, max 90 chars", '
        '"caption": "the complete ready-to-publish caption, WITHOUT the hashtags", '
        '"hashtags": ["array of hashtag strings including the # sign"], '
        '"cta": "the closing call to action, one line", '
        '"alt_text": "accessibility description of the visual, max 120 chars", '
        '"why_it_works": "one sentence on the strategic angle", '
        '"visual": {"style": "carousel|quote|infographic|photo|video", '
        '"theme": "one of ' + "|".join(THEME_KEYS) + '", '
        '"title": "cover/graphic title, max 50 chars", '
        '"quote": "used only when style is quote", "author": "attribution for the quote", '
        '"points": ["used only when style is infographic, 3-5 items, each max 70 chars"], '
        '"cover_image_prompt": "a vivid image-generation prompt for the cover, with NO text or words in the image", '
        '"slides": [{"heading": "max 40 chars", "body": "max 130 chars", '
        '"image_prompt": "optional image prompt for this slide, no text in image"}], '
        '"script": [{"scene": "what is on screen", "on_screen_text": "max 40 chars", '
        '"voiceover": "one spoken line", "video_prompt": "a detailed video-generation prompt"}]}}\n'
        "Omit the keys that do not apply to the chosen format. No markdown, no commentary."
    )

    model = req.model or CHAT_MODEL
    content = await chat(
        [{"role": "system", "content": system}, {"role": "user", "content": f"Topic: {req.topic}"}],
        model, 0.85, 2600,
    )
    plan = _extract_json(content)
    if not plan:
        # Never leave the user with nothing: fall back to the raw copy as a
        # single post so the Composer still opens with something usable.
        plan = {"format": "single", "title": req.topic[:60], "hook": "", "caption": content.strip(),
                "hashtags": [], "cta": "", "visual": {}}

    if plan.get("format") not in allowed:
        plan["format"] = fmt if fmt != "auto" else spec["default_format"]
    # A template's theme was a deliberate choice when it was converted —
    # honor it over whatever the model happened to pick.
    theme = template["theme"] if template else ((plan.get("visual") or {}).get("theme")) or "midnight"
    if theme not in THEME_KEYS:
        theme = "midnight"

    hashtags = [h if h.startswith("#") else f"#{h}" for h in (plan.get("hashtags") or []) if h]
    brand_tags = (brand.get("hashtags") or []) if brand else []
    for t in brand_tags:
        tag = t if t.startswith("#") else f"#{t}"
        if tag not in hashtags and len(hashtags) < spec["hashtags"]:
            hashtags.append(tag)
    plan["hashtags"] = hashtags[: spec["hashtags"]]

    assets = _apply_template_layouts(_plan_to_assets(plan, theme), template)
    result = {
        "format": plan["format"],
        "platform": req.platform,
        "title": plan.get("title") or req.topic[:60],
        "hook": plan.get("hook", ""),
        "caption": (plan.get("caption") or "").strip(),
        "hashtags": plan["hashtags"],
        "cta": plan.get("cta", ""),
        "alt_text": plan.get("alt_text", ""),
        "why_it_works": plan.get("why_it_works", ""),
        "theme": theme,
        "assets": assets,
        "visual": plan.get("visual") or {},
    }
    result["generation_id"] = await record_generation(
        "post_plan", req.topic, model, output=json.dumps(result),
        title=result["title"], meta={"platform": req.platform, "format": result["format"]},
    )
    return result


# ---------------- Posts CRUD ----------------
@api_router.post("/posts", response_model=Post)
async def create_post(inp: PostCreate):
    await ensure_schema()
    post = Post(**{k: v for k, v in inp.model_dump().items() if v is not None})
    await d1_query(
        "INSERT INTO posts (id, title, content, platforms, status, scheduled_time, media_urls, media_type, "
        "assets, format, hashtags, brand_kit_id, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        _post_row(post.model_dump()),
    )
    return post


@api_router.get("/posts", response_model=List[Post])
async def list_posts(status: Optional[str] = None):
    await ensure_schema()
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
    await ensure_schema()
    changes = {k: v for k, v in upd.model_dump().items() if v is not None}
    changes["updated_at"] = now_iso()
    set_clauses = []
    params = []
    for k, v in changes.items():
        if k in JSON_POST_FIELDS:
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


@api_router.post("/posts/bulk-delete")
async def bulk_delete_posts(req: BulkDeleteRequest):
    if not req.ids:
        return {"deleted": 0}
    placeholders = ",".join(["?"] * len(req.ids))
    rows, _ = await d1_query(f"DELETE FROM posts WHERE id IN ({placeholders}) RETURNING id", req.ids)
    return {"deleted": len(rows)}


@api_router.get("/stats")
async def get_stats():
    await ensure_schema()
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
    await ensure_schema()
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

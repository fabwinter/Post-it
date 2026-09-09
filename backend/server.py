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
]

# Columns added after the first release. Existing databases predate them, so
# they arrive as ALTERs rather than being picked up from the CREATE above.
_ADD_COLUMNS = {
    "posts": [
        ("assets", "ALTER TABLE posts ADD COLUMN assets TEXT NOT NULL DEFAULT '[]'"),
        ("format", "ALTER TABLE posts ADD COLUMN format TEXT NOT NULL DEFAULT 'single'"),
        ("hashtags", "ALTER TABLE posts ADD COLUMN hashtags TEXT NOT NULL DEFAULT '[]'"),
    ],
    "generations": [
        ("output", "ALTER TABLE generations ADD COLUMN output TEXT"),
        ("title", "ALTER TABLE generations ADD COLUMN title TEXT"),
        ("meta", "ALTER TABLE generations ADD COLUMN meta TEXT"),
        ("favorite", "ALTER TABLE generations ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0"),
        ("updated_at", "ALTER TABLE generations ADD COLUMN updated_at TEXT"),
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
    use_brand: bool = True


class WriteRequest(BaseModel):
    brief: str
    platform: str = "twitter"
    tone: Optional[str] = "engaging"
    model: Optional[str] = None
    use_brand: bool = True


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


# Post columns whose Python value is a list/dict and whose D1 value is JSON text.
JSON_POST_FIELDS = ("platforms", "media_urls", "assets", "hashtags")


def _post_row(post: dict):
    return [
        post["id"], post.get("title") or "Untitled post", post.get("content") or "",
        json.dumps(post.get("platforms") or []), post.get("status") or "draft", post.get("scheduled_time"),
        json.dumps(post.get("media_urls") or []), post.get("media_type"),
        json.dumps(post.get("assets") or []), post.get("format") or "single",
        json.dumps(post.get("hashtags") or []),
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
TEXT_KINDS = ("ideate", "write", "repurpose", "templates", "coach", "visual", "post_plan")


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
        + (brand_prompt(await load_brand()) if req.use_brand else "")
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
        + (brand_prompt(await load_brand()) if req.use_brand else "")
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
    use_brand: bool = True


@api_router.post("/ai/templates")
async def ai_templates(req: TemplateRequest):
    style = TEMPLATE_GUIDES.get(req.template, TEMPLATE_GUIDES["hooks"])
    guide = PLATFORM_GUIDE.get(req.platform, "Write a high-quality social media post.")
    n = max(1, min(int(req.count or 7), 14))
    system = (
        f"You are a viral content strategist. Write {n} distinct {req.platform} posts about the given topic, "
        f"each following this template: {style} Platform rules: {guide} "
        f'Return ONLY JSON: {{"posts": [{n} strings, each a complete ready-to-publish post]}}. No explanations.'
        + (brand_prompt(await load_brand()) if req.use_brand else "")
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


@api_router.post("/ai/generate")
async def ai_generate(req: GenerateRequest):
    opts = req.options or {}
    prompt = req.prompt
    if opts.get("use_brand"):
        brand = await load_brand()
        colors = brand.get("colors") or {}
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
# One kit per workspace for now. It is the single place the app learns what the
# brand sounds and looks like, and it feeds three different consumers: copy
# prompts, image prompts, and the client-side visual renderer.
DEFAULT_BRAND = {
    "name": "Default brand",
    "colors": {"bg": "#0A0A0A", "fg": "#FFFFFF", "accent": "#E2FF3D", "sub": "#a1a1aa"},
    "fonts": {"display": "Inter", "body": "Inter"},
    "logo_url": None,
    "handle": "",
    "voice": "",
    "audience": "",
    "hashtags": [],
    "cta": "",
    "banned_words": [],
}


class BrandKitUpdate(BaseModel):
    name: Optional[str] = None
    colors: Optional[Dict[str, str]] = None
    fonts: Optional[Dict[str, str]] = None
    logo_url: Optional[str] = None
    handle: Optional[str] = None
    voice: Optional[str] = None
    audience: Optional[str] = None
    hashtags: Optional[List[str]] = None
    cta: Optional[str] = None
    banned_words: Optional[List[str]] = None


def _row_to_brand(row: dict):
    return {
        "id": row["id"],
        "name": row["name"],
        "colors": json.loads(row["colors"] or "{}") or DEFAULT_BRAND["colors"],
        "fonts": json.loads(row["fonts"] or "{}") or DEFAULT_BRAND["fonts"],
        "logo_url": row["logo_url"],
        "handle": row["handle"] or "",
        "voice": row["voice"] or "",
        "audience": row["audience"] or "",
        "hashtags": json.loads(row["hashtags"] or "[]"),
        "cta": row["cta"] or "",
        "banned_words": json.loads(row["banned_words"] or "[]"),
        "updated_at": row["updated_at"],
    }


async def load_brand() -> dict:
    """The brand kit, or sane defaults. Never raises — an unconfigured or
    unreachable kit degrades to generic copy rather than a failed generation."""
    try:
        await ensure_schema()
        rows, _ = await d1_query("SELECT * FROM brand_kits ORDER BY is_default DESC, created_at ASC LIMIT 1")
        if rows:
            return _row_to_brand(rows[0])
    except Exception:
        logger.exception("Could not load brand kit")
    return {"id": None, **DEFAULT_BRAND, "updated_at": None}


def brand_prompt(brand: dict) -> str:
    """The brand kit rendered as prompt text. Returns '' when nothing is filled
    in, so an empty kit adds no noise to the prompt."""
    bits = []
    if brand.get("name") and brand["name"] != DEFAULT_BRAND["name"]:
        bits.append(f"Brand name: {brand['name']}.")
    if brand.get("voice"):
        bits.append(f"Brand voice: {brand['voice']}.")
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


@api_router.get("/brand-kit")
async def get_brand_kit():
    return await load_brand()


@api_router.put("/brand-kit")
async def put_brand_kit(upd: BrandKitUpdate):
    await ensure_schema()
    changes = {k: v for k, v in upd.model_dump().items() if v is not None}
    rows, _ = await d1_query("SELECT * FROM brand_kits ORDER BY is_default DESC, created_at ASC LIMIT 1")
    ts = now_iso()
    merged = {**DEFAULT_BRAND, **({k: v for k, v in _row_to_brand(rows[0]).items() if k != "id"} if rows else {}), **changes}
    values = [
        merged["name"], json.dumps(merged["colors"]), json.dumps(merged["fonts"]),
        merged["logo_url"], merged["handle"], merged["voice"], merged["audience"],
        json.dumps(merged["hashtags"]), merged["cta"], json.dumps(merged["banned_words"]), ts,
    ]
    if rows:
        out, _ = await d1_query(
            "UPDATE brand_kits SET name=?, colors=?, fonts=?, logo_url=?, handle=?, voice=?, audience=?, "
            "hashtags=?, cta=?, banned_words=?, updated_at=? WHERE id=? RETURNING *",
            values + [rows[0]["id"]],
        )
    else:
        out, _ = await d1_query(
            "INSERT INTO brand_kits (id, name, colors, fonts, logo_url, handle, voice, audience, hashtags, "
            "cta, banned_words, updated_at, is_default, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?) RETURNING *",
            [str(uuid.uuid4())] + values + [ts],
        )
    return _row_to_brand(out[0])


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

    brand = await load_brand() if req.use_brand else {}
    brand_note = brand_prompt(brand) if brand else ""
    tone = req.tone or (brand.get("voice") if brand else "") or "confident, specific, no fluff"

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
        f"{brand_note} "
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
    theme = ((plan.get("visual") or {}).get("theme")) or "midnight"
    if theme not in THEME_KEYS:
        theme = "midnight"

    hashtags = [h if h.startswith("#") else f"#{h}" for h in (plan.get("hashtags") or []) if h]
    brand_tags = (brand.get("hashtags") or []) if brand else []
    for t in brand_tags:
        tag = t if t.startswith("#") else f"#{t}"
        if tag not in hashtags and len(hashtags) < spec["hashtags"]:
            hashtags.append(tag)
    plan["hashtags"] = hashtags[: spec["hashtags"]]

    assets = _plan_to_assets(plan, theme)
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
        "assets, format, hashtags, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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

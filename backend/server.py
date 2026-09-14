from fastapi import FastAPI, APIRouter, HTTPException, Request, UploadFile, File, Form, Depends
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
import zipfile
import ipaddress
import socket
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse
from collections import Counter
from PIL import Image
from pypdf import PdfReader
from pptx import Presentation
from pptx.enum.dml import MSO_COLOR_TYPE, MSO_FILL_TYPE
from pptx.enum.text import PP_ALIGN
from pptx.opc.constants import RELATIONSHIP_TYPE as PPTX_RT
from docx import Document as DocxDocument

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

# Optional but strongly recommended: without it every /api route is open to
# anyone who has the URL — this app has no per-user accounts, so a single
# shared secret is the whole access-control model. Set it in Vercel and send
# it back as `Authorization: Bearer <token>` (the frontend's lock screen does
# this once the visitor enters it). Left unset, nothing is enforced, matching
# how every other optional integration in this file degrades.
APP_ACCESS_TOKEN = os.environ.get('APP_ACCESS_TOKEN')

app = FastAPI()
api_router = APIRouter(prefix="/api")
# The cron endpoint authenticates itself with its own CRON_SECRET (Vercel
# Cron sends that, not the app's access token) so it lives on a separate,
# unprotected router rather than inheriting api_router's dependency below.
cron_router = APIRouter(prefix="/api")


async def require_app_token(request: Request):
    if not APP_ACCESS_TOKEN:
        return
    if request.headers.get("authorization") != f"Bearer {APP_ACCESS_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")

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
        slides TEXT NOT NULL DEFAULT '[]', layouts TEXT NOT NULL DEFAULT '{}',
        bg_colors TEXT NOT NULL DEFAULT '{}', clips TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL)""",
    # A personal palette of reusable elements — uploaded logos/badges/stamps
    # saved once from the Composer's elements library and available on every
    # post after that, alongside the code-defined shape/icon/sticker presets
    # (which need no row since they never change).
    """CREATE TABLE IF NOT EXISTS library_elements (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'upload',
        name TEXT NOT NULL DEFAULT 'Element', element TEXT NOT NULL DEFAULT '{}',
        thumbnail_url TEXT, created_at TEXT NOT NULL)""",
    # Typefaces the user licensed elsewhere and uploaded. The catalogue in
    # lib/fonts.js can only carry faces we may legally serve; a retail script
    # bought from Creative Market or reached through Canva is not one of them,
    # so the file itself lives here and the front end registers it as a web
    # font under `name`.
    """CREATE TABLE IF NOT EXISTS custom_fonts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, pathname TEXT,
        filename TEXT NOT NULL, content_type TEXT, size INTEGER DEFAULT 0,
        created_at TEXT NOT NULL)""",
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
        ("alt_text", "ALTER TABLE posts ADD COLUMN alt_text TEXT NOT NULL DEFAULT ''"),
        ("content_by_platform", "ALTER TABLE posts ADD COLUMN content_by_platform TEXT NOT NULL DEFAULT '{}'"),
        ("music", "ALTER TABLE posts ADD COLUMN music TEXT NOT NULL DEFAULT '{}'"),
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
        ("guideline", "ALTER TABLE brand_kits ADD COLUMN guideline TEXT NOT NULL DEFAULT '{}'"),
    ],
    # Precomputed retrieval terms — stemmed once at ingest instead of on
    # every generation. See _term_counts / _chunk_term_counts / _doc_meta_terms.
    "knowledge_docs": [
        ("meta_terms", "ALTER TABLE knowledge_docs ADD COLUMN meta_terms TEXT NOT NULL DEFAULT '{}'"),
    ],
    "knowledge_chunks": [
        ("terms", "ALTER TABLE knowledge_chunks ADD COLUMN terms TEXT NOT NULL DEFAULT '{}'"),
    ],
    "visual_templates": [
        ("layouts", "ALTER TABLE visual_templates ADD COLUMN layouts TEXT NOT NULL DEFAULT '{}'"),
        ("bg_colors", "ALTER TABLE visual_templates ADD COLUMN bg_colors TEXT NOT NULL DEFAULT '{}'"),
        # A reel scene's stock/uploaded video clip — trim, speed, grade,
        # transition — keyed by role exactly like bg_colors. It rides
        # separately from `layouts` because a scene can carry a clip without
        # ever entering freeform layout edit (VideoClipEditor renders for
        # every scene regardless), so gating it on `layouts` the way
        # bg_colors effectively is would drop it for the common case.
        ("clips", "ALTER TABLE visual_templates ADD COLUMN clips TEXT NOT NULL DEFAULT '{}'"),
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


# The Music Series (generate-music, generate-mashup, ...) isn't queried
# through the generic status endpoint above — PoYo's own docs give it a
# dedicated "Query Music Detail" endpoint, task_id as a query param rather
# than a path segment, and a different result shape (`files[].audio_url`,
# not `file_url`). Polling the generic endpoint for a music task doesn't
# necessarily fail outright, but its files never carry a `file_url`, which
# is exactly a silent "no file came back" from the caller's point of view.
def _poyo_music_detail(task_id: str):
    resp = _poyo_call("GET", "/api/generate/detail/music", timeout=60, params={"task_id": task_id})
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"PoYo music detail error {resp.status_code}: {resp.text[:400]}")
    data = resp.json().get("data", {})
    files = [{"file_url": f["audio_url"], "credit": f.get("title") or ""} for f in (data.get("files") or []) if f.get("audio_url")]
    return {**data, "files": files}


async def chat(messages, model, temperature=0.8, max_tokens=1200):
    fn = _poyo_responses if model in RESPONSES_ONLY_MODELS else _poyo_chat
    return await asyncio.to_thread(fn, messages, model, temperature, max_tokens)


CHAT_MODEL = "gemini-3-flash-preview"

PLATFORM_GUIDE = {
    "twitter": ("X/Twitter: punchy, <=280 chars, strong hook first line, 0-1 hashtags max (only if genuinely "
                "trending). Never a formal, brand-speak opening — this audience calls it out."),
    "linkedin": ("LinkedIn: professional but human, short paragraphs, a hook, insight, and a soft CTA. Use line "
                 "breaks. Never open with \"We're excited to announce\" — that's the single most-skipped opener "
                 "on this platform. 2-3 specific hashtags at the very end, never mid-post."),
    "instagram": ("Instagram: warm and visual, a scroll-stopping first line (only ~2 lines show before \"more\"), "
                  "emojis sparingly, 5-10 hashtags on their own line at the end — mix a couple of huge ones with "
                  "several niche ones, not eight generic broad tags."),
    "tiktok": ("TikTok: casual, trend-aware caption, hook + payoff, 3-5 hashtags (one broad, one niche, one "
               "genuinely trending this week). The caption is a supplement — the hook has to already be in the "
               "video's first second."),
    "youtube": ("YouTube: a compelling video title/description, keyword-aware (the title is what search ranks "
                "on, not just a hook), clear value proposition stated in the first two description lines."),
    "threads": ("Threads: conversational, authentic, concise, first-person. Skip hashtags entirely — there's no "
                "established hashtag culture here yet and using them reads as try-hard."),
    "facebook": ("Facebook: friendly, story-driven, medium length (this audience reads more than X's), clear CTA "
                 "as a question. Max 1-2 hashtags — they carry little SEO value here."),
}

# ---------------- Content-craft prompt modules ----------------
# Distilled, reusable instruction fragments appended to system prompts across
# the AI routes below. Each condenses one editorial discipline down to what
# actually changes a model's output, rather than the source's full reference
# material (a 100-row hook table, a page of AI-vocabulary tells, a slide-deck
# design system) — the app's own users never see these; they only see better
# hooks, less robotic copy, and tighter slides, every time, without having to
# know any of this exists.

# Hook-writing: 10 psychology triggers, one filled example per trigger, and
# the "mix a stop-scroll trigger with a retention trigger" tactic.
HOOK_CRAFT_GUIDE = (
    " Hook-writing rules: a hook is a proven pattern filled with THIS topic's specific number, pain point, or "
    "contrarian claim — never a generic opener. Draw from these shapes, mixing one stop-scroll trigger with one "
    "retention trigger so it grabs attention AND keeps them reading: "
    "stop-scroll — curiosity gap (\"Nobody talks about [X] in [niche]\"), negation (\"It's not [assumed cause] — "
    "it's [real cause]\"), specificity (\"$[amount]: what [thing] actually costs\"), question (\"Why does [problem] "
    "keep happening?\"); "
    "retention — story (\"[time ago] I was [low point]. Today [high point]\"), confession (\"I'll admit it: "
    "[vulnerable fact]\"), emotional (\"This is for the [person] who [struggle]\"); "
    "also useful — contrarian (\"Stop [common advice] — here's what works\"), authority (\"I analyzed [N] [things]; "
    "here's what I found\"), listicle (\"[N] [things] that will [outcome]\"). "
    "Keep the filled hook under 12 words and native to the platform's voice."
)

# Humanize-writing: the highest-signal AI-writing tells, condensed from
# Wikipedia's "Signs of AI writing" guide, plus the calendar skill's "never
# open with the brand name" rule. Applied to every route that outputs
# finished, ready-to-publish copy.
HUMANIZE_GUIDE = (
    " Write like a specific person with real opinions, not a language model: no significance inflation "
    "(\"pivotal moment\", \"testament to\", \"stands as\", \"underscores its importance\"), no AI-vocabulary tells "
    "(delve, leverage, elevate, unlock, unleash, navigate, landscape, tapestry, realm, myriad, robust, seamless, "
    "cutting-edge, game-changing, revolutionize, synergy, streamline), no hedge-then-assert filler (\"it's worth "
    "noting\", \"in today's fast-paced world\", \"at the end of the day\"), no chatbot artifacts (\"I hope this "
    "helps\"), and no formulaic \"not just X, it's Y\" or a perfectly balanced good-news/bad-news closer. Vary "
    "sentence length — some short and blunt, some longer. State one real, specific opinion or fact instead of a "
    "vague claim. Never open with the brand name, \"We\", or \"Our\"."
)

# Carousel/reel slide discipline: one idea per slide, a hook-worthy opener, a
# CTA close, varied rhythm instead of every slide reading the same.
CAROUSEL_CRAFT_GUIDE = (
    " Slide/scene discipline: one idea per slide — never two joined with \"and\". Body text short enough to read "
    "in under 3 seconds. The first slide/scene is the single most intriguing line, strong enough to work as a "
    "standalone hook. The last is a clear call to action. Vary the rhythm across slides — not every slide is a flat "
    "statement; let some pose a question, some drop a number, some contradict the one before it."
)

# Short-form video (Reel/TikTok/Short) script pacing rules.
SHORTFORM_SCRIPT_GUIDE = (
    " Short-form video script rules: the hook must land in the first 1-2 seconds — no logo intro, no \"hey guys\", "
    "spoken word and on-screen text both start at scene 1. Cut every 1-3 seconds of screen time rather than one long "
    "static shot. On-screen text must carry the point with sound off. Arc: hook, then the problem, then the "
    "payoff/answer, then a one-line CTA."
)

# Cover/thumbnail image-generation prompt rules: what a viewer actually
# perceives at the small size a feed or a mobile thumbnail renders it at.
THUMBNAIL_PROMPT_GUIDE = (
    " This image doubles as a thumbnail people scan at postage-stamp size while scrolling, so the image-generation "
    "prompt must describe: one single focal point with nothing cluttering it, a clear emotional expression if a face "
    "is involved (surprise, curiosity, or concern reads best — a neutral expression reads worst), a high-contrast "
    "2-3 color palette, and simple bold shapes that still read when shrunk small rather than fine detail that "
    "vanishes at a glance."
)


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
    alt_text: str = ""
    # Per-platform caption overrides — keyed by platform, e.g. {"twitter": "…"}.
    # A platform with no entry here uses `content`. Lets one post carry a
    # 280-char X caption and a 2200-char Instagram one instead of forcing
    # the same text (and the same char-limit warning) onto every platform.
    content_by_platform: Dict[str, str] = Field(default_factory=dict)
    brand_kit_id: Optional[str] = None
    # A reel's background score: {url, volume (0-1, mixed under the voice),
    # credit}. Empty dict means no track set — the common case for every
    # non-reel format, and a reel before Auto Reel's music phase has picked
    # one for it.
    music: Dict[str, Any] = Field(default_factory=dict)
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
    alt_text: Optional[str] = ""
    content_by_platform: Optional[Dict[str, str]] = Field(default_factory=dict)
    brand_kit_id: Optional[str] = None
    music: Optional[Dict[str, Any]] = Field(default_factory=dict)


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
    alt_text: Optional[str] = None
    content_by_platform: Optional[Dict[str, str]] = None
    brand_kit_id: Optional[str] = None
    music: Optional[Dict[str, Any]] = None


# Post columns whose Python value is a list/dict and whose D1 value is JSON text.
JSON_POST_FIELDS = ("platforms", "media_urls", "assets", "hashtags", "content_by_platform", "music")


def _post_row(post: dict):
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
        "alt_text": row.get("alt_text") or "",
        "content_by_platform": json.loads(row.get("content_by_platform") or "{}"),
        "brand_kit_id": row.get("brand_kit_id"),
        "music": json.loads(row.get("music") or "{}"),
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
        + HOOK_CRAFT_GUIDE
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
        + HOOK_CRAFT_GUIDE + HUMANIZE_GUIDE
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
            + HUMANIZE_GUIDE
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
                  '{"quote": "a single powerful sentence, max 140 chars", "author": "a fitting short attribution"}'
                  + HUMANIZE_GUIDE)
        user = f"Topic: {req.topic}"
    elif t == "tweet":
        system = ('You write a viral-style tweet. Return ONLY JSON: '
                  '{"name": "display name", "handle": "@handle", "text": "the tweet, max 260 chars"}'
                  + HOOK_CRAFT_GUIDE + HUMANIZE_GUIDE)
        user = f"Topic: {req.topic}"
    elif t == "infographic":
        system = ('You design infographic copy. Return ONLY JSON: '
                  '{"title": "short punchy title, max 50 chars", "points": ["3 to 5 concise bullet points, each max 70 chars"]}'
                  + HUMANIZE_GUIDE)
        user = f"Topic: {req.topic}"
    else:  # carousel / slideshow / photo
        if t == "photo":
            system = ('You plan a photo slideshow. Return ONLY JSON: '
                      f'{{"title": "short cover title, max 50 chars", "slides": [{n} objects each '
                      '{"caption": "short on-image caption, max 60 chars", "image_prompt": "a vivid, cinematic, '
                      'detailed image-generation prompt for this slide; do NOT include any text or words in the image"}]}}'
                      + CAROUSEL_CRAFT_GUIDE + HUMANIZE_GUIDE + THUMBNAIL_PROMPT_GUIDE)
        else:
            system = ('You design a swipeable social carousel. Return ONLY JSON: '
                      f'{{"title": "hook cover title, max 50 chars", "slides": [{n} objects each '
                      '{"heading": "max 40 chars", "body": "max 120 chars"}]}. The first slide is the hook/cover.'
                      + HOOK_CRAFT_GUIDE + CAROUSEL_CRAFT_GUIDE + HUMANIZE_GUIDE)
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
        + (HOOK_CRAFT_GUIDE if req.template == "hooks" else "") + HUMANIZE_GUIDE
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
        + (HOOK_CRAFT_GUIDE if req.template == "hooks" else "") + HUMANIZE_GUIDE
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
        "If the draft reads like AI-generated writing (significance inflation, hedge-then-assert filler, "
        "AI-vocabulary tells, robotic parallel structure), call that out by name as one of the improvements. "
        'Return ONLY JSON: {"score": integer 0-100, "strengths": [2-3 short strings], '
        '"improvements": [2-3 short specific actionable strings], "hook_rewrite": "a stronger rewritten opening line"}'
        + HOOK_CRAFT_GUIDE
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
    """Re-serves an image, video, or audio file from our own origin so the
    browser's canvas export (a reel's clip/voiceover/score, or a PNG
    download) can read pixels/samples back out of it even when the
    original host doesn't send CORS headers — a cross-origin <img>/<video>/
    <audio> without them taints the canvas. audio/* used to be rejected
    outright here (only image/video were allowed), which meant every
    voiceover and music track — always a different origin than our own —
    silently 400'd the moment an export tried to load it, even though
    playback in the live preview never goes through this endpoint at all
    and so never showed the gap. Video also gets a taller cap and timeout
    than images: a several-second stock clip is routinely bigger and
    slower to fetch than a thumbnail, and the caps here used to assume
    image-sized files for both. _fetch_with_cap already blocks non-http(s)
    schemes and internal/private addresses."""
    # The content type isn't known until after the fetch, so one generous
    # cap covers all three kinds rather than guessing beforehand — images
    # never get remotely close to it, and it's sized for video, the
    # largest of the three.
    content, content_type = await asyncio.to_thread(_fetch_with_cap, url, 60 * 1024 * 1024, 45)
    if not content_type.startswith(("image/", "video/", "audio/")):
        raise HTTPException(status_code=400, detail="Only image, video, or audio URLs can be proxied")
    return Response(content=content, media_type=content_type, headers={
        "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400",
    })


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
    if ct.startswith("font/") or ct in _FONT_CONTENT_TYPES:
        return "font"
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


class UploadFromUrlRequest(BaseModel):
    url: str
    filename: Optional[str] = None


@api_router.post("/uploads/from-url")
async def create_upload_from_url(req: UploadFromUrlRequest):
    """The Library's "+" offers Stock alongside a plain file upload — this is
    what "downloaded from Stock" means: the picked photo/clip is fetched here
    and saved into the user's own storage exactly like a direct upload,
    rather than the library holding a live link to Pexels that could change
    or disappear out from under it. _fetch_with_cap already keeps this SSRF-
    safe (redirect-checked, size-capped) the same way proxy-image is."""
    await ensure_schema()
    content, content_type = await asyncio.to_thread(_fetch_with_cap, req.url, MAX_UPLOAD_BYTES, 30)
    if not content:
        raise HTTPException(status_code=400, detail="That file is empty")
    kind = _upload_kind(content_type)
    if kind not in ("image", "video", "audio"):
        raise HTTPException(status_code=400, detail="That link isn't an image, video or audio file")
    filename = _safe_filename(req.filename or req.url.rsplit("/", 1)[-1].split("?")[0] or f"stock.{content_type.split('/')[-1]}")
    blob = await asyncio.to_thread(_blob_put, f"uploads/{filename}", content, content_type)
    record = {
        "id": str(uuid.uuid4()), "url": blob.get("url"), "pathname": blob.get("pathname"),
        "filename": filename, "content_type": content_type, "kind": kind,
        "size": len(content), "created_at": now_iso(),
    }
    await d1_query(
        "INSERT INTO uploads (id, url, pathname, filename, content_type, kind, size, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [record["id"], record["url"], record["pathname"], record["filename"], record["content_type"],
         record["kind"], record["size"], record["created_at"]],
    )
    return _row_to_upload(record)


# ---------------- Custom fonts ----------------
# The catalogue the front end ships (lib/fonts.js) is limited to typefaces we
# have the right to serve: Google Fonts, one SIL OFL face bundled with the
# app, and the fonts already on the viewer's machine. That leaves out most of
# what a brand actually designs with — retail scripts from Creative Market,
# the faces Canva licenses on its users' behalf — which we can neither host
# nor redistribute on anyone's behalf.
#
# So the user supplies their own copy. It's stored like any other upload and
# served back under a family name they choose, which is all the front end
# needs to make it render everywhere a built-in font does, exports included.
MAX_FONT_BYTES = 8 * 1024 * 1024  # a generous ceiling; real faces are 20KB-2MB

_FONT_EXTENSIONS = {"woff2", "woff", "ttf", "otf"}
_FONT_CONTENT_TYPES = {
    "font/woff2", "font/woff", "font/ttf", "font/otf", "font/sfnt",
    "application/font-woff", "application/font-woff2", "application/x-font-ttf",
    "application/x-font-otf", "application/x-font-truetype", "application/x-font-opentype",
    "application/vnd.ms-opentype",
}

# What the bytes really are. Browsers and phones label font uploads wildly
# inconsistently (often application/octet-stream, sometimes nothing at all),
# so the extension is a hint and the magic number is the answer.
_FONT_MAGIC = {
    b"wOF2": "font/woff2",
    b"wOFF": "font/woff",
    b"OTTO": "font/otf",
    b"\x00\x01\x00\x00": "font/ttf",
    b"true": "font/ttf",
    b"ttcf": "font/ttf",
}


def _sniff_font(content: bytes, filename: str) -> str:
    head = content[:4]
    if head in _FONT_MAGIC:
        return _FONT_MAGIC[head]
    ext = (filename or "").rsplit(".", 1)[-1].lower()
    raise HTTPException(
        status_code=400,
        detail=(f"That doesn't look like a font file (.{ext})" if ext in _FONT_EXTENSIONS
                else "Upload a .woff2, .woff, .ttf or .otf font file"),
    )


# The name goes straight into a CSS @font-face rule on the client, so it may
# only hold what a font name plausibly holds — nothing that could close the
# rule and open another. Mirrors safeFamilyName() in lib/fonts.js so the
# family stored here is character-for-character the one that renders.
def _safe_family(name: str) -> str:
    cleaned = re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9 ._-]+", " ", name or "")).strip()
    return cleaned[:60]


def _row_to_font(row: dict):
    return {
        "id": row["id"], "name": row["name"], "url": row["url"], "filename": row["filename"],
        "content_type": row["content_type"], "size": row["size"], "created_at": row["created_at"],
    }


@api_router.get("/fonts")
async def list_custom_fonts():
    await ensure_schema()
    rows, _ = await d1_query("SELECT * FROM custom_fonts ORDER BY name COLLATE NOCASE ASC")
    return [_row_to_font(r) for r in rows]


@api_router.post("/fonts")
async def create_custom_font(file: UploadFile = File(...), name: str = Form("")):
    await ensure_schema()
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > MAX_FONT_BYTES:
        raise HTTPException(status_code=413, detail=f"Font is larger than {MAX_FONT_BYTES // (1024*1024)}MB")
    filename = _safe_filename(file.filename)
    content_type = _sniff_font(content, filename)
    # Falling back to the filename means dropping in "Brittany.otf" is enough;
    # naming it is only needed when the file is called something unhelpful.
    family = _safe_family(name) or _safe_family(re.sub(r"\.[A-Za-z0-9]+$", "", filename).replace("-", " ").replace("_", " "))
    if not family:
        raise HTTPException(status_code=400, detail="Give the font a name")

    existing, _ = await d1_query("SELECT * FROM custom_fonts WHERE name = ? COLLATE NOCASE", [family])
    blob = await asyncio.to_thread(_blob_put, f"fonts/{filename}", content, content_type)
    record = {
        "id": str(uuid.uuid4()), "name": family, "url": blob.get("url"), "pathname": blob.get("pathname"),
        "filename": filename, "content_type": content_type, "size": len(content), "created_at": now_iso(),
    }
    if existing:
        # Re-uploading a family replaces it rather than adding a second face
        # under the same name, which would render unpredictably.
        record["id"] = existing[0]["id"]
        await d1_query(
            "UPDATE custom_fonts SET url = ?, pathname = ?, filename = ?, content_type = ?, size = ?, created_at = ? WHERE id = ?",
            [record["url"], record["pathname"], record["filename"], record["content_type"],
             record["size"], record["created_at"], record["id"]],
        )
        try:
            await asyncio.to_thread(_blob_delete, [existing[0]["url"]])
        except Exception:
            logger.exception("Could not delete the replaced blob for font %s", record["id"])
    else:
        await d1_query(
            "INSERT INTO custom_fonts (id, name, url, pathname, filename, content_type, size, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [record["id"], record["name"], record["url"], record["pathname"], record["filename"],
             record["content_type"], record["size"], record["created_at"]],
        )
    return _row_to_font(record)


@api_router.delete("/fonts/{font_id}")
async def delete_custom_font(font_id: str):
    await ensure_schema()
    rows, _ = await d1_query("DELETE FROM custom_fonts WHERE id = ? RETURNING *", [font_id])
    if not rows:
        raise HTTPException(status_code=404, detail="Font not found")
    try:
        await asyncio.to_thread(_blob_delete, [rows[0]["url"]])
    except Exception:
        logger.exception("Could not delete blob for font %s (D1 row already removed)", font_id)
    return {"ok": True}


# ---------------- Elements library ----------------
# Shapes/icons/stickers are code-defined presets the frontend already knows
# (they never change, so there's nothing to store); only a user's own
# uploaded logos/badges/stamps need a row here, so they show up again on
# every future post instead of being a one-off insert.
class LibraryElementCreate(BaseModel):
    name: Optional[str] = None
    kind: str = "upload"
    element: Dict[str, Any]


def _row_to_library_element(row: dict):
    return {
        "id": row["id"], "kind": row["kind"], "name": row["name"],
        "element": _maybe_json(row.get("element"), "{}"),
        "thumbnail_url": row.get("thumbnail_url"),
        "created_at": row["created_at"],
    }


@api_router.get("/library/elements")
async def list_library_elements(kind: Optional[str] = None):
    await ensure_schema()
    if kind:
        rows, _ = await d1_query("SELECT * FROM library_elements WHERE kind = ? ORDER BY created_at DESC LIMIT 200", [kind])
    else:
        rows, _ = await d1_query("SELECT * FROM library_elements ORDER BY created_at DESC LIMIT 200")
    return [_row_to_library_element(r) for r in rows]


@api_router.post("/library/elements")
async def create_library_element(req: LibraryElementCreate):
    await ensure_schema()
    if not req.element or not req.element.get("type"):
        raise HTTPException(status_code=400, detail="element must include at least a type")
    element = dict(req.element)
    record = {
        "id": str(uuid.uuid4()), "kind": req.kind or "upload",
        "name": req.name or "Element", "element": element,
        "thumbnail_url": element.get("url") if element.get("type") == "image" else None,
        "created_at": now_iso(),
    }
    await d1_query(
        "INSERT INTO library_elements (id, kind, name, element, thumbnail_url, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [record["id"], record["kind"], record["name"], json.dumps(record["element"]),
         record["thumbnail_url"], record["created_at"]],
    )
    return _row_to_library_element(record)


@api_router.delete("/library/elements/{element_id}")
async def delete_library_element(element_id: str):
    await ensure_schema()
    rows, _ = await d1_query("DELETE FROM library_elements WHERE id = ? RETURNING id", [element_id])
    if not rows:
        raise HTTPException(status_code=404, detail="Library element not found")
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

# Every one of these fetches a URL a client supplied, not one this app
# generated — the classic SSRF shape (make the server request an internal
# address on the caller's behalf). Scheme and resolved-IP checks run before
# any request goes out; the byte cap is enforced while streaming, not after
# buffering the whole body, so a huge or slow response can't be used to
# exhaust memory or hold a lambda open.
# Narrow, explicit test-only escape hatch: a local dev/e2e harness fakes
# Blob storage by serving uploads back off its own loopback address, which
# is otherwise indistinguishable from an SSRF probe. Never set this in
# production — it isn't in .env.example, and nothing here reads it from
# anywhere a real deployment would set it. Loopback only; private ranges,
# link-local (including cloud metadata) and everything else stay blocked
# even with this set, so the guard still means something in that harness.
_ALLOW_LOOPBACK_FETCH = os.environ.get("ALLOW_LOOPBACK_FETCH") == "1"


def _assert_public_http_url(url: str):
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Only http:// and https:// URLs are allowed")
    host = parsed.hostname
    if not host:
        raise HTTPException(status_code=400, detail="That doesn't look like a valid URL")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        # Doesn't resolve for us => isn't reachable for us => not a viable
        # SSRF target; the real request below will fail on its own DNS
        # lookup the same way, with the same error either way.
        return
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_loopback and _ALLOW_LOOPBACK_FETCH:
            continue
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise HTTPException(status_code=400, detail="That host isn't reachable from here")


# Enough hops for the http->https and bare->www shuffles a real host does,
# few enough that a redirect loop ends as an error rather than a hang.
_MAX_REDIRECTS = 5


def _safe_get(url: str, *, timeout: int, stream: bool = False, headers: Optional[Dict[str, str]] = None):
    """requests.get with the private-address guard applied to every hop.

    _assert_public_http_url only ever sees the URL handed to it, and requests
    follows redirects by itself — so a public host answering 302 with a
    Location of http://169.254.169.254/ (cloud metadata) or a service on
    localhost got fetched anyway, straight past a check that would have
    rejected that address outright had it been passed in directly. The guard
    has to run against the URL actually being connected to, which means
    following the chain here rather than letting requests do it silently."""
    current = url
    for _ in range(_MAX_REDIRECTS + 1):
        _assert_public_http_url(current)
        r = requests.get(current, timeout=timeout, stream=stream, headers=headers, allow_redirects=False)
        if not r.is_redirect and not r.is_permanent_redirect:
            return r
        location = r.headers.get("location")
        r.close()
        if not location:
            raise HTTPException(status_code=502, detail=f"Could not fetch {url} (redirect with no target)")
        current = urljoin(current, location)
    raise HTTPException(status_code=502, detail=f"Could not fetch {url} (too many redirects)")


def _fetch_with_cap(url: str, max_bytes: int, timeout: int = 30) -> tuple:
    r = _safe_get(url, timeout=timeout, stream=True)
    if r.status_code != 200:
        r.close()
        raise HTTPException(status_code=502, detail=f"Could not fetch {url} ({r.status_code})")
    content_type = r.headers.get("content-type", "application/octet-stream")
    chunks, total = [], 0
    try:
        for chunk in r.iter_content(chunk_size=65536):
            if not chunk:
                continue
            total += len(chunk)
            if total > max_bytes:
                raise HTTPException(status_code=413, detail="That file is too large to analyze")
            chunks.append(chunk)
    finally:
        r.close()
    return b"".join(chunks), content_type


def _fetch_bytes(url: str, max_bytes: int = 20 * 1024 * 1024) -> bytes:
    data, _content_type = _fetch_with_cap(url, max_bytes)
    return data


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


def _relative_luminance(hexcolor: str) -> float:
    h = hexcolor.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))

    def chan(v):
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)


def _contrast_ratio(hex_a: str, hex_b: str) -> float:
    la, lb = _relative_luminance(hex_a), _relative_luminance(hex_b)
    lighter, darker = max(la, lb), min(la, lb)
    return (lighter + 0.05) / (darker + 0.05)


def _readable_text_color(fg: str, bg: str, min_ratio: float = 4.5) -> str:
    """Falls back to plain white or black when a candidate foreground
    doesn't contrast enough against its background — mirrors
    VisualCard.jsx's readableColor(). Extracted (not hand-picked) palettes
    need this: a "brightest of the sampled colors" pick is only relatively
    bright, and for a uniformly dark or uniformly light source image (a
    moody photo, a pastel scrapbook background) that still reads as
    invisible text on a same-toned background — every color in "brightest"
    and "darkest" can come from the same narrow, low-contrast band."""
    if _contrast_ratio(fg, bg) >= min_ratio:
        return fg
    return "#ffffff" if _contrast_ratio("#ffffff", bg) >= _contrast_ratio("#000000", bg) else "#000000"


def _suggest_palette(hexes: List[str]) -> Dict[str, str]:
    """Assigns bg/fg/accent/sub roles to a raw color list using real HSV
    brightness/saturation — a heuristic, not a guess: the darkest and
    brightest colors become background/text (whichever way the source
    leans), the most saturated becomes the accent. The chosen foreground is
    then guaranteed legible against the chosen background (see
    _readable_text_color) rather than trusting "brightest sampled color" to
    always mean "readable" — it doesn't, for a low-contrast source image."""
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
    return {"bg": bg, "fg": _readable_text_color(fg, bg), "accent": accent, "sub": sub}


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


# The 14 standard PDF base fonts (and a few common embedded-font names)
# mapped to a real display name — an embedded font's /BaseFont is often a
# subset tag like "ABCDEF+Calibri" or a PostScript name like
# "Helvetica-Bold", neither of which is a usable CSS font-family on its own.
_PDF_STANDARD_FONTS = {
    "helvetica": "Helvetica", "arial": "Arial", "arialmt": "Arial",
    "times": "Times New Roman", "timesroman": "Times New Roman", "timesnewroman": "Times New Roman",
    "courier": "Courier New", "couriernew": "Courier New",
    "georgia": "Georgia", "verdana": "Verdana", "calibri": "Calibri",
    "cambria": "Georgia", "garamond": "EB Garamond",
}


def _pdf_fonts(reader: PdfReader, max_pages: int = 5) -> List[str]:
    """The real font names a PDF actually uses, most-common first — cleaned
    of subset prefixes ('ABCDEF+Calibri' -> 'Calibri') and style suffixes
    ('Helvetica-Bold' -> 'Helvetica'), with the 14 standard PDF base fonts
    mapped to a real display name."""
    names = []
    for page in reader.pages[:max_pages]:
        try:
            fonts = (page.get("/Resources") or {}).get("/Font")
            if not fonts:
                continue
            for ref in fonts.values():
                base = str(ref.get_object().get("/BaseFont", "") or "")
                base = base.split("+")[-1]  # strip an embedded-subset tag
                base = re.sub(r"[-,](Bold|Italic|Oblique|Regular|MT|PS)+$", "", base, flags=re.I)
                if base:
                    names.append(_PDF_STANDARD_FONTS.get(re.sub(r"[^a-z]", "", base.lower()), base))
        except Exception:
            continue
    return [n for n, _ in Counter(names).most_common(3)]


def _pdf_vector_colors(reader: PdfReader, max_pages: int = 5) -> Optional[Dict[str, str]]:
    """The PDF's own real fill colors, read directly from its vector content
    stream (the ``R G B rg`` fill-color operator that precedes a filled
    rectangle or a text run) — not sampled from whichever embedded raster
    image happens to come first. A Canva/Illustrator/Figma export typically
    paints its background and text with these vector operators, while the
    first embedded image in such a file is often an unrelated decorative
    overlay (and may be mostly transparent, which naive RGBA-to-RGB
    flattening turns into solid black) — so vector colors are strongly
    preferred over raster sampling whenever a PDF has any. Many exports
    trace a rectangle purely to *clip* later content (`re W n`, never
    painted) — only a rectangle that's actually filled (`re ... f`) counts
    toward area, otherwise a full-page clip path would be indistinguishable
    from a full-page background fill. Among painted rectangles near the
    largest size found, the most recently painted one wins the background
    slot, since a base fill is routinely painted over by another full-bleed
    color layered on top of it. The color most often active when text is
    drawn is the foreground."""
    fill_area: Counter = Counter()
    paint_colors: Counter = Counter()
    max_area = 0.0
    bg_candidate = None
    text_colors: Counter = Counter()
    saw_any = False

    for page in reader.pages[:max_pages]:
        try:
            contents = page.get_contents()
            data = contents.get_data() if contents is not None else b""
        except Exception:
            continue
        if not data:
            continue

        stack: List[float] = []
        fill_color = None
        pending_rect_area = None
        for tok in data.split():
            try:
                stack.append(float(tok))
                continue
            except ValueError:
                pass
            if tok == b"rg" and len(stack) >= 3:
                r, g, b = stack[-3:]
                if all(0 <= v <= 1 for v in (r, g, b)):
                    fill_color = f"#{round(r * 255):02x}{round(g * 255):02x}{round(b * 255):02x}"
                    saw_any = True
            elif tok == b"re" and len(stack) >= 4:
                pending_rect_area = abs(stack[-2] * stack[-1])
            elif tok in (b"f", b"F", b"f*", b"B", b"B*", b"b", b"b*"):
                if fill_color:
                    paint_colors[fill_color] += 1
                if pending_rect_area and fill_color:
                    fill_area[fill_color] += pending_rect_area
                    if pending_rect_area >= max_area * 0.9:
                        bg_candidate = fill_color
                    max_area = max(max_area, pending_rect_area)
                pending_rect_area = None
            elif tok in (b"n", b"S", b"s"):
                pending_rect_area = None
            elif tok in (b"Tj", b"TJ") and fill_color:
                text_colors[fill_color] += 1
            stack = []

    if not saw_any:
        return None

    bg = bg_candidate or (fill_area.most_common(1)[0][0] if fill_area else None)
    if not bg:
        return None
    remaining_by_area = [hx for hx, _count in fill_area.most_common() if hx != bg]
    fg = (next((hx for hx, _count in text_colors.most_common() if hx != bg), None)
          or next(iter(remaining_by_area), "#ffffff"))

    def _hsv(hexcode):
        r, g, b = (int(hexcode[i:i + 2], 16) / 255 for i in (1, 3, 5))
        return colorsys.rgb_to_hsv(r, g, b)

    # Accent/sub draw from every painted color (rectangles and curved
    # shapes alike, e.g. doodles/icons) — fill_area alone only tracks
    # rectangle fills and would miss a page's real decorative accents. A
    # near-black or near-white color reads as visually neutral but can
    # still score a deceptively high HSV saturation (e.g. #090000 is
    # "fully saturated" red at near-zero brightness) — excluded so a real
    # colorful accent wins over what's actually just another shade of ink.
    others = [hx for hx, _count in paint_colors.most_common() if hx not in (bg, fg)]
    vivid = [hx for hx in others if 0.15 <= _hsv(hx)[2] <= 0.95]
    candidates = vivid or others
    accent = max(candidates, key=lambda hx: _hsv(hx)[1]) if candidates else fg
    sub = next((hx for hx in vivid if hx != accent), None) or next((hx for hx in others if hx != accent), fg)
    return {"bg": bg, "fg": _readable_text_color(fg, bg), "accent": accent, "sub": sub}


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
    fonts = []
    try:
        fonts = _pdf_fonts(reader)
    except Exception:
        pass
    vector_colors = None
    try:
        vector_colors = _pdf_vector_colors(reader)
    except Exception:
        pass
    return {"page_count": len(reader.pages), "text": full_text[:8000], "page_texts": page_texts,
            "first_image": first_image, "fonts": fonts, "vector_colors": vector_colors}


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


_DML_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"


def _dml_qn(tag: str) -> str:
    return f"{{{_DML_NS}}}{tag}"


# MSO_THEME_COLOR member name -> the theme's own <a:clrScheme> child tag.
_PPTX_THEME_COLOR_MAP = {
    "DARK_1": "dk1", "TEXT_1": "dk1", "LIGHT_1": "lt1", "BACKGROUND_1": "lt1",
    "DARK_2": "dk2", "TEXT_2": "dk2", "LIGHT_2": "lt2", "BACKGROUND_2": "lt2",
    "ACCENT_1": "accent1", "ACCENT_2": "accent2", "ACCENT_3": "accent3",
    "ACCENT_4": "accent4", "ACCENT_5": "accent5", "ACCENT_6": "accent6",
    "HYPERLINK": "hlink", "FOLLOWED_HYPERLINK": "folHlink",
}


def _hex_luminance(hexcolor: str) -> float:
    h = (hexcolor or "").lstrip("#")
    if len(h) != 6:
        return 0.5
    try:
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    except ValueError:
        return 0.5
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _pptx_theme(prs: Presentation) -> Dict[str, Any]:
    """A deck's real color scheme (the 12 colors in its theme1.xml) and
    typography (major/minor latin fonts) — resolvable even when no slide,
    placeholder or run overrides anything explicitly, which is the common
    case for a plain uploaded deck (python-pptx only reports what a run
    explicitly sets, not what it inherits, so without this every color and
    font read back as None for a totally ordinary, on-brand template)."""
    try:
        theme_part = prs.slide_masters[0].part.part_related_by(PPTX_RT.THEME)
        root = ET.fromstring(theme_part.blob)
        els = root.find(_dml_qn("themeElements"))
        scheme = {}
        for child in els.find(_dml_qn("clrScheme")):
            tag = child.tag.split("}")[-1]
            srgb = child.find(_dml_qn("srgbClr"))
            sysclr = child.find(_dml_qn("sysClr"))
            val = srgb.get("val") if srgb is not None else (sysclr.get("lastClr") if sysclr is not None else None)
            if val:
                scheme[tag] = f"#{val.lower()}"
        fs = els.find(_dml_qn("fontScheme"))
        major = fs.find(_dml_qn("majorFont")).find(_dml_qn("latin")).get("typeface") or None
        minor = fs.find(_dml_qn("minorFont")).find(_dml_qn("latin")).get("typeface") or None
        return {"scheme": scheme, "major_font": major, "minor_font": minor}
    except Exception:
        return {"scheme": {}, "major_font": None, "minor_font": None}


def _pptx_resolve_color(color, scheme: Dict[str, str]) -> Optional[str]:
    """An explicit RGB, or a scheme color (tx1/bg1/accent1/...) resolved
    through the deck's own theme — vs. python-pptx's raw .rgb, which raises
    for anything that isn't a literal RGB value."""
    try:
        if color.type == MSO_COLOR_TYPE.RGB:
            return f"#{color.rgb}".lower()
        if color.type == MSO_COLOR_TYPE.SCHEME:
            key = _PPTX_THEME_COLOR_MAP.get(color.theme_color.name)
            return scheme.get(key) if key else None
    except Exception:
        pass
    return None


def _pptx_bg_color(slide, scheme: Dict[str, str]) -> Optional[str]:
    """Walks slide -> layout -> master looking for the first explicit solid
    background fill; PowerPoint's own real default (no fill anywhere in that
    chain, the common case for a plain deck) is a light background, so the
    caller falls back to the theme's lt1 rather than an arbitrary guess."""
    for obj in (slide, getattr(slide, "slide_layout", None), getattr(slide.slide_layout, "slide_master", None) if getattr(slide, "slide_layout", None) else None):
        if obj is None:
            continue
        try:
            fill = obj.background.fill
            if fill.type == MSO_FILL_TYPE.SOLID:
                resolved = _pptx_resolve_color(fill.fore_color, scheme)
                if resolved:
                    return resolved
        except Exception:
            continue
    return None


EMU_PER_SLIDE_UNIT = 914400  # EMUs per inch — only used as a size fallback below
EMU_PER_POINT = 12700
# VisualCard renders every element's fontSize as px against a card this wide
# (see its own `f()` scaler), so a point size from a deck has to be restated
# in the same terms before it means anything here.
CARD_REF_WIDTH = 440
_PPTX_FONT_STYLE_SUFFIX = re.compile(
    r"\s+(bold|italic|oblique|regular|light|medium|semibold|semi\s?bold|extrabold|black|thin|heavy|book)$", re.I)


def _pptx_font_px(size_pt: float, slide_w_emu: int) -> float:
    """A point size only means something relative to the slide it sits on:
    146pt fills an 810pt-wide slide the way 79px fills a 440px-wide card.
    Writing the raw point value straight onto an element renders every
    heading roughly twice its intended size, and since the card clips
    overflow the tail of the text just disappears."""
    slide_pt = (slide_w_emu or 0) / EMU_PER_POINT
    if slide_pt <= 0:
        return size_pt
    return size_pt / slide_pt * CARD_REF_WIDTH


def _pptx_line_height(para, font_pt: Optional[float]) -> Optional[float]:
    """A paragraph's real leading, as a CSS-style multiple. python-pptx
    returns a plain float for percentage spacing and a Length for the
    exact-points form design tools actually emit — display type is routinely
    set tighter than single spacing, so assuming 1.2 for everything pushes a
    headline off the bottom of its own box."""
    try:
        spacing = para.line_spacing
    except Exception:
        return None
    if spacing is None:
        return None
    # Length subclasses int, so check for the points accessor before treating
    # the value as a bare multiple.
    pts = getattr(spacing, "pt", None)
    if pts is not None:
        return round(pts / font_pt, 3) if font_pt else None
    try:
        return round(float(spacing), 3)
    except (TypeError, ValueError):
        return None


def _pptx_box(left, top, width, height, sw, sh) -> Optional[tuple]:
    """A shape's box as percentages of the canvas, keeping any deliberate
    bleed past the edges. Shrinking an oversized box to fit instead makes
    its text wrap where the design never wrapped it — a display word set
    wider than the slide on purpose comes out broken across three lines
    rather than running off both edges as drawn. The card clips its own
    overflow, so bleed costs nothing; only a box with no overlap at all
    (something parked off the artboard entirely) is worth dropping."""
    if None in (left, top, width, height) or not width or not height or sw <= 0 or sh <= 0:
        return None
    x, y = left / sw * 100, top / sh * 100
    w, h = width / sw * 100, height / sh * 100
    if x + w <= 1 or y + h <= 1 or x >= 99 or y >= 99:
        return None
    def bound(v):  # keeps a wild value (a shape parked miles off the artboard) finite
        return round(max(-200.0, min(300.0, v)), 2)

    return bound(x), bound(y), bound(w), bound(h)


def _pptx_clean_font(name: Optional[str]) -> Optional[str]:
    """"Open Sauce Bold" is the family "Open Sauce" asked for at a bold
    weight — which is what fontWeight already carries. Keeping the style in
    the family name only makes the CSS lookup miss a font the viewer may
    genuinely have installed."""
    if not name:
        return name
    cleaned = name.strip()
    for _ in range(2):  # "Foo Bold Italic" needs two passes
        stripped = _PPTX_FONT_STYLE_SUFFIX.sub("", cleaned).strip()
        if stripped == cleaned or not stripped:
            break
        cleaned = stripped
    return cleaned or name


def _pptx_extract_design(pptx_bytes: bytes, max_slides: int = 20) -> Dict[str, Any]:
    """The deck's real design, not just its text: per-slide freeform text
    elements at their real position/size, colored and set in the deck's own
    theme fonts, plus the overall color scheme — so a template built from an
    uploaded PPTX actually looks like the file it came from."""
    prs = Presentation(io.BytesIO(pptx_bytes))
    theme = _pptx_theme(prs)
    scheme = theme["scheme"]
    bg_default = scheme.get("lt1") or "#ffffff"
    fg_default = scheme.get("dk1") or "#111111"
    fg_on_dark = scheme.get("lt1") or "#ffffff"
    sw = prs.slide_width or (EMU_PER_SLIDE_UNIT * 10)
    sh = prs.slide_height or (EMU_PER_SLIDE_UNIT * 7.5)
    align_map = {PP_ALIGN.LEFT: "left", PP_ALIGN.CENTER: "center", PP_ALIGN.RIGHT: "right"}

    slides = []
    for slide in list(prs.slides)[:max_slides]:
        shape_bg, blocks = _pptx_shape_fills(slide, scheme, sw, sh)
        bg_color = _pptx_bg_color(slide, scheme) or shape_bg or bg_default
        text_color_default = fg_on_dark if _hex_luminance(bg_color) < 0.5 else fg_default
        try:
            title_shape = slide.shapes.title
        except Exception:
            title_shape = None

        texts = []  # one entry per text shape, before any role is decided
        for shape in slide.shapes:
            if not getattr(shape, "has_text_frame", False):
                continue
            text = "\n".join(p.text for p in shape.text_frame.paragraphs if p.text).strip()
            if not text:
                continue
            try:
                box = _pptx_box(shape.left, shape.top, shape.width, shape.height, sw, sh)
            except Exception:
                box = None
            if not box:
                continue
            is_title = title_shape is not None and shape == title_shape
            first_run = next((r for p in shape.text_frame.paragraphs for r in p.runs if r.text.strip()), None)
            font_pt = first_run.font.size.pt if (first_run and first_run.font.size) else None
            font_name = (_pptx_clean_font(first_run.font.name if first_run else None)
                         or (theme["major_font"] if is_title else theme["minor_font"]))
            color = (_pptx_resolve_color(first_run.font.color, scheme) if first_run else None) or text_color_default
            bold = first_run.font.bold if (first_run and first_run.font.bold is not None) else is_title
            first_para = next((p for p in shape.text_frame.paragraphs if p.text), None)
            para_align = next((p.alignment for p in shape.text_frame.paragraphs if p.alignment), None)
            line_height = _pptx_line_height(first_para, font_pt) if first_para else None
            x, y, w, h = box
            texts.append({
                "is_title": is_title, "font_pt": font_pt or 0, "text": text,
                "element": {
                    "type": "text", "text": text, "x": x, "y": y, "w": w, "h": h,
                    "fontFamily": font_name,
                    "fontSize": round(_pptx_font_px(font_pt, sw)) if font_pt else (32 if is_title else 16),
                    "fontWeight": 800 if bold else 400, "color": color,
                    "align": align_map.get(para_align, "left"),
                    "lineHeight": line_height if line_height and line_height > 0 else 1.2,
                    "rotation": 0, "opacity": 1,
                },
            })

        headline = _pptx_pick_headline(texts)
        rest = [t for t in texts if t is not headline]
        # The longest remaining text is the paragraph slot a generated post's
        # body copy belongs in — not whichever label happens to sit highest.
        body_src = max(rest, key=lambda t: len(t["text"]), default=None)
        if headline:
            headline["element"]["role_hint"] = "title"
        if body_src and len(body_src["text"]) > 24:
            body_src["element"]["role_hint"] = "body"

        elements = blocks + [t["element"] for t in texts]
        slides.append({
            "heading": headline["text"] if headline else "",
            "body": " ".join(t["text"] for t in rest)[:500],
            "bg_color": bg_color, "elements": elements,
        })
    return {"slides": slides, "scheme": scheme, "major_font": theme["major_font"], "minor_font": theme["minor_font"]}


def _pptx_pick_headline(texts: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The slide's actual headline. A deck exported from a design tool is
    usually plain text boxes with no title placeholder at all, so trusting
    `shapes.title` alone leaves the heading empty and dumps every word into
    the body — which hands the model a blob to abstract and lets generated
    copy land in the date stamp. Falls back to the biggest type on the
    slide, preferring something that reads as a phrase over a one-word
    logotype or watermark, which is often set larger than the headline
    itself."""
    if not texts:
        return None
    titled = next((t for t in texts if t["is_title"]), None)
    if titled:
        return titled
    phrases = [t for t in texts if len(t["text"].split()) > 1]
    return max(phrases or texts, key=lambda t: (t["font_pt"], -t["element"]["y"]))


def _pptx_shape_fills(slide, scheme: Dict[str, str], sw: int, sh: int) -> (Optional[str], List[Dict[str, Any]]):
    """Solid-filled shapes: the one covering (near enough) the whole slide is
    the design's real background — decks built in a design tool paint it as
    a shape rather than setting a slide background, so without this the
    background silently falls back to the theme's default. Everything else
    becomes a real block element, since a color band behind a headline is
    part of the layout, not decoration to drop."""
    bg, blocks = None, []
    for shape in slide.shapes:
        try:
            fill = shape.fill
            if fill.type != MSO_FILL_TYPE.SOLID:
                continue
            color = _pptx_resolve_color(fill.fore_color, scheme)
        except Exception:
            continue
        if not color:
            continue
        try:
            coverage = (shape.width or 0) * (shape.height or 0) / (sw * sh)
        except Exception:
            coverage = 0
        if coverage >= 0.9:
            bg = bg or color
            continue
        try:
            box = _pptx_box(shape.left, shape.top, shape.width, shape.height, sw, sh)
        except Exception:
            box = None
        if not box:
            continue
        x, y, w, h = box
        blocks.append({"type": "shape", "shape": "rect", "x": x, "y": y, "w": w, "h": h,
                       "color": color, "rotation": 0, "opacity": 1})
    return bg, blocks


def _docx_extract(docx_bytes: bytes, max_blocks: int = 4000) -> str:
    """Word documents, tables included — brand guidelines live in tables."""
    doc = DocxDocument(io.BytesIO(docx_bytes))
    parts: List[str] = []
    for para in doc.paragraphs[:max_blocks]:
        text = para.text.strip()
        if not text:
            continue
        style = getattr(getattr(para, "style", None), "name", "") or ""
        parts.append(f"## {text}" if style.startswith("Heading") or style == "Title" else text)
    for table in doc.tables:
        for row in table.rows:
            cells = [c.text.strip().replace("\n", " ") for c in row.cells]
            line = " | ".join(c for c in cells if c)
            if line:
                parts.append(line)
    return "\n\n".join(parts)


_TEXT_ENCODINGS = ("utf-8-sig", "utf-8", "utf-16", "cp1252", "latin-1")


def _decode_text(data: bytes) -> str:
    for enc in _TEXT_ENCODINGS:
        try:
            return data.decode(enc)
        except (UnicodeDecodeError, UnicodeError):
            continue
    return data.decode("utf-8", errors="replace")


_RTF_GROUP_RE = re.compile(r"\{\\\*.*?\}", re.DOTALL)
_RTF_CONTROL_RE = re.compile(r"\\'([0-9a-fA-F]{2})|\\([a-zA-Z]+)-?\d* ?|\\([^a-zA-Z])")
_SCRIPT_STYLE_RE = re.compile(r"<(script|style)[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_BLOCK_BREAK_RE = re.compile(r"</(p|div|li|h[1-6]|tr|section|article)>|<br\s*/?>", re.IGNORECASE)


def _rtf_to_text(data: bytes) -> str:
    raw = _RTF_GROUP_RE.sub(" ", _decode_text(data))

    def sub(m):
        if m.group(1):
            try:
                return bytes([int(m.group(1), 16)]).decode("cp1252", errors="replace")
            except ValueError:
                return ""
        word = m.group(2)
        return "\n" if word in ("par", "line", "pard") else ""

    return re.sub(r"\n{3,}", "\n\n", _RTF_CONTROL_RE.sub(sub, raw).replace("{", "").replace("}", "")).strip()


def _html_to_text(data_or_str) -> str:
    html = data_or_str if isinstance(data_or_str, str) else _decode_text(data_or_str)
    html = _SCRIPT_STYLE_RE.sub(" ", html)
    html = _BLOCK_BREAK_RE.sub("\n", html)
    text = _TAG_RE.sub(" ", html)
    for entity, char in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&#39;", "'")):
        text = text.replace(entity, char)
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(ln for ln in lines if ln)).strip()


# Extensions we can read text out of directly. Anything not listed still gets
# a decode attempt if it sniffs as text — this is the "yes, and" list, not a
# gate.
_PLAIN_TEXT_EXTS = {
    "txt", "text", "md", "markdown", "mdx", "rst", "adoc", "asciidoc", "org", "log",
    "csv", "tsv", "json", "jsonl", "ndjson", "yaml", "yml", "toml", "ini", "cfg", "conf",
    "xml", "srt", "vtt", "tex", "sql",
}
_HTML_EXTS = {"html", "htm", "xhtml"}
# Formats a person plausibly has and we genuinely cannot read — say so by name
# rather than failing with "unsupported".
_KNOWN_UNREADABLE = {
    "ole": "Legacy Office files (.doc, .xls, .ppt) can't be read — re-save it as .docx, .pptx, .pdf or .txt.",
    "doc": "Legacy .doc files can't be read — re-save it as .docx, .pdf or .txt.",
    "pages": "Apple Pages files can't be read — export it as .docx or .pdf first.",
    "key": "Keynote files can't be read — export it as .pptx or .pdf first.",
    "numbers": "Numbers files can't be read — export it as .csv or .xlsx first.",
    "epub": "EPUB files can't be read yet — export the chapter as .pdf or paste the text.",
}


def _ext_of(name: str) -> str:
    return (name or "").rsplit("?", 1)[0].rsplit("#", 1)[0].rsplit(".", 1)[-1].lower() if "." in (name or "") else ""


def _sniff_document_kind(data: bytes, filename: str = "", content_type: str = "") -> str:
    """What this file actually is, by content first and name second. Browsers
    lie about content_type for .md and .csv often enough not to trust it."""
    head = data[:8]
    if head.startswith(b"%PDF"):
        return "pdf"
    if head.startswith(b"{\\rtf"):
        return "rtf"
    if head.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):   # OLE2: legacy .doc/.xls/.ppt
        return "ole"
    if head.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                names = set(z.namelist())
        except zipfile.BadZipFile:
            names = set()
        if "word/document.xml" in names:
            return "docx"
        if any(n.startswith("ppt/") for n in names):
            return "pptx"
        if any(n.startswith("xl/") for n in names):
            return "xlsx"
        return "zip"

    ext = _ext_of(filename)
    if ext in _KNOWN_UNREADABLE:
        return ext
    if ext in _HTML_EXTS:
        return "html"
    if ext in _PLAIN_TEXT_EXTS:
        return "text"

    ct = (content_type or "").lower()
    if "html" in ct:
        return "html"
    if ct.startswith("text/") or "json" in ct or "markdown" in ct or "xml" in ct:
        return "text"

    # Last resort: if it decodes cleanly and isn't mostly control bytes, it's text.
    sample = data[:4096]
    if b"\x00" in sample:
        return "binary"
    try:
        decoded = sample.decode("utf-8")
    except UnicodeDecodeError:
        return "binary"
    printable = sum(1 for ch in decoded if ch.isprintable() or ch in "\r\n\t")
    if decoded and printable / len(decoded) > 0.9:
        return "html" if decoded.lstrip()[:200].lower().startswith(("<!doctype html", "<html")) else "text"
    return "binary"


def _extract_document(data: bytes, filename: str = "", content_type: str = "") -> Dict[str, str]:
    """Any document the app accepts in, one call. Returns the text and the
    kind it turned out to be, so the caller can record where it came from."""
    kind = _sniff_document_kind(data, filename, content_type)
    if kind in _KNOWN_UNREADABLE:
        raise HTTPException(status_code=400, detail=_KNOWN_UNREADABLE[kind])
    if kind == "pdf":
        pdf = _pdf_extract(data, 40)
        return {"text": "\n\n".join(t for t in pdf["page_texts"] if t), "kind": "pdf"}
    if kind == "pptx":
        slides = _pptx_extract(data, 60)
        text = "\n\n".join(f"{s['heading']}\n{s['body']}".strip() for s in slides if s["heading"] or s["body"])
        return {"text": text, "kind": "pptx"}
    if kind == "docx":
        return {"text": _docx_extract(data), "kind": "docx"}
    if kind == "rtf":
        return {"text": _rtf_to_text(data), "kind": "rtf"}
    if kind == "html":
        return {"text": _html_to_text(data), "kind": "html"}
    if kind == "text":
        text = _decode_text(data).replace("\r\n", "\n").replace("\r", "\n")
        return {"text": re.sub(r"\n{3,}", "\n\n", text).strip(), "kind": "text"}
    if kind == "xlsx":
        raise HTTPException(status_code=400, detail="Spreadsheets can't be read yet — export the sheet as .csv.")
    raise HTTPException(
        status_code=400,
        detail="That file isn't readable as text. PDF, Word, PowerPoint, Markdown, plain text, CSV, HTML and RTF all work.",
    )


_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_META_DESC_RE = re.compile(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)', re.IGNORECASE)
_OG_IMAGE_RE = re.compile(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)', re.IGNORECASE)
_ICON_RE = re.compile(r'<link[^>]+rel=["\'][^"\']*icon[^"\']*["\'][^>]+href=["\']([^"\']+)', re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")


def _url_analysis(url: str) -> Dict[str, Any]:
    r = _safe_get(url, timeout=20, headers={"User-Agent": "Mozilla/5.0 (compatible; CreateOSBot/1.0)"})
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
        used_vector = False
        if pdf["vector_colors"]:
            result["colors"] = pdf["vector_colors"]
            used_vector = True
        elif pdf["first_image"]:
            try:
                hexes = await asyncio.to_thread(_dominant_colors, pdf["first_image"])
                result["colors"] = _suggest_palette(hexes)
            except Exception:
                pass
        voice = await _infer_voice_style(pdf["text"], f"a {pdf['page_count']}-page PDF", model)
        result["voice"], result["style"], result["detected_name"] = voice["voice"], voice["style"], voice["suggested_name"]
        note = f"Voice and style inferred from the PDF's actual text ({pdf['page_count']} pages read)."
        if used_vector:
            note += " A color palette was read directly from the PDF's own vector fill colors."
        elif pdf["first_image"]:
            note += " A color palette was pulled from an image embedded in the PDF."
        else:
            note += " No usable colors found to pull a palette from."
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


class TemplateFromComposerRequest(BaseModel):
    name: Optional[str] = None
    format: str
    theme: Optional[str] = "midnight"
    model: Optional[str] = None
    slides: List[Dict[str, Any]]  # raw Composer asset specs (heading/body/title + elements when customized)


def _maybe_json(v, default):
    """Accepts either an already-parsed value (building a response straight
    from a freshly-inserted record) or the JSON text a D1 row stores it as."""
    return v if isinstance(v, (list, dict)) else json.loads(v or default)


def _row_to_visual_template(row: dict):
    return {
        "id": row["id"], "name": row["name"], "source_kind": row["source_kind"],
        "source_url": row["source_url"], "format": row["format"], "theme": row["theme"],
        "colors": _maybe_json(row.get("colors"), "{}"),
        "slides": _maybe_json(row.get("slides"), "[]"),
        "layouts": _maybe_json(row.get("layouts"), "{}"),
        "bg_colors": _maybe_json(row.get("bg_colors"), "{}"),
        "clips": _maybe_json(row.get("clips"), "{}"), "created_at": row["created_at"],
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


def _template_preview(tpl: dict, layouts: Optional[dict] = None) -> Optional[dict]:
    """A representative first-slide spec, ready for VisualCard — so the
    library shows what a template actually looks like instead of a name and
    a description. Starters use their own outline as placeholder copy (the
    same words already visible in the library's description text); a
    converted deck's slides are already an abstracted outline, not the
    source's literal wording, so showing them as-is doesn't leak anything.
    A template with nothing visual to show (an image-only conversion has a
    palette but no layout) returns None — the caller falls back to its
    existing color-swatch summary."""
    slides = tpl.get("slides") or []
    first = slides[0] if slides else {}
    # Not every format has a cover (a reel storyboard is scenes only) — same
    # fallback order _apply_template_layouts uses at generation time.
    layout = (layouts or {}).get("cover") or (layouts or {}).get("slide")
    if layout:
        elements = _fill_layout(layout, {
            "title": first.get("heading") or tpl.get("name") or "",
            "heading": first.get("heading") or tpl.get("name") or "",
            "body": first.get("body") or "",
            "index": 1,
        }, 1)
        bg_colors = tpl.get("bg_colors") or {}
        preview = {"theme": tpl.get("theme"), "elements": elements}
        bg = bg_colors.get("cover") or bg_colors.get("slide")
        if bg:
            preview["bg_color"] = bg
        return preview
    if slides:
        return {"template": "slide", "theme": tpl.get("theme"), "total": 1,
                "heading": first.get("heading") or "", "body": first.get("body") or ""}
    return None


def _starter_as_template(t: dict) -> dict:
    """A starter rendered in the same shape the library and the Composer's
    picker already speak, so neither needs to know it isn't a saved row."""
    return {
        "id": t["id"], "name": t["name"], "source_kind": "starter", "source_url": "",
        "format": t["format"], "theme": t["theme"], "colors": {}, "slides": t["slides"],
        "description": t["description"], "builtin": True, "created_at": "",
        "preview": _template_preview(t, t.get("layouts")),
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
    fully editable in the Composer. A reel scene's clip rides along the same
    way, and independently of layout: a scene can have a saved clip with no
    customized elements at all (see _layouts_from_composer_slides), so it's
    applied whether or not this slide has a layout to fill."""
    layouts = (template or {}).get("layouts") or {}
    bg_colors = (template or {}).get("bg_colors") or {}
    clips = (template or {}).get("clips") or {}
    if not layouts and not clips:
        return assets
    last = len(assets) - 1
    for i, asset in enumerate(assets):
        spec = asset["spec"]
        # Whether this slide plays the cover/outro role depends on whether
        # the template actually customized THAT role in any way — layout,
        # background or clip — not layout alone; a reel whose only saved
        # customization is an outro clip would otherwise never route there.
        if i == 0 and spec.get("template") == "cover" and (layouts.get("cover") or bg_colors.get("cover") or clips.get("cover")):
            key = "cover"
        elif i == last and last > 0 and (layouts.get("outro") or bg_colors.get("outro") or clips.get("outro")):
            key = "outro"
        else:
            key = "slide"
        layout = layouts.get(key) or layouts.get("slide") or layouts.get("cover")
        if layout:
            spec["elements"] = _fill_layout(layout, spec, i)
            # A source file's own background (e.g. a PPTX's real slide
            # color) doesn't fit any of the four built-in theme keys, so it
            # rides along separately from the role-based layout itself.
            bg = bg_colors.get(key) or bg_colors.get("slide") or bg_colors.get("cover")
            if bg:
                spec["bg_color"] = bg
        # This scene's own saved footage first (see _layouts_from_composer_slides
        # on why clips are keyed per index as well as per role), falling back to
        # the role keys for templates saved before that and for carousels.
        clip = clips.get(str(i)) or clips.get(key) or clips.get("slide") or clips.get("cover")
        if clip:
            spec["clip"] = dict(clip)
            spec["video_url"] = clip.get("url", "")
    return assets


def _layout_hint(el: Dict[str, Any]) -> Optional[str]:
    """Which dynamic slot (title-ish, or body) an element was already
    established as, from either signal a text element can carry it under:
    role_hint (an extraction's own say-so, see _pptx_extract_design) or role
    (this same function's OWN output from a previous save — see the note on
    _layout_from_elements below for why that second case matters)."""
    hint = el.get("role_hint")
    if hint:
        return hint
    role = el.get("role")
    if role in ("title", "heading"):
        return "title"
    if role == "body":
        return "body"
    return None


def _layout_from_elements(elements: List[Dict[str, Any]], is_cover: bool) -> List[Dict[str, Any]]:
    """Turns one slide's freeform elements into a reusable layout: one or two
    text elements become dynamic (role title/heading, then body — refilled
    with fresh copy every time this template is used); everything else
    (images, shapes, extra badges) is carried through exactly as designed,
    unchanged on every future post built from this template.

    An extracted design says outright which element is its headline and which
    is its paragraph (role_hint, see _pptx_extract_design) — but editing a
    template that arrived with that hint materializes it into a real,
    editable Composer deck first (see templateEdit.js), and role_hint isn't
    on the result: it was already consumed and popped, replaced by this same
    function's own `role` output the first time it ran. Re-saving that deck
    with no memory of the hint would fall through to guessing by Y position —
    and for a design where the actual headline isn't the visually topmost
    text (a date stamp or handle sitting above it, as in a real Canva-style
    layout), that guess lands on the wrong element: the badge becomes the
    "dynamic" slot and the real headline's role is silently duplicated onto
    it, corrupting both on the very first edit-and-save. Treating an
    established `role` exactly like `role_hint` (_layout_hint, above) keeps
    the assignment stable across any number of edit/save cycles; the Y-guess
    is now reached only on a template's first save, when neither signal
    exists at all (a deck drafted straight in the Composer)."""
    texts = [e for e in elements if e.get("type") == "text"]
    hinted_title = next((e for e in texts if _layout_hint(e) == "title"), None)
    hinted_body = next((e for e in texts if _layout_hint(e) == "body"), None)
    if hinted_title or hinted_body:
        roles = {id(e): role for e, role in ((hinted_title, "title"), (hinted_body, "body")) if e}
    else:
        topmost = sorted(texts, key=lambda e: e.get("y", 0))[:2]
        roles = {id(e): ("title" if i == 0 else "body") for i, e in enumerate(topmost)}
    out = []
    for el in elements:
        e = dict(el)
        e.pop("id", None)
        e.pop("role_hint", None)
        # Cleared unconditionally so an element demoted this round (it held
        # a role before but lost the hint contest to another element) can't
        # keep answering to its stale role forever — see the docstring.
        e.pop("role", None)
        role = roles.get(id(el))
        if role:
            e["role"] = ("title" if is_cover else "heading") if role == "title" else "body"
            e.pop("text", None)
            # A slot that will be refilled with copy of some unknown future
            # length has to be able to hold it: keep the design's own box for
            # static art, but pull a dynamic one back inside the canvas so
            # fresh copy wraps into view instead of running off the edge the
            # source's hand-broken lines never reached.
            for pos, size in (("x", "w"), ("y", "h")):
                start = max(0.0, float(e.get(pos, 0) or 0))
                e[pos] = round(start, 2)
                e[size] = round(max(1.0, min(float(e.get(size, 0) or 0), 100 - start)), 2)
        out.append(e)
    return out


def _layouts_from_composer_slides(slides: List[Dict[str, Any]]) -> (Dict[str, Any], Dict[str, str], Dict[str, Any]):
    """Picks one representative slide per role (cover/slide/outro) — the same
    three roles _apply_template_layouts fills at generation time — from a
    Composer deck, plus that slide's own background color when it has one
    (e.g. one set directly in the editor, or carried over from a template
    this deck was originally built from), and its video clip when it has
    one. Layout/background need freeform elements to have been customized at
    all (there's nothing to save otherwise); a clip doesn't — VideoClipEditor
    renders for every reel scene regardless of whether it's ever entered
    layout edit — so it's collected on its own rather than gated behind
    `els`, or a stock video picked for a plain scene would be silently
    dropped the moment the deck is saved as a template."""
    layouts: Dict[str, Any] = {}
    bg_colors: Dict[str, str] = {}
    clips: Dict[str, Any] = {}
    last = len(slides) - 1
    for i, s in enumerate(slides):
        is_cover = i == 0 and s.get("template") == "cover"
        key = "cover" if is_cover else ("outro" if i == last and last > 0 else "slide")
        els = s.get("elements")
        if els and key not in layouts:
            layouts[key] = _layout_from_elements(els, is_cover)
            if s.get("bg_color"):
                bg_colors[key] = s["bg_color"]
        clip_url = (s.get("clip") or {}).get("url") or s.get("video_url")
        if clip_url:
            clip = {**(s.get("clip") or {}), "url": clip_url}
            # Layout is deliberately one representative slide per role — a
            # template is a reusable look, not a copy of this deck. Footage
            # isn't: a reel's scenes each carry their own clip, and keying
            # those by role meant only the first scene's survived and then
            # got replayed on every scene, with the rest dropped outright.
            # Per-index keys keep each scene's own footage; the role keys
            # stay alongside them so templates saved before this (and
            # carousels, which really do want one representative) still
            # resolve exactly as they did.
            clips[str(i)] = clip
            clips.setdefault(key, clip)
    return layouts, bg_colors, clips


def _layouts_from_design_slides(slides: List[Dict[str, Any]]) -> (Dict[str, Any], Dict[str, str]):
    """Same idea as _layouts_from_composer_slides, for a deck's real
    extracted design (see _pptx_extract_design): picks one representative
    slide per role and also carries that slide's real background color
    along, keyed the same way, since a source file's own color rarely
    matches any of the four built-in theme backgrounds."""
    layouts: Dict[str, Any] = {}
    bg_colors: Dict[str, str] = {}
    last = len(slides) - 1
    for i, s in enumerate(slides):
        els = s.get("elements")
        if not els:
            continue
        is_cover = i == 0
        key = "cover" if is_cover else ("outro" if i == last and last > 0 else "slide")
        if key not in layouts:
            layouts[key] = _layout_from_elements(els, is_cover)
            if s.get("bg_color"):
                bg_colors[key] = s["bg_color"]
    return layouts, bg_colors


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
    layouts: Dict[str, Any] = {}
    bg_colors: Dict[str, str] = {}

    if req.source_type == "pptx":
        data = await asyncio.to_thread(_fetch_bytes, req.source_url)
        design = await asyncio.to_thread(_pptx_extract_design, data)
        raw_slides = [{"heading": s["heading"], "body": s["body"]} for s in design["slides"]]
        if not raw_slides or not any(s["heading"] or s["body"] for s in raw_slides):
            raise HTTPException(status_code=422, detail="Couldn't find any slide text in that PPTX")
        slides = await _abstract_slides(raw_slides, model)
        # The deck's real color scheme and layout, not a generic guess — see
        # _pptx_extract_design. The four built-in theme keys are still a
        # backward-compatible carrier for anything that falls outside the
        # extracted layout (e.g. if a slide count exceeds what got a real
        # layout), so still pick whichever reads closer to the deck's own
        # background rather than always defaulting to midnight.
        scheme_hexes = list(design["scheme"].values())
        if scheme_hexes:
            colors = _suggest_palette(scheme_hexes)
        bg_guess = design["scheme"].get("lt1") or "#ffffff"
        theme = "whiteboard" if _hex_luminance(bg_guess) >= 0.5 else "midnight"
        layouts, bg_colors = await asyncio.to_thread(_layouts_from_design_slides, design["slides"])
        fmt, source_kind = "carousel", "pptx"

    elif req.source_type == "pdf":
        data = await asyncio.to_thread(_fetch_bytes, req.source_url)
        pdf = await asyncio.to_thread(_pdf_extract, data)
        raw_slides = [{"heading": f"Page {i+1}", "body": t[:500]} for i, t in enumerate(pdf["page_texts"]) if t]
        if not raw_slides:
            raise HTTPException(status_code=422, detail="Couldn't find any text in that PDF")
        slides = await _abstract_slides(raw_slides, model)
        theme = "midnight"
        if pdf["vector_colors"]:
            colors = pdf["vector_colors"]
        elif pdf["first_image"]:
            try:
                hexes = await asyncio.to_thread(_dominant_colors, pdf["first_image"])
                colors = _suggest_palette(hexes)
            except Exception:
                pass
        font = (pdf.get("fonts") or [None])[0]
        if colors or font:
            # No embedded per-shape geometry to recover from a PDF short of a
            # much heavier PDF-layout dependency — but the real extracted
            # colors and/or real font now actually reach a generated post
            # instead of being computed and then discarded; whichever one
            # wasn't found (a text-only PDF has no image to sample colors
            # from; some PDFs don't expose real font resources) falls back to
            # a sane generic default rather than blocking on the other.
            bg = colors.get("bg", "#0A0A0A") if colors else "#0A0A0A"
            fg = colors.get("fg", "#FFFFFF") if colors else "#FFFFFF"
            accent = colors.get("accent", "#E2FF3D") if colors else "#E2FF3D"
            theme = "whiteboard" if _hex_luminance(bg) >= 0.5 else "midnight"
            layouts = {
                "cover": [
                    {"type": "text", "role": "title", "x": 8, "y": 30, "w": 84, "h": 40,
                     "fontFamily": font, "fontSize": 38, "fontWeight": 800, "color": fg,
                     "align": "left", "lineHeight": 1.05},
                    {"type": "shape", "shape": "rect", "x": 8, "y": 85, "w": 20, "h": 1.4,
                     "color": accent, "opacity": 1},
                ],
                "slide": [
                    {"type": "text", "role": "heading", "x": 8, "y": 20, "w": 84, "h": 22,
                     "fontFamily": font, "fontSize": 26, "fontWeight": 800, "color": fg,
                     "align": "left", "lineHeight": 1.1},
                    {"type": "text", "role": "body", "x": 8, "y": 48, "w": 84, "h": 34,
                     "fontFamily": font, "fontSize": 16, "fontWeight": 400, "color": fg,
                     "align": "left", "lineHeight": 1.4},
                ],
            }
            bg_colors = {"cover": bg, "slide": bg}
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
        "colors": colors, "slides": slides, "layouts": layouts, "bg_colors": bg_colors, "created_at": now_iso(),
    }
    await d1_query(
        "INSERT INTO visual_templates (id, name, source_kind, source_url, format, theme, colors, slides, layouts, bg_colors, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [record["id"], record["name"], record["source_kind"], record["source_url"], record["format"],
         record["theme"], json.dumps(record["colors"]), json.dumps(record["slides"]),
         json.dumps(record["layouts"]), json.dumps(record["bg_colors"]), record["created_at"]],
    )
    return _row_to_visual_template(record)


def _literal_composer_outline(slides: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """The outline exactly as the Composer currently has it, with no AI
    rewrite — just the heading/body/title fields pulled out plainly."""
    return [{"heading": s.get("heading") or s.get("title") or "", "body": s.get("body") or ""} for s in slides]


async def _abstract_composer_outline(slides: List[Dict[str, Any]], model: str) -> List[Dict[str, str]]:
    """The first-save step of turning a Composer deck into a template: an
    abstracted outline (so a future generation writes fresh copy about a new
    topic, never this deck's literal wording). Only for the initial save —
    see update_template_from_composer for why editing an existing template
    doesn't run this again."""
    raw_slides = _literal_composer_outline(slides)
    return (
        await _abstract_slides(raw_slides, model)
        if any(s["heading"] or s["body"] for s in raw_slides) else raw_slides
    )


@api_router.post("/templates/from-composer")
async def create_template_from_composer(req: TemplateFromComposerRequest):
    """Saves the deck currently open in the Composer as a reusable template:
    an outline — abstracted for a carousel so future generations write fresh
    copy rather than this post's literal wording, verbatim for a reel, which
    is saved to keep one particular script — plus, for any slide that was
    customized in the freeform editor, the actual layout, in the same shape
    STARTER_TEMPLATES and file-converted templates already speak."""
    await ensure_schema()
    model = req.model or CHAT_MODEL
    # Abstracting the copy is what makes a carousel design reusable: "Week 6
    # is where everyone quits" becomes "State the turning point", so the next
    # post built from it writes fresh copy about its own topic. A reel is
    # saved for the opposite reason — to keep a particular script, timing and
    # cut — so rewording it there only ever destroyed what was being saved.
    slides = (
        _literal_composer_outline(req.slides) if req.format == "reel"
        else await _abstract_composer_outline(req.slides, model)
    )
    layouts, bg_colors, clips = _layouts_from_composer_slides(req.slides)

    record = {
        "id": str(uuid.uuid4()), "name": req.name or "Untitled template",
        "source_kind": "composer", "source_url": "", "format": req.format,
        "theme": req.theme or "midnight", "colors": {}, "slides": slides,
        "layouts": layouts, "bg_colors": bg_colors, "clips": clips, "created_at": now_iso(),
    }
    await d1_query(
        "INSERT INTO visual_templates (id, name, source_kind, source_url, format, theme, colors, slides, layouts, bg_colors, clips, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [record["id"], record["name"], record["source_kind"], record["source_url"], record["format"],
         record["theme"], json.dumps(record["colors"]), json.dumps(record["slides"]), json.dumps(record["layouts"]),
         json.dumps(record["bg_colors"]), json.dumps(record["clips"]), record["created_at"]],
    )
    return _row_to_visual_template(record)


@api_router.put("/templates/custom/{template_id}")
async def update_template_from_composer(template_id: str, req: TemplateFromComposerRequest):
    """The edit counterpart to /templates/from-composer's create: re-derives
    a template's outline, layout and background colors from the Composer
    deck currently open for it and overwrites the saved template in place —
    so a template's colors, style, fonts, layout and slide count can all be
    changed after it was first saved, not just at the moment of creation.

    Unlike create, this does NOT run the outline back through the AI
    abstraction step. materializeTemplateSlides fills the reopened deck's
    text straight from the template's own already-abstracted outline, so at
    the moment this fires, whatever text is on screen — untouched or freshly
    retyped — IS the outline, verbatim: the user is directly authoring the
    template's own copy now, not genericizing a specific post the way the
    first save does. Re-abstracting it here served no purpose but to send it
    through the LLM a second time, whose phrasing isn't stable between calls
    even on identical input — every edit-and-save, even one that never
    touched the text, silently reworded it into a different generic
    paraphrase. That's what "template text keeps reverting" actually was."""
    await ensure_schema()
    if template_id in STARTER_BY_ID:
        raise HTTPException(status_code=400, detail="Starter templates ship with the app and can't be edited — use \"Save as new\" to keep your changes as a new template")
    rows, _ = await d1_query("SELECT name FROM visual_templates WHERE id = ?", [template_id])
    if not rows:
        raise HTTPException(status_code=404, detail="Template not found")

    slides = _literal_composer_outline(req.slides)
    layouts, bg_colors, clips = _layouts_from_composer_slides(req.slides)
    name = (req.name or "").strip() or rows[0]["name"]

    await d1_query(
        "UPDATE visual_templates SET name = ?, format = ?, theme = ?, slides = ?, layouts = ?, bg_colors = ?, clips = ? WHERE id = ?",
        [name, req.format, req.theme or "midnight", json.dumps(slides), json.dumps(layouts), json.dumps(bg_colors),
         json.dumps(clips), template_id],
    )
    updated, _ = await d1_query("SELECT * FROM visual_templates WHERE id = ?", [template_id])
    return _row_to_visual_template(updated[0])


@api_router.get("/templates/custom")
async def list_custom_templates():
    """The user's converted templates first (newest first), then the starters
    that ship with the app — one list, so the picker has something to offer
    on day one."""
    await ensure_schema()
    rows, _ = await d1_query("SELECT * FROM visual_templates ORDER BY created_at DESC LIMIT 100")
    saved = [_row_to_visual_template(r) for r in rows]
    for tpl in saved:
        tpl["preview"] = _template_preview(tpl, tpl.get("layouts"))
    return saved + [_starter_as_template(t) for t in STARTER_TEMPLATES]


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
        model = opts.get("model", "gpt-image-2.5-sunburst")
        payload = {"prompt": prompt, "size": opts.get("size", "1:1")}
        if model.startswith("gpt-image"):
            payload["quality"] = opts.get("quality", "medium")
        if opts.get("resolution"):
            payload["resolution"] = opts["resolution"]
        # A non-empty image_urls turns every one of these models from
        # text-to-image into reference-image editing (verified per-model,
        # 2026-09-11: gpt-image-2.5-sunburst, nano-banana-2/-pro,
        # seedream-5.0-pro, qwen-image-3, z-image all accept it under this
        # exact field name — the frontend (Studio.jsx IMAGE_MODELS) is the
        # source of truth for which model gets which size/resolution/quality
        # enum; this endpoint just forwards what it's given).
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
            instrumental = bool(opts.get("instrumental", False))
            mv = opts.get("mv", "V4_5")
            if instrumental:
                # PoYo's own docs: custom_mode=false ("simple mode") is for a
                # full song with auto-generated lyrics from a prompt, and
                # explicitly says every other parameter should be left empty
                # there — instrumental=true never belonged in that mode.
                # An instrumental track needs custom_mode=true, where style
                # and title are required ("only style and title are needed").
                style = (opts.get("style") or prompt or "Upbeat, cinematic instrumental").strip()[:1000]
                title = (opts.get("title") or prompt or "Background score").strip()[:80] or "Background score"
                payload = {"style": style, "title": title, "custom_mode": True, "instrumental": True, "mv": mv}
                if prompt:
                    payload["prompt"] = prompt[:5000]
            else:
                payload = {"prompt": prompt, "custom_mode": False, "instrumental": False, "mv": mv}
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
    rows, _ = await d1_query("SELECT kind FROM generations WHERE task_id = ?", [task_id])
    kind = rows[0]["kind"] if rows else None
    if kind == "music":
        data = await asyncio.to_thread(_poyo_music_detail, task_id)
    else:
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
        # A voice generation requested with timestamps=true carries ElevenLabs'
        # own character-alignment object here (shape: parallel `characters`/
        # `character_start_times_seconds`/`character_end_times_seconds` arrays).
        # Passed through verbatim — the frontend derives word timing from it.
        "alignment": data.get("normalized_alignment") or data.get("alignment"),
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
        lambda: _safe_get(req.url, timeout=30, headers={"User-Agent": "CreateOS/1.0"})
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
# The extra content a one-page brand guideline needs that a graphic-oriented
# kit otherwise has no reason to collect: how the logo may be used, what
# imagery/icons should look like, and the voice's plain attributes/examples
# rather than just its free-text description.
DEFAULT_GUIDELINE = {
    # Three lockups a real guideline shows side by side, on top of the
    # kit's own primary logo_url: full color, and the two single-color
    # variants for a light or dark background respectively.
    "logos": {"color": "", "black_on_white": "", "white_on_black": ""},
    "logo_clear_space": "", "logo_min_size": "",
    "logo_dos": [], "logo_donts": [],
    "imagery_mood": "", "imagery_color": "", "icon_style": "",
    "voice_attributes": [], "voice_do": "", "voice_dont": "",
    "doc_owner": "", "version": "v1.0",
}
def _normalize_guideline(raw) -> dict:
    """Merges a saved (possibly partial or legacy) guideline onto
    DEFAULT_GUIDELINE so a missing key never surfaces as a KeyError — same
    idea as _normalize_colors, but guideline is otherwise flat aside from
    the nested `logos` lockups, which get their own one-level merge."""
    g = raw if isinstance(raw, dict) else {}
    merged = {**DEFAULT_GUIDELINE, **g}
    merged["logos"] = {**DEFAULT_GUIDELINE["logos"], **(g.get("logos") or {})}
    return merged


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
    "guideline": DEFAULT_GUIDELINE,
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
    guideline: Optional[Dict[str, Any]] = None
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
        "guideline": _normalize_guideline(json.loads(row.get("guideline") or "{}")),
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
    if changes.get("guideline") is not None:
        changes["guideline"] = _normalize_guideline(changes["guideline"])
    merged = {**DEFAULT_BRAND, **changes}
    if not changes.get("name"):
        merged["name"] = "New brand kit"
    merged["colors"] = _normalize_colors(merged["colors"])
    ts = now_iso()
    rows, _ = await d1_query("SELECT COUNT(*) AS n FROM brand_kits")
    is_first = not rows or not rows[0]["n"]
    out, _ = await d1_query(
        "INSERT INTO brand_kits (id, name, colors, color_mode, fonts, logo_url, handle, voice, style, audience, "
        "hashtags, cta, banned_words, guideline, is_default, updated_at, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
        [str(uuid.uuid4()), merged["name"], json.dumps(merged["colors"]), merged["color_mode"],
         json.dumps(merged["fonts"]), merged["logo_url"], merged["handle"], merged["voice"], merged["style"],
         merged["audience"], json.dumps(merged["hashtags"]), merged["cta"], json.dumps(merged["banned_words"]),
         json.dumps(merged["guideline"]), 1 if is_first else 0, ts, ts],
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
    existing = _row_to_brand(rows[0])
    if changes.get("guideline") is not None:
        # A guideline is mostly a flat bag of scalar/list fields (plus the
        # nested `logos` lockups) — merge onto what's already saved, so a
        # caller that only sends the fields it changed doesn't wipe out
        # everything else in the guideline.
        merged_guideline = {**existing["guideline"], **changes["guideline"]}
        if "logos" in changes["guideline"]:
            merged_guideline["logos"] = {**existing["guideline"]["logos"], **changes["guideline"]["logos"]}
        changes["guideline"] = merged_guideline
    merged = {**existing, **changes}
    merged["colors"] = _normalize_colors(merged["colors"])
    ts = now_iso()
    out, _ = await d1_query(
        "UPDATE brand_kits SET name=?, colors=?, color_mode=?, fonts=?, logo_url=?, handle=?, voice=?, style=?, "
        "audience=?, hashtags=?, cta=?, banned_words=?, guideline=?, updated_at=? WHERE id=? RETURNING *",
        [merged["name"], json.dumps(merged["colors"]), merged["color_mode"], json.dumps(merged["fonts"]),
         merged["logo_url"], merged["handle"], merged["voice"], merged["style"], merged["audience"],
         json.dumps(merged["hashtags"]), merged["cta"], json.dumps(merged["banned_words"]),
         json.dumps(merged["guideline"]), ts, kit_id],
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


@api_router.get("/brand-kits/{kit_id}/export")
async def export_brand_kit(kit_id: str):
    """Everything one kit knows and sounds like, as one file — the D1
    database backing this app has no export of its own, so this is the only
    way any of it leaves. Includes documents shared across every kit
    (brand_kit_id NULL) alongside this kit's own, since a restore needs both
    to reproduce what a generation actually saw."""
    await ensure_schema()
    rows, _ = await d1_query("SELECT * FROM brand_kits WHERE id = ?", [kit_id])
    if not rows:
        raise HTTPException(status_code=404, detail="Brand kit not found")
    docs, _ = await d1_query(
        "SELECT * FROM knowledge_docs WHERE brand_kit_id = ? OR brand_kit_id IS NULL "
        "ORDER BY pinned DESC, created_at ASC",
        [kit_id],
    )
    return {
        "exported_at": now_iso(),
        "kind": "postit_brand_kit_export",
        "version": 1,
        "brand_kit": _row_to_brand(rows[0]),
        "knowledge_docs": [_row_to_doc(d, include_content=True) for d in docs],
    }


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


def _term_counts(text: str) -> Dict[str, int]:
    """Stemmed term frequencies for one piece of text. This is the only
    tokenizing work retrieval should ever do live — everything else is
    computed once, at ingest, and reused unchanged on every generation."""
    counts: Dict[str, int] = {}
    for t in _terms(text):
        counts[t] = counts.get(t, 0) + 1
    return counts


def _merge_term_counts(a: Dict[str, int], b: Dict[str, int]) -> Dict[str, int]:
    out = dict(a)
    for t, c in b.items():
        out[t] = out.get(t, 0) + c
    return out


def _doc_meta_text(title: str, kind: str, summary: str, tags: List[str]) -> str:
    return f"{title} {kind} {summary or ''} {' '.join(tags or [])}"


def _doc_meta_terms(doc_row: dict) -> Dict[str, int]:
    """A document's title/kind/summary/tags, tokenized — this is what lets a
    chunk match a topic phrased in the document's own language rather than
    only the passage's. Read from the precomputed column; a row written
    before that column existed (or a genuinely term-free one) is tokenized
    once here rather than left unscored."""
    parsed = _maybe_json(doc_row.get("meta_terms"), "{}") if doc_row.get("meta_terms") else {}
    if parsed:
        return parsed
    return _term_counts(_doc_meta_text(
        doc_row.get("title", ""), doc_row.get("kind", ""), doc_row.get("summary", ""),
        _maybe_json(doc_row.get("tags"), "[]"),
    ))


def _chunk_term_counts(chunk_row: dict) -> Dict[str, int]:
    """A chunk's precomputed term frequencies, same fallback as above."""
    parsed = _maybe_json(chunk_row.get("terms"), "{}") if chunk_row.get("terms") else {}
    if parsed:
        return parsed
    return _term_counts(chunk_row.get("text") or "")


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


def _bm25_rank_indexed(query: str, rows: List[Dict[str, int]], k1: float = 1.5, b: float = 0.75) -> List[tuple]:
    """Classic BM25, but over rows that already carry their term frequencies
    (a {stem: count} dict per row) instead of raw text. Tokenizing and
    stemming the corpus happened once, at ingest — the only text this
    tokenizes on the retrieval path is the query itself, a handful of words."""
    q_terms = set(_terms(query))
    if not q_terms or not rows:
        return []
    lengths = [sum(r.values()) or 1 for r in rows]
    avg_len = sum(lengths) / len(lengths)
    df: Dict[str, int] = {}
    for r in rows:
        for t in set(r) & q_terms:
            df[t] = df.get(t, 0) + 1
    n = len(rows)
    scored = []
    for i, r in enumerate(rows):
        if not r:
            continue
        score = 0.0
        for t in q_terms:
            f = r.get(t, 0)
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
        # Term frequencies computed once here, not on every generation that
        # retrieves this chunk afterward.
        await d1_query(
            "INSERT INTO knowledge_chunks (id, doc_id, brand_kit_id, seq, text, terms, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [str(uuid.uuid4()), doc_id, brand_kit_id, seq, chunk, json.dumps(_term_counts(chunk)), ts],
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


# Kept warm per brand kit across generations in this process's memory.
# A generation used to re-fetch every document and every chunk, then
# re-tokenize the whole corpus, on every single call. Now it pays one cheap
# aggregate query to check whether anything changed, and only re-fetches
# (and never re-tokenizes — that's precomputed at ingest) when it did.
_KB_CACHE: Dict[str, Dict[str, Any]] = {}


async def _kb_version(brand_kit_id: Optional[str]) -> str:
    rows, _ = await d1_query(
        "SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), '') AS latest FROM knowledge_docs "
        "WHERE enabled = 1 AND (brand_kit_id = ? OR brand_kit_id IS NULL)",
        [brand_kit_id],
    )
    r = rows[0] if rows else {"n": 0, "latest": ""}
    return f"{r['n']}:{r['latest']}"


async def _load_kb_corpus(brand_kit_id: Optional[str]) -> Dict[str, Any]:
    """One kit's retrievable knowledge, ready to score. Cached until the
    version check above says it changed."""
    key = brand_kit_id or "*"
    version = await _kb_version(brand_kit_id)
    cached = _KB_CACHE.get(key)
    if cached and cached["version"] == version:
        return cached

    # `content` is deliberately not selected here — most generations never
    # need a document's full text, only its summary. Shipping every
    # document's body on every generation was most of the bytes moved for
    # no benefit.
    docs, _ = await d1_query(
        "SELECT id, brand_kit_id, title, kind, summary, tags, pinned, enabled, updated_at, meta_terms "
        "FROM knowledge_docs WHERE enabled = 1 AND (brand_kit_id = ? OR brand_kit_id IS NULL) "
        "ORDER BY pinned DESC, updated_at DESC LIMIT 200",
        [brand_kit_id],
    )
    for d in docs:
        d["_meta_terms"] = _doc_meta_terms(d)
    by_id = {d["id"]: d for d in docs}

    chunks, _ = await d1_query(
        "SELECT id, doc_id, brand_kit_id, seq, text, terms FROM knowledge_chunks "
        "WHERE brand_kit_id = ? OR brand_kit_id IS NULL LIMIT 2000",
        [brand_kit_id],
    )
    candidates = [c for c in chunks if c["doc_id"] in by_id]

    # A pinned doc with no summary yet needs its real text — rare, so it's
    # fetched on demand instead of joining `content` for every document above.
    needs_content = [d["id"] for d in docs if d["pinned"] and not (d["summary"] or "").strip()]
    content_by_id: Dict[str, str] = {}
    if needs_content:
        placeholders = ",".join("?" for _ in needs_content)
        rows, _ = await d1_query(
            f"SELECT id, content FROM knowledge_docs WHERE id IN ({placeholders})", needs_content
        )
        content_by_id = {r["id"]: (r["content"] or "") for r in rows}

    if len(_KB_CACHE) > 200:  # a long-lived warm instance shouldn't accumulate forever
        _KB_CACHE.clear()
    corpus = {"version": version, "docs": docs, "by_id": by_id, "candidates": candidates,
              "content_by_id": content_by_id}
    _KB_CACHE[key] = corpus
    return corpus


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
        corpus = await _load_kb_corpus(brand_kit_id)
        docs, by_id, candidates = corpus["docs"], corpus["by_id"], corpus["candidates"]
        if not docs:
            return empty
        used, parts, spent = [], [], 0

        # Tier 1 — pinned truths, always in, before anything is retrieved.
        for d in [x for x in docs if x["pinned"]]:
            text = (d["summary"] or "").strip() or corpus["content_by_id"].get(d["id"], "").strip()
            if not text:
                continue
            text = text[: max(280, budget // 4)]
            cost = len(text) + len(d["title"]) + 16
            if spent + cost > budget * 0.6:
                break
            parts.append(f"- [{d['title']} · {d['kind']}] {text}")
            used.append({"id": d["id"], "title": d["title"], "kind": d["kind"], "pinned": True})
            spent += cost

        # Tier 2 — retrieved passages, scored against this topic. Term
        # frequencies for both the chunk and its document's title/summary/tags
        # were computed once at ingest; only the topic itself is tokenized here.
        pinned_ids = {u["id"] for u in used}
        scoreable = [c for c in candidates if c["doc_id"] not in pinned_ids]
        scored_terms = [_merge_term_counts(_chunk_term_counts(c), by_id[c["doc_id"]]["_meta_terms"])
                        for c in scoreable]
        for score, i in _bm25_rank_indexed(topic, scored_terms)[:8]:
            c = scoreable[i]
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
    source_type: Optional[str] = None  # paste | url | file (pdf, docx, pptx, md, txt, csv, html, rtf…)
    source_url: Optional[str] = None
    model: Optional[str] = None


class KnowledgeSearch(BaseModel):
    brand_kit_id: Optional[str] = None
    query: str
    budget: Optional[int] = None


_DOC_KIND_LABELS = {
    "pdf": "PDF document", "pptx": "Deck", "docx": "Word document",
    "rtf": "Document", "html": "Web page", "text": "Text file",
}


def _title_from_source_url(url: str) -> str:
    """Blob URLs end in the original filename with a random suffix bolted on.
    Recover something a person would recognise in a list."""
    base = (url or "").rsplit("?", 1)[0].rsplit("/", 1)[-1]
    stem = base.rsplit(".", 1)[0] if "." in base else base
    stem = re.sub(r"[-_][A-Za-z0-9]{16,}$", "", stem)          # blob's random suffix
    stem = re.sub(r"[-_]+", " ", stem).strip()
    return stem[:1].upper() + stem[1:] if stem else ""


async def _ingest_source(req: KnowledgeDocIn) -> Dict[str, str]:
    """Pulls real text out of whatever was handed over — pasted text, a web
    page, or a file of almost any readable kind. Nothing here invents
    content; if a file yields no text, the caller rejects it."""
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
    # Everything else is a file. What it *is* gets decided by reading it, not
    # by what the caller called it — a phone that labels a .md upload
    # "application/octet-stream" still gets read as Markdown.
    data = await asyncio.to_thread(_fetch_bytes, req.source_url)
    doc = await asyncio.to_thread(_extract_document, data, req.source_url, "")
    return {"content": doc["text"],
            "title": req.title or _title_from_source_url(req.source_url) or _DOC_KIND_LABELS.get(doc["kind"], "Document"),
            "source_kind": doc["kind"], "source_url": req.source_url}


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
    meta_terms = json.dumps(_term_counts(_doc_meta_text(record["title"], kind, record["summary"], tags)))
    await d1_query(
        "INSERT INTO knowledge_docs (id, brand_kit_id, title, kind, content, summary, tags, source_kind, "
        "source_url, pinned, enabled, meta_terms, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [record["id"], record["brand_kit_id"], record["title"], record["kind"], record["content"],
         record["summary"], json.dumps(tags), record["source_kind"], record["source_url"],
         record["pinned"], 1, meta_terms, ts, ts],
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
    content_changed = req.content is not None and req.content != existing["content"]
    merged = {
        "title": (req.title or existing["title"])[:200],
        "kind": req.kind if req.kind in KNOWLEDGE_KINDS else existing["kind"],
        "content": content,
        "pinned": existing["pinned"] if req.pinned is None else req.pinned,
        "enabled": existing["enabled"] if req.enabled is None else req.enabled,
        "brand_kit_id": req.brand_kit_id if req.brand_kit_id is not None else existing["brand_kit_id"],
    }
    # A rewritten document's summary and tags described the OLD text — left
    # alone, a pinned doc (whose summary is injected into every generation
    # verbatim) would keep asserting something the edit just changed. Only
    # worth the model call when the content actually changed; a rename or a
    # pin toggle shouldn't pay for it.
    if content_changed:
        meta = await _summarise_doc(merged["title"], merged["content"], merged["kind"], req.model)
        summary = meta["summary"]
        tags = req.tags if req.tags is not None else meta["tags"]
    else:
        summary = existing["summary"]
        tags = req.tags if req.tags is not None else existing["tags"]
    merged["summary"], merged["tags"] = summary, tags
    ts = now_iso()
    meta_terms = json.dumps(_term_counts(
        _doc_meta_text(merged["title"], merged["kind"], merged["summary"], merged["tags"])
    ))
    out, _ = await d1_query(
        "UPDATE knowledge_docs SET title=?, kind=?, content=?, summary=?, tags=?, pinned=?, enabled=?, "
        "brand_kit_id=?, meta_terms=?, updated_at=? WHERE id=? RETURNING *",
        [merged["title"], merged["kind"], merged["content"], merged["summary"], json.dumps(merged["tags"]),
         1 if merged["pinned"] else 0, 1 if merged["enabled"] else 0, merged["brand_kit_id"],
         meta_terms, ts, doc_id],
    )
    # Only re-chunk when the text actually changed — re-chunking is the
    # expensive part and a pin/rename shouldn't pay for it.
    if content_changed:
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
            if row.get("kind") == "music":
                data = await asyncio.to_thread(_poyo_music_detail, row["task_id"])
            else:
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
        "notes": ("Cover slide must stop the scroll on its own — carousels get pushed by the algorithm because "
                  "they raise dwell time. Caption opens with a hook line (only ~2 lines show before \"more\"), "
                  "hashtags on their own line at the end. Low-quality or generic stock-photo visuals kill reach here."),
    },
    "tiktok": {
        "label": "TikTok", "char_limit": 2200, "hashtags": 5,
        "formats": ["reel", "carousel", "single"], "default_format": "reel",
        "aspect": {"reel": "9:16", "carousel": "9:16", "single": "9:16"},
        "slides": {"min": 3, "max": 8, "default": 5},
        "notes": ("Hook in the first 1-2 seconds, on-screen text from the first frame. Casual, spoken-word "
                  "voiceover — never a polished corporate-video feel, that's the fastest way to get scrolled past. "
                  "No slow intro, no logo card, no \"hey guys\"."),
    },
    "linkedin": {
        "label": "LinkedIn", "char_limit": 3000, "hashtags": 3,
        "formats": ["single", "carousel", "text"], "default_format": "carousel",
        "aspect": {"carousel": "1:1", "single": "1.91:1", "text": "1:1"},
        "slides": {"min": 4, "max": 10, "default": 7},
        "notes": ("Professional but human. Short paragraphs, one insight per line, a soft CTA at the end. Never "
                  "open with \"We're excited to announce\" or generic promotional language — that gets skipped. "
                  "Put any link in a comment, never the post body; the algorithm suppresses posts with links in them."),
    },
    "twitter": {
        "label": "X / Twitter", "char_limit": 280, "hashtags": 2,
        "formats": ["single", "thread", "carousel"], "default_format": "thread",
        "aspect": {"single": "16:9", "thread": "16:9", "carousel": "1:1"},
        "slides": {"min": 3, "max": 8, "default": 5},
        "notes": ("Every tweet stands alone and is under 280 characters. 0-1 hashtags — spam kills reach. The "
                  "opening line is a standalone hook, not a lead-in to what follows."),
    },
    "threads": {
        "label": "Threads", "char_limit": 500, "hashtags": 1,
        "formats": ["single", "thread", "carousel"], "default_format": "single",
        "aspect": {"single": "1:1", "thread": "1:1", "carousel": "1:1"},
        "slides": {"min": 3, "max": 8, "default": 5},
        "notes": "Conversational, first-person, and unpolished. Skip hashtags — there's no established hashtag culture here.",
    },
    "youtube": {
        "label": "YouTube", "char_limit": 5000, "hashtags": 3,
        "formats": ["reel", "single"], "default_format": "reel",
        "aspect": {"reel": "9:16", "single": "16:9"},
        "slides": {"min": 3, "max": 8, "default": 5},
        "notes": ("Title carries the click — under 60 characters, keyword up front, never redundant with the "
                  "thumbnail's own text. Description's first two lines are what shows in search, so lead with "
                  "the hook and the keyword there too."),
    },
    "facebook": {
        "label": "Facebook", "char_limit": 5000, "hashtags": 2,
        "formats": ["single", "carousel", "reel"], "default_format": "single",
        "aspect": {"single": "1.91:1", "carousel": "1:1", "reel": "9:16"},
        "slides": {"min": 3, "max": 10, "default": 5},
        "notes": "Story-driven and friendly, medium length (this audience reads more than X's), clear CTA as a question.",
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
    elif style == "photo" or visual.get("cover_image_prompt") or visual.get("image_prompt"):
        # The prompt schema's single image-generation field for a plain post
        # is cover_image_prompt (the same key the carousel branch above reads
        # for its cover) — this used to look for image_prompt instead, a key
        # the model is never asked to produce here, so a "single" + "photo"
        # build (the common case for a plain image post) silently produced
        # zero assets: nothing on the canvas, nothing to save as a template.
        assets.append({"type": "visual", "caption": "", "spec": {
            "template": "cover", "theme": theme, "index": 0, "total": 1,
            "title": visual.get("title") or plan.get("hook") or plan.get("title") or "",
            "image_prompt": visual.get("cover_image_prompt") or visual.get("image_prompt") or "",
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

    # Craft guidance for the "hook", "caption"/"cta", "slides"/"script", and
    # "cover_image_prompt" fields the JSON schema below asks for. Every
    # platform here allows at least one of carousel/thread/reel, so the slide
    # guide always applies; the short-form script guide only makes sense when
    # a video scene script is actually possible for this platform.
    craft_notes = HOOK_CRAFT_GUIDE + CAROUSEL_CRAFT_GUIDE + HUMANIZE_GUIDE + THUMBNAIL_PROMPT_GUIDE
    if "reel" in allowed:
        craft_notes += SHORTFORM_SCRIPT_GUIDE

    system = (
        f"You are a senior social creative director producing a finished, ready-to-publish "
        f"{spec['label']} post. Tone: {tone}. Platform rules: {spec['notes']} "
        f"Caption must be under {spec['char_limit']} characters and use at most {spec['hashtags']} hashtags. "
        f"{format_rule} "
        f"If the format is carousel, thread or reel, produce exactly {n} slides/scenes (a carousel's cover "
        f"is separate and does not count). "
        f"{craft_notes} "
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
    # honor it over whatever the model happened to pick. Otherwise, a real
    # saved brand kit wins by default: the model is never even offered
    # "brand" as a choice (THEME_KEYS is its generic palette options), so
    # without this every AI-built post would silently skip the user's own
    # colors/logo/fonts unless they remembered to click the brand swatch by
    # hand afterward, every single time.
    if template:
        theme = template["theme"]
    elif brand and brand.get("id"):
        theme = "brand"
    else:
        theme = ((plan.get("visual") or {}).get("theme")) or "midnight"
    if theme not in THEME_KEYS and theme != "brand":
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
        "assets, format, hashtags, alt_text, content_by_platform, brand_kit_id, music, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
@cron_router.get("/cron/publish-due")
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


app.include_router(api_router, dependencies=[Depends(require_app_token)])
app.include_router(cron_router)

# allow_credentials=True together with a wildcard origin is a combination
# browsers reject outright (and shouldn't be relied on if they didn't) —
# nothing here uses cookie-based auth, so credentialed CORS is simply off.
_cors_origins = os.environ.get('CORS_ORIGINS', '*').split(',')
app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

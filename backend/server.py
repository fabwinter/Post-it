from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import asyncio
import logging
import requests
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

POYO_API_KEY = os.environ.get('POYO_API_KEY')
POYO_BASE_URL = os.environ.get('POYO_BASE_URL', 'https://api.poyo.ai')

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


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
    return await asyncio.to_thread(_poyo_chat, messages, model, temperature, max_tokens)


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


class WriteRequest(BaseModel):
    brief: str
    platform: str = "twitter"
    tone: Optional[str] = "engaging"


class RepurposeRequest(BaseModel):
    source: str
    platforms: List[str] = Field(default_factory=lambda: ["twitter", "linkedin", "instagram", "threads"])


class GenerateRequest(BaseModel):
    kind: str  # image | video | music
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


# ---------------- AI routes ----------------
@api_router.get("/")
async def root():
    return {"message": "CreateOS API"}


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
    content = await chat([{"role": "system", "content": system}, {"role": "user", "content": user}], CHAT_MODEL, 0.95)
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
    content = await chat([{"role": "system", "content": system}, {"role": "user", "content": req.brief}], CHAT_MODEL, 0.85)
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
            CHAT_MODEL, 0.8,
        )
        results[platform] = txt.strip()
    await asyncio.gather(*[one(p) for p in req.platforms])
    return {"posts": results}


@api_router.post("/ai/generate")
async def ai_generate(req: GenerateRequest):
    opts = req.options or {}
    if req.kind == "image":
        model = opts.get("model", "gpt-image-2")
        payload = {
            "prompt": req.prompt,
            "size": opts.get("size", "1:1"),
            "quality": opts.get("quality", "medium"),
        }
    elif req.kind == "video":
        model = opts.get("model", "seedance-2-fast")
        payload = {
            "prompt": req.prompt,
            "resolution": opts.get("resolution", "720p"),
            "duration": int(opts.get("duration", 5)),
            "aspect_ratio": opts.get("aspect_ratio", "16:9"),
            "generate_audio": bool(opts.get("generate_audio", False)),
        }
    elif req.kind == "music":
        model = "generate-music"
        payload = {
            "prompt": req.prompt,
            "custom_mode": False,
            "instrumental": bool(opts.get("instrumental", False)),
            "mv": opts.get("mv", "V4_5"),
        }
    else:
        raise HTTPException(status_code=400, detail="kind must be image, video or music")

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
    await db.generations.insert_one({**record})
    return {"id": record["id"], "task_id": task_id, "status": status, "kind": req.kind}


@api_router.get("/ai/task/{task_id}")
async def ai_task(task_id: str):
    data = await asyncio.to_thread(_poyo_status, task_id)
    status = data.get("status", "running")
    files = data.get("files", []) or []
    await db.generations.update_one(
        {"task_id": task_id},
        {"$set": {"status": status, "files": files, "progress": data.get("progress", 0)}},
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
    docs = await db.generations.find({"status": "finished"}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return docs


# ---------------- Posts CRUD ----------------
@api_router.post("/posts", response_model=Post)
async def create_post(inp: PostCreate):
    post = Post(**{k: v for k, v in inp.model_dump().items() if v is not None})
    await db.posts.insert_one({**post.model_dump()})
    return post


@api_router.get("/posts", response_model=List[Post])
async def list_posts(status: Optional[str] = None):
    query = {"status": status} if status else {}
    docs = await db.posts.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@api_router.get("/posts/{post_id}", response_model=Post)
async def get_post(post_id: str):
    doc = await db.posts.find_one({"id": post_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Post not found")
    return doc


@api_router.put("/posts/{post_id}", response_model=Post)
async def update_post(post_id: str, upd: PostUpdate):
    changes = {k: v for k, v in upd.model_dump().items() if v is not None}
    changes["updated_at"] = now_iso()
    result = await db.posts.update_one({"id": post_id}, {"$set": changes})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Post not found")
    doc = await db.posts.find_one({"id": post_id}, {"_id": 0})
    return doc


@api_router.delete("/posts/{post_id}")
async def delete_post(post_id: str):
    result = await db.posts.delete_one({"id": post_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Post not found")
    return {"ok": True}


@api_router.get("/stats")
async def stats():
    total = await db.posts.count_documents({})
    drafts = await db.posts.count_documents({"status": "draft"})
    scheduled = await db.posts.count_documents({"status": "scheduled"})
    published = await db.posts.count_documents({"status": "published"})
    media = await db.generations.count_documents({"status": "finished"})
    return {"total": total, "drafts": drafts, "scheduled": scheduled, "published": published, "media": media}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

"""Production's D1 already has the OLD tables. Verify ensure_schema ALTERs them
in place rather than needing a hand-run migration."""
import json, os, pathlib, sqlite3, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
os.environ.update(CF_ACCOUNT_ID="a", CF_D1_DATABASE_ID="d", CF_API_TOKEN="t", POYO_API_KEY="k")
DB = sqlite3.connect(":memory:", check_same_thread=False); DB.row_factory = sqlite3.Row
# the schema as it exists in production today
DB.executescript("""
CREATE TABLE posts (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled post',
 content TEXT NOT NULL DEFAULT '', platforms TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL DEFAULT 'draft', scheduled_time TEXT, media_urls TEXT NOT NULL DEFAULT '[]',
 media_type TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE generations (id TEXT PRIMARY KEY, kind TEXT NOT NULL, prompt TEXT NOT NULL,
 model TEXT NOT NULL, task_id TEXT NOT NULL, status TEXT NOT NULL, files TEXT NOT NULL DEFAULT '[]',
 progress INTEGER DEFAULT 0, error_message TEXT, created_at TEXT NOT NULL);
INSERT INTO posts VALUES ('p1','Old','body','["twitter"]','draft',NULL,'[]',NULL,'2026-01-01','2026-01-01');
INSERT INTO generations VALUES ('g1','image','cat','gpt-image-2','t1','finished','[{"file_url":"u"}]',100,NULL,'2026-01-01');
""")
class Resp:
    def __init__(s, b, c=200): s._b, s.status_code, s.text = b, c, json.dumps(b)
    def json(s): return s._b
def fake_post(url, headers=None, json=None, timeout=None, **kw):
    sql, params = json["sql"], json.get("params", [])
    cur = DB.cursor()
    try: cur.execute(sql, params)
    except sqlite3.Error as e: return Resp({"success": False, "errors": [str(e)]})
    rows = [dict(r) for r in cur.fetchall()] if cur.description else []
    DB.commit(); return Resp({"success": True, "result": [{"results": rows, "meta": {}}]})
def fake_get(url, **kw): return Resp({"data": {"status": "finished", "files": []}})
import requests; requests.post, requests.get = fake_post, fake_get
import server
from fastapi.testclient import TestClient
c = TestClient(server.app)
F = []
def check(n, ok, x=""):
    print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else f" -> {x}")); ok or F.append(n)

r = c.get("/api/posts")
check("legacy post reads back", r.status_code == 200 and r.json()[0]["assets"] == [], r.text[:200])
check("legacy post defaults format", r.json()[0]["format"] == "single", r.text[:200])
cols = {x[1] for x in DB.execute("PRAGMA table_info(posts)")}
check("posts altered in place", {"assets","format","hashtags"} <= cols, cols)
check("posts gets its brand_kit_id column via the ALTER path", "brand_kit_id" in cols, cols)
cols = {x[1] for x in DB.execute("PRAGMA table_info(generations)")}
check("generations altered in place", {"output","title","meta","favorite","updated_at"} <= cols, cols)
check("brand_kits created", DB.execute("SELECT count(*) FROM sqlite_master WHERE name='brand_kits'").fetchone()[0] == 1)
cols = {x[1] for x in DB.execute("PRAGMA table_info(brand_kits)")}
check("brand_kits gets its style and color_mode columns via the ALTER path", {"style", "color_mode"} <= cols, cols)
check("connections created", DB.execute("SELECT count(*) FROM sqlite_master WHERE name='connections'").fetchone()[0] == 1)
check("visual_templates created", DB.execute("SELECT count(*) FROM sqlite_master WHERE name='visual_templates'").fetchone()[0] == 1)
check("uploads created", DB.execute("SELECT count(*) FROM sqlite_master WHERE name='uploads'").fetchone()[0] == 1)
r = c.get("/api/generations")
check("legacy generation reads back", r.json()[0]["kind"] == "image" and r.json()[0]["favorite"] is False, r.text[:200])
check("legacy generation gets a title", r.json()[0]["title"] == "cat", r.text[:200])
r = c.get("/api/connections")
check("connections endpoint works", r.status_code == 200 and len(r.json()) == 7, r.text[:120])
print("\n" + ("ALL PASS" if not F else f"{len(F)} FAILED: {F}")); sys.exit(1 if F else 0)

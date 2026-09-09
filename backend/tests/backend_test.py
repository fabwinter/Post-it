"""Backend tests for CreateOS - AI, Posts CRUD, Stats, Media."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://content-hub-1905.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ---------------- Health ----------------
def test_root(s):
    r = s.get(f"{API}/")
    assert r.status_code == 200
    assert "message" in r.json()


# ---------------- AI ----------------
def test_ai_ideate(s):
    r = s.post(f"{API}/ai/ideate", json={"topic": "AI productivity for solopreneurs", "count": 5}, timeout=120)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "ideas" in data
    assert isinstance(data["ideas"], list)
    assert len(data["ideas"]) >= 1
    assert all(isinstance(x, str) and len(x) > 0 for x in data["ideas"])


def test_ai_write(s):
    r = s.post(f"{API}/ai/write", json={"brief": "Announce a new AI writing tool called CreateOS", "platform": "twitter", "tone": "engaging"}, timeout=120)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "content" in data and isinstance(data["content"], str) and len(data["content"]) > 0


def test_ai_repurpose(s):
    src = "We just launched CreateOS: one platform to ideate, write, design, schedule, and repurpose content."
    r = s.post(f"{API}/ai/repurpose", json={"source": src, "platforms": ["twitter", "linkedin"]}, timeout=180)
    assert r.status_code == 200, r.text
    posts = r.json().get("posts", {})
    assert "twitter" in posts and "linkedin" in posts
    assert len(posts["twitter"]) > 0 and len(posts["linkedin"]) > 0


def test_ai_generate_image_and_poll(s):
    r = s.post(f"{API}/ai/generate", json={"kind": "image", "prompt": "a minimalist purple gradient logo mark", "options": {"size": "1:1", "quality": "low"}}, timeout=90)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "task_id" in data and data["task_id"]
    task_id = data["task_id"]
    # Poll up to ~60s
    final_status = None
    for _ in range(20):
        time.sleep(3)
        p = s.get(f"{API}/ai/task/{task_id}", timeout=60)
        assert p.status_code == 200, p.text
        pdata = p.json()
        final_status = pdata.get("status")
        if final_status in ("finished", "failed", "error"):
            if final_status == "finished":
                assert isinstance(pdata.get("files"), list)
            break
    print(f"Image final status: {final_status}")
    assert final_status is not None


def test_ai_generate_video_submit(s):
    r = s.post(f"{API}/ai/generate", json={"kind": "video", "prompt": "a calm ocean at sunset", "options": {"duration": 5}}, timeout=90)
    assert r.status_code == 200, r.text
    assert r.json().get("task_id")


def test_ai_generate_music_submit(s):
    r = s.post(f"{API}/ai/generate", json={"kind": "music", "prompt": "uplifting lofi beat"}, timeout=90)
    assert r.status_code == 200, r.text
    assert r.json().get("task_id")


# ---------------- Posts CRUD ----------------
@pytest.fixture(scope="module")
def created_post_id():
    sess = requests.Session()
    r = sess.post(f"{API}/posts", json={"title": "TEST_post", "content": "Hello world", "platforms": ["twitter", "linkedin"], "status": "draft"})
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    yield pid
    sess.delete(f"{API}/posts/{pid}")


def test_post_create_and_get(s, created_post_id):
    r = s.get(f"{API}/posts/{created_post_id}")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == created_post_id
    assert data["content"] == "Hello world"
    assert "twitter" in data["platforms"]


def test_posts_list(s, created_post_id):
    r = s.get(f"{API}/posts")
    assert r.status_code == 200
    ids = [p["id"] for p in r.json()]
    assert created_post_id in ids


def test_posts_update_to_scheduled(s, created_post_id):
    sched = "2026-06-01T12:00:00+00:00"
    r = s.put(f"{API}/posts/{created_post_id}", json={"status": "scheduled", "scheduled_time": sched})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "scheduled"
    assert data["scheduled_time"] == sched
    # verify with GET
    g = s.get(f"{API}/posts/{created_post_id}")
    assert g.json()["status"] == "scheduled"


def test_posts_filter_scheduled(s, created_post_id):
    r = s.get(f"{API}/posts", params={"status": "scheduled"})
    assert r.status_code == 200
    assert created_post_id in [p["id"] for p in r.json()]


def test_post_404(s):
    r = s.get(f"{API}/posts/nonexistent-id-xyz")
    assert r.status_code == 404
    r2 = s.put(f"{API}/posts/nonexistent-id-xyz", json={"status": "draft"})
    assert r2.status_code == 404
    r3 = s.delete(f"{API}/posts/nonexistent-id-xyz")
    assert r3.status_code == 404


def test_post_delete_and_verify(s):
    r = s.post(f"{API}/posts", json={"title": "TEST_del", "content": "bye"})
    pid = r.json()["id"]
    d = s.delete(f"{API}/posts/{pid}")
    assert d.status_code == 200
    g = s.get(f"{API}/posts/{pid}")
    assert g.status_code == 404


# ---------------- Stats / Media ----------------
def test_stats(s):
    r = s.get(f"{API}/stats")
    assert r.status_code == 200
    data = r.json()
    for k in ["total", "drafts", "scheduled", "published", "media"]:
        assert k in data
        assert isinstance(data[k], int)


def test_media_list(s):
    r = s.get(f"{API}/media")
    assert r.status_code == 200
    assert isinstance(r.json(), list)

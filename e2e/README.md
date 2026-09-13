# End-to-end harness

A real FastAPI backend and a real built frontend, with Cloudflare D1 and PoYo
faked in `serve.py` — no network access or API keys needed to run it.

## Setup (once)

```bash
cd e2e
npm install                 # pulls in playwright
npx playwright install chromium   # skip this if your machine already has a
                                   # Chromium Playwright can drive
```

## Running it

```bash
cd frontend && npm run build   # only needed after a frontend change
cd ../e2e && bash run.sh e2e.js
```

`run.sh` builds the frontend if `frontend/build` doesn't exist yet, boots
`serve.py` on `localhost:8123`, waits for it to answer, runs the given script
with Node, and tears the server down on exit. It does **not** rebuild the
frontend on every run — after changing frontend code, rebuild it yourself
first, or delete `frontend/build` to force `run.sh` to do it.

## What's faked, and why this is worth trusting

`serve.py` imports `backend/server.py` directly and monkey-patches
`requests.get`/`requests.post` process-wide, so every outgoing call the
backend makes — the D1 HTTP API, PoYo's chat/image/video endpoints, Pexels
stock search, a server-side `uploads/from-url` fetch — lands in one fake
dispatcher instead of the network. D1 is backed by a real in-memory-backed
sqlite3 connection, so the actual SQL the backend sends is genuinely
executed and validated, not stubbed. The frontend is the real production
build, served as static files, driving the real backend through the real
`/api` routes — this is the whole app, minus the two things (a paid LLM and
a live database) that would make it slow, flaky, or costly to test against
on every change.

## `e2e.js`

One growing regression suite, not a one-off script. When you fix a bug here,
add the check that would have caught it and leave it running — that's what
makes this worth keeping. Each check is one `ok(name, condition, debugInfo)`
call; a `FAIL` line names the check, a `PASS` line moves on. The very last
check greps the browser's own console for real errors (filtering out the
sandboxed run's expected off-origin font/analytics failures).

## Fixtures

`fixtures/` holds small real files (a real PNG, a tiny real MP4/MP3, a real
PDF/PPTX/SVG) used to exercise upload and stock-media flows — deliberately
not synthetic placeholders, since a few of these tests need actual decodable
media (a `<video>` that really plays, an image whose pixels can be sampled)
to tell "rendered" apart from "silently didn't."

## Writing a new check

- Prefer a `data-testid` already in the component over text/CSS selectors —
  copy stays free to change without breaking the suite.
- Use the `tap()` helper instead of `.click()` directly — it scrolls the
  target to center, hit-tests that a real tap would actually land on it (not
  on a toast or sticky header covering it), then clicks. A raw `.click({force:true})`
  skips that and can pass against an element a user could never actually reach.
- `page.goto(B + '/same/path/already/current')` is a no-op in Chromium when
  the URL doesn't change — the SPA never remounts, and React state from the
  previous test (an open template edit, undo history) leaks forward. Bounce
  through an unrelated route first when you need a real reset.

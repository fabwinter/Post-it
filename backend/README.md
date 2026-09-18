# Backend layout

- `server.py`: compatibility module that still owns route handlers and domain behavior while importing shared modules from `backend/app/`.
- `app/config.py`: environment loading and settings.
- `app/persistence/d1.py`: Cloudflare D1 query client wrapper.
- `app/routing.py`: API/cron router registration and CORS middleware wiring.
- `app/services/projects.py`: post row/JSON mapping helpers.
- `app/services/generations.py`: generation row mapping helpers.
- `app/services/templates.py`: visual-template row mapping helpers.
- `app/utils/time.py`: shared UTC ISO timestamp helper.
- `app/utils/json_utils.py`: shared JSON parsing helper for D1-backed fields.

# Local tests

From repository root:

`pytest backend/tests/test_migration.py backend/tests/test_api.py`

# Deployment entry point

Vercel entrypoint stays `api/index.py`, which exposes `app` from `backend/server.py`.

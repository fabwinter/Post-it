# CreateOS — PRD

## Original Problem Statement
Build a better version of Blotato.com. One platform that ideates, writes, designs, repurposes, schedules, and publishes everywhere. Take the capabilities and bones of Blotato.com but improve UI and polish. Use poyo.ai API for chat, image, video, and music generation. Use apify or other sites for scheduling and automatic posting.

## User Choices (v1)
- Scope: content creation (ideate/write/design/repurpose) + calendar/scheduling UI first.
- PoYo.ai API key provided (configured in backend/.env).
- Scheduling/calendar UI only — no real network publishing yet.
- No authentication.
- Design decided by builder → dark "Editorial Future / Swiss Brutalist" theme, lime accent (#E2FF3D), Cabinet Grotesk + Satoshi + JetBrains Mono.

## Architecture
- Frontend: React SPA (CreateOS), react-router, framer-motion, shadcn/ui, Tailwind. Dark theme.
- Backend: FastAPI, all routes /api. MongoDB for posts + generation records.
- PoYo.ai: chat = /v1/chat/completions (gemini-3-flash-preview); media = /api/generate/submit + poll /api/generate/status/{task_id} (image gpt-image-2, video seedance-2-fast, music generate-music).

## Implemented (2026-06)
- AI Ideation (topic → idea list), AI Writing (platform + tone), AI Repurpose (source → per-platform posts).
- Content Studio: Write / Image / Video / Music generation with async polling + preview.
- Composer: editor + AI write, multi-platform live previews, attach media, save draft / schedule / mark published.
- Content Calendar: month grid, scheduled posts on days, navigate months, click to edit.
- Media Library: grid of finished generations, reuse in composer.
- Dashboard: idea engine, stats, recent drafts, next scheduled.
- Posts CRUD, /api/stats, /api/media.
- Verified: 15/15 backend + 15/15 frontend tests passed.

## Personas
- Solo founders / creators / small agencies who want one tool to create + schedule everywhere.

## Backlog (P1/P2)
- P1: Real social publishing via OAuth/Apify connectors (X, LinkedIn, IG, etc.).
- P1: Drag-and-drop reschedule on calendar; week view.
- P1: Model picker in Studio (choose specific PoYo models/quality/resolution).
- P2: Analytics dashboard (views/likes/comments) once publishing is live.
- P2: Auth + multi-workspace/accounts.
- P2: Persist Studio generations directly to per-post attachments; brand voice presets.

## Next Tasks
- Add OAuth/Apify posting connectors when keys available.
- Calendar drag-to-reschedule.
- Studio advanced model/quality options.

## Updates (2026-09-17)
- Fixed: "single" format post no longer becomes a carousel (backend _plan_to_assets gates decks to carousel/thread; explicit format now always honored over the model's choice).
- Fixed: PNG/ZIP export "Export failed" on the create screen. Root cause was html-to-image reading cssRules of cross-origin webfont stylesheets (Fontshare, Google) loaded without CORS mode -> SecurityError. Fonts now load via <link crossorigin> (index.html) + crossOrigin on dynamic font links (fonts.js); export also proxies cross-origin images and has a skipFonts fallback.
- Added: delete a generated media item in Library (single trash button) + batch multi-select delete (Select mode -> Delete N, via /api/generations/bulk-delete).
- Added: "Save as project" button in the Composer header (saves current work as a draft/project).
- Config: app persistence is Cloudflare D1 (CF_ACCOUNT_ID/CF_D1_DATABASE_ID/CF_API_TOKEN) + Vercel Blob; these must be set in backend/.env for data endpoints to work.

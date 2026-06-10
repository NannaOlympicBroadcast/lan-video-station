# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LAN Video Station (局域网全栈视频站) — a self-hosted video platform for LAN deployment: VOD (upload/review/playback/comments/subtitles), live streaming with co-streaming (连麦), open API/Webhooks, and a LAN CDN. UI text and code comments are in Chinese.

## Commands

```bash
# Full stack (the intended way to run everything; requires LAN_IP in .env)
cp .env.example .env
docker compose up -d --build

# Backend dev (needs postgres/redis/minio running, see backend/src/config.js for env defaults)
cd backend && npm install && npm run dev   # node --watch src/index.js

# Frontend dev
cd frontend && npm install && npm run dev  # vite
cd frontend && npm run build
```

There are no tests and no linter configured. Database migrations run automatically at backend startup (`src/db/migrate.js` executes `schema.sql`, which must stay idempotent — use `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).

## Architecture

Docker Compose services: `postgres`, `redis`, `minio` (object storage: videos/thumbnails/subtitles/recordings buckets), `srs` (SRS 5.0 media server: RTMP/WebRTC/HLS/FLV), `api` (Express backend), `web` (Vue 3 SPA + nginx gateway reverse-proxying `/api`, `/ws`, `/live`, `/rtc`, `/storage`), and horizontally scalable `cdn-edge` nginx cache nodes that self-register with the API.

### Backend (`backend/`, Express, CommonJS)

- `src/index.js` mounts all routes under `/api/*`; routers live in `src/routes/`. Nested routers (comments, subtitles) use `express.Router({ mergeParams: true })` and are mounted at `/api/videos/:videoId/...`.
- Auth (`src/middleware/auth.js`): dual-channel — JWT (`Authorization: Bearer`) or API key (`X-API-Key` / bearer token starting with `lvs_`). Use `requireAuth`, `optionalAuth` (sets `req.user` or null), `requireAdmin`. Bans are enforced in `requireAuth`.
- Video access control: `canSee(video, user)` in `src/routes/videos.js` (exported and reused by comments/subtitles routes) — owner/admin always; otherwise must be `public` + `approved`. Private videos skip review; public videos are `pending` when the `review_required` site setting is on.
- Events (`src/lib/events.js`): every notable action emits events that fan out to WebSocket clients (`src/ws/gateway.js`, Redis pub/sub based) and user/room webhooks, and are archived in the `events` table. Use `emitToUser`, `emitToAdmins`, `emitRoomEvent`.
- Media: uploads go through multer temp files → ffmpeg probe/thumbnail (`src/lib/ffmpeg.js`) → MinIO (`src/lib/minio.js`, `objectUrl()` builds public URLs, optionally via a CDN edge). SRS callbacks hit `src/routes/callbacks.js`; recording pulls RTMP via ffmpeg (`src/lib/recorder.js`).
- CDN: `pickEdge()` in `src/routes/cdn.js` round-robins enabled edge nodes; play endpoints accept `?cdn=off` to force origin.
- Config is centralized in `src/config.js` (env vars with LAN-friendly defaults).

### Frontend (`frontend/`, Vue 3 + Vite + Pinia)

- `src/api.js`: single `api()` fetch wrapper (auto-JWT, JSON errors, logs out on 401). Uploads needing progress use raw XHR instead (see `Upload.vue`).
- `src/store.js`: one Pinia auth store persisted to localStorage. `src/router.js` guards via `meta.auth` / `meta.admin`.
- Views in `src/views/`; live playback uses mpegts.js (FLV) / hls.js, web push streaming uses WHIP (`src/whip.js`), `src/media.js` rewrites media URLs for HTTPS mixed-content handling, `src/ws.js` is the WebSocket event client.

### LAN-scenario security trade-offs (intentional, documented in README)

Object URLs are unguessable random keys but not per-request signed; HLS segments are not per-request authenticated; live room passwords are stored in plaintext. Match this style when adding similar features rather than introducing heavyweight auth.

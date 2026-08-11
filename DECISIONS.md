# VIT Live — Decision Log

Everything that has been built and, more importantly, **why it was built that way**.
Read this top-to-bottom to get up to speed on the whole project. Companion docs:
`README.md` (how to run), `docs/API_CONTRACT.md` (exact API shapes), `docs/` (original specs).

---

## 1. System architecture

| Decision | What we did | Why |
|---|---|---|
| **Monorepo, three apps** | `backend/` (Go Fiber), `student-app/` (React PWA, port 5173), `admin-dashboard/` (React, port 5174) | Students and admins have completely different UX needs; one shared API contract (`docs/API_CONTRACT.md`) keeps all three in lockstep |
| **Go + Fiber for the API** | Single binary, embedded SQL migrations, seeds on boot | Zero-dependency deploys; `go run ./cmd/server` is the whole backend setup |
| **Postgres = source of truth** | Every domain fact lives in Postgres (Docker volume `pgdata`) | Real-time layers can fail or be flushed without losing anything |
| **Redis = plumbing only** | Pub/sub fan-out, delivery counter sets, refresh tokens, rate limits | Everything in Redis is rebuildable; flushing it never loses domain data |
| **WebSocket is an accelerator, not a source of truth** | Live pushes over WS; on reconnect clients call `GET /announcements?since=<last_seen>` | Clients that were offline reconcile over REST, so a dropped socket never loses data (App Flow §8) |
| **Stateless WS instances** | Every publish goes through Redis `broadcast:<topic>` channels; each instance's hub only serves its local sockets | N backend instances behind a load balancer deliver correctly with no sticky sessions (TRD §2) |
| **Topic model** | `college:global`, `emergency:global`, `dept:<id>`, `year:<n>`, `club:<id>`, `user:<id>`, `admin:delivery` | One primitive (topics) covers broadcast, targeting, personal pings, and admin live counters |
| **App assembly in `internal/server`** | `server.New(cfg, pool, rdb)` builds the entire app; `main.go` is ~60 lines | Integration tests boot the *real* app in-process — routes, middleware, and handlers are tested exactly as deployed |

## 2. Data model & where things are stored

- **Postgres tables**: `users`, `departments`, `otp_verifications`, `device_tokens`, `clubs`,
  `club_members`, `announcements`, `announcement_reactions`, `emergency_alerts`,
  `lost_found_items`, `lostfound_reports`, `events`, `event_rsvps`, `polls`, `poll_options`,
  `poll_votes`, `poll_voted_users`, `academic_events`, `mess_menus`, `audit_logs`.
- **Migrations** are plain SQL files embedded in the binary (`internal/db/migrations/`),
  applied in filename order on boot, tracked in `schema_migrations`. No external tool needed.
- **Redis keys**: `broadcast:<topic>` (pub/sub), `delivered:<kind>:<id>` (sets driven by client
  `ack` frames), `target:<kind>:<id>` (delivery denominators, 7-day TTL), refresh tokens (hashed),
  `stats:online` gauge.
- **Uploads**: local `backend/uploads/` by default; any S3-compatible bucket when `S3_*` env
  vars are set (see §7).
- **Browser localStorage**: JWTs, feed `last_seen` cursor, acknowledged emergency alert ids,
  notification preferences.

## 3. Security decisions

| Decision | Why |
|---|---|
| **Poll anonymity by construction**: votes are keyed by `HMAC(poll_id + user_id, VOTE_HMAC_SECRET)`; `poll_voted_users` records only *that* you voted, `poll_votes` only *what* was chosen | Even a DB admin cannot join a vote back to a person; an integration test asserts the stored token is an opaque HMAC digest, not a user id |
| bcrypt passwords, 15-min JWT access tokens, rotating single-use refresh tokens (hashed, in Redis) | Standard defense in depth; stolen refresh tokens die on first reuse |
| OTP email verification (10-min expiry, 5 attempts), server-side signup domain allowlist | Only real college addresses get accounts; in dev the OTP is returned in the response so no SMTP is needed |
| Per-IP rate limiting on `/auth/*` (30/min) | Brute-force protection at the cheapest layer |
| RBAC middleware on every admin route (`student / club_admin / dept_admin / moderator / super_admin`) | Emergency alerts and user-role changes are super-admin only; moderation routes include `moderator` |
| Every admin action writes to `audit_logs` | Accountability for announcements, emergencies, role changes, removals |
| Upload validation: 5 MB cap, extension allowlist, **magic-byte sniffing** | Filenames lie; the first 512 bytes don't |
| Red is reserved exclusively for emergencies, and the full-screen takeover can only be dismissed by acknowledging | Alarm fatigue is a real failure mode; scarcity keeps red meaningful |

## 4. UI / design decisions

- **Minimal black theme (Aug 11, 2026)** across both apps: pure-black body, `#0d0d0d–#1a1a1a`
  surfaces, hairline `white/10` borders instead of shadows, **white as the accent color**
  (primary buttons are white with black text). Green/amber appear only as quiet tints.
- **Implementation trick**: both apps route all color through Tailwind v4 `@theme` tokens, so the
  entire retheme was mostly a token flip in each `index.css` + cleanup of hardcoded classes.
- **Framer Motion everywhere, one voice**: `student-app/src/components/motion.tsx` defines a
  single spring + stagger vocabulary reused by every list/page. Page transitions via
  `AnimatePresence` (keyed by tab, so sub-routes don't double-animate), `layoutId` sliding
  indicators on the bottom tab bar / admin sidebar / sub-tabs, spring-animated poll result bars
  (replacing a hand-rolled rAF animation), animated toasts, pulsing "Live" dot.
- **Mobile-first student app** (max-width 480px shell, bottom tabs, 44px+ touch targets);
  desktop sidebar layout for admins.
- **Admin analytics charts are monochrome by design**: single-series bars (white on near-black)
  need no categorical palette; values are direct-labeled in text tokens.

## 5. Feature drop 2 (Aug 11, 2026) — what and why

| Feature | Design notes |
|---|---|
| **Reactions (👍)** | Toggle endpoint + `announcement_reactions` table; live tally via `announcement.reaction` WS event on the announcement's audience topic; optimistic UI with server reconcile |
| **Scheduled publishing** | `publish_at` + `broadcast_at` columns; a 30s ticker publishes due posts. `created_at` is bumped to the go-live moment so feed ordering and `since`/`before` reconciliation stay correct. Students never see unpublished posts (`broadcast_at IS NULL` filter — test-covered) |
| **Announcement images** | `POST /admin/announcements` accepts JSON *or* multipart with `image`; same validated upload path as Lost & Found |
| **Deep links** | `/events/:id`, `/polls/:id`, `/clubs/:id` pages + `GET /events/:id`; toasts and push notifications land on the exact item |
| **Club pages** | `GET /clubs/:id` returns club + its announcements (audience `club:<id>`) + upcoming events in one call |
| **Academic calendar** | Own table (`academic_events`), not shoehorned into `events` — no RSVPs/banners/venues; kinds: exam/holiday/deadline/other. Students see it as a third tab under Events |
| **Mess menu** | `mess_menus` upserted per (date, meal); students get a collapsible card at the top of the feed. Deliberately boring tech, high daily value |
| **Lost & Found matching** | On create, Postgres full-text (`to_tsvector('simple')` + GIN index) matches open posts of the *opposite* type; matched posters get a `lostfound.match` ping on their `user:<id>` topic. OR-of-words query (not AND) so partial matches fire |
| **Moderation queue** | `lostfound_reports` (one per user per item, reason upsertable); `?reported=true` filter + report-count badges in the admin list; soft-delete stays audit-logged |
| **Analytics** | `GET /admin/analytics`: signups by day (14d), announcement reach (Redis delivered/target with verified-count fallback when the 7-day target key expired), poll participation, event popularity |
| **Targeted announcements** | Already existed server-side (audience → topic + feed filtering); verified end-to-end and kept |

## 6. PWA & push decisions

- **Service worker** (`student-app/public/sw.js`): network-first navigations with offline shell
  fallback, cache-first for content-hashed assets, **never caches** `/api`, `/ws`, `/uploads`
  (the app reconciles over REST itself — caching API responses would fight that design).
- **Push is env-gated at both ends**, mirroring each other: backend sends real FCM pushes only
  when `FCM_SERVICE_ACCOUNT_JSON` is set (otherwise logs); the student app registers a device
  token only when `VITE_FIREBASE_*` + `VITE_FCM_VAPID_KEY` are present at build time.
  Firebase SDK is dynamically imported so it's code-split and costs nothing when unconfigured.
- Backend FCM client implements the **HTTP v1 API with manual service-account OAuth** (no heavy
  SDK dependency) and deletes stale tokens on 404/410.
- SW registration is skipped in dev (`import.meta.env.DEV`) to keep HMR sane.

## 7. Storage abstraction

- `internal/storage.Store` interface: `Save(ctx, name, contentType, reader, size) → public URL`.
- **Local disk** default (serves `/uploads` statically) — zero config for dev.
- **S3-compatible driver with hand-rolled SigV4** (unsigned streaming payload) — works with AWS,
  Cloudflare R2, MinIO — chosen over the AWS SDK to avoid a huge dependency for one PUT request.
- Activated purely by env (`S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`,
  `S3_SECRET_KEY`, `S3_PUBLIC_URL`); local `uploads/` doesn't survive redeploys, S3 does.

## 8. Testing & CI

- **Integration over unit**: tests boot the real app via `server.New` against a disposable
  `vitlive_test` database (dropped/recreated per run) and Redis DB 15, then drive it with
  in-process HTTP requests (`app.Test`). What's covered:
  - full signup → OTP → login flow (dev OTP path),
  - wrong-password rejection,
  - RBAC: students 403 on admin routes, unauthenticated 401, admin 200,
  - polls: double vote → 409, **anonymity** (voter token is 64-hex HMAC ≠ user id,
    `poll_voted_users` has the marker),
  - scheduled announcements never leak into student feeds,
  - reaction toggle on/off.
- Tests **skip** (not fail) when Postgres/Redis aren't running locally.
- **CI** (`.github/workflows/ci.yml`): backend job with Postgres+Redis service containers
  (vet, test, build) + one job per frontend (npm ci, lint, typecheck+build).

## 9. Operational decisions

- `docker compose up -d postgres redis` is the only infra needed for dev; the optional `full`
  profile runs the API in Docker too.
- Migrations + seeds run automatically on boot — there is no separate "setup" step.
- Background workers (event reminders, scheduled-announcement publisher, Redis bridge) start
  from `Server.StartWorkers(ctx)` and stop on SIGTERM via context cancellation.
- Request logger only runs in development.
- Dev niceties: OTPs returned in signup responses and logged; seeded super admin
  `admin@vit.ac.in` / `admin12345`; both Vite dev servers proxy `/api`, `/ws`, `/uploads` to :8080.

## 10. Known gaps / deliberate deferrals

- **Push needs credentials**: fully wired, but silent until Firebase env vars are provided.
- **S3 likewise** — local disk until `S3_*` is set.
- **`GET /lostfound/:id` doesn't exist**; the detail page falls back to fetching the list and
  finding the item (fine at campus scale, worth adding if the list grows).
- **Analytics reach denominators** fall back to the current verified-user count once the
  7-day Redis `target:` key expires — directionally right, not historically exact.
- **Reaction counts on the feed don't live-update for *removed* reactions** of other users
  between reloads unless a `announcement.reaction` frame arrives (they do — this is fine; noted
  for completeness).
- **No E2E browser tests** — backend integration tests + typed frontends carry the weight.
- The repo is **not yet a git repository** — `git init` + first commit is the natural next step
  (CI activates once pushed to GitHub).

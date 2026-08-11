# VIT Live — Real-Time Campus Engagement Platform

One app, one identity (college email), one real-time pipe: live announcements, emergency
alerts, lost & found, events with RSVPs, and anonymous polls — delivered over WebSocket
(foreground) + FCM push (background), per the specs in `docs/`.

> **New here?** Read [`DECISIONS.md`](DECISIONS.md) — the decision log covering everything
> built in this project and why it was built that way.

## Repo layout

| Path | What | Stack |
|---|---|---|
| `backend/` | REST API + WebSocket hub + Redis pub/sub bridge | Go + Fiber v2, PostgreSQL, Redis |
| `admin-dashboard/` | Admin web dashboard (port 5174) | React + Vite + Tailwind v4 |
| `student-app/` | Mobile-first student app / PWA (port 5173) | React + Vite + Tailwind v4 |
| `docs/` | PRD, TRD, app flows, UI/UX spec, **API_CONTRACT.md** | — |

## Quick start (dev)

Prereqs: Go 1.24+, Node 20+, Docker.

```bash
# 1. Infra: Postgres + Redis
docker compose up -d postgres redis

# 2. Backend (applies migrations + seeds on boot) — http://localhost:8080
cd backend && go run ./cmd/server

# 3. Student app — http://localhost:5173
cd student-app && npm install && npm run dev

# 4. Admin dashboard — http://localhost:5174
cd admin-dashboard && npm install && npm run dev
```

Both frontends proxy `/api`, `/ws`, and `/uploads` to `localhost:8080`.

### Dev credentials

- **Super admin** (seeded): `admin@vit.ac.in` / `admin12345` → log into the dashboard.
- **Students**: sign up in the student app with any `@vitstudent.ac.in` / `@vit.ac.in`
  email. In dev (`APP_ENV=development`, no SMTP configured) the OTP is returned in the
  signup response and shown as a hint on the OTP screen, and also logged by the backend.

### Try the real-time pipeline

1. Open the student app, sign up, and land on the Feed.
2. In the dashboard, publish an announcement → it appears in the feed within ~a second,
   and the dashboard's delivered counter ticks up as clients ack.
3. In the dashboard's red **Emergency** section, type a message + `CONFIRM` → every
   student gets the full-screen red takeover; acknowledgments drive the live
   "Delivered: X / Y" bar.
4. Create a poll → students vote (anonymously — votes are stored against a one-way
   HMAC token, never a user id) → result bars update live everywhere.

## Configuration

All backend config is env-based — see `backend/.env.example`. Notables:

- `ALLOWED_EMAIL_DOMAINS` — server-side signup domain allowlist.
- `SMTP_*` — set to send real OTP email (otherwise logged to console in dev).
- `FCM_SERVICE_ACCOUNT_JSON` — path to a Firebase service-account file to enable real
  background push (otherwise pushes are logged and skipped; WS delivery still works).
- `JWT_SECRET`, `VOTE_HMAC_SECRET` — change in production.

## How data flows & where it's stored

### Write path (e.g. an admin publishes an announcement)

```
Admin dashboard ──POST /api/v1/admin/announcements──▶ Go backend (Fiber)
                                                        │ 1. validate + RBAC check
                                                        │ 2. INSERT into Postgres  ◀── durable source of truth
                                                        │ 3. audit_logs entry
                                                        │ 4. PUBLISH broadcast:college:global (Redis pub/sub)
                                                        ▼
                              every backend instance's Redis bridge receives it
                                                        │
                                        WS hub fans out to subscribed sockets
                                                        ▼
                    student app prepends card live; sends back an `ack` frame
                                                        │
                    backend adds user to Redis set delivered:announcement:<id>
                                                        ▼
                    dashboard's "delivered X / Y" counter updates via admin:delivery topic
```

Reads are plain REST + JWT (`GET /announcements`, `/events`, `/polls`, …). WebSocket is
only an accelerator — on reconnect the app re-syncs missed items over REST, so nothing
is lost if the socket drops.

### Storage map

| Store | What lives there | Lifetime |
|---|---|---|
| **PostgreSQL** (`vitlive` DB, Docker volume `pgdata`) | All domain data: `users`, `departments`, `otp_verifications`, `device_tokens`, `clubs`, `club_members`, `announcements`, `emergency_alerts`, `lost_found_items`, `events`, `event_rsvps`, `polls`, `poll_options`, `poll_votes`, `poll_voted_users`, `audit_logs` | Durable — survives restarts; migrations in `backend/internal/db/migrations/` are embedded in the binary and applied on boot (tracked in `schema_migrations`) |
| **Redis** | `broadcast:<topic>` pub/sub channels (fan-out between instances), `delivered:<kind>:<id>` sets (live delivery counters), hashed rotating refresh tokens, auth rate-limit counters | Ephemeral / TTL — safe to flush; clients reconcile over REST |
| **`backend/uploads/`** | Lost & Found images (served at `/uploads/...`) | Durable on the API host's disk |
| **Browser (localStorage)** | JWT access/refresh tokens, `vit_last_seen` feed cursor, acknowledged-alert ids, notification preferences | Per-device |

Postgres is always the source of truth; Redis never holds anything that can't be rebuilt.

## Architecture notes

- **Stateless WS instances**: each backend instance's hub only knows its local clients.
  All fan-out goes through Redis pub/sub (`broadcast:<topic>`), so N instances behind a
  load balancer deliver correctly without sticky sessions (TRD §2).
- **Topics**: `college:global`, `emergency:global`, `dept:<id>`, `year:<n>`, `club:<id>`,
  `user:<id>`, plus `admin:delivery` for live delivery counters.
- **Poll anonymity** (TRD §6): `poll_voted_users` proves *that* you voted;
  `poll_votes` stores *what* was voted keyed only by `HMAC(poll_id+user_id, secret)`.
- **Reconciliation**: WS is for speed; on reconnect clients call
  `GET /announcements?since=<last_seen>` — REST is the source of truth (App Flow §8).
- Auth: bcrypt passwords, 15-min JWT access tokens, rotating single-use refresh tokens
  (hashed, in Redis), OTP with 10-min expiry and 5-attempt cap, per-IP rate limiting on
  `/auth/*`, RBAC middleware on all admin routes, full audit log of admin actions.

## Production

`backend/Dockerfile` builds a static binary image; `docker compose --profile full up`
runs the API in Docker too. Deploy per TRD §10 (Railway/Render/Fly/VPS + managed
Postgres/Redis, Nginx TLS in front; serve the two frontends' `npm run build` output from
any static host pointed at the API).

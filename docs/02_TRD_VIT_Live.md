# Technical Requirements Document (TRD)
## VIT Live — Real-Time Campus Engagement Platform

---

## 1. Tech Stack Summary

| Layer | Choice | Why |
|---|---|---|
| Backend API + WS | **Go + Fiber** (Express-style, fast, built-in `fiber/websocket`) | High concurrency, low memory footprint, great for real-time — Go's goroutines are ideal for thousands of open WS connections |
| Pub/Sub | **Redis Pub/Sub** (or Redis Streams if you want replay) | Fan-out messages across multiple backend instances instantly |
| Primary DB | **PostgreSQL** | Relational integrity for users/roles/events/polls; strong JSON support for flexible fields |
| Cache / Session | **Redis** (same instance, different DB index, or separate) | OTP storage, rate limiting, session/token blacklist |
| Push Notifications | **Firebase Cloud Messaging (FCM)** | Free, cross-platform (Android/iOS/Web) background push |
| Object Storage | **Cloudinary** or **AWS S3 / Backblaze B2** | Lost & found photos, event banners |
| Email (OTP) | **SendGrid / AWS SES / Resend** | Transactional email for OTP + notifications |
| Mobile App | **Flutter** (single codebase, Android+iOS) or React Native | Cross-platform, good WS/FCM support |
| Admin Dashboard | **React + Vite + TailwindCSS** | Fast to build, good real-time UI libraries |
| Reverse Proxy / LB | **Nginx** (or Caddy) | TLS termination, load balancing across Fiber instances |
| Containerization | **Docker + Docker Compose** (dev), optionally **Kubernetes** later | Reproducible deploys |
| Hosting (budget-friendly) | Railway / Render / Fly.io / a single VPS (DigitalOcean/Hetzner) | Cheap to start, scale later |

> **Note on "Fiber 5":** Go Fiber's stable line is currently v2.x (v3 is in beta). There's no v5 release — use the latest stable **Fiber v2** (or v3 once stable) rather than targeting a specific "v5".

---

## 2. High-Level System Architecture

```
                         ┌─────────────────────┐
                         │   Admin Dashboard    │
                         │   (React, HTTPS)     │
                         └──────────┬───────────┘
                                    │ REST (JWT)
                                    ▼
┌──────────────┐      ┌─────────────────────────┐      ┌──────────────┐
│  Mobile App   │◄────►│      Nginx (LB/TLS)     │◄────►│   FCM (push) │
│ (Flutter, WS  │      └────────────┬────────────┘      └──────────────┘
│  + REST)      │                   │
└──────────────┘         ┌──────────┴───────────┐
                          ▼                      ▼
                 ┌────────────────┐    ┌────────────────┐
                 │ Fiber Instance 1│    │ Fiber Instance 2│  ...N instances
                 │ (REST + WS Hub) │    │ (REST + WS Hub) │
                 └────────┬────────┘    └────────┬────────┘
                          │                       │
                          └──────────┬────────────┘
                                     ▼
                        ┌─────────────────────────┐
                        │   Redis (Pub/Sub +       │
                        │   Cache + Rate Limit)    │
                        └─────────────────────────┘
                                     │
                                     ▼
                        ┌─────────────────────────┐
                        │   PostgreSQL (primary)   │
                        └─────────────────────────┘
```

**Key design decision:** Every Fiber instance is *stateless* for WS routing purposes — it only knows about the clients directly connected to it. When any instance needs to broadcast, it publishes to a Redis channel; **every** instance is subscribed and relays the message to its own locally connected clients. This is what lets you run N backend replicas behind a load balancer without needing sticky sessions for broadcast correctness (sticky sessions still help avoid unnecessary reconnects, but aren't required for message delivery).

---

## 3. Emergency Alert — End-to-End Flow (Reference Case)

```
1. Super Admin clicks "Send Emergency Alert" in dashboard, confirms
2. POST /api/v1/admin/emergency-alerts  (JWT-authenticated, role=super_admin)
3. Fiber handler:
     a. Validates payload + role
     b. Writes alert row to Postgres (status=sent, audit log entry)
     c. Publishes JSON message to Redis channel `broadcast:emergency`
4. Redis fans the message out to ALL subscribed Fiber instances (< few ms)
5. Each Fiber instance's WS Hub iterates its locally connected clients,
   sends the message frame to every client subscribed to `emergency:global`
6. In parallel, backend enqueues an FCM multicast job for all registered
   device tokens (covers users who are offline/app closed) — this runs
   async so it doesn't block the WS fan-out
7. Client (mobile app):
     - If WS connected & app foregrounded → instant full-screen alert UI
     - If app backgrounded/closed → FCM data+notification payload wakes
       the app, shows high-priority system notification + in-app takeover
       when opened
8. Client optionally sends a lightweight "delivered/read" ack back via
   WS or REST → dashboard's live counter updates in real time
```

**Target latency:** step 2 → step 5 delivery to an already-connected client should be **well under 1 second**; FCM push for offline devices typically lands within a few seconds (outside your control once handed to FCM/APNs).

---

## 4. WebSocket Protocol Design

### 4.1 Connection
- Client connects to `wss://api.vitlive.app/ws?token=<JWT>` (or send token as first frame — query param is simpler but log it carefully / use short-lived tokens).
- Server validates JWT, resolves `user_id`, `role`, `department`, `club_memberships[]`.
- Server auto-subscribes the connection to relevant topics:
  - `college:global` (everyone)
  - `dept:<dept_id>` (based on profile)
  - `club:<club_id>` (for each club they follow)
  - `emergency:global` (everyone, always)
  - `user:<user_id>` (personal notifications, e.g. "your lost item was claimed")

### 4.2 Message Envelope (JSON)
```json
{
  "type": "announcement.new" | "emergency.alert" | "event.new" | "poll.new" | "poll.update" | "lostfound.new" | "chat.message" | "ack",
  "topic": "college:global",
  "payload": { ... type-specific data ... },
  "ts": "2026-08-10T10:15:00Z",
  "id": "uuid"
}
```

### 4.3 Server → Client Event Types (Phase 1–3)
| type | Trigger | Priority |
|---|---|---|
| `emergency.alert` | Emergency alert published | Critical (bypasses normal feed rendering) |
| `announcement.new` | New announcement published | High |
| `event.new` / `event.reminder` | Event created / reminder fires | Normal |
| `poll.new` / `poll.update` | Poll published / vote tally changes | Normal |
| `lostfound.new` | New lost/found post | Low |
| `chat.message` | New chat message in a joined room | Normal |

### 4.4 Client → Server (rare, mostly REST is used for actions)
- `subscribe` / `unsubscribe` (e.g., follow/unfollow a club channel live)
- `ack` (delivery/read acknowledgment for emergency alerts)
- `chat.send` (Phase 3 real-time chat)

---

## 5. Database Schema (Core Tables)

```sql
-- Users & Auth
users (
  id UUID PK,
  college_email VARCHAR UNIQUE NOT NULL,
  full_name VARCHAR,
  role VARCHAR CHECK (role IN ('student','club_admin','dept_admin','super_admin','moderator')),
  department_id UUID REFERENCES departments(id),
  year_of_study INT,
  is_verified BOOLEAN DEFAULT FALSE,
  password_hash VARCHAR,
  created_at TIMESTAMPTZ DEFAULT now()
)

otp_verifications (
  id UUID PK, user_email VARCHAR, otp_hash VARCHAR,
  expires_at TIMESTAMPTZ, attempts INT DEFAULT 0
)

device_tokens (
  id UUID PK, user_id UUID REFERENCES users(id),
  fcm_token VARCHAR, platform VARCHAR, updated_at TIMESTAMPTZ
)

departments (id UUID PK, name VARCHAR, code VARCHAR)

clubs (id UUID PK, name VARCHAR, description TEXT, admin_id UUID REFERENCES users(id))
club_members (club_id UUID, user_id UUID, joined_at TIMESTAMPTZ, PRIMARY KEY(club_id, user_id))

-- Announcements
announcements (
  id UUID PK, title VARCHAR, body TEXT, priority VARCHAR DEFAULT 'normal',
  audience_type VARCHAR CHECK (audience_type IN ('all','department','club','year')),
  audience_ref UUID, created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
)

-- Emergency Alerts
emergency_alerts (
  id UUID PK, message TEXT, triggered_by UUID REFERENCES users(id),
  delivered_count INT DEFAULT 0, total_target INT,
  created_at TIMESTAMPTZ DEFAULT now()
)

-- Lost & Found
lost_found_items (
  id UUID PK, type VARCHAR CHECK (type IN ('lost','found')),
  title VARCHAR, description TEXT, image_url VARCHAR,
  location VARCHAR, posted_by UUID REFERENCES users(id),
  status VARCHAR DEFAULT 'open', created_at TIMESTAMPTZ DEFAULT now()
)

-- Events
events (
  id UUID PK, title VARCHAR, description TEXT, banner_url VARCHAR,
  venue VARCHAR, start_time TIMESTAMPTZ, created_by UUID REFERENCES users(id),
  club_id UUID REFERENCES clubs(id) NULL
)
event_rsvps (event_id UUID, user_id UUID, status VARCHAR, PRIMARY KEY(event_id, user_id))

-- Polls (anonymity-preserving design — see §6)
polls (
  id UUID PK, question VARCHAR, allow_multiple BOOLEAN DEFAULT FALSE,
  audience_type VARCHAR, audience_ref UUID,
  created_by UUID REFERENCES users(id), closes_at TIMESTAMPTZ
)
poll_options (id UUID PK, poll_id UUID REFERENCES polls(id), option_text VARCHAR)
poll_votes (
  id UUID PK, poll_id UUID REFERENCES polls(id), option_id UUID REFERENCES poll_options(id),
  voter_token VARCHAR NOT NULL  -- see §6, NOT a user_id FK
)
poll_voted_users (  -- separate table, only proves "did vote", not "voted what"
  poll_id UUID, user_id UUID, PRIMARY KEY(poll_id, user_id)
)

-- Chat (Phase 3)
chat_rooms (id UUID PK, name VARCHAR, club_id UUID REFERENCES clubs(id))
chat_messages (id UUID PK, room_id UUID REFERENCES chat_rooms(id), sender_id UUID, body TEXT, created_at TIMESTAMPTZ)

-- Audit
audit_logs (id UUID PK, actor_id UUID, action VARCHAR, target VARCHAR, metadata JSONB, created_at TIMESTAMPTZ)
```

---

## 6. Anonymous Polls — Anonymity-Preserving Design

To guarantee votes can't be traced back to a user even by an admin with DB access:

1. `poll_voted_users` records **that** a user voted (to prevent double-voting) — it does **not** store *what* they voted.
2. `poll_votes` records the actual choice, keyed by a `voter_token` = `HMAC(poll_id + user_id, server_secret)`. This token is **one-way** — you cannot reverse it to a `user_id` without brute-forcing every user, and it's never joined against the `users` table in any query.
3. Never log the raw vote request with `user_id` + `option_id` together in application logs.
4. Optional stronger approach (Phase 2+): submit the vote through a short-lived, single-use signed token issued at "poll opened" time, decoupled entirely from the authenticated request that fetched it.

---

## 7. REST API Surface (v1)

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/auth/signup` | Public | Register with college email |
| POST | `/api/v1/auth/verify-otp` | Public | Verify OTP, activate account |
| POST | `/api/v1/auth/login` | Public | Login, returns JWT + refresh token |
| POST | `/api/v1/auth/refresh` | Refresh token | Rotate access token |
| GET | `/api/v1/me` | JWT | Current user profile |
| GET | `/api/v1/announcements` | JWT | Paginated feed |
| POST | `/api/v1/admin/announcements` | JWT (admin) | Publish announcement |
| POST | `/api/v1/admin/emergency-alerts` | JWT (super_admin) | Trigger emergency alert |
| GET | `/api/v1/lostfound` | JWT | Browse lost & found |
| POST | `/api/v1/lostfound` | JWT | Post lost/found item |
| PATCH | `/api/v1/lostfound/:id/resolve` | JWT | Mark resolved |
| GET | `/api/v1/events` | JWT | List events |
| POST | `/api/v1/admin/events` | JWT (admin) | Create event |
| POST | `/api/v1/events/:id/rsvp` | JWT | RSVP |
| GET | `/api/v1/polls/:id` | JWT | Poll + live results |
| POST | `/api/v1/admin/polls` | JWT (admin) | Create poll |
| POST | `/api/v1/polls/:id/vote` | JWT | Cast anonymous vote |
| GET | `/api/v1/clubs` | JWT | List/follow clubs |
| WS | `/ws` | JWT (query/header) | Real-time channel |

---

## 8. Security Requirements

- **Domain-restricted signup**: server-side allowlist of email domains (config, not hardcoded).
- **JWT**: short-lived access token (15 min) + refresh token (7–30 days, rotated, stored hashed).
- **RBAC middleware**: role checked on every admin/emergency route.
- **Rate limiting**: Redis-backed limiter on `/auth/*` and `/polls/*/vote` to prevent brute force and vote spam.
- **Input validation**: strict schema validation (e.g., `go-playground/validator`) on every request body.
- **File upload safety**: validate MIME type + size for lost&found/event images before upload to storage.
- **Transport security**: HTTPS/WSS everywhere via Nginx + Let's Encrypt.
- **Emergency-trigger guardrail**: require 2-step confirmation + restrict to `super_admin` role only; every trigger fully audit-logged.
- **CORS**: locked to your dashboard + app origins in production.

---

## 9. Scalability & Performance Plan

| Concern | Approach |
|---|---|
| Many concurrent WS connections | Fiber's WS handling is goroutine-per-connection (cheap in Go); scale horizontally by adding Fiber instances |
| Broadcast fan-out across instances | Redis Pub/Sub (already covers this — see §2) |
| Sudden connection spike (everyone opens app during emergency) | Load test to expected peak (e.g. 10–20k simultaneous connects); consider connection rate-limiting/backoff on client reconnect logic |
| DB read load on feed queries | Add indexes on `(audience_type, audience_ref, created_at)`; cache latest feed page in Redis |
| FCM sending at scale | Use FCM multicast/topic messaging instead of per-token loops where possible |

---

## 10. DevOps

- **Local dev**: `docker-compose.yml` with Postgres, Redis, and the Fiber app (hot reload via `air`).
- **CI**: GitHub Actions — lint, `go test`, build Docker image on push to `main`.
- **CD**: Deploy container to Railway/Render/Fly.io, or a single VPS behind Nginx + systemd for MVP.
- **Config**: all secrets via environment variables (never committed); `.env.example` checked in.
- **Monitoring**: start simple — structured logs (JSON) + Fiber's built-in metrics; add Prometheus/Grafana once you outgrow log-grepping.
- **Backups**: daily Postgres dump to object storage.

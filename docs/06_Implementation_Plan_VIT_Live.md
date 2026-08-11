# Implementation Plan
## VIT Live — Phased Build Roadmap

Assumes a solo developer or small team (2–3 people) working part-time alongside college, over roughly **12–14 weeks**. Adjust pace as needed — the phase *order* matters more than the exact week count.

---

## Phase 0 — Setup & Foundations (Week 1)

| Task | Output |
|---|---|
| Finalize college email domain(s), confirm who holds Super Admin/emergency-trigger permission | Answered open questions from PRD §10 |
| Set up repo structure (backend, mobile app, admin dashboard as separate repos or a monorepo) | Repo scaffolding pushed |
| Set up Postgres + Redis locally via Docker Compose | `docker-compose up` works |
| Set up Fiber "hello world" with health-check endpoint | `GET /healthz` returns 200 |
| Set up CI (lint + test on push) | GitHub Actions green |

**Milestone:** Empty-but-running backend, dev environment reproducible by anyone on the team.

---

## Phase 1 — Auth + Real-Time Backbone (Weeks 2–4)

| Task | Output |
|---|---|
| DB schema: `users`, `otp_verifications`, `device_tokens`, `departments` | Migrations applied |
| Signup + domain validation + OTP email (SendGrid/SES) | Working signup flow |
| Login + JWT issue/refresh + RBAC middleware | Protected routes work |
| WebSocket Hub + Redis Pub/Sub bridge (see Backend Service doc §2) | Two backend instances relay a broadcast to each other's clients |
| Mobile app: Splash → Signup → OTP → Login → empty Home shell, WS connects | App connects and receives a test broadcast |
| Admin dashboard: Login + empty dashboard shell | Admin can log in |

**Milestone:** You can publish a raw test message from one backend instance and see it appear on a connected mobile client in real time. **This is the riskiest technical piece — validate it early.**

---

## Phase 2 — Announcements + Emergency Alerts (Weeks 5–6)

| Task | Output |
|---|---|
| `announcements` table + CRUD + audience targeting | Admin can create/publish |
| Feed screen (mobile) with live WS updates + pull-to-refresh + pagination | Students see announcements instantly |
| FCM integration (background push) | Push arrives when app is closed |
| Emergency alert isolated flow (extra-guarded role check, confirmation step, full-screen takeover UI) | End-to-end emergency test successful |
| Delivery/read ack + live counter on admin dashboard | Dashboard shows real-time delivery count |
| Audit logging for all admin actions | `audit_logs` populated |

**Milestone:** Core promise of the app (instant campus-wide alerts) is fully working end to end — this alone is a demoable, deployable MVP.

---

## Phase 3 — Lost & Found, Events, Polls (Weeks 7–9)

| Task | Output |
|---|---|
| Lost & Found: schema, CRUD, image upload (Cloudinary/S3), browse/filter UI | Working feature |
| Events: schema, CRUD, RSVP, reminder worker (ticker-based) | Working feature |
| Polls: schema, anonymized vote design (HMAC token — see TRD §6), live results via WS | Working feature, verify anonymity by attempting to trace a vote in the DB yourself |
| Admin dashboard sections for all three | Compose/manage from dashboard |

**Milestone:** Full Phase 2 scope of the PRD complete; app is genuinely useful day-to-day, not just for emergencies.

---

## Phase 4 — Clubs, Chat, Analytics (Weeks 10–12)

| Task | Output |
|---|---|
| Clubs: CRUD, follow/unfollow, club-admin role assignment | Club-scoped announcements work |
| Real-time chat per club (reuse WS Hub, add `chat.message` type + persistence) | Group chat functional |
| Chat moderation (mute/remove, admin-only) | Moderator tools work |
| Admin analytics: DAU, engagement per feature, reach heatmap by department | Dashboard charts |

**Milestone:** Full PRD Phase 3 scope complete.

---

## Phase 5 — Hardening, Testing, Deployment (Weeks 13–14)

| Task | Output |
|---|---|
| Load test WS layer (simulate full-campus concurrent connect, e.g. with `k6` or a custom Go load-test client) | Confirmed capacity number, documented |
| Security pass: rate limits, input validation, dependency audit | Checklist signed off |
| Set up production infra (managed Postgres/Redis, Nginx/Railway, domain + TLS) | Production URL live |
| Beta rollout to one department/club as pilot | Real usage feedback |
| Fix issues from pilot, then wider rollout | Public launch |

**Milestone:** Production-deployed, load-tested, piloted with real students.

---

## Testing Strategy (Throughout)

| Type | Tool/Approach | Focus |
|---|---|---|
| Unit tests | Go's `testing` + `testify` | Service logic (auth, vote anonymization, RBAC) |
| Integration tests | `httptest` against a test DB | API endpoints end-to-end |
| WS/load tests | `k6` (with WS support) or custom Go client spinning up N goroutines | Connection capacity, broadcast latency under load |
| Manual QA | Real devices, both platforms | Push notification behavior (foreground/background/killed states differ a lot between iOS/Android) |
| Security review | Manual checklist + `gosec` static analysis | Before each phase's deploy |

---

## Suggested Team Split (if not solo)

| Role | Owns |
|---|---|
| Backend (Go/Fiber) | API, WS Hub, DB, Redis, deployment |
| Mobile (Flutter/RN) | App UI, WS client, FCM integration |
| Frontend (React) | Admin dashboard |
| (Everyone) | Testing, pilot feedback iteration |

If solo: build in the phase order above — the backend real-time backbone (Phase 1) is the hardest and most important part to get right first, since every later feature reuses it.

---

## Definition of "Done" for MVP (Ship Criteria)

- [ ] Student can sign up with college email, verify OTP, log in
- [ ] Admin can publish an announcement, student sees it live within ~1s if app is open
- [ ] Student receives push notification if app is closed
- [ ] Super Admin can trigger an emergency alert with confirmation step; full-screen takeover works on both platforms
- [ ] Admin dashboard shows live delivery count for at least announcements + emergency alerts
- [ ] All admin actions are audit-logged
- [ ] Load test confirms the backend can handle expected peak concurrent connections
- [ ] Deployed to a real domain with HTTPS/WSS

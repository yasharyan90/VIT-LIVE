# Product Requirements Document (PRD)
## VIT Live — Real-Time Campus Engagement Platform

| | |
|---|---|
| **Version** | 1.0 (Draft) |
| **Status** | Planning |
| **Owner** | You (Product/Founder) |
| **Last Updated** | Aug 2026 |

---

## 1. Vision

> A single real-time app that replaces scattered WhatsApp groups, notice boards, and word-of-mouth with one trusted channel — so every student gets every announcement, alert, and event the moment it's posted, and admins get one dashboard to reach the whole campus instantly.

---

## 2. Problem Statement

| Current State | Problem |
|---|---|
| Announcements via WhatsApp groups, notice boards, emails | Fragmented, easy to miss, no delivery guarantee |
| Lost & found handled at a physical desk / random posts | Low recovery rate, no searchable record |
| Club events via posters / word of mouth | Low visibility, low attendance |
| Feedback via paper forms or nothing | No trusted anonymous channel |
| Emergencies communicated via mass SMS/call trees | Slow, expensive, no confirmation of reach |

VIT Live solves this with **one app, one identity (college email), one real-time pipe**.

---

## 3. Target Users / Personas

| Persona | Role | Core Need |
|---|---|---|
| **Student** | End user (majority) | See announcements/events instantly, report/find lost items, vote anonymously, get emergency alerts even with app closed |
| **Club Admin** | Content publisher (scoped) | Post announcements/events to their club's followers only |
| **Department/College Admin** | Content publisher (broad) | Post official, college-wide announcements and events |
| **Super Admin (College IT/Dean's office)** | System owner | Trigger emergency alerts, manage users/roles, moderate content, view analytics |
| **Moderator** (optional, Phase 3) | Content police | Review/remove inappropriate lost & found posts or chat messages |

---

## 4. Goals & Success Metrics

| Goal | Metric | Target (6 months post-launch) |
|---|---|---|
| Fast delivery | p95 notification delivery latency (publish → device) | < 1.5s for online users |
| Adoption | % of enrolled students with verified account | ≥ 60% |
| Engagement | DAU/MAU ratio | ≥ 25% |
| Emergency reliability | % of online users receiving alert within 5s | ≥ 99% |
| Lost & found utility | % of posted lost items marked "recovered" | ≥ 30% |
| Retention | Week-4 retention of new signups | ≥ 40% |

---

## 5. Scope

### Phase 1 — MVP (Core Real-Time Backbone)
- College-email authentication (signup, OTP verify, login)
- Live campus announcements (admin → all/segment)
- Emergency alerts (highest priority, full-screen + push)
- Push (background) + WebSocket (foreground) delivery
- Basic admin dashboard: compose & publish, view reach

### Phase 2 — Utility Features
- Lost & Found (post, browse, claim, resolve)
- Event notifications (create, RSVP, reminders)
- Anonymous polls (create, vote, live results)

### Phase 3 — Community Features
- Club channels (follow/unfollow, club-scoped announcements)
- Real-time group chat (per club/interest group — **not** open 1:1 DMs in v1)
- Admin analytics (engagement, reach, heatmaps by department)

### Explicitly Out of Scope (v1)
- Payments / fee-related features
- LMS or academic record integration
- Open 1:1 direct messaging (social-network style)
- Video/audio calling or streaming

---

## 6. Feature Requirements (User Stories + Acceptance Criteria)

### 6.1 Authentication (College Email Login)
| # | User Story | Acceptance Criteria |
|---|---|---|
| A1 | As a student, I can sign up only with my official college email (e.g. `@vitstudent.ac.in`) | Signup rejects any non-whitelisted domain with a clear error |
| A2 | As a user, I verify my email via OTP before accessing the app | Account stays in `unverified` state until OTP confirmed; OTP expires in 10 min |
| A3 | As a user, I stay logged in across sessions | Refresh token flow keeps session alive for 7–30 days without re-entering password |
| A4 | As an admin, I can be granted elevated roles | Role changes only performable by Super Admin from dashboard, logged in audit trail |

### 6.2 Live Campus Announcements
| # | User Story | Acceptance Criteria |
|---|---|---|
| N1 | As an admin, I can publish an announcement to all students or a filtered segment (year/dept/club) | Segment selector in dashboard; publish triggers fan-out within seconds |
| N2 | As a student, I see new announcements in a live feed without refreshing | WebSocket pushes new item to top of feed in real time |
| N3 | As a student, I get a push notification if the app is backgrounded/closed | FCM delivers within a few seconds; tapping opens the announcement |
| N4 | As a student, I can view announcement history | Paginated feed, newest first, searchable |

### 6.3 Emergency Alerts
| # | User Story | Acceptance Criteria |
|---|---|---|
| E1 | As a Super Admin, I can trigger a campus-wide emergency alert | Requires explicit confirmation step (type "CONFIRM" or 2-tap) to prevent accidental sends |
| E2 | As a student, an emergency alert overrides normal UX | Full-screen red takeover + sound/vibration even if phone is on silent-app-mute (where OS allows), regardless of current screen |
| E3 | As an admin, I can see live delivery/read stats for an emergency alert | Dashboard shows "delivered to X/Y", updates in real time |

### 6.4 Lost & Found
| # | User Story | Acceptance Criteria |
|---|---|---|
| L1 | As a student, I can post a lost or found item with photo, description, location, date | Post appears in feed instantly, categorized (Lost / Found) |
| L2 | As a student, I can browse/search/filter lost & found posts | Filter by category, location, date range |
| L3 | As a finder/owner, I can mark an item "claimed/resolved" | Item moves to resolved tab, optionally notifies the poster |
| L4 | As a moderator, I can remove spam/inappropriate posts | Soft-delete with audit log |

### 6.5 Event Notifications
| # | User Story | Acceptance Criteria |
|---|---|---|
| V1 | As a club/dept admin, I can create an event with title, description, date/time, venue, banner image | Event appears in Events tab and triggers a notification to followers |
| V2 | As a student, I can RSVP to an event | RSVP count visible to admin; optional capacity limit |
| V3 | As a student, I get a reminder before the event starts | Scheduled reminder push (e.g., 1 hr before) |

### 6.6 Anonymous Polls
| # | User Story | Acceptance Criteria |
|---|---|---|
| P1 | As an admin, I can create a poll (single/multi-choice) targeted at all or a segment | Poll broadcast in real time like an announcement |
| P2 | As a student, I can vote without my identity being linked to my choice in the UI or exposed to admins | Vote stored decoupled from user identity in a way that prevents reverse lookup from the results view |
| P3 | As a student/admin, I can see live results update as votes come in | Results bar chart updates via WebSocket without refresh |

### 6.7 Real-Time Chat (Phase 3)
| # | User Story | Acceptance Criteria |
|---|---|---|
| C1 | As a club member, I can chat in my club's group channel | Messages delivered in real time to all online members, persisted for offline members |
| C2 | As an admin/moderator, I can mute or remove a member from a channel | Action reflected immediately, logged |

---

## 7. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Performance** | p95 API response < 300ms; WS message fan-out < 1.5s at 10k concurrent connections |
| **Scalability** | Horizontally scalable WebSocket layer (stateless app servers behind Redis Pub/Sub) to support entire campus (~15k–30k students) |
| **Availability** | Target 99.5% uptime for core notification path; emergency alert path should degrade gracefully (fallback to push-only if WS layer is down) |
| **Security** | College-domain-restricted signup, JWT auth, RBAC, HTTPS everywhere, rate limiting, input sanitization |
| **Privacy** | Anonymous poll votes must not be traceable to a user identity in any admin-facing view |
| **Data Retention** | Chat/announcement history retained 12 months by default (configurable) |
| **Accessibility** | Mobile UI meets basic WCAG AA contrast; emergency alerts usable with screen readers |
| **Auditability** | All admin actions (publish, delete, role change, emergency trigger) logged with timestamp + actor |

---

## 8. Assumptions & Constraints

- College maintains a consistent, verifiable email domain (or small set of domains) for students/staff.
- Students predominantly use Android/iOS smartphones.
- Initial budget is limited → prefer free-tier / low-cost managed services (Redis, Postgres, FCM) over enterprise infra.
- College IT is willing to informally endorse the app or at least not block it (no official LDAP/SSO integration assumed for v1 — plain email+OTP instead).

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Low adoption (students don't switch from WhatsApp) | High | Seed with club admins first, promote via orientation, make onboarding < 60s |
| Emergency alert misuse/spam | High | Restrict trigger permission to 1–2 Super Admin accounts, require confirmation, full audit log |
| WebSocket layer overload during a real emergency (everyone opens app at once) | High | Load-test for full-campus concurrent connect; fallback to FCM push if WS saturated |
| Fake/spam accounts | Medium | Enforce college email + OTP; rate-limit signups |
| Anonymous poll de-anonymization | Medium | Architect vote storage so identity and vote are never joinable in any query (see TRD §6) |

---

## 10. Open Questions (to resolve before build)

1. Exact list of valid college email domains (students vs staff)?
2. Who exactly holds "Emergency Alert" trigger permission — Dean of Students only, or also security office?
3. Will the college officially endorse/host this, or is it a student-led unofficial pilot?
4. Data retention/deletion policy for graduated students?

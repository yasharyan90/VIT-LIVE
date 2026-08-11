# VIT Live — API Contract (v1)

Backend base URL (dev): `http://localhost:8080`
All REST routes are under `/api/v1`. WebSocket at `ws://localhost:8080/ws?token=<access_token>`.
Frontends in dev proxy `/api`, `/ws`, and `/uploads` to `localhost:8080` via Vite proxy.

Auth: `Authorization: Bearer <access_token>` header. Access token ~15 min, refresh token 30 days.
All errors: HTTP status + `{"error": "human readable message"}`.

Roles: `student`, `club_admin`, `dept_admin`, `super_admin`, `moderator`.
"admin" below means `club_admin | dept_admin | super_admin` unless stated.

## Entities

```jsonc
User: {
  "id": "uuid", "college_email": "s@vitstudent.ac.in", "full_name": "…",
  "role": "student", "department_id": "uuid|null", "department_code": "CSE|null",
  "department_name": "Computer Science|null", "year_of_study": 2,
  "is_verified": true, "created_at": "RFC3339",
  "followed_club_ids": ["uuid"]            // present on /me only
}

Announcement: {
  "id": "uuid", "title": "…", "body": "…", "priority": "normal|high",
  "audience_type": "all|department|club|year", "audience_ref": "uuid-or-year-string|null",
  "author_name": "…", "created_at": "RFC3339"
}

EmergencyAlert: {
  "id": "uuid", "message": "…", "triggered_by_name": "…",
  "delivered_count": 0, "total_target": 0, "created_at": "RFC3339"
}

LostFoundItem: {
  "id": "uuid", "type": "lost|found", "title": "…", "description": "…",
  "image_url": "/uploads/xyz.jpg|null", "location": "…",
  "status": "open|resolved", "posted_by": "uuid", "poster_name": "…",
  "poster_email": "…", "created_at": "RFC3339"
}

Event: {
  "id": "uuid", "title": "…", "description": "…", "banner_url": "/uploads/…|null",
  "venue": "…", "start_time": "RFC3339", "club_id": "uuid|null", "club_name": "…|null",
  "rsvp_count": 12, "my_rsvp": true, "created_at": "RFC3339"
}

Poll: {
  "id": "uuid", "question": "…", "allow_multiple": false,
  "closes_at": "RFC3339|null", "created_at": "RFC3339",
  "total_votes": 120, "has_voted": false, "is_closed": false,
  "options": [{ "id": "uuid", "option_text": "…", "votes": 60 }]
}

Club: {
  "id": "uuid", "name": "…", "description": "…",
  "member_count": 40, "is_following": false
}

AuditLog: {
  "id": "uuid", "actor_name": "…", "action": "announcement.create",
  "target": "uuid-or-desc", "metadata": {}, "created_at": "RFC3339"
}
```

## Auth (public)

| Route | Body → Response |
|---|---|
| `POST /auth/signup` | `{college_email, full_name, password, department_code, year_of_study}` → `201 {message, dev_otp?}` (`dev_otp` only when APP_ENV=development) |
| `POST /auth/verify-otp` | `{college_email, otp}` → `{message}` (400 wrong/expired; max 5 attempts) |
| `POST /auth/resend-otp` | `{college_email}` → `{message, dev_otp?}` |
| `POST /auth/login` | `{college_email, password}` → `{access_token, refresh_token, user: User}` (403 `{"error":"account not verified"}` if unverified) |
| `POST /auth/refresh` | `{refresh_token}` → `{access_token, refresh_token}` (rotated) |
| `GET /departments` | → `{items: [{id, name, code}]}` (public, for signup dropdown) |

## Student routes (JWT)

| Route | Notes |
|---|---|
| `GET /me` | → `{user: User}` (includes `followed_club_ids`) |
| `POST /me/device-token` | `{fcm_token, platform}` → `{message}` |
| `GET /announcements?limit=20&before=<RFC3339>&since=<RFC3339>&q=` | → `{items: [Announcement], has_more: bool}` newest first; `before` = pagination cursor, `since` = reconciliation |
| `GET /emergency-alerts/active` | → `{alert: EmergencyAlert|null}` (latest alert < 60 min old not acked by me) |
| `POST /emergency-alerts/:id/ack` | → `{delivered_count}` |
| `GET /lostfound?type=lost|found&status=open|resolved&q=` | → `{items: [LostFoundItem]}` |
| `POST /lostfound` | multipart form: `type,title,description,location` + optional file field `image` → `201 {item}` |
| `PATCH /lostfound/:id/resolve` | poster or admin only → `{item}` |
| `GET /events` | → `{items: [Event]}` upcoming first |
| `POST /events/:id/rsvp` | `{going: true|false}` → `{rsvp_count, my_rsvp}` |
| `GET /polls` | → `{items: [Poll]}` active first, then closed |
| `GET /polls/:id` | → `{poll: Poll}` |
| `POST /polls/:id/vote` | `{option_ids: ["uuid"]}` → `{poll: Poll}` (409 if already voted) |
| `GET /clubs` | → `{items: [Club]}` |
| `POST /clubs/:id/follow` / `POST /clubs/:id/unfollow` | → `{club: Club}` |

## Admin routes (JWT + role)

| Route | Role | Notes |
|---|---|---|
| `GET /admin/stats` | admin | → `{total_users, verified_users, online_now, announcements_today, active_polls, open_lostfound, upcoming_events}` |
| `POST /admin/announcements` | admin | `{title, body, priority, audience_type, audience_ref?}` → `201 {announcement}` |
| `GET /admin/announcements` | admin | → `{items:[Announcement & {delivered_count}]}` |
| `POST /admin/emergency-alerts` | super_admin | `{message (≤160 chars), confirm: "CONFIRM"}` → `201 {alert}` (400 if confirm ≠ "CONFIRM") |
| `GET /admin/emergency-alerts` | super_admin | → `{items: [EmergencyAlert]}` |
| `POST /admin/events` | admin | multipart: `title,description,venue,start_time(RFC3339),club_id?` + optional file `banner` → `201 {event}` |
| `GET /admin/events` | admin | → `{items: [Event]}` |
| `POST /admin/polls` | admin | `{question, options: ["…","…"], allow_multiple, closes_at?}` → `201 {poll}` |
| `GET /admin/polls` | admin | → `{items: [Poll]}` |
| `GET /admin/lostfound` | admin/moderator | → `{items}` incl. soft-deleted (`status:"removed"`) |
| `DELETE /admin/lostfound/:id` | admin/moderator | soft delete → `{message}` |
| `GET /admin/users?q=&role=` | super_admin | → `{items: [User]}` |
| `PATCH /admin/users/:id/role` | super_admin | `{role}` → `{user}` |
| `POST /admin/clubs` | super_admin | `{name, description}` → `201 {club}` |
| `GET /admin/audit-logs?limit=50` | super_admin | → `{items: [AuditLog]}` |

## WebSocket protocol

Connect: `ws://host/ws?token=<access_token>`. Server auto-subscribes: `college:global`,
`emergency:global`, `user:<id>`, `dept:<dept_id>`, `club:<id>` per followed club.
Admin dashboard connections (role ≠ student) are also subscribed to `admin:delivery`.

Envelope (server → client):
```json
{ "type": "…", "topic": "college:global", "payload": {}, "ts": "RFC3339", "id": "uuid" }
```

| type | payload |
|---|---|
| `announcement.new` | Announcement |
| `emergency.alert` | EmergencyAlert |
| `event.new` / `event.reminder` | Event |
| `poll.new` | Poll |
| `poll.update` | Poll (fresh tallies; `has_voted` omitted — client keeps its own) |
| `lostfound.new` | LostFoundItem |
| `delivery.update` | `{kind: "emergency"|"announcement", ref_id: "uuid", delivered: 123, total: 4000}` (topic `admin:delivery`) |

Client → server frames:
```json
{ "type": "subscribe",   "topic": "club:<id>" }
{ "type": "unsubscribe", "topic": "club:<id>" }
{ "type": "ack", "payload": { "kind": "emergency|announcement", "ref_id": "uuid" } }
```
Clients send an `ack` when an emergency alert is displayed (and again is idempotent).
On WS reconnect / app foreground, clients call `GET /announcements?since=<last_seen>` to reconcile.

## Dev credentials (seeded)

- Super admin: `admin@vit.ac.in` / `admin12345` (verified, role super_admin)
- Departments seeded: CSE, ECE, MECH, CIVIL, EEE. Clubs seeded: Coding Club, Robotics Club, Music Club.
- Allowed signup domains (dev): `vitstudent.ac.in`, `vit.ac.in`

## Feature drop 2 additions (Aug 2026)

New/changed REST endpoints (all under `/api/v1`, JWT unless noted):

| Method & path | Who | Notes |
|---|---|---|
| `POST /announcements/:id/react` | student+ | Toggles the caller's 👍. → `{reaction_count, my_reaction}` |
| `GET /events/:id` | student+ | Single event (deep links). → `{event}` |
| `GET /clubs/:id` | student+ | Club page. → `{club, announcements, events}` |
| `POST /lostfound/:id/report` | student+ | Flag a post. Body `{reason?}`. Idempotent per user. |
| `GET /academic-events[?all=true]` | student+ | Academic calendar (upcoming by default). → `{items}` |
| `GET /mess-menu[?date=YYYY-MM-DD]` | student+ | → `{date, meals: [{menu_date, meal, items, updated_at}]}` |
| `GET /admin/analytics` | admin | `{signups_by_day, announcement_reach, poll_participation, popular_events}` |
| `GET /admin/lostfound?reported=true` | moderation | Only posts with ≥1 student report; items carry `report_count`. |
| `POST /admin/academic-events` | admin | `{title, kind: exam|holiday|deadline|other, starts_on, ends_on?}` |
| `DELETE /admin/academic-events/:id` | admin | |
| `POST /admin/mess-menu` | admin | Upsert `{menu_date, meal, items}` |

`POST /admin/announcements` now also accepts **multipart/form-data** (same fields
plus optional `image`) and an optional `publish_at` (RFC3339). A future `publish_at`
schedules the post: it is hidden from student feeds (`scheduled: true` in admin lists)
until a 30s server ticker publishes + broadcasts it.

Announcement objects gained `image_url`, `publish_at`, `scheduled`, `reaction_count`,
`my_reaction`. LostFound items gained `report_count` (admin lists only).

New WS envelope types:

| type | payload | topic |
|---|---|---|
| `announcement.reaction` | `{id, reaction_count}` | the announcement's audience topic |
| `lostfound.match` | LostFoundItem (the newly posted counterpart) | `user:<id>` of matched posters |

Uploads are stored on local disk by default, or any S3-compatible bucket when the
`S3_*` env vars are set (see `backend/.env.example`). Web push activates when
`FCM_SERVICE_ACCOUNT_JSON` (backend) and `VITE_FIREBASE_*`/`VITE_FCM_VAPID_KEY`
(student app build) are configured.

## Ticketing (feature drop 3, Aug 2026)

Events gained `price_cents` (0 = free; set via the create form). Event objects
include `my_ticket_status` (`paid` | `checked_in` | null) for the caller.
RSVP on a paid event returns **402** — attendance is by ticket.

| Method & path | Who | Notes |
|---|---|---|
| `POST /events/:id/order` | student+ | Start purchase. → `{mock, key_id, order_id, amount_cents, currency, event_title}`. `mock:true` when Razorpay isn't configured. |
| `POST /events/:id/confirm` | student+ | Body: Razorpay checkout callback fields (`razorpay_order_id/payment_id/signature`), verified server-side via HMAC; empty body allowed in mock mode. → `{ticket}` (201). Idempotent. |
| `GET /me/tickets` | student+ | Caller's paid tickets with event info. |
| `POST /admin/tickets/checkin` | club_admin / dept_admin / super_admin | Body `{code}` (the QR contents). 200 grants entry; **409** already checked in; **402** unpaid; **403** for a club account scanning another club's event. |
| `PATCH /admin/clubs/:id/admin` | super_admin | Body `{email}` — makes that verified user the club's account (promotes students to `club_admin`). Club accounts create events only under their own club and see only their club's events in the admin list. |

Ticket object: `{id, event_id, code, amount_cents, status, created_at,
checked_in_at, event_title, venue, start_time, attendee_name}`. The QR encodes
`code` (an opaque 32-hex secret). A paid ticket also inserts an RSVP so
`rsvp_count` doubles as tickets sold.

Env: `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — unset means mock gateway
(instant success) for local dev.

## Club social feed (Aug 2026)

Clubs have a public social timeline (announcements / banner reveals / news)
managed by the club account, followed by students.

| Method & path | Who | Notes |
|---|---|---|
| `POST /admin/club-posts` | club_admin / super_admin | Multipart: `kind` (announcement\|banner\|news), `body`, `image?`, `club_id` (super admins only — club accounts post to their own club). Text or image required. |
| `GET /admin/club-posts[?club_id=]` | club_admin / super_admin | Manage view → `{club:{id,name}, items}` |
| `DELETE /admin/club-posts/:id` | owning club account / super_admin | Other clubs get 403. |
| `GET /clubs/:id/posts` | student+ | A club's public timeline. |
| `GET /feed/clubs` | student+ | Aggregated feed of posts from every club the caller follows. |
| `POST /club-posts/:id/like` | student+ | Toggle like → `{like_count, my_like}` |

ClubPost: `{id, club_id, club_name, kind, body, image_url, author_name,
created_at, like_count, my_like}`.

WS envelopes on topic `club:<id>` (followers auto-subscribed):
`clubpost.new` (ClubPost), `clubpost.like` (`{id, like_count}`),
`clubpost.deleted` (`{id}`).

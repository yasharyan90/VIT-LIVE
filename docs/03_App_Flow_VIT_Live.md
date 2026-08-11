# App Flow Document
## VIT Live — User Journeys & Sequence Flows

---

## 1. Onboarding Flow (Student)

```
Splash Screen
     │
     ▼
[First launch?] ──No──► Login Screen
     │Yes
     ▼
Signup Screen (college email + name + department + year)
     │
     ▼
Server validates email domain ──Invalid──► Show error: "Use your college email"
     │Valid
     ▼
OTP sent to email ──► OTP Entry Screen (6-digit, 10 min expiry)
     │
     ▼
[OTP correct?] ──No──► Retry (max 5 attempts, then cooldown)
     │Yes
     ▼
Set password (or magic-link-only, no password — your choice)
     │
     ▼
Profile setup: photo (optional), notification preferences,
follow clubs of interest
     │
     ▼
Request push notification permission (OS prompt)
     │
     ▼
Home Feed (WS connects in background)
```

---

## 2. Returning User — Login Flow

```
Splash → Check stored refresh token
     │
     ├─ Valid → silently refresh access token → Home Feed
     │
     └─ Expired/missing → Login Screen (email + password
                            OR "send OTP" passwordless option)
                                │
                                ▼
                          Home Feed (WS connects)
```

---

## 3. Student — Core Navigation (Bottom Tab Bar)

```
┌─────────┬─────────┬─────────┬─────────┬─────────┐
│  Feed   │  Lost&  │ Events  │  Polls  │ Profile │
│ (Home)  │  Found  │         │         │         │
└─────────┴─────────┴─────────┴─────────┴─────────┘
```

- **Feed**: chronological stream of announcements + club posts + polls, mixed, with priority badges. Pull-to-refresh + live WS updates prepend new items with a subtle animation.
- **Lost & Found**: two sub-tabs (Lost / Found), floating "+" to post, search/filter bar.
- **Events**: upcoming (chronological) / my RSVPs, tap for detail + RSVP button.
- **Polls**: active polls needing your vote at top, past polls with results below.
- **Profile**: my department/year, followed clubs, notification settings, logout.

*(Chat, Phase 3, added as a 6th tab or nested inside each Club's page.)*

---

## 4. Admin — Publish an Announcement (Dashboard Flow)

```
Admin logs in (email + password, role checked)
     │
     ▼
Dashboard Home (stats: active users, recent posts, pending moderation)
     │
     ▼
Click "New Announcement"
     │
     ▼
Compose: title, body, optional image, priority (normal/high),
audience (All / Department X / Club Y / Year Z)
     │
     ▼
Preview → Click "Publish"
     │
     ▼
POST /admin/announcements → saved to DB → published to Redis
     │
     ▼
Dashboard shows live delivery counter ticking up in real time
(via WS subscription to a `delivery:<announcement_id>` topic)
```

---

## 5. Emergency Alert Flow (Super Admin) — Detailed

This matches the pipeline you described, expanded into a full user-facing flow:

```
Super Admin → "Emergency Alert" button (visually distinct, red, requires
              separate role-gated screen, not reachable from normal
              announcement composer)
     │
     ▼
Compose short alert message (character-limited, forces brevity)
     │
     ▼
Confirmation modal: "This will immediately alert ALL <N> students.
                      Type CONFIRM to proceed."
     │
     ▼
Submit → POST /admin/emergency-alerts
     │
     ▼
 Backend:
   1. Insert row (status=sending)
   2. Publish to Redis channel `broadcast:emergency`
   3. Enqueue FCM multicast (async, for offline users)
     │
     ▼
 All Fiber instances relay to locally connected WS clients
 subscribed to `emergency:global`
     │
     ├─ App is open (foreground) ──► Immediate full-screen red
     │                                takeover, sound + vibration,
     │                                "I'm Safe" acknowledgment button
     │
     └─ App is closed/background ──► FCM high-priority notification
                                      wakes device → tap opens app
                                      directly to alert screen
     │
     ▼
 Client sends lightweight ack (WS or REST) → Admin dashboard's
 live counter updates: "Delivered: 8,214 / 15,000"
```

---

## 6. Lost & Found Flow

```
Student taps "+" on Lost & Found tab
     │
     ▼
Choose type: Lost / Found
     │
     ▼
Fill form: title, description, location, date, photo (optional but
recommended)
     │
     ▼
Submit → appears instantly at top of the relevant feed for all users
     │
     ▼
Another student sees a match → taps post → "This is mine" / "I found this"
     │
     ▼
In-app contact reveal (or a simple in-app message thread — Phase 3 chat,
or a lightweight "Contact via email" link in MVP to avoid building full
messaging just for this)
     │
     ▼
Original poster marks item "Resolved" → moves to resolved history
```

---

## 7. Anonymous Poll — Voting Flow

```
Student sees new poll in Feed (pushed via WS like an announcement)
     │
     ▼
Tap poll → see question + options (no live results shown yet if you
           want to avoid bandwagon bias — configurable)
     │
     ▼
Select option(s) → Submit
     │
     ▼
Backend: check poll_voted_users (already voted?) → if not, insert
         vote with anonymized voter_token, mark poll_voted_users
     │
     ▼
Live results bar updates for everyone via WS `poll.update` event
     │
     ▼
Student sees "Thanks, your vote is anonymous" confirmation + results
```

---

## 8. Notification Handling — Foreground vs Background

```
                    ┌─────────────────────┐
                    │  New event occurs    │
                    │  (backend publishes) │
                    └──────────┬───────────┘
                               │
                 ┌─────────────┴─────────────┐
                 ▼                            ▼
        App is FOREGROUND               App is BACKGROUND/CLOSED
        (WS connection alive)           (WS disconnected)
                 │                            │
                 ▼                            ▼
        Message arrives over WS      FCM delivers push notification
                 │                            │
                 ▼                            ▼
        In-app banner/toast +        OS notification tray →
        feed updates live            tap → deep-link into app →
                                      fetch missed items via REST
                                      (reconciliation call)
```

**Reconciliation on reconnect:** every time the app comes to foreground / WS reconnects, call `GET /api/v1/announcements?since=<last_seen_ts>` to fill any gap between disconnect and reconnect — WS is for *speed*, REST is the source of truth for *completeness*.

---

## 9. Club Follow & Club-Scoped Announcement Flow (Phase 3)

```
Student → Clubs directory → tap "Follow" on a club
     │
     ▼
Server adds row to club_members, client subscribes WS to `club:<id>`
     │
     ▼
Club Admin publishes announcement scoped to `audience_type=club`
     │
     ▼
Only followers receive it (WS topic + FCM topic messaging scoped
to club subscribers)
```

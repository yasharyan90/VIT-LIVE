# UI/UX Design Document
## VIT Live — Mobile App & Admin Dashboard

---

## 1. Design Principles

1. **Urgency hierarchy is visual, not just textual.** Emergency > Announcement > Event > Poll > Lost&Found > Chat, in that order of visual weight (color, size, placement).
2. **Zero-friction onboarding.** Signup-to-home-feed should take under 60 seconds.
3. **Never bury an emergency.** It must be impossible to miss, even mid-scroll or mid-chat.
4. **Trustworthy anonymity.** Poll voting UI should visibly reassure the user their identity is protected.
5. **Familiar patterns.** Use standard mobile idioms (bottom tabs, pull-to-refresh, floating action button) — don't make students learn a new interaction model.

---

## 2. Information Architecture

### Mobile App (Student)
```
Splash
 └─ Auth
     ├─ Signup → OTP → Profile Setup
     └─ Login
 └─ Main (Bottom Tabs)
     ├─ Feed (Home)
     │   └─ Announcement Detail
     ├─ Lost & Found
     │   ├─ Lost tab / Found tab
     │   ├─ Post New Item
     │   └─ Item Detail
     ├─ Events
     │   ├─ Upcoming / My RSVPs
     │   └─ Event Detail
     ├─ Polls
     │   └─ Poll Detail / Results
     └─ Profile
         ├─ My Clubs
         ├─ Notification Settings
         └─ Logout
 └─ Emergency Alert Overlay (global, can appear over any screen)
 └─ Club Detail (from Feed or Clubs directory)
     └─ Club Chat (Phase 3)
```

### Admin Dashboard (Web)
```
Login
 └─ Dashboard Home (stats overview)
     ├─ Announcements (list, compose, edit)
     ├─ Emergency Alerts (separate, role-gated, red-themed section)
     ├─ Events (list, compose)
     ├─ Polls (list, compose, live results)
     ├─ Lost & Found (moderation queue)
     ├─ Clubs (manage club admins, members)
     ├─ Users (search, role management, verification status)
     ├─ Chat Moderation (Phase 3)
     └─ Audit Log
```

---

## 3. Design System

### 3.1 Color Palette

| Token | Hex | Usage |
|---|---|---|
| `primary` | `#1E3A8A` (deep campus blue) | Brand, headers, primary buttons |
| `primary-light` | `#3B82F6` | Links, secondary actions |
| `emergency` | `#DC2626` (strong red) | Emergency alerts only — reserved, never reused elsewhere |
| `emergency-bg` | `#FEF2F2` | Emergency banner background (light mode) |
| `success` | `#16A34A` | Resolved items, confirmations |
| `warning` | `#D97706` | High-priority (non-emergency) announcements |
| `neutral-900` | `#111827` | Primary text |
| `neutral-500` | `#6B7280` | Secondary text |
| `neutral-100` | `#F3F4F6` | Card backgrounds |
| `surface` | `#FFFFFF` | Base background |

> Reserve red (`emergency`) exclusively for actual emergency alerts. If any other UI element uses red, users will desensitize to it and the real alert loses impact.

### 3.2 Typography

| Style | Font | Size | Weight |
|---|---|---|---|
| Display (alert headline) | Inter / SF Pro | 28px | Bold |
| H1 (screen title) | Inter | 22px | Bold |
| H2 (card title) | Inter | 17px | Semibold |
| Body | Inter | 15px | Regular |
| Caption | Inter | 12px | Regular |

### 3.3 Components (Reusable)
- **Priority Badge**: pill-shaped, color-coded (red=emergency, amber=high, blue=normal)
- **Feed Card**: icon (type indicator) + title + snippet + timestamp + priority badge
- **Live Counter**: animated number ticker (used in admin dashboard for delivery stats)
- **Vote Bar**: horizontal bar with percentage fill, animates on WS update
- **Empty State**: friendly illustration + short copy for empty feeds/lists

---

## 4. Key Screen Wireframes (Described)

### 4.1 Home Feed
```
┌───────────────────────────────┐
│  VIT Live          🔔 (3)      │  ← header, notification bell w/ badge
├───────────────────────────────┤
│ 🔴 EMERGENCY ALERT BANNER      │  ← only shows if active, dismiss-locked
│ "Campus closed - flooding..."  │
├───────────────────────────────┤
│ 🟡 HIGH  Placement drive...    │  ← announcement card
│    Computer Science Dept       │
│    2 min ago                   │
├───────────────────────────────┤
│ 📊 POLL  "Extend library hrs?" │  ← poll card, inline vote buttons
│    [Yes]  [No]                 │
├───────────────────────────────┤
│ 🎉 EVENT  Robotics Club Fest   │
│    Tomorrow, 5 PM · Auditorium │
│    [RSVP]                      │
├───────────────────────────────┤
│ 🔵 Coding Club posted an       │
│    announcement · 1 hr ago     │
└───────────────────────────────┘
[ Feed | Lost&Found | Events | Polls | Profile ]  ← bottom tabs
```

### 4.2 Emergency Alert — Full-Screen Takeover
```
┌───────────────────────────────┐
│                                 │
│           ⚠️  (large icon)      │
│                                 │
│      EMERGENCY ALERT           │
│                                 │
│  "Fire reported in Block C.    │
│   Evacuate immediately via     │
│   the main gate."               │
│                                 │
│   Issued by: Dean of Students  │
│   10:42 AM                      │
│                                 │
│   [   I'm Safe — Acknowledge  ] │
│                                 │
└───────────────────────────────┘
```
- Full red background (`emergency-bg`), cannot be dismissed by swipe/back button — only by the acknowledge action.
- Triggers device vibration pattern + sound even if app was backgrounded.
- Acknowledge button sends the delivery/read ack described in the App Flow doc.

### 4.3 Lost & Found — Post Item
```
┌───────────────────────────────┐
│  ← New Post                    │
├───────────────────────────────┤
│  [ Lost ]   [ Found ]           │  ← toggle
├───────────────────────────────┤
│  📷  Add Photo                  │
│  Title: [_______________]       │
│  Description: [____________]    │
│  Location: [____________]       │
│  Date: [__/__/____]             │
├───────────────────────────────┤
│           [ Post ]              │
└───────────────────────────────┘
```

### 4.4 Poll Voting
```
┌───────────────────────────────┐
│  📊 Should library hours       │
│     extend to midnight?         │
│                                  │
│  🔒 Your vote is anonymous —    │
│     admins cannot see who       │
│     voted what.                 │
│                                  │
│     [   Yes   ]                 │
│     [   No    ]                 │
│                                  │
│  1,204 votes so far              │
└───────────────────────────────┘
```
After voting → results view with animated bars, percentages, total vote count. The reassurance line ("Your vote is anonymous...") is a deliberate UX trust signal.

### 4.5 Admin Dashboard — Compose Announcement
```
┌─────────────────────────────────────────────┐
│  VIT Live Admin        [Search]  [👤 Admin]   │
├───────────┬───────────────────────────────────┤
│ Dashboard │  New Announcement                   │
│ Announce. │  Title: [_____________________]     │
│ ⚠ Emergency│  Body:  [_____________________]     │
│ Events    │         [_____________________]     │
│ Polls     │  Priority: (•) Normal ( ) High       │
│ Lost&Found│  Audience: [ All Students     ▾]     │
│ Clubs     │  Image: [ Upload ]                    │
│ Users     │                                        │
│ Audit Log │  [ Preview ]   [ Publish → ]           │
└───────────┴───────────────────────────────────────┘
```

### 4.6 Admin Dashboard — Emergency Alerts (Isolated, Guarded Section)
```
┌─────────────────────────────────────────────┐
│  ⚠ EMERGENCY ALERTS   (Super Admin only)      │
├───────────────────────────────────────────────┤
│  Message: [___________________________]        │
│  (160 char limit — keep it short and clear)     │
│                                                  │
│  ⚠ This will immediately notify all 15,340       │
│     students with a full-screen alert.           │
│                                                  │
│  Type CONFIRM to proceed: [____________]         │
│                                                  │
│                    [ Send Emergency Alert ]      │
├───────────────────────────────────────────────┤
│  Live delivery: ████████░░  8,214 / 15,340       │
└───────────────────────────────────────────────┘
```

---

## 5. Accessibility Notes

- Minimum contrast ratio 4.5:1 for all text (verify `emergency` red against white/background).
- Emergency alert screen must work with screen readers — headline + body read aloud automatically (`accessibilityLiveRegion="assertive"` in RN, or equivalent Flutter semantics).
- All tappable targets ≥ 44x44px.
- Support system font-scaling (don't hardcode pixel sizes that break with OS text-size settings).
- Provide a non-color signal (icon + label, not just red) for priority, for colorblind users.

---

## 6. Motion & Feedback Guidelines

- New feed items animate in with a subtle slide-down + fade (200ms), never jarring.
- Emergency alert entrance: no fade-in subtlety — appears instantly, paired with haptic feedback.
- Poll results bars animate fill on each WS update (300ms ease-out).
- Live delivery counters (admin dashboard) count up smoothly rather than jumping, to visually communicate "still delivering."

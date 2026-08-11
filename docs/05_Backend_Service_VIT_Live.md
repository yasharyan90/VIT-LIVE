# Backend Service Design
## VIT Live — Go Fiber + Redis Pub/Sub + WebSocket Hub

---

## 1. Project Structure

```
vit-live-backend/
├── cmd/
│   └── server/
│       └── main.go
├── internal/
│   ├── auth/            # signup, otp, login, jwt, middleware
│   ├── announcements/    # handlers, service, repository
│   ├── emergency/        # emergency alert handlers (isolated, extra-guarded)
│   ├── lostfound/
│   ├── events/
│   ├── polls/
│   ├── clubs/
│   ├── chat/              # phase 3
│   ├── notifications/     # FCM sender
│   ├── ws/                 # WebSocket hub + Redis pub/sub bridge
│   │   ├── hub.go
│   │   ├── client.go
│   │   └── redis_bridge.go
│   ├── db/                 # Postgres connection, migrations
│   ├── cache/                # Redis connection helpers
│   └── middleware/           # RBAC, rate limiting, logging
├── migrations/
├── config/
│   └── config.go             # env-based config loader
├── docker-compose.yml
├── Dockerfile
├── go.mod
└── .env.example
```

---

## 2. WebSocket Hub Design (Core Real-Time Engine)

The Hub is the heart of the "milliseconds" delivery pipeline. Each Fiber instance runs one Hub. The Hub tracks local connections by topic, and a Redis subscriber goroutine feeds it messages published by *any* instance (including itself).

### 2.1 Hub structure (conceptual)

```go
// internal/ws/hub.go
package ws

import "sync"

type Client struct {
    ID     string
    UserID string
    Topics map[string]bool // e.g. "college:global", "dept:cse", "club:123"
    Send   chan []byte
}

type Hub struct {
    mu       sync.RWMutex
    clients  map[string]*Client            // clientID -> Client
    byTopic  map[string]map[string]*Client // topic -> set of clients
}

func NewHub() *Hub {
    return &Hub{
        clients: make(map[string]*Client),
        byTopic: make(map[string]map[string]*Client),
    }
}

func (h *Hub) Register(c *Client) {
    h.mu.Lock()
    defer h.mu.Unlock()
    h.clients[c.ID] = c
    for topic := range c.Topics {
        if h.byTopic[topic] == nil {
            h.byTopic[topic] = make(map[string]*Client)
        }
        h.byTopic[topic][c.ID] = c
    }
}

func (h *Hub) Unregister(c *Client) {
    h.mu.Lock()
    defer h.mu.Unlock()
    delete(h.clients, c.ID)
    for topic := range c.Topics {
        delete(h.byTopic[topic], c.ID)
    }
    close(c.Send)
}

// BroadcastToTopic delivers to all LOCAL clients subscribed to a topic.
// This is called by the Redis bridge whenever a message arrives —
// including messages published by THIS instance, so publish-once logic
// stays simple (no special-casing "is this my own broadcast").
func (h *Hub) BroadcastToTopic(topic string, message []byte) {
    h.mu.RLock()
    defer h.mu.RUnlock()
    for _, c := range h.byTopic[topic] {
        select {
        case c.Send <- message:
        default:
            // slow client — drop or disconnect, don't block the hub
        }
    }
}
```

### 2.2 Redis Bridge

```go
// internal/ws/redis_bridge.go
package ws

import (
    "context"
    "github.com/redis/go-redis/v9"
)

type RedisBridge struct {
    rdb *redis.Client
    hub *Hub
}

func NewRedisBridge(rdb *redis.Client, hub *Hub) *RedisBridge {
    return &RedisBridge{rdb: rdb, hub: hub}
}

// Listen subscribes to a pattern covering all broadcast topics and
// relays every message to the local hub. Run this once per instance
// at startup as a background goroutine.
func (b *RedisBridge) Listen(ctx context.Context) {
    pubsub := b.rdb.PSubscribe(ctx, "broadcast:*")
    defer pubsub.Close()

    ch := pubsub.Channel()
    for msg := range ch {
        // channel name e.g. "broadcast:college:global" -> topic "college:global"
        topic := msg.Channel[len("broadcast:"):]
        b.hub.BroadcastToTopic(topic, []byte(msg.Payload))
    }
}

// Publish is called by any handler (e.g. announcements.Create) after
// persisting to Postgres — this is the ONLY place that triggers fan-out.
func Publish(ctx context.Context, rdb *redis.Client, topic string, payload []byte) error {
    return rdb.Publish(ctx, "broadcast:"+topic, payload).Err()
}
```

### 2.3 Fiber WebSocket Route

```go
// cmd/server/main.go (relevant excerpt)
app.Use("/ws", func(c *fiber.Ctx) error {
    if websocket.IsWebSocketUpgrade(c) {
        // Auth: validate JWT from query param or header BEFORE upgrade
        userID, role, err := auth.ValidateTokenFromRequest(c)
        if err != nil {
            return fiber.ErrUnauthorized
        }
        c.Locals("userID", userID)
        c.Locals("role", role)
        return c.Next()
    }
    return fiber.ErrUpgradeRequired
})

app.Get("/ws", websocket.New(func(conn *websocket.Conn) {
    userID := conn.Locals("userID").(string)
    topics := ws.ResolveTopicsForUser(userID) // college:global, dept:x, club:y...

    client := &ws.Client{
        ID: uuid.NewString(), UserID: userID,
        Topics: topics, Send: make(chan []byte, 32),
    }
    hub.Register(client)
    defer hub.Unregister(client)

    go client.WritePump(conn)  // drains client.Send -> conn.WriteMessage
    client.ReadPump(conn)      // blocks, handles subscribe/ack messages
}))
```

### 2.4 Publishing an Emergency Alert (Handler)

```go
// internal/emergency/handler.go
func CreateEmergencyAlert(c *fiber.Ctx) error {
    role := c.Locals("role").(string)
    if role != "super_admin" {
        return fiber.ErrForbidden
    }

    var req struct{ Message string `json:"message" validate:"required,max=160"` }
    if err := c.BodyParser(&req); err != nil {
        return fiber.ErrBadRequest
    }

    alert := models.EmergencyAlert{
        Message: req.Message,
        TriggeredBy: c.Locals("userID").(string),
    }
    if err := db.Create(&alert).Error; err != nil {
        return fiber.ErrInternalServerError
    }

    payload, _ := json.Marshal(ws.Envelope{
        Type: "emergency.alert", Topic: "emergency:global",
        Payload: alert, Ts: time.Now(),
    })

    // 1. Instant path: Redis pub/sub -> all connected clients
    if err := ws.Publish(c.Context(), rdb, "emergency:global", payload); err != nil {
        log.Error("redis publish failed", err) // still proceed to FCM fallback
    }

    // 2. Reach path: async FCM push for offline/backgrounded devices
    go notifications.SendEmergencyPush(alert)

    audit.Log(c.Locals("userID").(string), "emergency_alert.create", alert.ID)

    return c.JSON(fiber.Map{"status": "sent", "id": alert.ID})
}
```

---

## 3. Service Layer Breakdown

| Service | Responsibilities |
|---|---|
| **auth** | Signup validation (domain check), OTP generation/verification, JWT issue/refresh, password hashing (bcrypt/argon2) |
| **announcements** | CRUD, audience resolution, publish → Redis + FCM |
| **emergency** | Isolated, extra-guarded publish path (see above); delivery tracking |
| **lostfound** | CRUD, image upload orchestration (pre-signed URL to storage), status transitions |
| **events** | CRUD, RSVP tracking, scheduled reminder jobs (cron/worker) |
| **polls** | CRUD, anonymized vote recording (HMAC token, see TRD §6), live tally aggregation |
| **clubs** | Club CRUD, membership (follow/unfollow), club-admin role assignment |
| **notifications** | FCM token registration, multicast sending, topic messaging |
| **ws** | Hub + Redis bridge (above) |
| **audit** | Write-only audit log service, called by every admin-privileged action |

---

## 4. Scheduled Jobs (Reminders, Cleanup)

For event reminders and OTP cleanup, run a lightweight background worker (a goroutine with a ticker, or a proper job queue like `asynq` backed by Redis once you outgrow a simple ticker):

```go
// A simple ticker-based worker is enough for MVP scale
func StartReminderWorker(ctx context.Context) {
    ticker := time.NewTicker(1 * time.Minute)
    for range ticker.C {
        events := events.FindStartingWithin(ctx, 60*time.Minute)
        for _, e := range events {
            notifications.SendEventReminder(e)
        }
    }
}
```

Recommend migrating to **asynq** (Redis-backed task queue for Go) once you need retries, delayed jobs, or multiple worker types (Phase 2+).

---

## 5. Rate Limiting (Fiber built-in middleware)

```go
app.Use("/api/v1/auth", limiter.New(limiter.Config{
    Max:        5,
    Expiration: 1 * time.Minute,
    KeyGenerator: func(c *fiber.Ctx) string { return c.IP() },
}))

app.Use("/api/v1/polls/:id/vote", limiter.New(limiter.Config{
    Max:        1,
    Expiration: 24 * time.Hour,
    KeyGenerator: func(c *fiber.Ctx) string {
        return c.Locals("userID").(string) + c.Params("id")
    },
}))
```

---

## 6. RBAC Middleware

```go
func RequireRole(roles ...string) fiber.Handler {
    return func(c *fiber.Ctx) error {
        role := c.Locals("role").(string)
        for _, r := range roles {
            if role == r {
                return c.Next()
            }
        }
        return fiber.ErrForbidden
    }
}

// usage:
admin := app.Group("/api/v1/admin", auth.JWTMiddleware)
admin.Post("/announcements", RequireRole("dept_admin", "club_admin", "super_admin"), announcements.Create)
admin.Post("/emergency-alerts", RequireRole("super_admin"), emergency.Create)
```

---

## 7. Docker Compose (Local Dev)

```yaml
version: "3.9"
services:
  api:
    build: .
    ports: ["8080:8080"]
    env_file: .env
    depends_on: [postgres, redis]
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: vitlive
      POSTGRES_PASSWORD: devpass
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
  redis:
    image: redis:7
    ports: ["6379:6379"]
volumes:
  pgdata:
```

---

## 8. Deployment Topology (Production, Budget-Friendly)

```
Internet
   │
   ▼
Nginx (TLS, load balance) — or Railway/Render's built-in LB
   │
   ├──► Fiber instance 1 (Docker container)
   ├──► Fiber instance 2 (Docker container)
   └──► Fiber instance N
              │
              ▼
        Managed Redis (Upstash / Railway Redis)
              │
              ▼
        Managed Postgres (Supabase / Railway / Neon)
```

Start with **1–2 instances** — Go/Fiber handles thousands of WS connections per instance comfortably; only add instances once you exceed a single machine's connection/CPU ceiling (load test to confirm your actual number, don't guess).

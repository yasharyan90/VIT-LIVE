// Package server assembles the whole HTTP/WS application from its parts.
// main() uses it in production; tests use it to run the real API in-process.
package server

import (
	"context"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/websocket/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"vitlive/internal/academics"
	"vitlive/internal/adminops"
	"vitlive/internal/announcements"
	"vitlive/internal/audit"
	"vitlive/internal/auth"
	"vitlive/internal/chat"
	"vitlive/internal/clubs"
	"vitlive/internal/config"
	"vitlive/internal/emergency"
	"vitlive/internal/events"
	"vitlive/internal/lostfound"
	"vitlive/internal/mess"
	"vitlive/internal/notifications"
	"vitlive/internal/payments"
	"vitlive/internal/polls"
	"vitlive/internal/storage"
	"vitlive/internal/tickets"
	"vitlive/internal/ws"
)

type Server struct {
	App *fiber.App
	Hub *ws.Hub
	RDB *redis.Client
	Ann *announcements.Handler
	Ev  *events.Handler
}

// StartWorkers runs the Redis fan-out bridge and background loops (event
// reminders, scheduled announcements) until ctx is cancelled.
func (s *Server) StartWorkers(ctx context.Context) {
	go ws.NewRedisBridge(s.RDB, s.Hub).Listen(ctx)
	go s.Ev.StartReminderWorker(ctx)
	go s.Ann.StartScheduler(ctx)
}

func newStore(cfg *config.Config) (storage.Store, error) {
	if cfg.S3Endpoint != "" && cfg.S3Bucket != "" {
		log.Printf("storage: S3-compatible bucket %s at %s", cfg.S3Bucket, cfg.S3Endpoint)
		return &storage.S3{
			Endpoint:  cfg.S3Endpoint,
			Bucket:    cfg.S3Bucket,
			Region:    cfg.S3Region,
			AccessKey: cfg.S3AccessKey,
			SecretKey: cfg.S3SecretKey,
			PublicURL: cfg.S3PublicURL,
		}, nil
	}
	return storage.NewLocal(cfg.UploadsDir)
}

func New(cfg *config.Config, pool *pgxpool.Pool, rdb *redis.Client) (*Server, error) {
	store, err := newStore(cfg)
	if err != nil {
		return nil, err
	}

	hub := ws.NewHub()
	gateway := &ws.Gateway{Hub: hub, RDB: rdb, DB: pool}

	auditor := &audit.Logger{DB: pool}
	mailer := notifications.NewMailer(cfg)
	fcm := notifications.NewFCM(pool, cfg.FCMServiceAccountJSON)

	authH := &auth.Handler{DB: pool, RDB: rdb, Cfg: cfg, Mailer: mailer, Store: store}
	annH := &announcements.Handler{DB: pool, RDB: rdb, Audit: auditor, FCM: fcm, Store: store}
	emgH := &emergency.Handler{DB: pool, RDB: rdb, Audit: auditor, FCM: fcm, Gateway: gateway}
	lfH := &lostfound.Handler{DB: pool, RDB: rdb, Audit: auditor, Store: store}
	evH := &events.Handler{DB: pool, RDB: rdb, Audit: auditor, FCM: fcm, Store: store}
	pollH := &polls.Handler{DB: pool, RDB: rdb, Audit: auditor, HMACSecret: cfg.VoteHMACSecret}
	clubH := &clubs.Handler{DB: pool, RDB: rdb, Audit: auditor, Store: store}
	opsH := &adminops.Handler{DB: pool, RDB: rdb, Audit: auditor}
	acadH := &academics.Handler{DB: pool, Audit: auditor}
	messH := &mess.Handler{DB: pool, Audit: auditor}
	rzp := payments.New(cfg.RazorpayKeyID, cfg.RazorpayKeySecret)
	if rzp.Enabled() {
		log.Printf("payments: razorpay configured (key %s)", cfg.RazorpayKeyID)
	} else {
		log.Printf("payments: razorpay not configured — mock gateway active")
	}
	tickH := &tickets.Handler{DB: pool, Audit: auditor, RZP: rzp}

	app := fiber.New(fiber.Config{
		BodyLimit:    10 << 20, // uploads up to ~10 MB request size
		ErrorHandler: fiberErrorHandler,
	})
	app.Use(recover.New())
	if cfg.IsDev() {
		app.Use(logger.New())
	}
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowHeaders: "Origin, Content-Type, Accept, Authorization",
		AllowMethods: "GET, POST, PATCH, DELETE, OPTIONS",
	}))

	app.Get("/healthz", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok"})
	})
	if cfg.S3Endpoint == "" {
		app.Static("/uploads", cfg.UploadsDir)
	}

	api := app.Group("/api/v1")

	// Public auth routes with brute-force rate limiting.
	authGroup := api.Group("/auth", limiter.New(limiter.Config{
		Max:        30,
		Expiration: time.Minute,
		KeyGenerator: func(c *fiber.Ctx) string {
			return c.IP()
		},
	}))
	authGroup.Post("/signup", authH.Signup)
	authGroup.Post("/verify-otp", authH.VerifyOTP)
	authGroup.Post("/resend-otp", authH.ResendOTP)
	authGroup.Post("/login", authH.Login)
	authGroup.Post("/refresh", authH.Refresh)
	api.Get("/departments", authH.Departments)

	// Authenticated routes.
	jwtMW := auth.JWTMiddleware(cfg.JWTSecret)
	api.Get("/me", jwtMW, authH.Me)
	api.Patch("/me", jwtMW, authH.UpdateMe)
	api.Post("/me/device-token", jwtMW, authH.RegisterDeviceToken)

	api.Get("/announcements", jwtMW, annH.List)
	api.Post("/announcements/:id/react", jwtMW, annH.React)
	api.Get("/emergency-alerts/active", jwtMW, emgH.Active)
	api.Post("/emergency-alerts/:id/ack", jwtMW, emgH.Ack)

	api.Get("/lostfound", jwtMW, lfH.List)
	api.Post("/lostfound", jwtMW, lfH.Create)
	api.Patch("/lostfound/:id/resolve", jwtMW, lfH.Resolve)
	api.Post("/lostfound/:id/report", jwtMW, lfH.Report)

	api.Get("/events", jwtMW, evH.List)
	api.Get("/events/:id", jwtMW, evH.Get)
	api.Post("/events/:id/rsvp", jwtMW, evH.RSVP)
	api.Post("/events/:id/order", jwtMW, tickH.CreateOrder)
	api.Post("/events/:id/confirm", jwtMW, tickH.Confirm)
	api.Get("/me/tickets", jwtMW, tickH.MyTickets)

	api.Get("/polls", jwtMW, pollH.List)
	api.Get("/polls/:id", jwtMW, pollH.Get)
	api.Post("/polls/:id/vote", jwtMW, pollH.Vote)

	api.Get("/clubs", jwtMW, clubH.List)
	api.Get("/clubs/:id", jwtMW, clubH.Get)
	api.Post("/clubs/:id/follow", jwtMW, clubH.Follow)
	api.Post("/clubs/:id/unfollow", jwtMW, clubH.Unfollow)
	api.Get("/clubs/:id/posts", jwtMW, clubH.ListPosts)
	api.Get("/feed/clubs", jwtMW, clubH.FollowedFeed)
	api.Post("/club-posts/:id/like", jwtMW, clubH.LikePost)
	api.Get("/club-posts/:id/comments", jwtMW, clubH.ListComments)
	api.Post("/club-posts/:id/comments", jwtMW, clubH.CreateComment)
	api.Delete("/club-posts/:id/comments/:commentID", jwtMW, clubH.DeleteComment)

	// Student-to-student chat.
	chatH := &chat.Handler{DB: pool, RDB: rdb}
	api.Get("/chat/search", jwtMW, chatH.Search)
	api.Get("/chat/conversations", jwtMW, chatH.Conversations)
	api.Get("/chat/unread", jwtMW, chatH.Unread)
	api.Get("/chat/with/:userID", jwtMW, chatH.Thread)
	api.Post("/chat/with/:userID", jwtMW, chatH.Send)
	api.Post("/chat/block/:userID", jwtMW, chatH.Block)
	api.Post("/chat/unblock/:userID", jwtMW, chatH.Unblock)

	api.Get("/academic-events", jwtMW, acadH.List)
	api.Get("/mess-menu", jwtMW, messH.Get)
	api.Get("/pulse", jwtMW, opsH.Pulse)

	// Admin routes.
	adminRoles := auth.RequireRole(auth.AdminRoles...)
	superOnly := auth.RequireRole("super_admin")
	moderation := auth.RequireRole("club_admin", "dept_admin", "super_admin", "moderator")

	admin := api.Group("/admin", jwtMW)
	admin.Get("/stats", adminRoles, opsH.Stats)
	admin.Get("/analytics", adminRoles, opsH.Analytics)
	admin.Post("/announcements", adminRoles, annH.Create)
	admin.Get("/announcements", adminRoles, annH.AdminList)
	admin.Post("/emergency-alerts", superOnly, emgH.Create)
	admin.Get("/emergency-alerts", superOnly, emgH.AdminList)
	admin.Post("/events", adminRoles, evH.Create)
	admin.Get("/events", adminRoles, evH.AdminList)
	admin.Post("/polls", adminRoles, pollH.Create)
	admin.Get("/polls", adminRoles, pollH.List)
	admin.Get("/lostfound", moderation, lfH.AdminList)
	admin.Delete("/lostfound/:id", moderation, lfH.AdminRemove)
	admin.Get("/users", superOnly, opsH.ListUsers)
	admin.Patch("/users/:id/role", superOnly, opsH.UpdateRole)
	admin.Post("/clubs", superOnly, clubH.AdminCreate)
	admin.Patch("/clubs/:id/admin", superOnly, clubH.AssignAdmin)
	// Ticket scanning & attendee lists: the event's own club account or a
	// super admin — no other club, no other role.
	clubOrSuper := auth.RequireRole("club_admin", "super_admin")
	admin.Post("/tickets/checkin", clubOrSuper, tickH.Checkin)
	admin.Get("/events/:id/attendees", clubOrSuper, tickH.Attendees)
	admin.Post("/club-posts", clubOrSuper, clubH.CreatePost)
	admin.Get("/club-posts", clubOrSuper, clubH.AdminListPosts)
	admin.Delete("/club-posts/:id", clubOrSuper, clubH.DeletePost)
	admin.Get("/audit-logs", superOnly, auditor.List)
	admin.Post("/academic-events", superOnly, acadH.Create)
	admin.Delete("/academic-events/:id", superOnly, acadH.Delete)
	admin.Post("/mess-menu", adminRoles, messH.Upsert)

	// WebSocket endpoint: JWT validated BEFORE the upgrade.
	app.Use("/ws", func(c *fiber.Ctx) error {
		if !websocket.IsWebSocketUpgrade(c) {
			return fiber.ErrUpgradeRequired
		}
		token := c.Query("token")
		claims, err := auth.ParseAccessToken(cfg.JWTSecret, token)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid token"})
		}
		c.Locals("userID", claims.UserID)
		c.Locals("role", claims.Role)
		return c.Next()
	})
	app.Get("/ws", websocket.New(func(conn *websocket.Conn) {
		userID := conn.Locals("userID").(string)
		role := conn.Locals("role").(string)
		client := &ws.Client{
			ID:     uuid.NewString(),
			UserID: userID,
			Role:   role,
			Topics: gateway.ResolveTopicsForUser(context.Background(), userID, role),
			Send:   make(chan []byte, 64),
		}
		gateway.Serve(conn, client)
	}))

	return &Server{App: app, Hub: hub, RDB: rdb, Ann: annH, Ev: evH}, nil
}

func fiberErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	msg := "internal error"
	if e, ok := err.(*fiber.Error); ok {
		code, msg = e.Code, e.Message
	}
	return c.Status(code).JSON(fiber.Map{"error": msg})
}

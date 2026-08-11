package emergency

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"vitlive/internal/audit"
	"vitlive/internal/models"
	"vitlive/internal/notifications"
	"vitlive/internal/ws"
)

// Handler is the isolated, extra-guarded emergency alert path.
type Handler struct {
	DB      *pgxpool.Pool
	RDB     *redis.Client
	Audit   *audit.Logger
	FCM     *notifications.FCM
	Gateway *ws.Gateway
}

func errJSON(c *fiber.Ctx, status int, msg string) error {
	return c.Status(status).JSON(fiber.Map{"error": msg})
}

// POST /api/v1/admin/emergency-alerts  (super_admin only, route-gated)
func (h *Handler) Create(c *fiber.Ctx) error {
	var req struct {
		Message string `json:"message"`
		Confirm string `json:"confirm"`
	}
	if err := c.BodyParser(&req); err != nil {
		return errJSON(c, 400, "invalid request body")
	}
	req.Message = strings.TrimSpace(req.Message)
	if req.Message == "" || len(req.Message) > 160 {
		return errJSON(c, 400, "message is required and must be at most 160 characters")
	}
	if req.Confirm != "CONFIRM" {
		return errJSON(c, 400, `you must type CONFIRM to send an emergency alert`)
	}

	userID := c.Locals("userID").(string)
	ctx := c.Context()

	var totalTarget int
	h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE is_verified`).Scan(&totalTarget)

	var alert models.EmergencyAlert
	alert.Message = req.Message
	alert.TotalTarget = totalTarget
	err := h.DB.QueryRow(ctx,
		`INSERT INTO emergency_alerts(message, triggered_by, total_target)
		 VALUES($1,$2,$3) RETURNING id::text, created_at`,
		req.Message, userID, totalTarget).Scan(&alert.ID, &alert.CreatedAt)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	h.DB.QueryRow(ctx, `SELECT full_name FROM users WHERE id=$1`, userID).Scan(&alert.TriggeredByName)

	h.RDB.Set(ctx, "target:emergency:"+alert.ID, totalTarget, 7*24*time.Hour)

	// 1. Instant path: Redis pub/sub -> every connected client, every instance.
	ws.Publish(ctx, h.RDB, "emergency:global", ws.NewEnvelope("emergency.alert", "emergency:global", alert))

	// 2. Reach path: async FCM push for offline/backgrounded devices.
	go h.FCM.Send("🚨 EMERGENCY ALERT", alert.Message,
		map[string]string{"type": "emergency", "id": alert.ID}, nil)

	h.Audit.Log(ctx, userID, "emergency_alert.create", alert.ID,
		map[string]any{"message": alert.Message, "total_target": totalTarget})
	return c.Status(201).JSON(fiber.Map{"alert": alert})
}

func (h *Handler) loadAlert(c *fiber.Ctx, id string) (*models.EmergencyAlert, error) {
	var a models.EmergencyAlert
	err := h.DB.QueryRow(c.Context(),
		`SELECT e.id::text, e.message, COALESCE(u.full_name,''), e.delivered_count, e.total_target, e.created_at
		 FROM emergency_alerts e LEFT JOIN users u ON u.id=e.triggered_by WHERE e.id=$1`, id).
		Scan(&a.ID, &a.Message, &a.TriggeredByName, &a.DeliveredCount, &a.TotalTarget, &a.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// GET /api/v1/emergency-alerts/active — latest alert < 60 min old not yet acked by me.
func (h *Handler) Active(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	ctx := c.Context()
	var id string
	err := h.DB.QueryRow(ctx,
		`SELECT id::text FROM emergency_alerts WHERE created_at > now() - interval '60 minutes'
		 ORDER BY created_at DESC LIMIT 1`).Scan(&id)
	if err != nil {
		return c.JSON(fiber.Map{"alert": nil})
	}
	acked, _ := h.RDB.SIsMember(ctx, "delivered:emergency:"+id, userID).Result()
	if acked {
		return c.JSON(fiber.Map{"alert": nil})
	}
	alert, err := h.loadAlert(c, id)
	if err != nil {
		return c.JSON(fiber.Map{"alert": nil})
	}
	return c.JSON(fiber.Map{"alert": alert})
}

// POST /api/v1/emergency-alerts/:id/ack
func (h *Handler) Ack(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	id := c.Params("id")
	h.Gateway.RecordAck(c.Context(), userID, "emergency", id)
	delivered, _ := h.RDB.SCard(c.Context(), "delivered:emergency:"+id).Result()
	return c.JSON(fiber.Map{"delivered_count": delivered})
}

// GET /api/v1/admin/emergency-alerts
func (h *Handler) AdminList(c *fiber.Ctx) error {
	ctx := c.Context()
	rows, err := h.DB.Query(ctx,
		`SELECT e.id::text, e.message, COALESCE(u.full_name,''), e.delivered_count, e.total_target, e.created_at
		 FROM emergency_alerts e LEFT JOIN users u ON u.id=e.triggered_by
		 ORDER BY e.created_at DESC LIMIT 50`)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	defer rows.Close()
	items := []models.EmergencyAlert{}
	for rows.Next() {
		var a models.EmergencyAlert
		if rows.Scan(&a.ID, &a.Message, &a.TriggeredByName, &a.DeliveredCount, &a.TotalTarget, &a.CreatedAt) == nil {
			// Redis has the freshest count (DB row lags by design).
			if n, err := h.RDB.SCard(ctx, "delivered:emergency:"+a.ID).Result(); err == nil && int(n) > a.DeliveredCount {
				a.DeliveredCount = int(n)
			}
			items = append(items, a)
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

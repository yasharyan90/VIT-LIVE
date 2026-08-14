// Package chat: student-to-student direct messages. Find anyone by email,
// message them live (WS `chat.message` on both users' personal topics),
// block anyone at any time.
package chat

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"vitlive/internal/ws"
)

type Handler struct {
	DB  *pgxpool.Pool
	RDB *redis.Client
}

func errJSON(c *fiber.Ctx, status int, msg string) error {
	return c.Status(status).JSON(fiber.Map{"error": msg})
}

type Message struct {
	ID          string     `json:"id"`
	SenderID    string     `json:"sender_id"`
	RecipientID string     `json:"recipient_id"`
	Body        string     `json:"body"`
	CreatedAt   time.Time  `json:"created_at"`
	ReadAt      *time.Time `json:"read_at"`
	SenderName  string     `json:"sender_name,omitempty"`
}

// GET /api/v1/chat/search?q= — find people by email or name.
func (h *Handler) Search(c *fiber.Ctx) error {
	q := strings.TrimSpace(c.Query("q"))
	if len(q) < 2 {
		return c.JSON(fiber.Map{"items": []any{}})
	}
	userID := c.Locals("userID").(string)
	rows, err := h.DB.Query(c.Context(),
		`SELECT id::text, full_name, college_email, avatar_url, bio
		 FROM users
		 WHERE is_verified AND id <> $1
		   AND (college_email ILIKE $2 OR full_name ILIKE $2)
		 ORDER BY college_email LIMIT 10`, userID, "%"+q+"%")
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	defer rows.Close()
	type person struct {
		ID           string  `json:"id"`
		FullName     string  `json:"full_name"`
		CollegeEmail string  `json:"college_email"`
		AvatarURL    *string `json:"avatar_url"`
		Bio          string  `json:"bio"`
	}
	items := []person{}
	for rows.Next() {
		var p person
		if rows.Scan(&p.ID, &p.FullName, &p.CollegeEmail, &p.AvatarURL, &p.Bio) == nil {
			items = append(items, p)
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

// GET /api/v1/chat/conversations — everyone you've chatted with: last
// message, unread count, block state. Newest conversation first.
func (h *Handler) Conversations(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	rows, err := h.DB.Query(c.Context(),
		`SELECT p.partner_id::text, u.full_name, u.college_email, u.avatar_url,
		        p.body, p.created_at, (p.sender_id = $1),
		        (SELECT COUNT(*) FROM chat_messages m2
		          WHERE m2.sender_id = p.partner_id AND m2.recipient_id = $1 AND m2.read_at IS NULL),
		        EXISTS(SELECT 1 FROM chat_blocks b WHERE b.blocker_id=$1 AND b.blocked_id=p.partner_id)
		 FROM (
		   SELECT DISTINCT ON (partner_id) partner_id, body, created_at, sender_id
		   FROM (
		     SELECT CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS partner_id,
		            body, created_at, sender_id
		     FROM chat_messages WHERE sender_id = $1 OR recipient_id = $1
		   ) all_msgs
		   ORDER BY partner_id, created_at DESC
		 ) p
		 JOIN users u ON u.id = p.partner_id
		 ORDER BY p.created_at DESC LIMIT 100`, userID)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	defer rows.Close()
	type convo struct {
		PartnerID    string    `json:"partner_id"`
		FullName     string    `json:"full_name"`
		CollegeEmail string    `json:"college_email"`
		AvatarURL    *string   `json:"avatar_url"`
		LastBody     string    `json:"last_body"`
		LastAt       time.Time `json:"last_at"`
		LastFromMe   bool      `json:"last_from_me"`
		Unread       int       `json:"unread"`
		IBlocked     bool      `json:"i_blocked"`
	}
	items := []convo{}
	for rows.Next() {
		var v convo
		if rows.Scan(&v.PartnerID, &v.FullName, &v.CollegeEmail, &v.AvatarURL,
			&v.LastBody, &v.LastAt, &v.LastFromMe, &v.Unread, &v.IBlocked) == nil {
			items = append(items, v)
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

// GET /api/v1/chat/unread — total unread messages (nav badge).
func (h *Handler) Unread(c *fiber.Ctx) error {
	var n int
	h.DB.QueryRow(c.Context(),
		`SELECT COUNT(*) FROM chat_messages WHERE recipient_id=$1 AND read_at IS NULL`,
		c.Locals("userID").(string)).Scan(&n)
	return c.JSON(fiber.Map{"count": n})
}

// GET /api/v1/chat/with/:userID — the thread with one person (oldest→newest,
// last 100). Marks their messages to you as read.
func (h *Handler) Thread(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	partnerID := c.Params("userID")
	ctx := c.Context()

	var partnerName, partnerEmail string
	var partnerAvatar *string
	if err := h.DB.QueryRow(ctx,
		`SELECT full_name, college_email, avatar_url FROM users WHERE id=$1 AND is_verified`,
		partnerID).Scan(&partnerName, &partnerEmail, &partnerAvatar); err != nil {
		return errJSON(c, 404, "user not found")
	}

	h.DB.Exec(ctx,
		`UPDATE chat_messages SET read_at=now()
		 WHERE sender_id=$1 AND recipient_id=$2 AND read_at IS NULL`, partnerID, userID)

	rows, err := h.DB.Query(ctx,
		`SELECT id::text, sender_id::text, recipient_id::text, body, created_at, read_at
		 FROM (
		   SELECT * FROM chat_messages
		   WHERE (sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1)
		   ORDER BY created_at DESC LIMIT 100
		 ) m ORDER BY created_at ASC`, userID, partnerID)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	defer rows.Close()
	items := []Message{}
	for rows.Next() {
		var m Message
		if rows.Scan(&m.ID, &m.SenderID, &m.RecipientID, &m.Body, &m.CreatedAt, &m.ReadAt) == nil {
			items = append(items, m)
		}
	}

	var iBlocked bool
	h.DB.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM chat_blocks WHERE blocker_id=$1 AND blocked_id=$2)`,
		userID, partnerID).Scan(&iBlocked)

	return c.JSON(fiber.Map{
		"partner": fiber.Map{
			"id": partnerID, "full_name": partnerName,
			"college_email": partnerEmail, "avatar_url": partnerAvatar,
		},
		"i_blocked": iBlocked,
		"items":     items,
	})
}

// POST /api/v1/chat/with/:userID {"body": "..."} — send a message.
func (h *Handler) Send(c *fiber.Ctx) error {
	var req struct {
		Body string `json:"body"`
	}
	if err := c.BodyParser(&req); err != nil {
		return errJSON(c, 400, "invalid request body")
	}
	req.Body = strings.TrimSpace(req.Body)
	if req.Body == "" {
		return errJSON(c, 400, "message is empty")
	}
	if len(req.Body) > 2000 {
		return errJSON(c, 400, "message too long (max 2000 characters)")
	}
	userID := c.Locals("userID").(string)
	partnerID := c.Params("userID")
	if partnerID == userID {
		return errJSON(c, 400, "that's you")
	}
	ctx := c.Context()

	var exists bool
	if err := h.DB.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND is_verified)`, partnerID).
		Scan(&exists); err != nil || !exists {
		return errJSON(c, 404, "user not found")
	}
	var iBlocked, blockedMe bool
	h.DB.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM chat_blocks WHERE blocker_id=$1 AND blocked_id=$2),
		        EXISTS(SELECT 1 FROM chat_blocks WHERE blocker_id=$2 AND blocked_id=$1)`,
		userID, partnerID).Scan(&iBlocked, &blockedMe)
	if iBlocked {
		return errJSON(c, 400, "you blocked this user — unblock to message them")
	}
	if blockedMe {
		return errJSON(c, 403, "you can't message this user")
	}

	var m Message
	m.SenderID, m.RecipientID, m.Body = userID, partnerID, req.Body
	if err := h.DB.QueryRow(ctx,
		`INSERT INTO chat_messages(sender_id, recipient_id, body)
		 VALUES($1,$2,$3) RETURNING id::text, created_at`,
		userID, partnerID, req.Body).Scan(&m.ID, &m.CreatedAt); err != nil {
		return errJSON(c, 500, "internal error")
	}
	h.DB.QueryRow(ctx, `SELECT full_name FROM users WHERE id=$1`, userID).Scan(&m.SenderName)

	// Deliver live to both sides (recipient's devices + sender's other tabs).
	for _, uid := range []string{partnerID, userID} {
		topic := "user:" + uid
		ws.Publish(ctx, h.RDB, topic, ws.NewEnvelope("chat.message", topic, m))
	}
	return c.Status(201).JSON(fiber.Map{"message": m})
}

// POST /api/v1/chat/block/:userID and /chat/unblock/:userID
func (h *Handler) Block(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	partnerID := c.Params("userID")
	if partnerID == userID {
		return errJSON(c, 400, "you can't block yourself")
	}
	if _, err := h.DB.Exec(c.Context(),
		`INSERT INTO chat_blocks(blocker_id, blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
		userID, partnerID); err != nil {
		return errJSON(c, 404, "user not found")
	}
	return c.JSON(fiber.Map{"blocked": true})
}

func (h *Handler) Unblock(c *fiber.Ctx) error {
	if _, err := h.DB.Exec(c.Context(),
		`DELETE FROM chat_blocks WHERE blocker_id=$1 AND blocked_id=$2`,
		c.Locals("userID").(string), c.Params("userID")); err != nil {
		return errJSON(c, 500, "internal error")
	}
	return c.JSON(fiber.Map{"blocked": false})
}

package announcements

import (
	"context"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"vitlive/internal/audit"
	"vitlive/internal/models"
	"vitlive/internal/notifications"
	"vitlive/internal/storage"
	"vitlive/internal/ws"
)

type Handler struct {
	DB    *pgxpool.Pool
	RDB   *redis.Client
	Audit *audit.Logger
	FCM   *notifications.FCM
	Store storage.Store
}

func errJSON(c *fiber.Ctx, status int, msg string) error {
	return c.Status(status).JSON(fiber.Map{"error": msg})
}

func topicFor(audienceType string, ref *string) string {
	switch audienceType {
	case "department":
		return "dept:" + *ref
	case "club":
		return "club:" + *ref
	case "year":
		return "year:" + *ref
	default:
		return "college:global"
	}
}

// targetUserIDs returns the user ids an audience resolves to (verified users only).
func (h *Handler) targetUserIDs(ctx context.Context, audienceType string, ref *string) []string {
	var (
		q    string
		args []any
	)
	switch audienceType {
	case "department":
		q, args = `SELECT id::text FROM users WHERE is_verified AND department_id=$1`, []any{*ref}
	case "year":
		q, args = `SELECT id::text FROM users WHERE is_verified AND year_of_study=$1::int`, []any{*ref}
	case "club":
		q, args = `SELECT u.id::text FROM users u JOIN club_members m ON m.user_id=u.id WHERE u.is_verified AND m.club_id=$1`, []any{*ref}
	default:
		q = `SELECT id::text FROM users WHERE is_verified`
	}
	rows, err := h.DB.Query(ctx, q, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	return ids
}

// broadcast fans a just-published announcement out: delivery target counter,
// WS envelope on its audience topic, FCM push.
func (h *Handler) broadcast(ctx context.Context, a models.Announcement) {
	targets := h.targetUserIDs(ctx, a.AudienceType, a.AudienceRef)
	h.RDB.Set(ctx, "target:announcement:"+a.ID, len(targets), 7*24*time.Hour)
	topic := topicFor(a.AudienceType, a.AudienceRef)
	ws.Publish(ctx, h.RDB, topic, ws.NewEnvelope("announcement.new", topic, a))
	go h.FCM.Send(a.Title, a.Body, map[string]string{"type": "announcement", "id": a.ID}, targets)
}

// POST /api/v1/admin/announcements — JSON or multipart (with optional image).
func (h *Handler) Create(c *fiber.Ctx) error {
	var req struct {
		Title        string  `json:"title"`
		Body         string  `json:"body"`
		Priority     string  `json:"priority"`
		AudienceType string  `json:"audience_type"`
		AudienceRef  *string `json:"audience_ref"`
		PublishAt    string  `json:"publish_at"`
	}
	var imageURL *string
	if strings.HasPrefix(c.Get("Content-Type"), "multipart/form-data") {
		req.Title, req.Body = c.FormValue("title"), c.FormValue("body")
		req.Priority, req.AudienceType = c.FormValue("priority"), c.FormValue("audience_type")
		if v := c.FormValue("audience_ref"); v != "" {
			req.AudienceRef = &v
		}
		req.PublishAt = c.FormValue("publish_at")
		if file, err := c.FormFile("image"); err == nil && file != nil {
			url, err := storage.SaveImage(c.Context(), h.Store, file)
			if err != nil {
				if fe, ok := err.(*fiber.Error); ok {
					return errJSON(c, fe.Code, fe.Message)
				}
				return errJSON(c, 500, "could not store image")
			}
			imageURL = &url
		}
	} else if err := c.BodyParser(&req); err != nil {
		return errJSON(c, 400, "invalid request body")
	}

	req.Title, req.Body = strings.TrimSpace(req.Title), strings.TrimSpace(req.Body)
	if req.Title == "" || req.Body == "" {
		return errJSON(c, 400, "title and body are required")
	}
	if req.Priority != "high" {
		req.Priority = "normal"
	}
	switch req.AudienceType {
	case "department", "club", "year":
		if req.AudienceRef == nil || *req.AudienceRef == "" {
			return errJSON(c, 400, "audience_ref is required for this audience type")
		}
	default:
		req.AudienceType, req.AudienceRef = "all", nil
	}

	publishAt := time.Now().UTC()
	scheduled := false
	if req.PublishAt != "" {
		t, err := time.Parse(time.RFC3339, req.PublishAt)
		if err != nil {
			return errJSON(c, 400, "publish_at must be RFC3339")
		}
		if t.After(time.Now().Add(30 * time.Second)) {
			publishAt, scheduled = t.UTC(), true
		}
	}

	userID := c.Locals("userID").(string)
	ctx := c.Context()

	var a models.Announcement
	a.Title, a.Body, a.Priority, a.ImageURL = req.Title, req.Body, req.Priority, imageURL
	a.AudienceType, a.AudienceRef = req.AudienceType, req.AudienceRef
	a.PublishAt, a.Scheduled = publishAt, scheduled
	var broadcastAt *time.Time
	if !scheduled {
		broadcastAt = &publishAt
	}
	err := h.DB.QueryRow(ctx,
		`INSERT INTO announcements(title, body, priority, image_url, audience_type, audience_ref, created_by, publish_at, broadcast_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id::text, created_at`,
		req.Title, req.Body, req.Priority, imageURL, req.AudienceType, req.AudienceRef, userID, publishAt, broadcastAt).
		Scan(&a.ID, &a.CreatedAt)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	h.DB.QueryRow(ctx, `SELECT full_name FROM users WHERE id=$1`, userID).Scan(&a.AuthorName)

	action := "announcement.create"
	if scheduled {
		action = "announcement.schedule"
	} else {
		h.broadcast(ctx, a)
	}
	h.Audit.Log(ctx, userID, action, a.ID,
		map[string]any{"title": a.Title, "audience": a.AudienceType, "priority": a.Priority})
	return c.Status(201).JSON(fiber.Map{"announcement": a})
}

// StartScheduler publishes scheduled announcements when their time comes.
// Run as a background goroutine.
func (h *Handler) StartScheduler(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.publishDue(ctx)
		}
	}
}

func (h *Handler) publishDue(ctx context.Context) {
	// created_at is bumped to the go-live moment so feed ordering and
	// since/before reconciliation stay correct.
	rows, err := h.DB.Query(ctx,
		`UPDATE announcements SET broadcast_at=now(), created_at=now()
		 WHERE broadcast_at IS NULL AND publish_at <= now()
		 RETURNING id::text, title, body, priority, image_url, audience_type, audience_ref, created_by::text, created_at, publish_at`)
	if err != nil {
		log.Printf("announcement scheduler: %v", err)
		return
	}
	type duePost struct {
		a       models.Announcement
		creator string
	}
	var due []duePost
	for rows.Next() {
		var d duePost
		if rows.Scan(&d.a.ID, &d.a.Title, &d.a.Body, &d.a.Priority, &d.a.ImageURL,
			&d.a.AudienceType, &d.a.AudienceRef, &d.creator, &d.a.CreatedAt, &d.a.PublishAt) == nil {
			due = append(due, d)
		}
	}
	rows.Close()
	for _, d := range due {
		h.DB.QueryRow(ctx, `SELECT full_name FROM users WHERE id=$1`, d.creator).Scan(&d.a.AuthorName)
		h.broadcast(ctx, d.a)
		log.Printf("scheduled announcement published: %s (%s)", d.a.Title, d.a.ID)
	}
}

// POST /api/v1/announcements/:id/react — toggle the calling user's 👍.
func (h *Handler) React(c *fiber.Ctx) error {
	id := c.Params("id")
	userID := c.Locals("userID").(string)
	ctx := c.Context()

	var audienceType string
	var audienceRef *string
	if err := h.DB.QueryRow(ctx,
		`SELECT audience_type, audience_ref FROM announcements WHERE id=$1 AND broadcast_at IS NOT NULL`, id).
		Scan(&audienceType, &audienceRef); err != nil {
		return errJSON(c, 404, "announcement not found")
	}

	ct, err := h.DB.Exec(ctx,
		`INSERT INTO announcement_reactions(announcement_id, user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
		id, userID)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	myReaction := ct.RowsAffected() == 1
	if !myReaction { // already reacted -> toggle off
		if _, err := h.DB.Exec(ctx,
			`DELETE FROM announcement_reactions WHERE announcement_id=$1 AND user_id=$2`, id, userID); err != nil {
			return errJSON(c, 500, "internal error")
		}
	}
	var count int
	h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM announcement_reactions WHERE announcement_id=$1`, id).Scan(&count)

	topic := topicFor(audienceType, audienceRef)
	ws.Publish(ctx, h.RDB, topic, ws.NewEnvelope("announcement.reaction", topic,
		fiber.Map{"id": id, "reaction_count": count}))
	return c.JSON(fiber.Map{"reaction_count": count, "my_reaction": myReaction})
}

const selectCols = `a.id::text, a.title, a.body, a.priority, a.image_url, a.audience_type, a.audience_ref,
	COALESCE(u.full_name,''), a.created_at, a.publish_at, (a.broadcast_at IS NULL),
	(SELECT COUNT(*) FROM announcement_reactions r WHERE r.announcement_id=a.id),
	EXISTS(SELECT 1 FROM announcement_reactions r WHERE r.announcement_id=a.id AND r.user_id=$1)`

func scanAnnouncements(rows interface {
	Next() bool
	Scan(...any) error
	Close()
}) []models.Announcement {
	items := []models.Announcement{}
	for rows.Next() {
		var a models.Announcement
		if rows.Scan(&a.ID, &a.Title, &a.Body, &a.Priority, &a.ImageURL, &a.AudienceType, &a.AudienceRef,
			&a.AuthorName, &a.CreatedAt, &a.PublishAt, &a.Scheduled, &a.ReactionCount, &a.MyReaction) == nil {
			items = append(items, a)
		}
	}
	return items
}

// GET /api/v1/announcements — the student feed, filtered to what this user should see.
func (h *Handler) List(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	ctx := c.Context()
	limit := c.QueryInt("limit", 20)
	if limit < 1 || limit > 100 {
		limit = 20
	}

	var deptID *string
	var year *int
	h.DB.QueryRow(ctx, `SELECT department_id::text, year_of_study FROM users WHERE id=$1`, userID).Scan(&deptID, &year)

	q := `SELECT ` + selectCols + `
	      FROM announcements a JOIN users u ON u.id=a.created_by
	      WHERE a.broadcast_at IS NOT NULL
	       AND (a.audience_type='all'
	         OR (a.audience_type='department' AND a.audience_ref=$2)
	         OR (a.audience_type='year' AND a.audience_ref=$3)
	         OR (a.audience_type='club' AND a.audience_ref IN
	              (SELECT club_id::text FROM club_members WHERE user_id=$1)))`
	deptRef, yearRef := "", ""
	if deptID != nil {
		deptRef = *deptID
	}
	if year != nil {
		yearRef = strconv.Itoa(*year)
	}
	args := []any{userID, deptRef, yearRef}

	if before := c.Query("before"); before != "" {
		if t, err := time.Parse(time.RFC3339, before); err == nil {
			args = append(args, t)
			q += " AND a.created_at < $" + strconv.Itoa(len(args))
		}
	}
	if since := c.Query("since"); since != "" {
		if t, err := time.Parse(time.RFC3339, since); err == nil {
			args = append(args, t)
			q += " AND a.created_at > $" + strconv.Itoa(len(args))
		}
	}
	if search := strings.TrimSpace(c.Query("q")); search != "" {
		args = append(args, "%"+search+"%")
		n := strconv.Itoa(len(args))
		q += " AND (a.title ILIKE $" + n + " OR a.body ILIKE $" + n + ")"
	}
	args = append(args, limit+1)
	q += " ORDER BY a.created_at DESC LIMIT $" + strconv.Itoa(len(args))

	rows, err := h.DB.Query(ctx, q, args...)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	items := scanAnnouncements(rows)
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	return c.JSON(fiber.Map{"items": items, "has_more": hasMore})
}

// GET /api/v1/admin/announcements — everything (including scheduled), with delivery counts.
func (h *Handler) AdminList(c *fiber.Ctx) error {
	ctx := c.Context()
	userID := c.Locals("userID").(string)
	rows, err := h.DB.Query(ctx,
		`SELECT `+selectCols+`
		 FROM announcements a JOIN users u ON u.id=a.created_by
		 ORDER BY (a.broadcast_at IS NULL) DESC, a.created_at DESC LIMIT 100`, userID)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	items := scanAnnouncements(rows)
	for i := range items {
		n, _ := h.RDB.SCard(ctx, "delivered:announcement:"+items[i].ID).Result()
		items[i].DeliveredCount = int(n)
	}
	return c.JSON(fiber.Map{"items": items})
}

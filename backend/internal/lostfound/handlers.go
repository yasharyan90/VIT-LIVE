package lostfound

import (
	"context"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"vitlive/internal/audit"
	"vitlive/internal/models"
	"vitlive/internal/storage"
	"vitlive/internal/ws"
)

type Handler struct {
	DB    *pgxpool.Pool
	RDB   *redis.Client
	Audit *audit.Logger
	Store storage.Store
}

func errJSON(c *fiber.Ctx, status int, msg string) error {
	return c.Status(status).JSON(fiber.Map{"error": msg})
}

// POST /api/v1/lostfound (multipart form)
func (h *Handler) Create(c *fiber.Ctx) error {
	itemType := c.FormValue("type")
	if itemType != "lost" && itemType != "found" {
		return errJSON(c, 400, `type must be "lost" or "found"`)
	}
	title := strings.TrimSpace(c.FormValue("title"))
	if title == "" {
		return errJSON(c, 400, "title is required")
	}
	description := strings.TrimSpace(c.FormValue("description"))
	location := strings.TrimSpace(c.FormValue("location"))

	var imageURL *string
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

	userID := c.Locals("userID").(string)
	ctx := c.Context()
	var item models.LostFoundItem
	item.Type, item.Title, item.Description, item.Location = itemType, title, description, location
	item.ImageURL, item.PostedBy, item.Status = imageURL, userID, "open"
	err := h.DB.QueryRow(ctx,
		`INSERT INTO lost_found_items(type, title, description, image_url, location, posted_by)
		 VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text, created_at`,
		itemType, title, description, imageURL, location, userID).Scan(&item.ID, &item.CreatedAt)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	h.DB.QueryRow(ctx, `SELECT full_name, college_email FROM users WHERE id=$1`, userID).
		Scan(&item.PosterName, &item.PosterEmail)

	ws.Publish(ctx, h.RDB, "college:global", ws.NewEnvelope("lostfound.new", "college:global", item))
	go h.notifyMatches(context.Background(), item)
	return c.Status(201).JSON(fiber.Map{"item": item})
}

var wordRe = regexp.MustCompile(`[a-zA-Z0-9]{3,}`)

// notifyMatches full-text matches the new post against open posts of the
// opposite type and pings each matched poster on their personal topic.
func (h *Handler) notifyMatches(ctx context.Context, item models.LostFoundItem) {
	words := wordRe.FindAllString(strings.ToLower(item.Title+" "+item.Description), 8)
	if len(words) == 0 {
		return
	}
	opposite := "found"
	if item.Type == "found" {
		opposite = "lost"
	}
	rows, err := h.DB.Query(ctx,
		`SELECT DISTINCT posted_by::text FROM lost_found_items
		 WHERE type=$1 AND status='open' AND posted_by <> $2
		   AND to_tsvector('simple', title || ' ' || description) @@ to_tsquery('simple', $3)`,
		opposite, item.PostedBy, strings.Join(words, " | "))
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var uid string
		if rows.Scan(&uid) != nil {
			continue
		}
		topic := "user:" + uid
		ws.Publish(ctx, h.RDB, topic, ws.NewEnvelope("lostfound.match", topic, item))
	}
}

// POST /api/v1/lostfound/:id/report {"reason": "..."}
func (h *Handler) Report(c *fiber.Ctx) error {
	var req struct {
		Reason string `json:"reason"`
	}
	c.BodyParser(&req) // reason is optional
	id := c.Params("id")
	userID := c.Locals("userID").(string)
	ctx := c.Context()

	var exists bool
	if err := h.DB.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM lost_found_items WHERE id=$1 AND status <> 'removed')`, id).
		Scan(&exists); err != nil || !exists {
		return errJSON(c, 404, "item not found")
	}
	if _, err := h.DB.Exec(ctx,
		`INSERT INTO lostfound_reports(item_id, user_id, reason) VALUES($1,$2,$3)
		 ON CONFLICT (item_id, user_id) DO UPDATE SET reason=EXCLUDED.reason`,
		id, userID, strings.TrimSpace(req.Reason)); err != nil {
		return errJSON(c, 500, "internal error")
	}
	return c.JSON(fiber.Map{"message": "reported — a moderator will take a look"})
}

func (h *Handler) queryItems(c *fiber.Ctx, includeRemoved bool) error {
	q := `SELECT i.id::text, i.type, i.title, i.description, i.image_url, i.location, i.status,
	             i.posted_by::text, COALESCE(u.full_name,''), COALESCE(u.college_email,''), i.created_at,
	             (SELECT COUNT(*) FROM lostfound_reports r WHERE r.item_id=i.id)
	      FROM lost_found_items i JOIN users u ON u.id=i.posted_by WHERE 1=1`
	var args []any
	arg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	if !includeRemoved {
		q += " AND i.status <> 'removed'"
	}
	if t := c.Query("type"); t == "lost" || t == "found" {
		q += " AND i.type = " + arg(t)
	}
	if s := c.Query("status"); s == "open" || s == "resolved" {
		q += " AND i.status = " + arg(s)
	}
	if includeRemoved && c.Query("reported") == "true" {
		q += " AND EXISTS(SELECT 1 FROM lostfound_reports r WHERE r.item_id=i.id)"
	}
	if search := strings.TrimSpace(c.Query("q")); search != "" {
		p := arg("%" + search + "%")
		q += " AND (i.title ILIKE " + p + " OR i.description ILIKE " + p + " OR i.location ILIKE " + p + ")"
	}
	q += " ORDER BY i.created_at DESC LIMIT 100"

	rows, err := h.DB.Query(c.Context(), q, args...)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	defer rows.Close()
	items := []models.LostFoundItem{}
	for rows.Next() {
		var i models.LostFoundItem
		if rows.Scan(&i.ID, &i.Type, &i.Title, &i.Description, &i.ImageURL, &i.Location, &i.Status,
			&i.PostedBy, &i.PosterName, &i.PosterEmail, &i.CreatedAt, &i.ReportCount) == nil {
			items = append(items, i)
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

// GET /api/v1/lostfound
func (h *Handler) List(c *fiber.Ctx) error { return h.queryItems(c, false) }

// GET /api/v1/admin/lostfound
func (h *Handler) AdminList(c *fiber.Ctx) error { return h.queryItems(c, true) }

// PATCH /api/v1/lostfound/:id/resolve — poster or any admin/moderator.
func (h *Handler) Resolve(c *fiber.Ctx) error {
	id := c.Params("id")
	userID := c.Locals("userID").(string)
	role := c.Locals("role").(string)
	ctx := c.Context()

	var postedBy string
	if err := h.DB.QueryRow(ctx, `SELECT posted_by::text FROM lost_found_items WHERE id=$1`, id).Scan(&postedBy); err != nil {
		return errJSON(c, 404, "item not found")
	}
	if postedBy != userID && role == "student" {
		return errJSON(c, 403, "only the poster can resolve this item")
	}
	if _, err := h.DB.Exec(ctx, `UPDATE lost_found_items SET status='resolved' WHERE id=$1`, id); err != nil {
		return errJSON(c, 500, "internal error")
	}
	// Personal notification to the poster ("your item was marked resolved").
	ws.Publish(ctx, h.RDB, "user:"+postedBy, ws.NewEnvelope("lostfound.resolved", "user:"+postedBy,
		fiber.Map{"id": id}))
	var item models.LostFoundItem
	err := h.DB.QueryRow(ctx,
		`SELECT i.id::text, i.type, i.title, i.description, i.image_url, i.location, i.status,
		        i.posted_by::text, COALESCE(u.full_name,''), COALESCE(u.college_email,''), i.created_at
		 FROM lost_found_items i JOIN users u ON u.id=i.posted_by WHERE i.id=$1`, id).
		Scan(&item.ID, &item.Type, &item.Title, &item.Description, &item.ImageURL, &item.Location,
			&item.Status, &item.PostedBy, &item.PosterName, &item.PosterEmail, &item.CreatedAt)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	return c.JSON(fiber.Map{"item": item})
}

// DELETE /api/v1/admin/lostfound/:id — soft delete with audit trail.
func (h *Handler) AdminRemove(c *fiber.Ctx) error {
	id := c.Params("id")
	userID := c.Locals("userID").(string)
	ct, err := h.DB.Exec(c.Context(), `UPDATE lost_found_items SET status='removed' WHERE id=$1`, id)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	if ct.RowsAffected() == 0 {
		return errJSON(c, 404, "item not found")
	}
	h.Audit.Log(c.Context(), userID, "lostfound.remove", id, nil)
	return c.JSON(fiber.Map{"message": "item removed"})
}

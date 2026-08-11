package clubs

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"vitlive/internal/audit"
	"vitlive/internal/models"
)

type Handler struct {
	DB    *pgxpool.Pool
	RDB   *redis.Client
	Audit *audit.Logger
}

func errJSON(c *fiber.Ctx, status int, msg string) error {
	return c.Status(status).JSON(fiber.Map{"error": msg})
}

func (h *Handler) loadClub(c *fiber.Ctx, id, userID string) (*models.Club, error) {
	var club models.Club
	err := h.DB.QueryRow(c.Context(),
		`SELECT c.id::text, c.name, c.description,
		        (SELECT COUNT(*) FROM club_members m WHERE m.club_id=c.id),
		        EXISTS(SELECT 1 FROM club_members m WHERE m.club_id=c.id AND m.user_id=$2)
		 FROM clubs c WHERE c.id=$1`, id, userID).
		Scan(&club.ID, &club.Name, &club.Description, &club.MemberCount, &club.IsFollowing)
	if err != nil {
		return nil, err
	}
	return &club, nil
}

// GET /api/v1/clubs
func (h *Handler) List(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	rows, err := h.DB.Query(c.Context(),
		`SELECT c.id::text, c.name, c.description,
		        (SELECT COUNT(*) FROM club_members m WHERE m.club_id=c.id),
		        EXISTS(SELECT 1 FROM club_members m WHERE m.club_id=c.id AND m.user_id=$1)
		 FROM clubs c ORDER BY c.name`, userID)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	defer rows.Close()
	items := []models.Club{}
	for rows.Next() {
		var club models.Club
		if rows.Scan(&club.ID, &club.Name, &club.Description, &club.MemberCount, &club.IsFollowing) == nil {
			items = append(items, club)
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

// GET /api/v1/clubs/:id — club page: profile + its announcements + upcoming events.
func (h *Handler) Get(c *fiber.Ctx) error {
	id := c.Params("id")
	userID := c.Locals("userID").(string)
	ctx := c.Context()

	club, err := h.loadClub(c, id, userID)
	if err != nil {
		return errJSON(c, 404, "club not found")
	}

	anns := []models.Announcement{}
	rows, err := h.DB.Query(ctx,
		`SELECT a.id::text, a.title, a.body, a.priority, a.image_url, COALESCE(u.full_name,''), a.created_at,
		        (SELECT COUNT(*) FROM announcement_reactions r WHERE r.announcement_id=a.id),
		        EXISTS(SELECT 1 FROM announcement_reactions r WHERE r.announcement_id=a.id AND r.user_id=$2)
		 FROM announcements a JOIN users u ON u.id=a.created_by
		 WHERE a.broadcast_at IS NOT NULL AND a.audience_type='club' AND a.audience_ref=$1
		 ORDER BY a.created_at DESC LIMIT 20`, id, userID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var a models.Announcement
			a.AudienceType, a.AudienceRef = "club", &id
			if rows.Scan(&a.ID, &a.Title, &a.Body, &a.Priority, &a.ImageURL, &a.AuthorName, &a.CreatedAt,
				&a.ReactionCount, &a.MyReaction) == nil {
				anns = append(anns, a)
			}
		}
	}

	events := []models.Event{}
	eRows, err := h.DB.Query(ctx,
		`SELECT e.id::text, e.title, e.description, e.banner_url, e.venue, e.start_time,
		        e.club_id::text, c2.name, e.created_at,
		        (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id=e.id AND r.status='going'),
		        EXISTS(SELECT 1 FROM event_rsvps r WHERE r.event_id=e.id AND r.user_id=$2 AND r.status='going')
		 FROM events e LEFT JOIN clubs c2 ON c2.id=e.club_id
		 WHERE e.club_id=$1 AND e.start_time > now() - interval '6 hours'
		 ORDER BY e.start_time ASC LIMIT 20`, id, userID)
	if err == nil {
		defer eRows.Close()
		for eRows.Next() {
			var e models.Event
			if eRows.Scan(&e.ID, &e.Title, &e.Description, &e.BannerURL, &e.Venue, &e.StartTime,
				&e.ClubID, &e.ClubName, &e.CreatedAt, &e.RSVPCount, &e.MyRSVP) == nil {
				events = append(events, e)
			}
		}
	}

	return c.JSON(fiber.Map{"club": club, "announcements": anns, "events": events})
}

// POST /api/v1/clubs/:id/follow
func (h *Handler) Follow(c *fiber.Ctx) error {
	id := c.Params("id")
	userID := c.Locals("userID").(string)
	if _, err := h.DB.Exec(c.Context(),
		`INSERT INTO club_members(club_id, user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, id, userID); err != nil {
		return errJSON(c, 404, "club not found")
	}
	club, err := h.loadClub(c, id, userID)
	if err != nil {
		return errJSON(c, 404, "club not found")
	}
	return c.JSON(fiber.Map{"club": club})
}

// POST /api/v1/clubs/:id/unfollow
func (h *Handler) Unfollow(c *fiber.Ctx) error {
	id := c.Params("id")
	userID := c.Locals("userID").(string)
	if _, err := h.DB.Exec(c.Context(),
		`DELETE FROM club_members WHERE club_id=$1 AND user_id=$2`, id, userID); err != nil {
		return errJSON(c, 500, "internal error")
	}
	club, err := h.loadClub(c, id, userID)
	if err != nil {
		return errJSON(c, 404, "club not found")
	}
	return c.JSON(fiber.Map{"club": club})
}

// POST /api/v1/admin/clubs (super_admin)
func (h *Handler) AdminCreate(c *fiber.Ctx) error {
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := c.BodyParser(&req); err != nil {
		return errJSON(c, 400, "invalid request body")
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		return errJSON(c, 400, "name is required")
	}
	userID := c.Locals("userID").(string)
	var id string
	err := h.DB.QueryRow(c.Context(),
		`INSERT INTO clubs(name, description) VALUES($1,$2) RETURNING id::text`,
		req.Name, strings.TrimSpace(req.Description)).Scan(&id)
	if err != nil {
		return errJSON(c, 409, "a club with this name already exists")
	}
	h.Audit.Log(c.Context(), userID, "club.create", id, map[string]any{"name": req.Name})
	club, _ := h.loadClub(c, id, userID)
	return c.Status(201).JSON(fiber.Map{"club": club})
}

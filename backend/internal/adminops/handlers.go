package adminops

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"vitlive/internal/audit"
	"vitlive/internal/models"
)

var validRoles = map[string]bool{
	"student": true, "club_admin": true, "dept_admin": true, "super_admin": true, "moderator": true,
}

type Handler struct {
	DB    *pgxpool.Pool
	RDB   *redis.Client
	Audit *audit.Logger
}

func errJSON(c *fiber.Ctx, status int, msg string) error {
	return c.Status(status).JSON(fiber.Map{"error": msg})
}

// GET /api/v1/admin/stats
func (h *Handler) Stats(c *fiber.Ctx) error {
	ctx := c.Context()
	var stats struct {
		TotalUsers         int `json:"total_users"`
		VerifiedUsers      int `json:"verified_users"`
		OnlineNow          int `json:"online_now"`
		AnnouncementsToday int `json:"announcements_today"`
		ActivePolls        int `json:"active_polls"`
		OpenLostfound      int `json:"open_lostfound"`
		UpcomingEvents     int `json:"upcoming_events"`
	}
	h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&stats.TotalUsers)
	h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE is_verified`).Scan(&stats.VerifiedUsers)
	h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM announcements WHERE created_at > now() - interval '24 hours'`).Scan(&stats.AnnouncementsToday)
	h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM polls WHERE closes_at IS NULL OR closes_at > now()`).Scan(&stats.ActivePolls)
	h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM lost_found_items WHERE status='open'`).Scan(&stats.OpenLostfound)
	h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM events WHERE start_time > now()`).Scan(&stats.UpcomingEvents)
	if n, err := h.RDB.Get(ctx, "stats:online").Int(); err == nil && n > 0 {
		stats.OnlineNow = n
	}
	return c.JSON(stats)
}

// GET /api/v1/admin/analytics — data behind the dashboard charts.
func (h *Handler) Analytics(c *fiber.Ctx) error {
	ctx := c.Context()

	type dayCount struct {
		Day   string `json:"day"`
		Count int    `json:"count"`
	}
	signups := []dayCount{}
	rows, err := h.DB.Query(ctx,
		`SELECT d::date::text, COUNT(u.id)
		 FROM generate_series(CURRENT_DATE - interval '13 days', CURRENT_DATE, interval '1 day') d
		 LEFT JOIN users u ON u.created_at::date = d::date
		 GROUP BY d ORDER BY d`)
	if err == nil {
		for rows.Next() {
			var dc dayCount
			if rows.Scan(&dc.Day, &dc.Count) == nil {
				signups = append(signups, dc)
			}
		}
		rows.Close()
	}

	type annReach struct {
		ID        string `json:"id"`
		Title     string `json:"title"`
		Delivered int    `json:"delivered"`
		Target    int    `json:"target"`
	}
	reach := []annReach{}
	rows, err = h.DB.Query(ctx,
		`SELECT id::text, title FROM announcements WHERE broadcast_at IS NOT NULL
		 ORDER BY created_at DESC LIMIT 10`)
	if err == nil {
		for rows.Next() {
			var a annReach
			if rows.Scan(&a.ID, &a.Title) == nil {
				reach = append(reach, a)
			}
		}
		rows.Close()
		var verified int
		h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE is_verified`).Scan(&verified)
		for i := range reach {
			n, _ := h.RDB.SCard(ctx, "delivered:announcement:"+reach[i].ID).Result()
			reach[i].Delivered = int(n)
			t, err := h.RDB.Get(ctx, "target:announcement:"+reach[i].ID).Int()
			if err != nil || t == 0 {
				t = verified // counter expired — fall back to current verified count
			}
			reach[i].Target = t
		}
	}

	type pollPart struct {
		ID       string `json:"id"`
		Question string `json:"question"`
		Voters   int    `json:"voters"`
		Eligible int    `json:"eligible"`
	}
	participation := []pollPart{}
	rows, err = h.DB.Query(ctx,
		`SELECT p.id::text, p.question,
		        (SELECT COUNT(*) FROM poll_voted_users v WHERE v.poll_id=p.id),
		        (SELECT COUNT(*) FROM users WHERE is_verified)
		 FROM polls p ORDER BY p.created_at DESC LIMIT 10`)
	if err == nil {
		for rows.Next() {
			var p pollPart
			if rows.Scan(&p.ID, &p.Question, &p.Voters, &p.Eligible) == nil {
				participation = append(participation, p)
			}
		}
		rows.Close()
	}

	type eventPop struct {
		ID        string `json:"id"`
		Title     string `json:"title"`
		RSVPCount int    `json:"rsvp_count"`
	}
	popular := []eventPop{}
	rows, err = h.DB.Query(ctx,
		`SELECT e.id::text, e.title, COUNT(r.user_id)
		 FROM events e LEFT JOIN event_rsvps r ON r.event_id=e.id AND r.status='going'
		 GROUP BY e.id ORDER BY COUNT(r.user_id) DESC, e.start_time DESC LIMIT 10`)
	if err == nil {
		for rows.Next() {
			var e eventPop
			if rows.Scan(&e.ID, &e.Title, &e.RSVPCount) == nil {
				popular = append(popular, e)
			}
		}
		rows.Close()
	}

	return c.JSON(fiber.Map{
		"signups_by_day":     signups,
		"announcement_reach": reach,
		"poll_participation": participation,
		"popular_events":     popular,
	})
}

// GET /api/v1/admin/users?q=&role=
func (h *Handler) ListUsers(c *fiber.Ctx) error {
	q := `SELECT u.id::text, u.college_email, u.full_name, u.role, u.department_id::text,
	             d.code, d.name, u.year_of_study, u.is_verified, u.created_at
	      FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE 1=1`
	var args []any
	if search := strings.TrimSpace(c.Query("q")); search != "" {
		args = append(args, "%"+search+"%")
		q += ` AND (u.full_name ILIKE $1 OR u.college_email ILIKE $1)`
	}
	if role := c.Query("role"); validRoles[role] {
		args = append(args, role)
		if len(args) == 1 {
			q += ` AND u.role = $1`
		} else {
			q += ` AND u.role = $2`
		}
	}
	q += ` ORDER BY u.created_at DESC LIMIT 200`
	rows, err := h.DB.Query(c.Context(), q, args...)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	defer rows.Close()
	items := []models.User{}
	for rows.Next() {
		var u models.User
		if rows.Scan(&u.ID, &u.CollegeEmail, &u.FullName, &u.Role, &u.DepartmentID,
			&u.DepartmentCode, &u.DepartmentName, &u.YearOfStudy, &u.IsVerified, &u.CreatedAt) == nil {
			items = append(items, u)
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

// PATCH /api/v1/admin/users/:id/role (super_admin, audit-logged)
func (h *Handler) UpdateRole(c *fiber.Ctx) error {
	var req struct {
		Role string `json:"role"`
	}
	if err := c.BodyParser(&req); err != nil || !validRoles[req.Role] {
		return errJSON(c, 400, "invalid role")
	}
	id := c.Params("id")
	actorID := c.Locals("userID").(string)
	if id == actorID && req.Role != "super_admin" {
		return errJSON(c, 400, "you cannot demote your own account")
	}
	ctx := c.Context()
	var oldRole string
	if err := h.DB.QueryRow(ctx, `SELECT role FROM users WHERE id=$1`, id).Scan(&oldRole); err != nil {
		return errJSON(c, 404, "user not found")
	}
	if _, err := h.DB.Exec(ctx, `UPDATE users SET role=$1 WHERE id=$2`, req.Role, id); err != nil {
		return errJSON(c, 500, "internal error")
	}
	h.Audit.Log(ctx, actorID, "user.role_change", id, map[string]any{"from": oldRole, "to": req.Role})

	var u models.User
	err := h.DB.QueryRow(ctx,
		`SELECT u.id::text, u.college_email, u.full_name, u.role, u.department_id::text,
		        d.code, d.name, u.year_of_study, u.is_verified, u.created_at
		 FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE u.id=$1`, id).
		Scan(&u.ID, &u.CollegeEmail, &u.FullName, &u.Role, &u.DepartmentID,
			&u.DepartmentCode, &u.DepartmentName, &u.YearOfStudy, &u.IsVerified, &u.CreatedAt)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	return c.JSON(fiber.Map{"user": u})
}

// Package academics: the academic calendar (exams, holidays, deadlines).
package academics

import (
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"vitlive/internal/audit"
	"vitlive/internal/models"
)

var validKinds = map[string]bool{"exam": true, "holiday": true, "deadline": true, "other": true}

type Handler struct {
	DB    *pgxpool.Pool
	Audit *audit.Logger
}

func errJSON(c *fiber.Ctx, status int, msg string) error {
	return c.Status(status).JSON(fiber.Map{"error": msg})
}

// GET /api/v1/academic-events — upcoming by default; ?from=&to= (YYYY-MM-DD)
// selects a window (calendar month views); ?all=true returns everything.
func (h *Handler) List(c *fiber.Ctx) error {
	q := `SELECT id::text, title, kind, starts_on::text, ends_on::text, created_at FROM academic_events`
	var conds []string
	var args []any
	if from := c.Query("from"); from != "" {
		if _, err := time.Parse("2006-01-02", from); err != nil {
			return errJSON(c, 400, "from must be YYYY-MM-DD")
		}
		args = append(args, from)
		conds = append(conds, "COALESCE(ends_on, starts_on) >= $"+strconv.Itoa(len(args)))
	}
	if to := c.Query("to"); to != "" {
		if _, err := time.Parse("2006-01-02", to); err != nil {
			return errJSON(c, 400, "to must be YYYY-MM-DD")
		}
		args = append(args, to)
		conds = append(conds, "starts_on <= $"+strconv.Itoa(len(args)))
	}
	if len(conds) == 0 && c.Query("all") != "true" {
		conds = append(conds, "COALESCE(ends_on, starts_on) >= CURRENT_DATE")
	}
	if len(conds) > 0 {
		q += " WHERE " + strings.Join(conds, " AND ")
	}
	q += ` ORDER BY starts_on ASC LIMIT 200`
	rows, err := h.DB.Query(c.Context(), q, args...)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	defer rows.Close()
	items := []models.AcademicEvent{}
	for rows.Next() {
		var e models.AcademicEvent
		if rows.Scan(&e.ID, &e.Title, &e.Kind, &e.StartsOn, &e.EndsOn, &e.CreatedAt) == nil {
			items = append(items, e)
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

// POST /api/v1/admin/academic-events
func (h *Handler) Create(c *fiber.Ctx) error {
	var req struct {
		Title    string  `json:"title"`
		Kind     string  `json:"kind"`
		StartsOn string  `json:"starts_on"` // YYYY-MM-DD
		EndsOn   *string `json:"ends_on"`
	}
	if err := c.BodyParser(&req); err != nil {
		return errJSON(c, 400, "invalid request body")
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		return errJSON(c, 400, "title is required")
	}
	if !validKinds[req.Kind] {
		req.Kind = "other"
	}
	if _, err := time.Parse("2006-01-02", req.StartsOn); err != nil {
		return errJSON(c, 400, "starts_on must be YYYY-MM-DD")
	}
	if req.EndsOn != nil && *req.EndsOn != "" {
		if _, err := time.Parse("2006-01-02", *req.EndsOn); err != nil {
			return errJSON(c, 400, "ends_on must be YYYY-MM-DD")
		}
	} else {
		req.EndsOn = nil
	}

	userID := c.Locals("userID").(string)
	var e models.AcademicEvent
	e.Title, e.Kind, e.StartsOn, e.EndsOn = req.Title, req.Kind, req.StartsOn, req.EndsOn
	err := h.DB.QueryRow(c.Context(),
		`INSERT INTO academic_events(title, kind, starts_on, ends_on, created_by)
		 VALUES($1,$2,$3,$4,$5) RETURNING id::text, created_at`,
		req.Title, req.Kind, req.StartsOn, req.EndsOn, userID).Scan(&e.ID, &e.CreatedAt)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	h.Audit.Log(c.Context(), userID, "academic_event.create", e.ID, map[string]any{"title": e.Title, "kind": e.Kind})
	return c.Status(201).JSON(fiber.Map{"event": e})
}

// DELETE /api/v1/admin/academic-events/:id
func (h *Handler) Delete(c *fiber.Ctx) error {
	id := c.Params("id")
	userID := c.Locals("userID").(string)
	ct, err := h.DB.Exec(c.Context(), `DELETE FROM academic_events WHERE id=$1`, id)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	if ct.RowsAffected() == 0 {
		return errJSON(c, 404, "not found")
	}
	h.Audit.Log(c.Context(), userID, "academic_event.delete", id, nil)
	return c.JSON(fiber.Map{"message": "deleted"})
}

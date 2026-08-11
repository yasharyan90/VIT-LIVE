// Package mess: the daily mess/cafeteria menu.
package mess

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"vitlive/internal/audit"
	"vitlive/internal/models"
)

var validMeals = map[string]bool{"breakfast": true, "lunch": true, "snacks": true, "dinner": true}

type Handler struct {
	DB    *pgxpool.Pool
	Audit *audit.Logger
}

func errJSON(c *fiber.Ctx, status int, msg string) error {
	return c.Status(status).JSON(fiber.Map{"error": msg})
}

// GET /api/v1/mess-menu?date=YYYY-MM-DD (defaults to today).
func (h *Handler) Get(c *fiber.Ctx) error {
	date := c.Query("date")
	if date == "" {
		date = time.Now().Format("2006-01-02")
	} else if _, err := time.Parse("2006-01-02", date); err != nil {
		return errJSON(c, 400, "date must be YYYY-MM-DD")
	}
	rows, err := h.DB.Query(c.Context(),
		`SELECT menu_date::text, meal, items, updated_at FROM mess_menus WHERE menu_date=$1
		 ORDER BY CASE meal WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'snacks' THEN 3 ELSE 4 END`, date)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	defer rows.Close()
	items := []models.MessMenu{}
	for rows.Next() {
		var m models.MessMenu
		if rows.Scan(&m.MenuDate, &m.Meal, &m.Items, &m.UpdatedAt) == nil {
			items = append(items, m)
		}
	}
	return c.JSON(fiber.Map{"date": date, "meals": items})
}

// POST /api/v1/admin/mess-menu — upsert one meal for a date.
func (h *Handler) Upsert(c *fiber.Ctx) error {
	var req struct {
		MenuDate string `json:"menu_date"`
		Meal     string `json:"meal"`
		Items    string `json:"items"`
	}
	if err := c.BodyParser(&req); err != nil {
		return errJSON(c, 400, "invalid request body")
	}
	if _, err := time.Parse("2006-01-02", req.MenuDate); err != nil {
		return errJSON(c, 400, "menu_date must be YYYY-MM-DD")
	}
	if !validMeals[req.Meal] {
		return errJSON(c, 400, "meal must be breakfast|lunch|snacks|dinner")
	}
	req.Items = strings.TrimSpace(req.Items)

	userID := c.Locals("userID").(string)
	var m models.MessMenu
	err := h.DB.QueryRow(c.Context(),
		`INSERT INTO mess_menus(menu_date, meal, items, updated_by)
		 VALUES($1,$2,$3,$4)
		 ON CONFLICT (menu_date, meal) DO UPDATE SET items=EXCLUDED.items, updated_by=EXCLUDED.updated_by, updated_at=now()
		 RETURNING menu_date::text, meal, items, updated_at`,
		req.MenuDate, req.Meal, req.Items, userID).
		Scan(&m.MenuDate, &m.Meal, &m.Items, &m.UpdatedAt)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	h.Audit.Log(c.Context(), userID, "mess_menu.update", req.MenuDate+"/"+req.Meal, nil)
	return c.JSON(fiber.Map{"menu": m})
}

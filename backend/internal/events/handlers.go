package events

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

const selectEvent = `
	SELECT e.id::text, e.title, e.description, e.banner_url, e.venue, e.start_time,
	       e.club_id::text, c.name, e.price_cents, e.created_at,
	       (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id=e.id AND r.status='going'),
	       EXISTS(SELECT 1 FROM event_rsvps r WHERE r.event_id=e.id AND r.user_id=$1 AND r.status='going'),
	       (SELECT t.status FROM tickets t WHERE t.event_id=e.id AND t.user_id=$1 AND t.status IN ('paid','checked_in'))
	FROM events e LEFT JOIN clubs c ON c.id=e.club_id`

func scanEvent(row interface{ Scan(...any) error }) (*models.Event, error) {
	var e models.Event
	err := row.Scan(&e.ID, &e.Title, &e.Description, &e.BannerURL, &e.Venue, &e.StartTime,
		&e.ClubID, &e.ClubName, &e.PriceCents, &e.CreatedAt, &e.RSVPCount, &e.MyRSVP, &e.MyTicketStatus)
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// POST /api/v1/admin/events (multipart form)
func (h *Handler) Create(c *fiber.Ctx) error {
	title := strings.TrimSpace(c.FormValue("title"))
	if title == "" {
		return errJSON(c, 400, "title is required")
	}
	startTime, err := time.Parse(time.RFC3339, c.FormValue("start_time"))
	if err != nil {
		return errJSON(c, 400, "start_time must be RFC3339")
	}
	description := strings.TrimSpace(c.FormValue("description"))
	venue := strings.TrimSpace(c.FormValue("venue"))
	priceCents := 0
	if v := c.FormValue("price_cents"); v != "" {
		p, err := strconv.Atoi(v)
		if err != nil || p < 0 || p > 10_000_000 {
			return errJSON(c, 400, "price_cents must be a non-negative integer (max ₹1,00,000)")
		}
		// Razorpay's minimum order is 100 paise (₹1).
		if p > 0 && p < 100 {
			return errJSON(c, 400, "ticket price must be at least ₹1 (100 paise) or free")
		}
		priceCents = p
	}
	var clubID *string
	if v := c.FormValue("club_id"); v != "" {
		clubID = &v
	}

	// Club accounts always create events under their own club.
	userID := c.Locals("userID").(string)
	if c.Locals("role").(string) == "club_admin" {
		var myClub string
		if err := h.DB.QueryRow(c.Context(),
			`SELECT id::text FROM clubs WHERE admin_id=$1`, userID).Scan(&myClub); err != nil {
			return errJSON(c, 403, "no club is assigned to your account — ask a super admin")
		}
		clubID = &myClub
	}
	var bannerURL *string
	if file, err := c.FormFile("banner"); err == nil && file != nil {
		url, err := storage.SaveImage(c.Context(), h.Store, file)
		if err != nil {
			if fe, ok := err.(*fiber.Error); ok {
				return errJSON(c, fe.Code, fe.Message)
			}
			return errJSON(c, 500, "could not store banner")
		}
		bannerURL = &url
	}

	ctx := c.Context()
	var id string
	err = h.DB.QueryRow(ctx,
		`INSERT INTO events(title, description, banner_url, venue, start_time, created_by, club_id, price_cents)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text`,
		title, description, bannerURL, venue, startTime, userID, clubID, priceCents).Scan(&id)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	event, err := scanEvent(h.DB.QueryRow(ctx, selectEvent+` WHERE e.id=$2`, userID, id))
	if err != nil {
		return errJSON(c, 500, "internal error")
	}

	topic := "college:global"
	if clubID != nil {
		topic = "club:" + *clubID
	}
	ws.Publish(ctx, h.RDB, topic, ws.NewEnvelope("event.new", topic, event))
	go h.FCM.Send("New event: "+title, venue+" · "+startTime.Format("Jan 2, 3:04 PM"),
		map[string]string{"type": "event", "id": id}, nil)

	h.Audit.Log(ctx, userID, "event.create", id, map[string]any{"title": title})
	return c.Status(201).JSON(fiber.Map{"event": event})
}

func (h *Handler) list(c *fiber.Ctx, includePast bool) error {
	userID := c.Locals("userID").(string)
	q := selectEvent
	var conds []string
	args := []any{userID}
	if !includePast {
		conds = append(conds, `e.start_time > now() - interval '6 hours'`)
	}
	// The admin list shows club accounts only their own club's events.
	if includePast && c.Locals("role").(string) == "club_admin" {
		conds = append(conds, `e.club_id = (SELECT id FROM clubs WHERE admin_id=$2)`)
		args = append(args, userID)
	}
	if len(conds) > 0 {
		q += ` WHERE ` + strings.Join(conds, " AND ")
	}
	q += ` ORDER BY e.start_time ASC LIMIT 100`
	rows, err := h.DB.Query(c.Context(), q, args...)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	defer rows.Close()
	items := []models.Event{}
	for rows.Next() {
		if e, err := scanEvent(rows); err == nil {
			items = append(items, *e)
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

// GET /api/v1/events
func (h *Handler) List(c *fiber.Ctx) error { return h.list(c, false) }

// GET /api/v1/events/:id — deep-link target.
func (h *Handler) Get(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	event, err := scanEvent(h.DB.QueryRow(c.Context(), selectEvent+` WHERE e.id=$2`, userID, c.Params("id")))
	if err != nil {
		return errJSON(c, 404, "event not found")
	}
	return c.JSON(fiber.Map{"event": event})
}

// GET /api/v1/admin/events
func (h *Handler) AdminList(c *fiber.Ctx) error { return h.list(c, true) }

// POST /api/v1/events/:id/rsvp  {"going": true|false}
func (h *Handler) RSVP(c *fiber.Ctx) error {
	var req struct {
		Going bool `json:"going"`
	}
	if err := c.BodyParser(&req); err != nil {
		return errJSON(c, 400, "invalid request body")
	}
	id := c.Params("id")
	userID := c.Locals("userID").(string)
	ctx := c.Context()

	var price int
	if err := h.DB.QueryRow(ctx, `SELECT price_cents FROM events WHERE id=$1`, id).Scan(&price); err != nil {
		return errJSON(c, 404, "event not found")
	}
	if price > 0 && req.Going {
		return errJSON(c, 402, "this is a ticketed event — buy a ticket to attend")
	}
	if req.Going {
		_, err := h.DB.Exec(ctx,
			`INSERT INTO event_rsvps(event_id, user_id, status) VALUES($1,$2,'going')
			 ON CONFLICT (event_id, user_id) DO UPDATE SET status='going'`, id, userID)
		if err != nil {
			return errJSON(c, 500, "internal error")
		}
	} else {
		if _, err := h.DB.Exec(ctx, `DELETE FROM event_rsvps WHERE event_id=$1 AND user_id=$2`, id, userID); err != nil {
			return errJSON(c, 500, "internal error")
		}
	}
	var count int
	h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM event_rsvps WHERE event_id=$1 AND status='going'`, id).Scan(&count)
	return c.JSON(fiber.Map{"rsvp_count": count, "my_rsvp": req.Going})
}

// StartReminderWorker publishes event.reminder ~1h before start to users who
// RSVPed (plus an FCM push), once per event. Run as a background goroutine.
func (h *Handler) StartReminderWorker(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.fireDueReminders(ctx)
		}
	}
}

func (h *Handler) fireDueReminders(ctx context.Context) {
	rows, err := h.DB.Query(ctx,
		`UPDATE events SET reminded_at=now()
		 WHERE reminded_at IS NULL AND start_time > now() AND start_time <= now() + interval '60 minutes'
		 RETURNING id::text, title, venue, start_time`)
	if err != nil {
		log.Printf("reminder worker: %v", err)
		return
	}
	type due struct {
		id, title, venue string
		start            time.Time
	}
	var dues []due
	for rows.Next() {
		var d due
		if rows.Scan(&d.id, &d.title, &d.venue, &d.start) == nil {
			dues = append(dues, d)
		}
	}
	rows.Close()

	for _, d := range dues {
		payload := fiber.Map{"id": d.id, "title": d.title, "venue": d.venue, "start_time": d.start}
		ws.Publish(ctx, h.RDB, "college:global", ws.NewEnvelope("event.reminder", "college:global", payload))

		var rsvpers []string
		rRows, err := h.DB.Query(ctx, `SELECT user_id::text FROM event_rsvps WHERE event_id=$1 AND status='going'`, d.id)
		if err == nil {
			for rRows.Next() {
				var uid string
				if rRows.Scan(&uid) == nil {
					rsvpers = append(rsvpers, uid)
				}
			}
			rRows.Close()
		}
		if len(rsvpers) > 0 {
			go h.FCM.Send("Starting soon: "+d.title, d.venue+" · "+d.start.Format("3:04 PM"),
				map[string]string{"type": "event_reminder", "id": d.id}, rsvpers)
		}
		log.Printf("reminder fired for event %s (%s)", d.title, d.id)
	}
}

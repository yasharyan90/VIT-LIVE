// Package tickets: paid-event ticketing. Buy (Razorpay order → signature-
// verified confirm), hold (QR code), and door check-in by club accounts.
package tickets

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"vitlive/internal/audit"
	"vitlive/internal/models"
	"vitlive/internal/payments"
)

type Handler struct {
	DB    *pgxpool.Pool
	Audit *audit.Logger
	RZP   *payments.Razorpay
}

func errJSON(c *fiber.Ctx, status int, msg string) error {
	return c.Status(status).JSON(fiber.Map{"error": msg})
}

func newCode() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

const ticketCols = `t.id::text, t.event_id::text, t.code, t.amount_cents, t.status,
	t.created_at, t.checked_in_at, e.title, e.venue, e.start_time, COALESCE(u.full_name,'')`

func scanTicket(row interface{ Scan(...any) error }) (*models.Ticket, error) {
	var t models.Ticket
	err := row.Scan(&t.ID, &t.EventID, &t.Code, &t.AmountCents, &t.Status,
		&t.CreatedAt, &t.CheckedInAt, &t.EventTitle, &t.Venue, &t.StartTime, &t.AttendeeName)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (h *Handler) loadTicket(c *fiber.Ctx, where string, args ...any) (*models.Ticket, error) {
	return scanTicket(h.DB.QueryRow(c.Context(),
		`SELECT `+ticketCols+`
		 FROM tickets t JOIN events e ON e.id=t.event_id JOIN users u ON u.id=t.user_id
		 WHERE `+where, args...))
}

// POST /api/v1/events/:id/order — start a purchase. Returns either a real
// Razorpay order for checkout.js, or {mock:true} when no gateway is configured.
func (h *Handler) CreateOrder(c *fiber.Ctx) error {
	eventID := c.Params("id")
	userID := c.Locals("userID").(string)
	ctx := c.Context()

	var price int
	var title string
	var start time.Time
	if err := h.DB.QueryRow(ctx,
		`SELECT price_cents, title, start_time FROM events WHERE id=$1`, eventID).
		Scan(&price, &title, &start); err != nil {
		return errJSON(c, 404, "event not found")
	}
	if price <= 0 {
		return errJSON(c, 400, "this event is free — just RSVP")
	}
	if time.Now().After(start) {
		return errJSON(c, 400, "this event has already started")
	}

	var status string
	err := h.DB.QueryRow(ctx,
		`SELECT status FROM tickets WHERE event_id=$1 AND user_id=$2`, eventID, userID).Scan(&status)
	if err == nil && status != "pending" {
		return errJSON(c, 409, "you already have a ticket for this event")
	}

	orderID := "mock_" + uuid.NewString()
	if h.RZP.Enabled() {
		receipt := "evt-" + eventID[:8] + "-" + userID[:8]
		orderID, err = h.RZP.CreateOrder(ctx, price, receipt)
		if err != nil {
			return errJSON(c, 502, "payment gateway error — try again")
		}
	}

	// One row per (event,user): a re-attempted purchase reuses the row with a
	// fresh order id.
	if _, err := h.DB.Exec(ctx,
		`INSERT INTO tickets(event_id, user_id, code, amount_cents, order_id, status)
		 VALUES($1,$2,$3,$4,$5,'pending')
		 ON CONFLICT (event_id, user_id)
		 DO UPDATE SET order_id=EXCLUDED.order_id, amount_cents=EXCLUDED.amount_cents`,
		eventID, userID, newCode(), price, orderID); err != nil {
		return errJSON(c, 500, "internal error")
	}

	return c.JSON(fiber.Map{
		"mock":         !h.RZP.Enabled(),
		"key_id":       h.RZP.KeyID,
		"order_id":     orderID,
		"amount_cents": price,
		"currency":     "INR",
		"event_title":  title,
	})
}

// POST /api/v1/events/:id/confirm — finish a purchase. With a real gateway the
// checkout callback fields are verified; in mock mode it succeeds directly.
func (h *Handler) Confirm(c *fiber.Ctx) error {
	eventID := c.Params("id")
	userID := c.Locals("userID").(string)
	ctx := c.Context()

	var req struct {
		OrderID   string `json:"razorpay_order_id"`
		PaymentID string `json:"razorpay_payment_id"`
		Signature string `json:"razorpay_signature"`
	}
	c.BodyParser(&req) // empty body is fine in mock mode

	var ticketID, orderID, status string
	if err := h.DB.QueryRow(ctx,
		`SELECT id::text, COALESCE(order_id,''), status FROM tickets WHERE event_id=$1 AND user_id=$2`,
		eventID, userID).Scan(&ticketID, &orderID, &status); err != nil {
		return errJSON(c, 404, "no purchase in progress — create an order first")
	}
	if status != "pending" {
		t, err := h.loadTicket(c, `t.id=$1`, ticketID)
		if err != nil {
			return errJSON(c, 500, "internal error")
		}
		return c.JSON(fiber.Map{"ticket": t}) // idempotent: already paid
	}

	paymentID := req.PaymentID
	if h.RZP.Enabled() {
		if req.OrderID != orderID || !h.RZP.VerifySignature(req.OrderID, req.PaymentID, req.Signature) {
			return errJSON(c, 400, "payment verification failed")
		}
	} else {
		if !strings.HasPrefix(orderID, "mock_") {
			return errJSON(c, 400, "payment verification failed")
		}
		paymentID = "mock_payment"
	}

	if _, err := h.DB.Exec(ctx,
		`UPDATE tickets SET status='paid', payment_id=$1 WHERE id=$2`, paymentID, ticketID); err != nil {
		return errJSON(c, 500, "internal error")
	}
	// A paid ticket counts as attending.
	h.DB.Exec(ctx,
		`INSERT INTO event_rsvps(event_id, user_id, status) VALUES($1,$2,'going')
		 ON CONFLICT (event_id, user_id) DO UPDATE SET status='going'`, eventID, userID)

	h.Audit.Log(ctx, userID, "ticket.purchase", ticketID,
		map[string]any{"event_id": eventID, "payment_id": paymentID})
	t, err := h.loadTicket(c, `t.id=$1`, ticketID)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	return c.Status(201).JSON(fiber.Map{"ticket": t})
}

// GET /api/v1/admin/events/:id/attendees — who's coming / who's inside.
// Ticketed attendees (paid / checked_in with timestamps) plus plain RSVPs for
// free events. Club account of the event's club, or super admin.
func (h *Handler) Attendees(c *fiber.Ctx) error {
	eventID := c.Params("id")
	ctx := c.Context()

	var clubID *string
	var title string
	if err := h.DB.QueryRow(ctx,
		`SELECT club_id::text, title FROM events WHERE id=$1`, eventID).Scan(&clubID, &title); err != nil {
		return errJSON(c, 404, "event not found")
	}
	if err := h.authorizeForEvent(c, clubID); err != nil {
		fe := err.(*fiber.Error)
		return errJSON(c, fe.Code, fe.Message)
	}

	type attendee struct {
		FullName     string     `json:"full_name"`
		CollegeEmail string     `json:"college_email"`
		Status       string     `json:"status"` // rsvp | paid | checked_in
		CheckedInAt  *time.Time `json:"checked_in_at"`
	}
	items := []attendee{}
	rows, err := h.DB.Query(ctx,
		`SELECT u.full_name, u.college_email, t.status, t.checked_in_at
		 FROM tickets t JOIN users u ON u.id=t.user_id
		 WHERE t.event_id=$1 AND t.status IN ('paid','checked_in')
		 UNION ALL
		 SELECT u.full_name, u.college_email, 'rsvp', NULL
		 FROM event_rsvps r JOIN users u ON u.id=r.user_id
		 WHERE r.event_id=$1 AND r.status='going'
		   AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.event_id=r.event_id
		                     AND t.user_id=r.user_id AND t.status IN ('paid','checked_in'))
		 ORDER BY 3 DESC, 1 ASC`, eventID)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	defer rows.Close()
	checkedIn, paid := 0, 0
	for rows.Next() {
		var a attendee
		if rows.Scan(&a.FullName, &a.CollegeEmail, &a.Status, &a.CheckedInAt) == nil {
			switch a.Status {
			case "checked_in":
				checkedIn++
				paid++
			case "paid":
				paid++
			}
			items = append(items, a)
		}
	}
	return c.JSON(fiber.Map{
		"event_title": title,
		"total":       len(items),
		"paid":        paid,
		"checked_in":  checkedIn,
		"items":       items,
	})
}

// GET /api/v1/me/tickets — the caller's paid tickets, newest event first.
func (h *Handler) MyTickets(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	rows, err := h.DB.Query(c.Context(),
		`SELECT `+ticketCols+`
		 FROM tickets t JOIN events e ON e.id=t.event_id JOIN users u ON u.id=t.user_id
		 WHERE t.user_id=$1 AND t.status IN ('paid','checked_in')
		 ORDER BY e.start_time DESC LIMIT 100`, userID)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	defer rows.Close()
	items := []models.Ticket{}
	for rows.Next() {
		if t, err := scanTicket(rows); err == nil {
			items = append(items, *t)
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

// authorizeForEvent: super admins act on any event; a club admin only on
// events belonging to the club whose account they hold. Everyone else: no.
func (h *Handler) authorizeForEvent(c *fiber.Ctx, eventClubID *string) error {
	role := c.Locals("role").(string)
	if role == "super_admin" {
		return nil
	}
	if role != "club_admin" {
		return fiber.NewError(403, "only the event's club account or a super admin can do this")
	}
	var myClub *string
	h.DB.QueryRow(c.Context(), `SELECT id::text FROM clubs WHERE admin_id=$1`,
		c.Locals("userID").(string)).Scan(&myClub)
	if myClub == nil {
		return fiber.NewError(403, "no club is assigned to your account")
	}
	if eventClubID == nil || *eventClubID != *myClub {
		return fiber.NewError(403, "this event belongs to another club")
	}
	return nil
}

// POST /api/v1/admin/tickets/checkin {"code": "..."} — scan a ticket QR at the
// door. Club admins can only check in tickets for their own club's events.
func (h *Handler) Checkin(c *fiber.Ctx) error {
	var req struct {
		Code string `json:"code"`
	}
	if err := c.BodyParser(&req); err != nil || strings.TrimSpace(req.Code) == "" {
		return errJSON(c, 400, "code is required")
	}
	code := strings.TrimSpace(strings.ToLower(req.Code))
	userID := c.Locals("userID").(string)
	ctx := c.Context()

	var ticketID, status string
	var clubID *string
	var checkedInAt *time.Time
	if err := h.DB.QueryRow(ctx,
		`SELECT t.id::text, t.status, e.club_id::text, t.checked_in_at
		 FROM tickets t JOIN events e ON e.id=t.event_id WHERE t.code=$1`, code).
		Scan(&ticketID, &status, &clubID, &checkedInAt); err != nil {
		return errJSON(c, 404, "invalid ticket — no match for this QR")
	}
	if err := h.authorizeForEvent(c, clubID); err != nil {
		fe := err.(*fiber.Error)
		return errJSON(c, fe.Code, fe.Message)
	}

	switch status {
	case "pending":
		return errJSON(c, 402, "ticket not paid")
	case "checked_in":
		t, _ := h.loadTicket(c, `t.id=$1`, ticketID)
		return c.Status(409).JSON(fiber.Map{
			"error":  "already checked in",
			"ticket": t,
		})
	}

	if _, err := h.DB.Exec(ctx,
		`UPDATE tickets SET status='checked_in', checked_in_at=now() WHERE id=$1`, ticketID); err != nil {
		return errJSON(c, 500, "internal error")
	}
	h.Audit.Log(ctx, userID, "ticket.checkin", ticketID, nil)
	t, err := h.loadTicket(c, `t.id=$1`, ticketID)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	return c.JSON(fiber.Map{"ticket": t})
}

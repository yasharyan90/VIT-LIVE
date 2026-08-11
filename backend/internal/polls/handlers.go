package polls

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"vitlive/internal/audit"
	"vitlive/internal/models"
	"vitlive/internal/ws"
)

type Handler struct {
	DB         *pgxpool.Pool
	RDB        *redis.Client
	Audit      *audit.Logger
	HMACSecret string
}

func errJSON(c *fiber.Ctx, status int, msg string) error {
	return c.Status(status).JSON(fiber.Map{"error": msg})
}

// voterToken is a one-way HMAC of (poll_id + user_id): it deduplicates votes
// inside a poll without being reversible to a user, and is never joined
// against the users table anywhere.
func (h *Handler) voterToken(pollID, userID string) string {
	mac := hmac.New(sha256.New, []byte(h.HMACSecret))
	mac.Write([]byte(pollID + ":" + userID))
	return hex.EncodeToString(mac.Sum(nil))
}

func (h *Handler) loadPoll(ctx context.Context, pollID, userID string) (*models.Poll, error) {
	var p models.Poll
	err := h.DB.QueryRow(ctx,
		`SELECT id::text, question, allow_multiple, closes_at, created_at FROM polls WHERE id=$1`, pollID).
		Scan(&p.ID, &p.Question, &p.AllowMultiple, &p.ClosesAt, &p.CreatedAt)
	if err != nil {
		return nil, err
	}
	p.IsClosed = p.ClosesAt != nil && time.Now().After(*p.ClosesAt)

	rows, err := h.DB.Query(ctx,
		`SELECT o.id::text, o.option_text, (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id=o.id)
		 FROM poll_options o WHERE o.poll_id=$1 ORDER BY o.position, o.id`, pollID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	p.Options = []models.PollOption{}
	for rows.Next() {
		var o models.PollOption
		if rows.Scan(&o.ID, &o.OptionText, &o.Votes) == nil {
			p.Options = append(p.Options, o)
		}
	}
	// total = distinct voters, not option rows (multi-choice polls).
	h.DB.QueryRow(ctx, `SELECT COUNT(DISTINCT voter_token) FROM poll_votes WHERE poll_id=$1`, pollID).Scan(&p.TotalVotes)
	if userID != "" {
		h.DB.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM poll_voted_users WHERE poll_id=$1 AND user_id=$2)`,
			pollID, userID).Scan(&p.HasVoted)
	}
	return &p, nil
}

// POST /api/v1/admin/polls
func (h *Handler) Create(c *fiber.Ctx) error {
	var req struct {
		Question      string     `json:"question"`
		Options       []string   `json:"options"`
		AllowMultiple bool       `json:"allow_multiple"`
		ClosesAt      *time.Time `json:"closes_at"`
	}
	if err := c.BodyParser(&req); err != nil {
		return errJSON(c, 400, "invalid request body")
	}
	req.Question = strings.TrimSpace(req.Question)
	var options []string
	for _, o := range req.Options {
		if o = strings.TrimSpace(o); o != "" {
			options = append(options, o)
		}
	}
	if req.Question == "" || len(options) < 2 {
		return errJSON(c, 400, "question and at least 2 options are required")
	}

	userID := c.Locals("userID").(string)
	ctx := c.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	defer tx.Rollback(ctx)

	var pollID string
	if err := tx.QueryRow(ctx,
		`INSERT INTO polls(question, allow_multiple, created_by, closes_at) VALUES($1,$2,$3,$4) RETURNING id::text`,
		req.Question, req.AllowMultiple, userID, req.ClosesAt).Scan(&pollID); err != nil {
		return errJSON(c, 500, "internal error")
	}
	for i, opt := range options {
		if _, err := tx.Exec(ctx,
			`INSERT INTO poll_options(poll_id, option_text, position) VALUES($1,$2,$3)`, pollID, opt, i); err != nil {
			return errJSON(c, 500, "internal error")
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return errJSON(c, 500, "internal error")
	}

	poll, err := h.loadPoll(ctx, pollID, "")
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	ws.Publish(ctx, h.RDB, "college:global", ws.NewEnvelope("poll.new", "college:global", poll))
	h.Audit.Log(ctx, userID, "poll.create", pollID, map[string]any{"question": req.Question})
	return c.Status(201).JSON(fiber.Map{"poll": poll})
}

// GET /api/v1/polls (and /admin/polls) — active first, then closed.
func (h *Handler) List(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	ctx := c.Context()
	rows, err := h.DB.Query(ctx,
		`SELECT id::text FROM polls
		 ORDER BY (closes_at IS NOT NULL AND closes_at < now()) ASC, created_at DESC LIMIT 50`)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	items := []models.Poll{}
	for _, id := range ids {
		if p, err := h.loadPoll(ctx, id, userID); err == nil {
			items = append(items, *p)
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

// GET /api/v1/polls/:id
func (h *Handler) Get(c *fiber.Ctx) error {
	poll, err := h.loadPoll(c.Context(), c.Params("id"), c.Locals("userID").(string))
	if err != nil {
		return errJSON(c, 404, "poll not found")
	}
	return c.JSON(fiber.Map{"poll": poll})
}

// POST /api/v1/polls/:id/vote  {"option_ids": ["uuid", ...]}
func (h *Handler) Vote(c *fiber.Ctx) error {
	var req struct {
		OptionIDs []string `json:"option_ids"`
	}
	if err := c.BodyParser(&req); err != nil || len(req.OptionIDs) == 0 {
		return errJSON(c, 400, "option_ids required")
	}
	pollID := c.Params("id")
	userID := c.Locals("userID").(string)
	ctx := c.Context()

	var allowMultiple bool
	var closesAt *time.Time
	if err := h.DB.QueryRow(ctx, `SELECT allow_multiple, closes_at FROM polls WHERE id=$1`, pollID).
		Scan(&allowMultiple, &closesAt); err != nil {
		return errJSON(c, 404, "poll not found")
	}
	if closesAt != nil && time.Now().After(*closesAt) {
		return errJSON(c, 400, "poll is closed")
	}
	if !allowMultiple && len(req.OptionIDs) != 1 {
		return errJSON(c, 400, "this poll allows exactly one choice")
	}
	// Validate every option belongs to this poll.
	for _, optID := range req.OptionIDs {
		var ok bool
		if err := h.DB.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM poll_options WHERE id=$1 AND poll_id=$2)`, optID, pollID).Scan(&ok); err != nil || !ok {
			return errJSON(c, 400, "invalid option for this poll")
		}
	}

	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	defer tx.Rollback(ctx)

	// Double-vote guard: the identity-linked table records only THAT you voted.
	ct, err := tx.Exec(ctx,
		`INSERT INTO poll_voted_users(poll_id, user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, pollID, userID)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	if ct.RowsAffected() == 0 {
		return errJSON(c, 409, "you have already voted in this poll")
	}
	// The actual choice is stored only against the one-way voter token.
	token := h.voterToken(pollID, userID)
	for _, optID := range req.OptionIDs {
		if _, err := tx.Exec(ctx,
			`INSERT INTO poll_votes(poll_id, option_id, voter_token) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
			pollID, optID, token); err != nil {
			return errJSON(c, 500, "internal error")
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return errJSON(c, 500, "internal error")
	}

	poll, err := h.loadPoll(ctx, pollID, userID)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	// Live tally for everyone; per-user has_voted is meaningless in a broadcast.
	broadcast := *poll
	broadcast.HasVoted = false
	ws.Publish(ctx, h.RDB, "college:global", ws.NewEnvelope("poll.update", "college:global", broadcast))
	return c.JSON(fiber.Map{"poll": poll})
}

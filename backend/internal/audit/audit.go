package audit

import (
	"context"
	"encoding/json"
	"log"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"vitlive/internal/models"
)

// Logger is the write-only audit trail; every admin-privileged action calls Log.
type Logger struct {
	DB *pgxpool.Pool
}

func (l *Logger) Log(ctx context.Context, actorID, action, target string, metadata map[string]any) {
	if metadata == nil {
		metadata = map[string]any{}
	}
	meta, _ := json.Marshal(metadata)
	if _, err := l.DB.Exec(ctx,
		`INSERT INTO audit_logs(actor_id, action, target, metadata) VALUES($1,$2,$3,$4)`,
		actorID, action, target, meta); err != nil {
		log.Printf("audit: failed to log %s: %v", action, err)
	}
}

// GET /api/v1/admin/audit-logs
func (l *Logger) List(c *fiber.Ctx) error {
	limit := c.QueryInt("limit", 50)
	if limit < 1 || limit > 200 {
		limit = 50
	}
	rows, err := l.DB.Query(c.Context(),
		`SELECT a.id::text, COALESCE(u.full_name,'system'), a.action, a.target, a.metadata, a.created_at
		 FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
		 ORDER BY a.created_at DESC LIMIT $1`, limit)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}
	defer rows.Close()
	items := []models.AuditLog{}
	for rows.Next() {
		var a models.AuditLog
		var meta []byte
		if rows.Scan(&a.ID, &a.ActorName, &a.Action, &a.Target, &meta, &a.CreatedAt) == nil {
			json.Unmarshal(meta, &a.Metadata)
			items = append(items, a)
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

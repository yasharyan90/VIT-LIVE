package db

import (
	"context"
	"embed"
	"fmt"
	"log"
	"sort"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("postgres ping: %w", err)
	}
	return pool, nil
}

// Migrate applies embedded SQL migrations in filename order, tracking them
// in a schema_migrations table.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx,
		`CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`); err != nil {
		return err
	}
	entries, err := migrationFS.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	for _, name := range names {
		var exists bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE name=$1)`, name).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		sqlBytes, err := migrationFS.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		if _, err := pool.Exec(ctx, string(sqlBytes)); err != nil {
			return fmt.Errorf("migration %s: %w", name, err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO schema_migrations(name) VALUES($1)`, name); err != nil {
			return err
		}
		log.Printf("applied migration %s", name)
	}
	return nil
}

// Seed inserts departments, sample clubs, and the super admin account (idempotent).
func Seed(ctx context.Context, pool *pgxpool.Pool, superEmail, superPassword string) error {
	departments := [][2]string{
		{"Computer Science", "CSE"}, {"Electronics & Communication", "ECE"},
		{"Mechanical Engineering", "MECH"}, {"Civil Engineering", "CIVIL"},
		{"Electrical & Electronics", "EEE"},
	}
	for _, d := range departments {
		if _, err := pool.Exec(ctx,
			`INSERT INTO departments(name, code) VALUES($1,$2) ON CONFLICT (code) DO NOTHING`, d[0], d[1]); err != nil {
			return err
		}
	}
	for _, c := range []string{"Coding Club", "Robotics Club", "Music Club"} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO clubs(name, description) VALUES($1,$2) ON CONFLICT (name) DO NOTHING`,
			c, "Official "+c+" of the campus."); err != nil {
			return err
		}
	}
	var exists bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM users WHERE college_email=$1)`, superEmail).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		hash, err := bcrypt.GenerateFromPassword([]byte(superPassword), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO users(college_email, full_name, role, is_verified, password_hash)
			 VALUES($1, 'Super Admin', 'super_admin', TRUE, $2)`, superEmail, string(hash)); err != nil {
			return err
		}
		log.Printf("seeded super admin %s", superEmail)
	}
	return nil
}

// Integration tests: the real app (routes, middleware, handlers) against a
// disposable Postgres database and Redis DB 15.
//
// Requires local Postgres + Redis (docker compose up -d postgres redis).
// Override connection strings with TEST_PG_ADMIN_URL / TEST_DATABASE_URL /
// TEST_REDIS_URL (used as-is by CI).

package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"testing"

	"github.com/redis/go-redis/v9"

	"vitlive/internal/config"
	"vitlive/internal/db"
)

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

type testEnv struct {
	srv *Server
}

func setup(t *testing.T) *testEnv {
	t.Helper()
	ctx := context.Background()

	adminURL := envOr("TEST_PG_ADMIN_URL", "postgres://postgres:devpass@localhost:5432/postgres?sslmode=disable")
	adminPool, err := db.Connect(ctx, adminURL)
	if err != nil {
		t.Skipf("postgres not available (%v) — run: docker compose up -d postgres redis", err)
	}
	adminPool.Exec(ctx, `DROP DATABASE IF EXISTS vitlive_test WITH (FORCE)`)
	if _, err := adminPool.Exec(ctx, `CREATE DATABASE vitlive_test`); err != nil {
		t.Fatalf("create test db: %v", err)
	}
	adminPool.Close()

	testURL := envOr("TEST_DATABASE_URL", "postgres://postgres:devpass@localhost:5432/vitlive_test?sslmode=disable")
	pool, err := db.Connect(ctx, testURL)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := db.Seed(ctx, pool, "admin@vit.ac.in", "admin12345"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	redisOpts, err := redis.ParseURL(envOr("TEST_REDIS_URL", "redis://localhost:6379/15"))
	if err != nil {
		t.Fatalf("redis url: %v", err)
	}
	rdb := redis.NewClient(redisOpts)
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("redis not available (%v) — run: docker compose up -d postgres redis", err)
	}
	rdb.FlushDB(ctx)
	t.Cleanup(func() { rdb.Close() })

	cfg := config.Load()
	cfg.AppEnv = "development" // dev OTPs in responses
	cfg.DatabaseURL = testURL
	cfg.UploadsDir = t.TempDir()
	cfg.S3Endpoint = "" // force local storage in tests

	srv, err := New(cfg, pool, rdb)
	if err != nil {
		t.Fatalf("server.New: %v", err)
	}
	return &testEnv{srv: srv}
}

// call sends a JSON request through the in-process app and decodes the response.
func (e *testEnv) call(t *testing.T, method, path, token string, body any) (int, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode body: %v", err)
		}
	}
	req, _ := http.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := e.srv.App.Test(req, 30_000)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	var decoded map[string]any
	json.NewDecoder(resp.Body).Decode(&decoded)
	return resp.StatusCode, decoded
}

func (e *testEnv) loginAdmin(t *testing.T) string {
	t.Helper()
	status, resp := e.call(t, "POST", "/api/v1/auth/login", "", map[string]any{
		"college_email": "admin@vit.ac.in", "password": "admin12345",
	})
	if status != 200 {
		t.Fatalf("admin login: status %d (%v)", status, resp)
	}
	return resp["access_token"].(string)
}

// signupStudent runs the full signup → OTP → login flow and returns a token.
func (e *testEnv) signupStudent(t *testing.T, email string) string {
	t.Helper()
	status, resp := e.call(t, "POST", "/api/v1/auth/signup", "", map[string]any{
		"college_email": email, "full_name": "Test Student",
		"password": "hunter2secret", "department_code": "CSE", "year_of_study": 2,
	})
	if status != 200 && status != 201 {
		t.Fatalf("signup: status %d (%v)", status, resp)
	}
	otp, ok := resp["dev_otp"].(string)
	if !ok || otp == "" {
		t.Fatalf("signup response missing dev_otp in development mode: %v", resp)
	}
	if status, resp := e.call(t, "POST", "/api/v1/auth/verify-otp", "", map[string]any{
		"college_email": email, "otp": otp,
	}); status != 200 {
		t.Fatalf("verify-otp: status %d (%v)", status, resp)
	}
	status, resp = e.call(t, "POST", "/api/v1/auth/login", "", map[string]any{
		"college_email": email, "password": "hunter2secret",
	})
	if status != 200 {
		t.Fatalf("student login: status %d (%v)", status, resp)
	}
	return resp["access_token"].(string)
}

func TestAPI(t *testing.T) {
	e := setup(t)
	adminToken := e.loginAdmin(t)
	studentToken := e.signupStudent(t, "student1@vitstudent.ac.in")

	t.Run("auth flow issues working tokens", func(t *testing.T) {
		status, me := e.call(t, "GET", "/api/v1/me", studentToken, nil)
		if status != 200 {
			t.Fatalf("/me: status %d", status)
		}
		user := me["user"].(map[string]any)
		if user["role"] != "student" || user["is_verified"] != true {
			t.Fatalf("unexpected /me payload: %v", user)
		}
	})

	t.Run("wrong password is rejected", func(t *testing.T) {
		status, _ := e.call(t, "POST", "/api/v1/auth/login", "", map[string]any{
			"college_email": "student1@vitstudent.ac.in", "password": "wrong-password",
		})
		if status != 401 {
			t.Fatalf("expected 401 for bad password, got %d", status)
		}
	})

	t.Run("RBAC blocks students from admin routes", func(t *testing.T) {
		for _, path := range []string{"/api/v1/admin/stats", "/api/v1/admin/analytics", "/api/v1/admin/users"} {
			if status, _ := e.call(t, "GET", path, studentToken, nil); status != 403 {
				t.Errorf("%s as student: expected 403, got %d", path, status)
			}
		}
		if status, _ := e.call(t, "GET", "/api/v1/admin/stats", adminToken, nil); status != 200 {
			t.Errorf("/admin/stats as admin: expected 200, got %d", status)
		}
		if status, _ := e.call(t, "GET", "/api/v1/admin/stats", "", nil); status != 401 {
			t.Errorf("/admin/stats unauthenticated: expected 401, got %d", status)
		}
	})

	t.Run("poll voting: once only, anonymously", func(t *testing.T) {
		status, resp := e.call(t, "POST", "/api/v1/admin/polls", adminToken, map[string]any{
			"question": "Best mess meal?", "options": []string{"Breakfast", "Lunch", "Dinner"},
		})
		if status != 200 && status != 201 {
			t.Fatalf("create poll: status %d (%v)", status, resp)
		}
		poll := resp["poll"].(map[string]any)
		pollID := poll["id"].(string)
		optionID := poll["options"].([]any)[0].(map[string]any)["id"].(string)

		status, resp = e.call(t, "POST", "/api/v1/polls/"+pollID+"/vote", studentToken, map[string]any{
			"option_ids": []string{optionID},
		})
		if status != 200 {
			t.Fatalf("vote: status %d (%v)", status, resp)
		}
		if status, _ = e.call(t, "POST", "/api/v1/polls/"+pollID+"/vote", studentToken, map[string]any{
			"option_ids": []string{optionID},
		}); status != 409 {
			t.Fatalf("second vote: expected 409, got %d", status)
		}

		// Anonymity: the stored voter token must be an opaque HMAC hex digest,
		// not the voter's user id.
		_, me := e.call(t, "GET", "/api/v1/me", studentToken, nil)
		userID := me["user"].(map[string]any)["id"].(string)

		ctx := context.Background()
		pool, err := db.Connect(ctx, envOr("TEST_DATABASE_URL", "postgres://postgres:devpass@localhost:5432/vitlive_test?sslmode=disable"))
		if err != nil {
			t.Fatalf("connect: %v", err)
		}
		defer pool.Close()
		var voterToken string
		if err := pool.QueryRow(ctx,
			`SELECT voter_token FROM poll_votes WHERE poll_id=$1`, pollID).Scan(&voterToken); err != nil {
			t.Fatalf("read voter_token: %v", err)
		}
		if voterToken == userID {
			t.Fatal("voter_token equals the user id — votes are NOT anonymous")
		}
		if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(voterToken) {
			t.Fatalf("voter_token is not an HMAC-SHA256 hex digest: %q", voterToken)
		}
		var votedRecorded bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM poll_voted_users WHERE poll_id=$1 AND user_id=$2)`,
			pollID, userID).Scan(&votedRecorded); err != nil || !votedRecorded {
			t.Fatalf("poll_voted_users missing the has-voted marker (err=%v)", err)
		}
	})

	t.Run("scheduled announcements are hidden until published", func(t *testing.T) {
		status, resp := e.call(t, "POST", "/api/v1/admin/announcements", adminToken, map[string]any{
			"title": "Future post", "body": "not yet", "publish_at": "2099-01-01T00:00:00Z",
		})
		if status != 201 {
			t.Fatalf("schedule: status %d (%v)", status, resp)
		}
		if resp["announcement"].(map[string]any)["scheduled"] != true {
			t.Fatalf("expected scheduled=true: %v", resp)
		}
		_, feed := e.call(t, "GET", "/api/v1/announcements", studentToken, nil)
		for _, it := range feed["items"].([]any) {
			if it.(map[string]any)["title"] == "Future post" {
				t.Fatal("scheduled announcement leaked into the student feed")
			}
		}
	})

	t.Run("reactions toggle", func(t *testing.T) {
		status, resp := e.call(t, "POST", "/api/v1/admin/announcements", adminToken, map[string]any{
			"title": "React to me", "body": "👍",
		})
		if status != 201 {
			t.Fatalf("create announcement: %d (%v)", status, resp)
		}
		annID := resp["announcement"].(map[string]any)["id"].(string)

		status, resp = e.call(t, "POST", "/api/v1/announcements/"+annID+"/react", studentToken, nil)
		if status != 200 || resp["my_reaction"] != true || resp["reaction_count"].(float64) != 1 {
			t.Fatalf("first react: %d (%v)", status, resp)
		}
		status, resp = e.call(t, "POST", "/api/v1/announcements/"+annID+"/react", studentToken, nil)
		if status != 200 || resp["my_reaction"] != false || resp["reaction_count"].(float64) != 0 {
			t.Fatalf("toggle off: %d (%v)", status, resp)
		}
	})
}

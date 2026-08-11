package notifications

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FCM sends push notifications via the FCM HTTP v1 API using a service
// account. When no service account is configured (local dev) sends are
// logged and skipped — the WebSocket path still delivers everything.
type FCM struct {
	db        *pgxpool.Pool
	projectID string
	clientEml string
	tokenURI  string
	key       any // *rsa.PrivateKey

	mu          sync.Mutex
	accessToken string
	expiry      time.Time
}

func NewFCM(db *pgxpool.Pool, serviceAccountPath string) *FCM {
	f := &FCM{db: db}
	if serviceAccountPath == "" {
		return f
	}
	raw, err := os.ReadFile(serviceAccountPath)
	if err != nil {
		log.Printf("fcm: cannot read service account file: %v (push disabled)", err)
		return f
	}
	var sa struct {
		ProjectID   string `json:"project_id"`
		PrivateKey  string `json:"private_key"`
		ClientEmail string `json:"client_email"`
		TokenURI    string `json:"token_uri"`
	}
	if err := json.Unmarshal(raw, &sa); err != nil {
		log.Printf("fcm: bad service account json: %v (push disabled)", err)
		return f
	}
	block, _ := pem.Decode([]byte(sa.PrivateKey))
	if block == nil {
		log.Printf("fcm: bad private key pem (push disabled)")
		return f
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		log.Printf("fcm: parse private key: %v (push disabled)", err)
		return f
	}
	f.projectID, f.clientEml, f.tokenURI, f.key = sa.ProjectID, sa.ClientEmail, sa.TokenURI, key
	log.Printf("fcm: configured for project %s", sa.ProjectID)
	return f
}

func (f *FCM) enabled() bool { return f.key != nil }

func (f *FCM) getAccessToken(ctx context.Context) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.accessToken != "" && time.Now().Before(f.expiry.Add(-2*time.Minute)) {
		return f.accessToken, nil
	}
	now := time.Now()
	claims := jwt.MapClaims{
		"iss":   f.clientEml,
		"scope": "https://www.googleapis.com/auth/firebase.messaging",
		"aud":   f.tokenURI,
		"iat":   now.Unix(),
		"exp":   now.Add(time.Hour).Unix(),
	}
	assertion, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(f.key)
	if err != nil {
		return "", err
	}
	form := url.Values{
		"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"},
		"assertion":  {assertion},
	}
	req, _ := http.NewRequestWithContext(ctx, "POST", f.tokenURI, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var tok struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return "", err
	}
	if tok.AccessToken == "" {
		return "", errors.New("empty access token from google oauth")
	}
	f.accessToken = tok.AccessToken
	f.expiry = time.Now().Add(time.Duration(tok.ExpiresIn) * time.Second)
	return f.accessToken, nil
}

func (f *FCM) tokensFor(ctx context.Context, userIDs []string) []string {
	var (
		rowsQuery = `SELECT fcm_token FROM device_tokens`
		args      []any
	)
	if userIDs != nil {
		rowsQuery += ` WHERE user_id = ANY($1)`
		args = append(args, userIDs)
	}
	rows, err := f.db.Query(ctx, rowsQuery, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var tokens []string
	for rows.Next() {
		var t string
		if rows.Scan(&t) == nil {
			tokens = append(tokens, t)
		}
	}
	return tokens
}

// Send pushes a high-priority notification to the given users
// (userIDs == nil means every registered device). Runs synchronously;
// call from a goroutine.
func (f *FCM) Send(title, body string, data map[string]string, userIDs []string) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	tokens := f.tokensFor(ctx, userIDs)
	if !f.enabled() {
		log.Printf("[fcm:dev] would push %q to %d device(s)", title, len(tokens))
		return
	}
	access, err := f.getAccessToken(ctx)
	if err != nil {
		log.Printf("fcm: token exchange failed: %v", err)
		return
	}
	endpoint := fmt.Sprintf("https://fcm.googleapis.com/v1/projects/%s/messages:send", f.projectID)
	sent := 0
	for _, t := range tokens {
		msg := map[string]any{
			"message": map[string]any{
				"token":        t,
				"notification": map[string]string{"title": title, "body": body},
				"data":         data,
				"android":      map[string]any{"priority": "high"},
				"apns": map[string]any{
					"headers": map[string]string{"apns-priority": "10"},
				},
			},
		}
		b, _ := json.Marshal(msg)
		req, _ := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(b))
		req.Header.Set("Authorization", "Bearer "+access)
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			continue
		}
		if resp.StatusCode == 200 {
			sent++
		} else if resp.StatusCode == 404 || resp.StatusCode == 410 {
			// stale token — clean up
			f.db.Exec(ctx, `DELETE FROM device_tokens WHERE fcm_token=$1`, t)
		}
		resp.Body.Close()
	}
	log.Printf("fcm: pushed %q to %d/%d device(s)", title, sent, len(tokens))
}

// Package payments wraps the Razorpay Orders API. Like FCM/SMTP/S3, it is
// env-gated: without RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET the backend runs in
// mock mode — orders are fake and confirm succeeds without a gateway, so the
// whole ticket flow is testable locally.
package payments

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type Razorpay struct {
	KeyID     string
	KeySecret string
	Client    *http.Client
}

func New(keyID, keySecret string) *Razorpay {
	return &Razorpay{KeyID: keyID, KeySecret: keySecret}
}

func (r *Razorpay) Enabled() bool { return r.KeyID != "" && r.KeySecret != "" }

// CreateOrder creates a Razorpay order for the given amount (in paise) and
// returns its id.
func (r *Razorpay) CreateOrder(ctx context.Context, amountPaise int, receipt string) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"amount":   amountPaise,
		"currency": "INR",
		"receipt":  receipt,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.razorpay.com/v1/orders", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.SetBasicAuth(r.KeyID, r.KeySecret)
	req.Header.Set("Content-Type", "application/json")

	client := r.Client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("razorpay order: %s: %s", resp.Status, string(b))
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if out.ID == "" {
		return "", fmt.Errorf("razorpay order: empty id in response")
	}
	return out.ID, nil
}

// VerifySignature checks the checkout callback signature:
// HMAC-SHA256(order_id + "|" + payment_id, key_secret).
func (r *Razorpay) VerifySignature(orderID, paymentID, signature string) bool {
	mac := hmac.New(sha256.New, []byte(r.KeySecret))
	mac.Write([]byte(orderID + "|" + paymentID))
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

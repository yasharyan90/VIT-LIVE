// Package storage abstracts where uploaded files live: local disk by default,
// any S3-compatible bucket (AWS, R2, MinIO) when S3_* env vars are set.
// Upload URLs returned to clients keep working either way.
package storage

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

type Store interface {
	// Save persists the content under name and returns the public URL path
	// clients should use to fetch it.
	Save(ctx context.Context, name, contentType string, r io.Reader, size int64) (string, error)
}

/* ---------- Local disk (default) ---------- */

type Local struct {
	Dir string
}

func NewLocal(dir string) (*Local, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &Local{Dir: dir}, nil
}

func (l *Local) Save(_ context.Context, name, _ string, r io.Reader, _ int64) (string, error) {
	dst, err := os.Create(filepath.Join(l.Dir, name))
	if err != nil {
		return "", err
	}
	defer dst.Close()
	if _, err := io.Copy(dst, r); err != nil {
		return "", err
	}
	return "/uploads/" + name, nil
}

/* ---------- S3-compatible (SigV4, streaming, no SDK) ---------- */

type S3 struct {
	Endpoint  string // e.g. https://<account>.r2.cloudflarestorage.com
	Bucket    string
	Region    string
	AccessKey string
	SecretKey string
	PublicURL string // public base for serving, e.g. https://cdn.example.com
	Client    *http.Client
}

func (s *S3) Save(ctx context.Context, name, contentType string, r io.Reader, size int64) (string, error) {
	u, err := url.Parse(strings.TrimRight(s.Endpoint, "/") + "/" + s.Bucket + "/" + name)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, u.String(), r)
	if err != nil {
		return "", err
	}
	req.ContentLength = size
	req.Header.Set("Content-Type", contentType)
	s.sign(req)

	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("s3 put %s: %s: %s", name, resp.Status, string(body))
	}
	return strings.TrimRight(s.PublicURL, "/") + "/" + name, nil
}

// sign applies AWS Signature Version 4 with an unsigned streaming payload.
func (s *S3) sign(req *http.Request) {
	const payloadHash = "UNSIGNED-PAYLOAD"
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")

	req.Header.Set("Host", req.URL.Host)
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)

	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	canonical := strings.Join([]string{
		req.Method,
		req.URL.EscapedPath(),
		req.URL.RawQuery,
		"host:" + req.URL.Host + "\n" +
			"x-amz-content-sha256:" + payloadHash + "\n" +
			"x-amz-date:" + amzDate + "\n",
		signedHeaders,
		payloadHash,
	}, "\n")

	scope := dateStamp + "/" + s.Region + "/s3/aws4_request"
	toSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		hexSHA256([]byte(canonical)),
	}, "\n")

	kDate := hmacSHA256([]byte("AWS4"+s.SecretKey), dateStamp)
	kRegion := hmacSHA256(kDate, s.Region)
	kService := hmacSHA256(kRegion, "s3")
	kSigning := hmacSHA256(kService, "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(kSigning, toSign))

	req.Header.Set("Authorization", fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		s.AccessKey, scope, signedHeaders, signature))
}

func hexSHA256(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func hmacSHA256(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(data))
	return mac.Sum(nil)
}

/* ---------- Image upload validation (shared by all handlers) ---------- */

const maxImageBytes = 5 << 20 // 5 MB

var allowedImageExt = map[string]string{
	".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
	".webp": "image/webp", ".gif": "image/gif",
}

// SaveImage validates an uploaded image (size, extension, magic bytes) and
// stores it via the given Store, returning its public URL.
func SaveImage(ctx context.Context, store Store, file *multipart.FileHeader) (string, error) {
	if file.Size > maxImageBytes {
		return "", fiber.NewError(400, "image too large (max 5 MB)")
	}
	ext := strings.ToLower(filepath.Ext(file.Filename))
	contentType, ok := allowedImageExt[ext]
	if !ok {
		return "", fiber.NewError(400, "unsupported image type")
	}
	src, err := file.Open()
	if err != nil {
		return "", err
	}
	defer src.Close()
	// Sniff actual content type — don't trust the filename alone.
	head := make([]byte, 512)
	n, _ := io.ReadFull(src, head)
	if !strings.HasPrefix(detectImageType(head[:n]), "image/") {
		return "", fiber.NewError(400, "file is not an image")
	}
	if _, err := src.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	name := uuid.NewString() + ext
	return store.Save(ctx, name, contentType, src, file.Size)
}

func detectImageType(head []byte) string {
	switch {
	case len(head) > 3 && head[0] == 0xFF && head[1] == 0xD8:
		return "image/jpeg"
	case len(head) > 8 && string(head[1:4]) == "PNG":
		return "image/png"
	case len(head) > 6 && string(head[:3]) == "GIF":
		return "image/gif"
	case len(head) > 12 && string(head[8:12]) == "WEBP":
		return "image/webp"
	default:
		return "unknown"
	}
}

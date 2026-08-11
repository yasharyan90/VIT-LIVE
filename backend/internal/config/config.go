package config

import (
	"os"
	"strings"
)

type Config struct {
	AppEnv         string // development | production
	Port           string
	DatabaseURL    string
	RedisURL       string
	JWTSecret      string
	VoteHMACSecret string
	AllowedDomains []string
	UploadsDir     string

	// Optional integrations — features degrade gracefully when unset.
	SMTPHost string
	SMTPPort string
	SMTPUser string
	SMTPPass string
	SMTPFrom string

	FCMServiceAccountJSON string // path to service-account file, or empty

	// S3-compatible object storage for uploads (optional; local disk when unset).
	S3Endpoint  string
	S3Bucket    string
	S3Region    string
	S3AccessKey string
	S3SecretKey string
	S3PublicURL string

	SuperAdminEmail    string
	SuperAdminPassword string
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func Load() *Config {
	domains := strings.Split(env("ALLOWED_EMAIL_DOMAINS", "vitbhopal.ac.in,vitstudent.ac.in,vit.ac.in"), ",")
	for i := range domains {
		domains[i] = strings.ToLower(strings.TrimSpace(domains[i]))
	}
	return &Config{
		AppEnv:                env("APP_ENV", "development"),
		Port:                  env("PORT", "8080"),
		DatabaseURL:           env("DATABASE_URL", "postgres://postgres:devpass@localhost:5432/vitlive?sslmode=disable"),
		RedisURL:              env("REDIS_URL", "redis://localhost:6379/0"),
		JWTSecret:             env("JWT_SECRET", "dev-jwt-secret-change-me"),
		VoteHMACSecret:        env("VOTE_HMAC_SECRET", "dev-vote-hmac-secret-change-me"),
		AllowedDomains:        domains,
		UploadsDir:            env("UPLOADS_DIR", "./uploads"),
		SMTPHost:              os.Getenv("SMTP_HOST"),
		SMTPPort:              env("SMTP_PORT", "587"),
		SMTPUser:              os.Getenv("SMTP_USER"),
		SMTPPass:              os.Getenv("SMTP_PASS"),
		SMTPFrom:              env("SMTP_FROM", "VIT Live <no-reply@vitlive.app>"),
		FCMServiceAccountJSON: os.Getenv("FCM_SERVICE_ACCOUNT_JSON"),
		S3Endpoint:            os.Getenv("S3_ENDPOINT"),
		S3Bucket:              os.Getenv("S3_BUCKET"),
		S3Region:              env("S3_REGION", "auto"),
		S3AccessKey:           os.Getenv("S3_ACCESS_KEY"),
		S3SecretKey:           os.Getenv("S3_SECRET_KEY"),
		S3PublicURL:           os.Getenv("S3_PUBLIC_URL"),
		SuperAdminEmail:       env("SUPERADMIN_EMAIL", "admin@vit.ac.in"),
		SuperAdminPassword:    env("SUPERADMIN_PASSWORD", "admin12345"),
	}
}

func (c *Config) IsDev() bool { return c.AppEnv == "development" }

func (c *Config) DomainAllowed(email string) bool {
	at := strings.LastIndex(email, "@")
	if at < 0 {
		return false
	}
	domain := strings.ToLower(email[at+1:])
	for _, d := range c.AllowedDomains {
		if domain == d {
			return true
		}
	}
	return false
}

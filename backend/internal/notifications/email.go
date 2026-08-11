package notifications

import (
	"fmt"
	"log"
	"net/smtp"

	"vitlive/internal/config"
)

// Mailer sends transactional email via SMTP; without SMTP config (local dev)
// it logs the message instead so the flow still works end to end.
type Mailer struct {
	cfg *config.Config
}

func NewMailer(cfg *config.Config) *Mailer { return &Mailer{cfg: cfg} }

func (m *Mailer) SendOTP(to, otp string) {
	subject := "Your VIT Live verification code"
	body := fmt.Sprintf("Your VIT Live OTP is %s. It expires in 10 minutes.", otp)
	m.send(to, subject, body)
}

func (m *Mailer) send(to, subject, body string) {
	if m.cfg.SMTPHost == "" {
		log.Printf("[mail:dev] to=%s subject=%q body=%q", to, subject, body)
		return
	}
	go func() {
		addr := m.cfg.SMTPHost + ":" + m.cfg.SMTPPort
		msg := []byte("From: " + m.cfg.SMTPFrom + "\r\nTo: " + to +
			"\r\nSubject: " + subject + "\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n" + body + "\r\n")
		var auth smtp.Auth
		if m.cfg.SMTPUser != "" {
			auth = smtp.PlainAuth("", m.cfg.SMTPUser, m.cfg.SMTPPass, m.cfg.SMTPHost)
		}
		if err := smtp.SendMail(addr, auth, m.cfg.SMTPFrom, []string{to}, msg); err != nil {
			log.Printf("smtp send to %s failed: %v", to, err)
		}
	}()
}

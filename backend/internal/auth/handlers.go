package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"

	"vitlive/internal/config"
	"vitlive/internal/models"
	"vitlive/internal/notifications"
	"vitlive/internal/storage"
)

const maxOTPAttempts = 5

type Handler struct {
	DB     *pgxpool.Pool
	RDB    *redis.Client
	Cfg    *config.Config
	Mailer *notifications.Mailer
	Store  storage.Store
}

// PATCH /api/v1/me (multipart) — edit your own profile: name, bio, phone,
// residence (hosteller block/room or day scholar) and avatar image.
func (h *Handler) UpdateMe(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	ctx := c.Context()

	fullName := strings.TrimSpace(c.FormValue("full_name"))
	if fullName == "" {
		return errJSON(c, 400, "full_name is required")
	}
	if len(fullName) > 80 {
		return errJSON(c, 400, "name must be under 80 characters")
	}
	bio := strings.TrimSpace(c.FormValue("bio"))
	if len(bio) > 280 {
		return errJSON(c, 400, "bio must be under 280 characters")
	}
	phone := strings.TrimSpace(c.FormValue("phone"))
	if len(phone) > 20 {
		return errJSON(c, 400, "phone must be under 20 characters")
	}

	var residence *string
	hostelBlock, roomNumber := "", ""
	switch v := c.FormValue("residence_type"); v {
	case "hosteller":
		residence = &v
		hostelBlock = strings.TrimSpace(c.FormValue("hostel_block"))
		roomNumber = strings.TrimSpace(c.FormValue("room_number"))
		if len(hostelBlock) > 40 || len(roomNumber) > 20 {
			return errJSON(c, 400, "hostel block / room is too long")
		}
	case "day_scholar":
		residence = &v
	case "":
		// not specified — stays unset
	default:
		return errJSON(c, 400, "residence_type must be hosteller or day_scholar")
	}

	var avatarURL *string
	if file, err := c.FormFile("avatar"); err == nil && file != nil {
		url, err := storage.SaveImage(ctx, h.Store, file)
		if err != nil {
			if fe, ok := err.(*fiber.Error); ok {
				return errJSON(c, fe.Code, fe.Message)
			}
			return errJSON(c, 500, "could not store avatar")
		}
		avatarURL = &url
	}

	if avatarURL != nil {
		_, err := h.DB.Exec(ctx,
			`UPDATE users SET full_name=$1, bio=$2, phone=$3, residence_type=$4,
			        hostel_block=$5, room_number=$6, avatar_url=$7 WHERE id=$8`,
			fullName, bio, phone, residence, hostelBlock, roomNumber, *avatarURL, userID)
		if err != nil {
			return errJSON(c, 500, "internal error")
		}
	} else {
		_, err := h.DB.Exec(ctx,
			`UPDATE users SET full_name=$1, bio=$2, phone=$3, residence_type=$4,
			        hostel_block=$5, room_number=$6 WHERE id=$7`,
			fullName, bio, phone, residence, hostelBlock, roomNumber, userID)
		if err != nil {
			return errJSON(c, 500, "internal error")
		}
	}

	user, err := h.LoadUser(ctx, "id", userID)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	return c.JSON(fiber.Map{"user": user})
}

func generateOTP() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func hashOTP(otp string) string {
	sum := sha256.Sum256([]byte(otp))
	return hex.EncodeToString(sum[:])
}

func errJSON(c *fiber.Ctx, status int, msg string) error {
	return c.Status(status).JSON(fiber.Map{"error": msg})
}

// LoadUser fetches a user (by id or email) with department info joined.
func (h *Handler) LoadUser(ctx context.Context, by, value string) (*models.User, error) {
	q := `SELECT u.id::text, u.college_email, u.full_name, u.role, u.department_id::text,
	             d.code, d.name, u.year_of_study, u.is_verified, u.created_at,
	             u.avatar_url, u.bio, u.phone, u.residence_type, u.hostel_block, u.room_number,
	             u.password_hash
	      FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE `
	switch by {
	case "id":
		q += "u.id = $1"
	default:
		q += "u.college_email = $1"
	}
	var u models.User
	var passwordHash string
	err := h.DB.QueryRow(ctx, q, value).Scan(
		&u.ID, &u.CollegeEmail, &u.FullName, &u.Role, &u.DepartmentID,
		&u.DepartmentCode, &u.DepartmentName, &u.YearOfStudy, &u.IsVerified, &u.CreatedAt,
		&u.AvatarURL, &u.Bio, &u.Phone, &u.ResidenceType, &u.HostelBlock, &u.RoomNumber,
		&passwordHash)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (h *Handler) passwordHashFor(ctx context.Context, email string) (string, error) {
	var hash string
	err := h.DB.QueryRow(ctx, `SELECT password_hash FROM users WHERE college_email=$1`, email).Scan(&hash)
	return hash, err
}

func (h *Handler) createAndSendOTP(ctx context.Context, email string) (string, error) {
	otp, err := generateOTP()
	if err != nil {
		return "", err
	}
	if _, err := h.DB.Exec(ctx, `DELETE FROM otp_verifications WHERE user_email=$1`, email); err != nil {
		return "", err
	}
	if _, err := h.DB.Exec(ctx,
		`INSERT INTO otp_verifications(user_email, otp_hash, expires_at) VALUES($1,$2,$3)`,
		email, hashOTP(otp), time.Now().Add(10*time.Minute)); err != nil {
		return "", err
	}
	h.Mailer.SendOTP(email, otp)
	return otp, nil
}

// POST /api/v1/auth/signup
func (h *Handler) Signup(c *fiber.Ctx) error {
	var req struct {
		CollegeEmail   string `json:"college_email"`
		FullName       string `json:"full_name"`
		Password       string `json:"password"`
		DepartmentCode string `json:"department_code"`
		YearOfStudy    *int   `json:"year_of_study"`
	}
	if err := c.BodyParser(&req); err != nil {
		return errJSON(c, 400, "invalid request body")
	}
	req.CollegeEmail = strings.ToLower(strings.TrimSpace(req.CollegeEmail))
	req.FullName = strings.TrimSpace(req.FullName)
	if req.CollegeEmail == "" || req.FullName == "" {
		return errJSON(c, 400, "email and full name are required")
	}
	if !h.Cfg.DomainAllowed(req.CollegeEmail) {
		return errJSON(c, 400, "use your college email ("+strings.Join(h.Cfg.AllowedDomains, ", ")+")")
	}
	if len(req.Password) < 8 {
		return errJSON(c, 400, "password must be at least 8 characters")
	}
	if req.YearOfStudy != nil && (*req.YearOfStudy < 1 || *req.YearOfStudy > 5) {
		return errJSON(c, 400, "year_of_study must be between 1 and 5")
	}

	ctx := c.Context()
	var deptID *string
	if req.DepartmentCode != "" {
		var id string
		err := h.DB.QueryRow(ctx, `SELECT id::text FROM departments WHERE code=$1`, req.DepartmentCode).Scan(&id)
		if err != nil {
			return errJSON(c, 400, "unknown department code")
		}
		deptID = &id
	}

	passHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}

	var existingVerified bool
	err = h.DB.QueryRow(ctx, `SELECT is_verified FROM users WHERE college_email=$1`, req.CollegeEmail).Scan(&existingVerified)
	switch {
	case err == nil && existingVerified:
		return errJSON(c, 409, "an account with this email already exists")
	case err == nil: // unverified re-signup: refresh details
		if _, err := h.DB.Exec(ctx,
			`UPDATE users SET full_name=$1, password_hash=$2, department_id=$3, year_of_study=$4 WHERE college_email=$5`,
			req.FullName, string(passHash), deptID, req.YearOfStudy, req.CollegeEmail); err != nil {
			return errJSON(c, 500, "internal error")
		}
	case err == pgx.ErrNoRows:
		if _, err := h.DB.Exec(ctx,
			`INSERT INTO users(college_email, full_name, password_hash, department_id, year_of_study) VALUES($1,$2,$3,$4,$5)`,
			req.CollegeEmail, req.FullName, string(passHash), deptID, req.YearOfStudy); err != nil {
			return errJSON(c, 500, "internal error")
		}
	default:
		return errJSON(c, 500, "internal error")
	}

	otp, err := h.createAndSendOTP(ctx, req.CollegeEmail)
	if err != nil {
		return errJSON(c, 500, "could not send OTP")
	}
	resp := fiber.Map{"message": "OTP sent to your college email"}
	if h.Cfg.IsDev() {
		resp["dev_otp"] = otp
	}
	return c.Status(201).JSON(resp)
}

// POST /api/v1/auth/verify-otp
func (h *Handler) VerifyOTP(c *fiber.Ctx) error {
	var req struct {
		CollegeEmail string `json:"college_email"`
		OTP          string `json:"otp"`
	}
	if err := c.BodyParser(&req); err != nil {
		return errJSON(c, 400, "invalid request body")
	}
	req.CollegeEmail = strings.ToLower(strings.TrimSpace(req.CollegeEmail))
	ctx := c.Context()

	var id, otpHash string
	var expiresAt time.Time
	var attempts int
	err := h.DB.QueryRow(ctx,
		`SELECT id::text, otp_hash, expires_at, attempts FROM otp_verifications
		 WHERE user_email=$1 ORDER BY created_at DESC LIMIT 1`, req.CollegeEmail).
		Scan(&id, &otpHash, &expiresAt, &attempts)
	if err != nil {
		return errJSON(c, 400, "no pending verification — sign up or resend the OTP")
	}
	if time.Now().After(expiresAt) {
		return errJSON(c, 400, "OTP expired — request a new one")
	}
	if attempts >= maxOTPAttempts {
		return errJSON(c, 429, "too many attempts — request a new OTP")
	}
	if hashOTP(strings.TrimSpace(req.OTP)) != otpHash {
		h.DB.Exec(ctx, `UPDATE otp_verifications SET attempts=attempts+1 WHERE id=$1`, id)
		return errJSON(c, 400, "incorrect OTP")
	}
	if _, err := h.DB.Exec(ctx, `UPDATE users SET is_verified=TRUE WHERE college_email=$1`, req.CollegeEmail); err != nil {
		return errJSON(c, 500, "internal error")
	}
	h.DB.Exec(ctx, `DELETE FROM otp_verifications WHERE user_email=$1`, req.CollegeEmail)
	return c.JSON(fiber.Map{"message": "email verified — you can now log in"})
}

// POST /api/v1/auth/resend-otp
func (h *Handler) ResendOTP(c *fiber.Ctx) error {
	var req struct {
		CollegeEmail string `json:"college_email"`
	}
	if err := c.BodyParser(&req); err != nil {
		return errJSON(c, 400, "invalid request body")
	}
	req.CollegeEmail = strings.ToLower(strings.TrimSpace(req.CollegeEmail))
	ctx := c.Context()
	var verified bool
	if err := h.DB.QueryRow(ctx, `SELECT is_verified FROM users WHERE college_email=$1`, req.CollegeEmail).Scan(&verified); err != nil {
		return errJSON(c, 404, "no account with this email")
	}
	if verified {
		return errJSON(c, 400, "account already verified — just log in")
	}
	otp, err := h.createAndSendOTP(ctx, req.CollegeEmail)
	if err != nil {
		return errJSON(c, 500, "could not send OTP")
	}
	resp := fiber.Map{"message": "OTP re-sent"}
	if h.Cfg.IsDev() {
		resp["dev_otp"] = otp
	}
	return c.JSON(resp)
}

func (h *Handler) issueTokenPair(ctx context.Context, userID, role string) (string, string, error) {
	access, err := IssueAccessToken(h.Cfg.JWTSecret, userID, role)
	if err != nil {
		return "", "", err
	}
	refreshPlain, refreshHash, err := NewRefreshToken()
	if err != nil {
		return "", "", err
	}
	if err := h.RDB.Set(ctx, "refresh:"+refreshHash, userID, RefreshTokenTTL).Err(); err != nil {
		return "", "", err
	}
	return access, refreshPlain, nil
}

// POST /api/v1/auth/login
func (h *Handler) Login(c *fiber.Ctx) error {
	var req struct {
		CollegeEmail string `json:"college_email"`
		Password     string `json:"password"`
	}
	if err := c.BodyParser(&req); err != nil {
		return errJSON(c, 400, "invalid request body")
	}
	req.CollegeEmail = strings.ToLower(strings.TrimSpace(req.CollegeEmail))
	ctx := c.Context()

	user, err := h.LoadUser(ctx, "email", req.CollegeEmail)
	if err != nil {
		return errJSON(c, 401, "invalid email or password")
	}
	passHash, err := h.passwordHashFor(ctx, req.CollegeEmail)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(passHash), []byte(req.Password)) != nil {
		return errJSON(c, 401, "invalid email or password")
	}
	if !user.IsVerified {
		return errJSON(c, 403, "account not verified")
	}
	access, refresh, err := h.issueTokenPair(ctx, user.ID, user.Role)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	return c.JSON(fiber.Map{"access_token": access, "refresh_token": refresh, "user": user})
}

// POST /api/v1/auth/refresh
func (h *Handler) Refresh(c *fiber.Ctx) error {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.BodyParser(&req); err != nil || req.RefreshToken == "" {
		return errJSON(c, 400, "refresh_token required")
	}
	ctx := c.Context()
	key := "refresh:" + HashToken(req.RefreshToken)
	userID, err := h.RDB.Get(ctx, key).Result()
	if err != nil {
		return errJSON(c, 401, "invalid refresh token")
	}
	h.RDB.Del(ctx, key) // rotate: single use
	var role string
	if err := h.DB.QueryRow(ctx, `SELECT role FROM users WHERE id=$1`, userID).Scan(&role); err != nil {
		return errJSON(c, 401, "user no longer exists")
	}
	access, refresh, err := h.issueTokenPair(ctx, userID, role)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	return c.JSON(fiber.Map{"access_token": access, "refresh_token": refresh})
}

// GET /api/v1/me
func (h *Handler) Me(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	ctx := c.Context()
	user, err := h.LoadUser(ctx, "id", userID)
	if err != nil {
		return errJSON(c, 404, "user not found")
	}
	rows, err := h.DB.Query(ctx, `SELECT club_id::text FROM club_members WHERE user_id=$1`, userID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil {
				user.FollowedClubIDs = append(user.FollowedClubIDs, id)
			}
		}
	}
	if user.FollowedClubIDs == nil {
		user.FollowedClubIDs = []string{}
	}
	return c.JSON(fiber.Map{"user": user})
}

// POST /api/v1/me/device-token
func (h *Handler) RegisterDeviceToken(c *fiber.Ctx) error {
	var req struct {
		FCMToken string `json:"fcm_token"`
		Platform string `json:"platform"`
	}
	if err := c.BodyParser(&req); err != nil || req.FCMToken == "" {
		return errJSON(c, 400, "fcm_token required")
	}
	userID := c.Locals("userID").(string)
	if _, err := h.DB.Exec(c.Context(),
		`INSERT INTO device_tokens(user_id, fcm_token, platform) VALUES($1,$2,$3)
		 ON CONFLICT (fcm_token) DO UPDATE SET user_id=$1, platform=$3, updated_at=now()`,
		userID, req.FCMToken, req.Platform); err != nil {
		return errJSON(c, 500, "internal error")
	}
	return c.JSON(fiber.Map{"message": "device token registered"})
}

// GET /api/v1/departments (public — needed on the signup screen)
func (h *Handler) Departments(c *fiber.Ctx) error {
	rows, err := h.DB.Query(c.Context(), `SELECT id::text, name, code FROM departments ORDER BY name`)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	defer rows.Close()
	items := []models.Department{}
	for rows.Next() {
		var d models.Department
		if rows.Scan(&d.ID, &d.Name, &d.Code) == nil {
			items = append(items, d)
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

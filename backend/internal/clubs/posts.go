// Club social feed: the club account posts public updates (announcements,
// banner reveals, news); followers see them live and can like them.

package clubs

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"vitlive/internal/models"
	"vitlive/internal/storage"
	"vitlive/internal/ws"
)

var validPostKinds = map[string]bool{"announcement": true, "banner": true, "news": true}

const postCols = `p.id::text, p.club_id::text, c.name, p.kind, p.body, p.image_url,
	COALESCE(u.full_name,''), p.created_at,
	(SELECT COUNT(*) FROM club_post_likes l WHERE l.post_id=p.id),
	EXISTS(SELECT 1 FROM club_post_likes l WHERE l.post_id=p.id AND l.user_id=$1),
	(SELECT COUNT(*) FROM club_post_comments cc WHERE cc.post_id=p.id)`

const postFrom = ` FROM club_posts p JOIN clubs c ON c.id=p.club_id LEFT JOIN users u ON u.id=p.created_by `

func scanPosts(rows interface {
	Next() bool
	Scan(...any) error
	Close()
}) []models.ClubPost {
	items := []models.ClubPost{}
	for rows.Next() {
		var p models.ClubPost
		if rows.Scan(&p.ID, &p.ClubID, &p.ClubName, &p.Kind, &p.Body, &p.ImageURL,
			&p.AuthorName, &p.CreatedAt, &p.LikeCount, &p.MyLike, &p.CommentCount) == nil {
			items = append(items, p)
		}
	}
	return items
}

// resolveClubForWrite: club accounts always act on their own club; super
// admins pass club_id explicitly.
func (h *Handler) resolveClubForWrite(c *fiber.Ctx, requested string) (string, error) {
	userID := c.Locals("userID").(string)
	if c.Locals("role").(string) == "club_admin" {
		var myClub string
		if err := h.DB.QueryRow(c.Context(),
			`SELECT id::text FROM clubs WHERE admin_id=$1`, userID).Scan(&myClub); err != nil {
			return "", fiber.NewError(403, "no club is assigned to your account")
		}
		return myClub, nil
	}
	if requested == "" {
		return "", fiber.NewError(400, "club_id is required")
	}
	var exists bool
	if err := h.DB.QueryRow(c.Context(),
		`SELECT EXISTS(SELECT 1 FROM clubs WHERE id=$1)`, requested).Scan(&exists); err != nil || !exists {
		return "", fiber.NewError(404, "club not found")
	}
	return requested, nil
}

// POST /api/v1/admin/club-posts (multipart: kind, body, image?, club_id for super admins)
func (h *Handler) CreatePost(c *fiber.Ctx) error {
	clubID, err := h.resolveClubForWrite(c, c.FormValue("club_id"))
	if err != nil {
		fe := err.(*fiber.Error)
		return errJSON(c, fe.Code, fe.Message)
	}
	kind := c.FormValue("kind")
	if !validPostKinds[kind] {
		kind = "announcement"
	}
	body := strings.TrimSpace(c.FormValue("body"))

	var imageURL *string
	if file, err := c.FormFile("image"); err == nil && file != nil {
		url, err := storage.SaveImage(c.Context(), h.Store, file)
		if err != nil {
			if fe, ok := err.(*fiber.Error); ok {
				return errJSON(c, fe.Code, fe.Message)
			}
			return errJSON(c, 500, "could not store image")
		}
		imageURL = &url
	}
	if body == "" && imageURL == nil {
		return errJSON(c, 400, "post needs text or an image")
	}

	userID := c.Locals("userID").(string)
	ctx := c.Context()
	var postID string
	if err := h.DB.QueryRow(ctx,
		`INSERT INTO club_posts(club_id, kind, body, image_url, created_by)
		 VALUES($1,$2,$3,$4,$5) RETURNING id::text`,
		clubID, kind, body, imageURL, userID).Scan(&postID); err != nil {
		return errJSON(c, 500, "internal error")
	}

	rows, err := h.DB.Query(ctx, `SELECT `+postCols+postFrom+`WHERE p.id=$2`, userID, postID)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	posts := scanPosts(rows)
	if len(posts) == 0 {
		return errJSON(c, 500, "internal error")
	}
	post := posts[0]

	topic := "club:" + clubID
	ws.Publish(ctx, h.RDB, topic, ws.NewEnvelope("clubpost.new", topic, post))
	h.Audit.Log(ctx, userID, "clubpost.create", postID, map[string]any{"club_id": clubID, "kind": kind})
	return c.Status(201).JSON(fiber.Map{"post": post})
}

// DELETE /api/v1/admin/club-posts/:id — the club's own account or a super admin.
func (h *Handler) DeletePost(c *fiber.Ctx) error {
	postID := c.Params("id")
	userID := c.Locals("userID").(string)
	ctx := c.Context()

	var clubID string
	if err := h.DB.QueryRow(ctx,
		`SELECT club_id::text FROM club_posts WHERE id=$1`, postID).Scan(&clubID); err != nil {
		return errJSON(c, 404, "post not found")
	}
	if c.Locals("role").(string) == "club_admin" {
		var myClub *string
		h.DB.QueryRow(ctx, `SELECT id::text FROM clubs WHERE admin_id=$1`, userID).Scan(&myClub)
		if myClub == nil || *myClub != clubID {
			return errJSON(c, 403, "this post belongs to another club")
		}
	}
	if _, err := h.DB.Exec(ctx, `DELETE FROM club_posts WHERE id=$1`, postID); err != nil {
		return errJSON(c, 500, "internal error")
	}
	topic := "club:" + clubID
	ws.Publish(ctx, h.RDB, topic, ws.NewEnvelope("clubpost.deleted", topic, fiber.Map{"id": postID}))
	h.Audit.Log(ctx, userID, "clubpost.delete", postID, nil)
	return c.JSON(fiber.Map{"message": "post deleted"})
}

// GET /api/v1/admin/club-posts[?club_id=] — manage view. Club accounts get
// their own club implicitly; super admins pass club_id.
func (h *Handler) AdminListPosts(c *fiber.Ctx) error {
	clubID, err := h.resolveClubForWrite(c, c.Query("club_id"))
	if err != nil {
		fe := err.(*fiber.Error)
		return errJSON(c, fe.Code, fe.Message)
	}
	userID := c.Locals("userID").(string)
	var clubName string
	h.DB.QueryRow(c.Context(), `SELECT name FROM clubs WHERE id=$1`, clubID).Scan(&clubName)
	rows, err := h.DB.Query(c.Context(),
		`SELECT `+postCols+postFrom+`WHERE p.club_id=$2 ORDER BY p.created_at DESC LIMIT 100`,
		userID, clubID)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	return c.JSON(fiber.Map{
		"club":  fiber.Map{"id": clubID, "name": clubName},
		"items": scanPosts(rows),
	})
}

// GET /api/v1/clubs/:id/posts — a club's public timeline.
func (h *Handler) ListPosts(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	rows, err := h.DB.Query(c.Context(),
		`SELECT `+postCols+postFrom+`WHERE p.club_id=$2 ORDER BY p.created_at DESC LIMIT 50`,
		userID, c.Params("id"))
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	return c.JSON(fiber.Map{"items": scanPosts(rows)})
}

// GET /api/v1/feed/clubs — the social feed: posts from every club you follow.
func (h *Handler) FollowedFeed(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	rows, err := h.DB.Query(c.Context(),
		`SELECT `+postCols+postFrom+`
		 WHERE p.club_id IN (SELECT club_id FROM club_members WHERE user_id=$1)
		 ORDER BY p.created_at DESC LIMIT 50`, userID)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	return c.JSON(fiber.Map{"items": scanPosts(rows)})
}

// GET /api/v1/club-posts/:id/comments — a post's comments, oldest first.
func (h *Handler) ListComments(c *fiber.Ctx) error {
	rows, err := h.DB.Query(c.Context(),
		`SELECT cc.id::text, cc.post_id::text, cc.user_id::text, u.full_name, u.avatar_url,
		        cc.body, cc.created_at
		 FROM club_post_comments cc JOIN users u ON u.id=cc.user_id
		 WHERE cc.post_id=$1 ORDER BY cc.created_at ASC LIMIT 200`, c.Params("id"))
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	defer rows.Close()
	items := []models.ClubPostComment{}
	for rows.Next() {
		var cm models.ClubPostComment
		if rows.Scan(&cm.ID, &cm.PostID, &cm.UserID, &cm.UserName, &cm.AvatarURL,
			&cm.Body, &cm.CreatedAt) == nil {
			items = append(items, cm)
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

// POST /api/v1/club-posts/:id/comments {"body": "..."} — anyone can comment.
func (h *Handler) CreateComment(c *fiber.Ctx) error {
	var req struct {
		Body string `json:"body"`
	}
	if err := c.BodyParser(&req); err != nil {
		return errJSON(c, 400, "invalid request body")
	}
	req.Body = strings.TrimSpace(req.Body)
	if req.Body == "" {
		return errJSON(c, 400, "comment is empty")
	}
	if len(req.Body) > 500 {
		return errJSON(c, 400, "comment too long (max 500 characters)")
	}
	postID := c.Params("id")
	userID := c.Locals("userID").(string)
	ctx := c.Context()

	var clubID string
	if err := h.DB.QueryRow(ctx,
		`SELECT club_id::text FROM club_posts WHERE id=$1`, postID).Scan(&clubID); err != nil {
		return errJSON(c, 404, "post not found")
	}

	var cm models.ClubPostComment
	cm.PostID, cm.UserID, cm.Body = postID, userID, req.Body
	if err := h.DB.QueryRow(ctx,
		`INSERT INTO club_post_comments(post_id, user_id, body)
		 VALUES($1,$2,$3) RETURNING id::text, created_at`,
		postID, userID, req.Body).Scan(&cm.ID, &cm.CreatedAt); err != nil {
		return errJSON(c, 500, "internal error")
	}
	h.DB.QueryRow(ctx, `SELECT full_name, avatar_url FROM users WHERE id=$1`, userID).
		Scan(&cm.UserName, &cm.AvatarURL)

	var count int
	h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM club_post_comments WHERE post_id=$1`, postID).Scan(&count)
	topic := "club:" + clubID
	ws.Publish(ctx, h.RDB, topic, ws.NewEnvelope("clubpost.comment", topic,
		fiber.Map{"post_id": postID, "comment_count": count, "comment": cm}))
	return c.Status(201).JSON(fiber.Map{"comment": cm, "comment_count": count})
}

// DELETE /api/v1/club-posts/:id/comments/:commentID — the comment's author,
// the club's account, or a super admin.
func (h *Handler) DeleteComment(c *fiber.Ctx) error {
	postID, commentID := c.Params("id"), c.Params("commentID")
	userID := c.Locals("userID").(string)
	role := c.Locals("role").(string)
	ctx := c.Context()

	var authorID, clubID string
	if err := h.DB.QueryRow(ctx,
		`SELECT cc.user_id::text, p.club_id::text
		 FROM club_post_comments cc JOIN club_posts p ON p.id=cc.post_id
		 WHERE cc.id=$1 AND cc.post_id=$2`, commentID, postID).Scan(&authorID, &clubID); err != nil {
		return errJSON(c, 404, "comment not found")
	}
	allowed := authorID == userID || role == "super_admin"
	if !allowed && role == "club_admin" {
		var myClub *string
		h.DB.QueryRow(ctx, `SELECT id::text FROM clubs WHERE admin_id=$1`, userID).Scan(&myClub)
		allowed = myClub != nil && *myClub == clubID
	}
	if !allowed {
		return errJSON(c, 403, "you can only delete your own comments")
	}
	h.DB.Exec(ctx, `DELETE FROM club_post_comments WHERE id=$1`, commentID)

	var count int
	h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM club_post_comments WHERE post_id=$1`, postID).Scan(&count)
	topic := "club:" + clubID
	ws.Publish(ctx, h.RDB, topic, ws.NewEnvelope("clubpost.comment", topic,
		fiber.Map{"post_id": postID, "comment_count": count}))
	return c.JSON(fiber.Map{"message": "deleted", "comment_count": count})
}

// POST /api/v1/club-posts/:id/like — toggle the caller's like.
func (h *Handler) LikePost(c *fiber.Ctx) error {
	postID := c.Params("id")
	userID := c.Locals("userID").(string)
	ctx := c.Context()

	var clubID string
	if err := h.DB.QueryRow(ctx,
		`SELECT club_id::text FROM club_posts WHERE id=$1`, postID).Scan(&clubID); err != nil {
		return errJSON(c, 404, "post not found")
	}
	ct, err := h.DB.Exec(ctx,
		`INSERT INTO club_post_likes(post_id, user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
		postID, userID)
	if err != nil {
		return errJSON(c, 500, "internal error")
	}
	myLike := ct.RowsAffected() == 1
	if !myLike {
		if _, err := h.DB.Exec(ctx,
			`DELETE FROM club_post_likes WHERE post_id=$1 AND user_id=$2`, postID, userID); err != nil {
			return errJSON(c, 500, "internal error")
		}
	}
	var count int
	h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM club_post_likes WHERE post_id=$1`, postID).Scan(&count)

	topic := "club:" + clubID
	ws.Publish(ctx, h.RDB, topic, ws.NewEnvelope("clubpost.like", topic,
		fiber.Map{"id": postID, "like_count": count}))
	return c.JSON(fiber.Map{"like_count": count, "my_like": myLike})
}

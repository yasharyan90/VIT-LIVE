package ws

import (
	"context"
	"encoding/json"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/websocket/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 75 * time.Second
	pingPeriod = 60 * time.Second
)

// inboundFrame is what clients may send us: subscribe / unsubscribe / ack.
type inboundFrame struct {
	Type    string `json:"type"`
	Topic   string `json:"topic"`
	Payload struct {
		Kind  string `json:"kind"`
		RefID string `json:"ref_id"`
	} `json:"payload"`
}

// Gateway owns the per-connection pumps and inbound frame handling.
type Gateway struct {
	Hub *Hub
	RDB *redis.Client
	DB  *pgxpool.Pool
}

// ResolveTopicsForUser computes the auto-subscription set for a user.
func (g *Gateway) ResolveTopicsForUser(ctx context.Context, userID, role string) map[string]bool {
	topics := map[string]bool{
		"college:global":   true,
		"emergency:global": true,
		"user:" + userID:   true,
	}
	var deptID *string
	var year *int
	if err := g.DB.QueryRow(ctx,
		`SELECT department_id::text, year_of_study FROM users WHERE id=$1`, userID).Scan(&deptID, &year); err == nil {
		if deptID != nil {
			topics["dept:"+*deptID] = true
		}
		if year != nil {
			topics["year:"+strconv.Itoa(*year)] = true
		}
	}
	rows, err := g.DB.Query(ctx, `SELECT club_id::text FROM club_members WHERE user_id=$1`, userID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var clubID string
			if rows.Scan(&clubID) == nil {
				topics["club:"+clubID] = true
			}
		}
	}
	if role != "student" {
		topics["admin:delivery"] = true
	}
	return topics
}

// Serve runs the read loop (blocking) and a write pump goroutine for one connection.
func (g *Gateway) Serve(conn *websocket.Conn, client *Client) {
	g.Hub.Register(client)
	g.RDB.Incr(context.Background(), "stats:online")
	defer func() {
		g.Hub.Unregister(client)
		g.RDB.Decr(context.Background(), "stats:online")
	}()

	done := make(chan struct{})
	go g.writePump(conn, client, done)
	g.readPump(conn, client)
	<-done
}

func (g *Gateway) writePump(conn *websocket.Conn, client *Client, done chan struct{}) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		conn.Close()
		close(done)
	}()
	for {
		select {
		case msg, ok := <-client.Send:
			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (g *Gateway) readPump(conn *websocket.Conn, client *Client) {
	conn.SetReadLimit(4096)
	conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var frame inboundFrame
		if err := json.Unmarshal(raw, &frame); err != nil {
			continue
		}
		switch frame.Type {
		case "subscribe":
			if isClientSubscribableTopic(frame.Topic) {
				g.Hub.Subscribe(client, frame.Topic)
			}
		case "unsubscribe":
			if isClientSubscribableTopic(frame.Topic) {
				g.Hub.Unsubscribe(client, frame.Topic)
			}
		case "ack":
			g.RecordAck(context.Background(), client.UserID, frame.Payload.Kind, frame.Payload.RefID)
		}
	}
}

// Clients may only self-manage club topic subscriptions (follow/unfollow live).
func isClientSubscribableTopic(topic string) bool {
	return strings.HasPrefix(topic, "club:")
}

// RecordAck marks a delivery ack (emergency or announcement) exactly once per
// user, updates counters, and pushes a live delivery.update to admin dashboards.
func (g *Gateway) RecordAck(ctx context.Context, userID, kind, refID string) {
	if refID == "" || (kind != "emergency" && kind != "announcement") {
		return
	}
	added, err := g.RDB.SAdd(ctx, "delivered:"+kind+":"+refID, userID).Result()
	if err != nil || added == 0 {
		return // already acked (or redis down) — nothing to update
	}
	delivered, _ := g.RDB.SCard(ctx, "delivered:"+kind+":"+refID).Result()
	total, _ := g.RDB.Get(ctx, "target:"+kind+":"+refID).Int()

	if kind == "emergency" {
		if _, err := g.DB.Exec(ctx,
			`UPDATE emergency_alerts SET delivered_count=$1 WHERE id=$2`, delivered, refID); err != nil {
			log.Printf("ack: update emergency delivered_count: %v", err)
		}
	}
	env := NewEnvelope("delivery.update", "admin:delivery", map[string]any{
		"kind": kind, "ref_id": refID, "delivered": delivered, "total": total,
	})
	if err := Publish(ctx, g.RDB, "admin:delivery", env); err != nil {
		log.Printf("ack: publish delivery.update: %v", err)
	}
}

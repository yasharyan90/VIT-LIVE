package ws

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// Envelope is the wire format for every server -> client message.
type Envelope struct {
	Type    string    `json:"type"`
	Topic   string    `json:"topic"`
	Payload any       `json:"payload"`
	Ts      time.Time `json:"ts"`
	ID      string    `json:"id"`
}

func NewEnvelope(msgType, topic string, payload any) Envelope {
	return Envelope{Type: msgType, Topic: topic, Payload: payload, Ts: time.Now().UTC(), ID: uuid.NewString()}
}

// Publish persists nothing — it fans an envelope out via Redis so that every
// backend instance (including this one) relays it to its local clients.
// This is the ONLY entry point for real-time fan-out.
func Publish(ctx context.Context, rdb *redis.Client, topic string, env Envelope) error {
	b, err := json.Marshal(env)
	if err != nil {
		return err
	}
	return rdb.Publish(ctx, "broadcast:"+topic, b).Err()
}

type Client struct {
	ID     string
	UserID string
	Role   string
	mu     sync.Mutex
	Topics map[string]bool
	Send   chan []byte
}

func (c *Client) HasTopic(t string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.Topics[t]
}

type Hub struct {
	mu      sync.RWMutex
	clients map[string]*Client
	byTopic map[string]map[string]*Client
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[string]*Client),
		byTopic: make(map[string]map[string]*Client),
	}
}

func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c.ID] = c
	for topic := range c.Topics {
		if h.byTopic[topic] == nil {
			h.byTopic[topic] = make(map[string]*Client)
		}
		h.byTopic[topic][c.ID] = c
	}
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[c.ID]; !ok {
		return
	}
	delete(h.clients, c.ID)
	for topic := range c.Topics {
		delete(h.byTopic[topic], c.ID)
		if len(h.byTopic[topic]) == 0 {
			delete(h.byTopic, topic)
		}
	}
	close(c.Send)
}

func (h *Hub) Subscribe(c *Client, topic string) {
	c.mu.Lock()
	c.Topics[topic] = true
	c.mu.Unlock()
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.byTopic[topic] == nil {
		h.byTopic[topic] = make(map[string]*Client)
	}
	h.byTopic[topic][c.ID] = c
}

func (h *Hub) Unsubscribe(c *Client, topic string) {
	c.mu.Lock()
	delete(c.Topics, topic)
	c.mu.Unlock()
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.byTopic[topic], c.ID)
}

// BroadcastToTopic delivers to all LOCAL clients subscribed to a topic.
// Called by the Redis bridge for every message, including our own publishes.
func (h *Hub) BroadcastToTopic(topic string, message []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, c := range h.byTopic[topic] {
		select {
		case c.Send <- message:
		default:
			// Slow client: drop the frame rather than block the hub.
		}
	}
}

func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

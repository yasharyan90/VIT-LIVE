package ws

import (
	"context"
	"log"
	"strings"

	"github.com/redis/go-redis/v9"
)

// RedisBridge subscribes to every broadcast:* channel and relays messages to
// the local hub. Run once per instance as a background goroutine.
type RedisBridge struct {
	rdb *redis.Client
	hub *Hub
}

func NewRedisBridge(rdb *redis.Client, hub *Hub) *RedisBridge {
	return &RedisBridge{rdb: rdb, hub: hub}
}

func (b *RedisBridge) Listen(ctx context.Context) {
	pubsub := b.rdb.PSubscribe(ctx, "broadcast:*")
	defer pubsub.Close()
	log.Println("redis bridge listening on broadcast:*")
	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			topic := strings.TrimPrefix(msg.Channel, "broadcast:")
			b.hub.BroadcastToTopic(topic, []byte(msg.Payload))
		}
	}
}

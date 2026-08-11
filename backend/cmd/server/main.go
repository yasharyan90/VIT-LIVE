package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/redis/go-redis/v9"

	"vitlive/internal/config"
	"vitlive/internal/db"
	"vitlive/internal/server"
)

func main() {
	cfg := config.Load()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("postgres: %v", err)
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	if err := db.Seed(ctx, pool, cfg.SuperAdminEmail, cfg.SuperAdminPassword); err != nil {
		log.Fatalf("seed: %v", err)
	}

	redisOpts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		log.Fatalf("redis url: %v", err)
	}
	rdb := redis.NewClient(redisOpts)
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("redis: %v", err)
	}
	rdb.Set(ctx, "stats:online", 0, 0) // reset gauge on boot (single-instance dev)

	srv, err := server.New(cfg, pool, rdb)
	if err != nil {
		log.Fatalf("server: %v", err)
	}
	srv.StartWorkers(ctx)

	go func() {
		<-ctx.Done()
		log.Println("shutting down...")
		srv.App.Shutdown()
	}()

	log.Printf("VIT Live backend listening on :%s (env=%s)", cfg.Port, cfg.AppEnv)
	if err := srv.App.Listen(":" + cfg.Port); err != nil {
		log.Fatal(err)
	}
}

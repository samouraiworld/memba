package main

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"connectrpc.com/connect"
	"github.com/rs/cors"
	membav1connect "github.com/samouraiworld/memba/backend/gen/memba/v1/membav1connect"
	"github.com/samouraiworld/memba/backend/internal/db"
	"github.com/samouraiworld/memba/backend/internal/service"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	_ "modernc.org/sqlite"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./memba.db"
	}

	corsOrigins := os.Getenv("CORS_ORIGINS")
	if corsOrigins == "" {
		corsOrigins = "http://localhost:5173"
	}

	// Initialize database
	database, err := db.Open(dbPath)
	if err != nil {
		slog.Error("failed to open database", "error", err)
		os.Exit(1)
	}
	defer database.Close()

	if err := db.Migrate(database); err != nil {
		slog.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}

	slog.Info("database initialized", "path", dbPath)

	// Create service
	svc, err := service.NewMultisigService(database)
	if err != nil {
		slog.Error("failed to create multisig service", "error", err)
		os.Exit(1)
	}

	// Create ConnectRPC handler
	mux := http.NewServeMux()

	path, handler := membav1connect.NewMultisigServiceHandler(svc, connect.WithInterceptors())
	mux.Handle(path, rateLimiter(handler))

	// Health check
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"status":"ok","timestamp":"%s"}`, time.Now().UTC().Format(time.RFC3339))
	})

	// CORS
	c := cors.New(cors.Options{
		AllowedOrigins: splitOrigins(corsOrigins),
		AllowedMethods: []string{
			http.MethodGet,
			http.MethodPost,
			http.MethodOptions,
		},
		AllowedHeaders: []string{
			"Content-Type",
			"Connect-Protocol-Version",
			"Connect-Timeout-Ms",
			"Grpc-Timeout",
			"X-Grpc-Web",
			"X-User-Agent",
		},
		ExposedHeaders: []string{
			"Grpc-Status",
			"Grpc-Message",
		},
		AllowCredentials: false,
		MaxAge:           7200,
	})

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      c.Handler(h2c.NewHandler(mux, &http2.Server{})),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("server starting", "port", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down gracefully...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Error("forced shutdown", "error", err)
	}

	slog.Info("server stopped")
}

// splitOrigins splits a comma-separated CORS_ORIGINS string, trimming whitespace.
func splitOrigins(s string) []string {
	parts := strings.Split(s, ",")
	origins := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			origins = append(origins, p)
		}
	}
	return origins
}

// ── Rate limiter ─────────────────────────────────────────────────

const (
	rateLimitWindow = time.Minute
	rateLimitMax    = 100
)

type ipEntry struct {
	count  int
	expiry time.Time
}

type ipRateLimiter struct {
	mu      sync.Mutex
	entries map[string]*ipEntry
}

func newIPRateLimiter() *ipRateLimiter {
	rl := &ipRateLimiter{entries: make(map[string]*ipEntry)}
	// GC stale entries every minute
	go func() {
		for {
			time.Sleep(rateLimitWindow)
			rl.mu.Lock()
			now := time.Now()
			for ip, e := range rl.entries {
				if now.After(e.expiry) {
					delete(rl.entries, ip)
				}
			}
			rl.mu.Unlock()
		}
	}()
	return rl
}

func (rl *ipRateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	e, ok := rl.entries[ip]
	if !ok || now.After(e.expiry) {
		rl.entries[ip] = &ipEntry{count: 1, expiry: now.Add(rateLimitWindow)}
		return true
	}
	e.count++
	return e.count <= rateLimitMax
}

var limiter = newIPRateLimiter()

func rateLimiter(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			ip = strings.Split(fwd, ",")[0]
		}
		ip = strings.TrimSpace(ip)

		if !limiter.allow(ip) {
			slog.Warn("rate limited", "ip", ip)
			http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ensure sql.DB is used (will be used by service layer)
var _ *sql.DB

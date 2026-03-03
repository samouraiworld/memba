package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"connectrpc.com/connect"
	connectcors "connectrpc.com/cors"
	"github.com/rs/cors"
	membav1connect "github.com/samouraiworld/memba/backend/gen/memba/v1/membav1connect"
	"github.com/samouraiworld/memba/backend/internal/auth"
	"github.com/samouraiworld/memba/backend/internal/db"
	"github.com/samouraiworld/memba/backend/internal/service"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	_ "modernc.org/sqlite"
)

const appVersion = "7.0.0"

var startTime = time.Now()

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
	defer func() {
		if err := database.Close(); err != nil {
			slog.Error("failed to close database", "error", err)
		}
	}()

	if err := db.Migrate(database); err != nil {
		slog.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}

	slog.Info("database initialized", "path", dbPath)

	// Parse backup interval from env (default: 24h)
	backupInterval := 24 * time.Hour
	if bi := os.Getenv("BACKUP_INTERVAL"); bi != "" {
		if d, err := time.ParseDuration(bi); err == nil {
			backupInterval = d
		}
	}

	// Create service
	svc, err := service.NewMultisigService(database)
	if err != nil {
		slog.Error("failed to create multisig service", "error", err)
		os.Exit(1)
	}

	// Create ConnectRPC handler
	mux := http.NewServeMux()

	// Graceful shutdown context — created early so the rate limiter GC can use it.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Initialize rate limiter with app context for clean shutdown.
	limiter = newIPRateLimiter(ctx)

	// Start nonce tracker GC with app context for clean shutdown.
	auth.StartNonceTracker(ctx)

	// Start SQLite backup scheduler with app context for clean shutdown.
	db.StartBackupSchedule(ctx, database, dbPath, logger, backupInterval)

	// Initialize OAuth state store with app context for clean shutdown.
	oauthStore := service.NewOAuthStateStore(ctx)

	path, handler := membav1connect.NewMultisigServiceHandler(svc, connect.WithInterceptors())
	mux.Handle(path, rateLimiter(handler))

	// Health check — enhanced with DB, uptime, memory diagnostics
	mux.HandleFunc("/health", healthHandler(database, dbPath))

	// GitHub OAuth — CSRF-protected state generation + code exchange
	mux.Handle("/github/oauth/state", rateLimiter(service.HandleGitHubOAuthState(oauthStore)))
	mux.Handle("/github/oauth/exchange", rateLimiter(service.HandleGitHubOAuthExchange(oauthStore)))

	// CORS – use connectrpc.com/cors helpers for correct header lists.
	c := cors.New(cors.Options{
		AllowedOrigins:   splitOrigins(corsOrigins),
		AllowedMethods:   connectcors.AllowedMethods(),
		AllowedHeaders:   []string{"*"},
		ExposedHeaders:   connectcors.ExposedHeaders(),
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

func newIPRateLimiter(ctx context.Context) *ipRateLimiter {
	rl := &ipRateLimiter{entries: make(map[string]*ipEntry)}
	// GC stale entries every minute, stops on context cancellation.
	go func() {
		ticker := time.NewTicker(rateLimitWindow)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				rl.mu.Lock()
				now := time.Now()
				for ip, e := range rl.entries {
					if now.After(e.expiry) {
						delete(rl.entries, ip)
					}
				}
				rl.mu.Unlock()
			}
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

// limiter is initialized in main() with a cancellable context.
var limiter *ipRateLimiter

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

// ── Health handler ───────────────────────────────────────────────

func healthHandler(database *sql.DB, dbPath string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		status := "ok"
		httpCode := http.StatusOK

		// DB liveness
		dbStatus := "ok"
		if err := database.Ping(); err != nil {
			dbStatus = "unreachable"
			status = "degraded"
			httpCode = http.StatusServiceUnavailable
		}

		// DB file sizes (filepath.Clean satisfies gosec G703 — dbPath is operator-set, not user input)
		var dbSize, walSize int64
		cleanPath := filepath.Clean(dbPath)
		if info, err := os.Stat(cleanPath); err == nil {
			dbSize = info.Size()
		}
		if info, err := os.Stat(cleanPath + "-wal"); err == nil {
			walSize = info.Size()
		}

		// Memory
		var mem runtime.MemStats
		runtime.ReadMemStats(&mem)

		resp := map[string]interface{}{
			"status":         status,
			"version":        appVersion,
			"uptime_seconds": int(time.Since(startTime).Seconds()),
			"db": map[string]interface{}{
				"status":         dbStatus,
				"size_bytes":     dbSize,
				"wal_size_bytes": walSize,
			},
			"memory_mb": mem.Alloc / 1024 / 1024,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(httpCode)
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			slog.Error("failed to write health response", "error", err)
		}
	}
}

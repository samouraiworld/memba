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
	"syscall"
	"time"

	"connectrpc.com/connect"
	connectcors "connectrpc.com/cors"
	"github.com/rs/cors"
	membav1connect "github.com/samouraiworld/memba/backend/gen/memba/v1/membav1connect"
	"github.com/samouraiworld/memba/backend/internal/auth"
	"github.com/samouraiworld/memba/backend/internal/db"
	"github.com/samouraiworld/memba/backend/internal/ratelimit"
	"github.com/samouraiworld/memba/backend/internal/service"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	_ "modernc.org/sqlite"
)

// appVersion is set at build time via: go build -ldflags "-X main.appVersion=v2.0.0"
var appVersion = "dev"

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

	// Initialize per-endpoint rate limiter with app context for clean shutdown.
	limiter = ratelimit.New(ctx, ratelimit.DefaultConfigs())

	// Start nonce tracker GC with app context for clean shutdown.
	auth.StartNonceTracker(ctx)

	// Start SQLite backup scheduler with app context for clean shutdown.
	db.StartBackupSchedule(ctx, database, dbPath, logger, backupInterval)

	// Initialize OAuth state store with app context for clean shutdown.
	oauthStore := service.NewOAuthStateStore(ctx)

	path, handler := membav1connect.NewMultisigServiceHandler(svc, connect.WithInterceptors())
	mux.Handle(path, rateLimitMiddleware("rpc", maxBodySize(1<<20, handler))) // 1MB max body

	// Health check — enhanced with DB, uptime, memory diagnostics
	mux.HandleFunc("/health", healthHandler(database, dbPath))

	// Render proxy — REST endpoints for ABCI queries (no auth, per-endpoint rate-limited)
	// NOTE: /api/eval was removed in v6 (SEC-01) — it allowed arbitrary qeval on any realm.
	// Use /api/render for legitimate read-only queries.
	mux.Handle("/api/render", rateLimitMiddleware("render", service.HandleRenderProxy()))
	mux.Handle("/api/balance", rateLimitMiddleware("balance", service.HandleBalanceProxy()))

	// Marketplace — cached realm proxies (60s server-side TTL)
	agentRegistryPath := os.Getenv("AGENT_REGISTRY_REALM_PATH")
	if agentRegistryPath == "" {
		agentRegistryPath = "gno.land/r/samcrew/agent_registry"
	}
	escrowRealmPath := os.Getenv("ESCROW_REALM_PATH")
	if escrowRealmPath == "" {
		escrowRealmPath = "gno.land/r/samcrew/escrow"
	}
	mux.Handle("/api/marketplace/agents", rateLimitMiddleware("marketplace", service.HandleMarketplaceAgentsProxy(agentRegistryPath)))
	mux.Handle("/api/marketplace/escrow", rateLimitMiddleware("marketplace", service.HandleMarketplaceAgentsProxy(escrowRealmPath)))

	// DAO Analyst — LLM-powered governance analysis (proxies to free-tier LLMs)
	// v6 SEC-03: auth required to prevent API key abuse
	mux.Handle("/api/analyst/analyze", rateLimitMiddleware("analyst", requireAuthMiddleware(svc, service.HandleAnalystAnalyze())))
	mux.Handle("/api/analyst/consensus", rateLimitMiddleware("analyst", service.HandleAnalystConsensus(database)))

	// IPFS upload proxy — keeps Lighthouse API key server-side
	// v6 SEC-02: auth required to prevent API key abuse
	mux.Handle("/api/upload/avatar", rateLimitMiddleware("upload", requireAuthMiddleware(svc, service.HandleIPFSUpload())))

	// GitHub OAuth — CSRF-protected state generation + code exchange
	mux.Handle("/github/oauth/state", rateLimitMiddleware("oauth", service.HandleGitHubOAuthState(oauthStore)))
	mux.Handle("/github/oauth/exchange", rateLimitMiddleware("oauth", service.HandleGitHubOAuthExchange(oauthStore)))

	// CORS – use connectrpc.com/cors helpers for correct header lists.
	c := cors.New(cors.Options{
		AllowedOrigins:   splitOrigins(corsOrigins),
		AllowedMethods:   connectcors.AllowedMethods(),
		AllowedHeaders:   connectcors.AllowedHeaders(),
		ExposedHeaders:   connectcors.ExposedHeaders(),
		AllowCredentials: false,
		MaxAge:           7200,
	})

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      c.Handler(h2c.NewHandler(mux, &http2.Server{})),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 90 * time.Second,
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

	// WAL checkpoint before shutdown — ensures all writes are flushed to main DB file.
	if _, err := database.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		slog.Error("WAL checkpoint failed on shutdown", "error", err)
	} else {
		slog.Info("WAL checkpoint completed")
	}

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

// ── Body size limiter ────────────────────────────────────────────

// maxBodySize wraps a handler with a request body size limit.
func maxBodySize(maxBytes int64, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
		next.ServeHTTP(w, r)
	})
}

// ── REST auth middleware ─────────────────────────────────────────

// requireAuthMiddleware wraps a REST handler with token validation.
// The client must send: Authorization: Bearer <base64-encoded-protobuf-token>
// This reuses the same server-signed token that ConnectRPC endpoints validate.
func requireAuthMiddleware(svc *service.MultisigService, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
			http.Error(w, `{"error":"authorization required"}`, http.StatusUnauthorized)
			return
		}
		tokenJSON := strings.TrimPrefix(authHeader, "Bearer ")
		if err := svc.ValidateRESTToken(tokenJSON); err != nil {
			slog.Warn("REST auth failed", "error", err)
			http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ── Rate limiter ─────────────────────────────────────────────────

// limiter is initialized in main() with a cancellable context.
var limiter *ratelimit.Limiter

func rateLimitMiddleware(endpoint string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := ratelimit.ExtractIP(r.RemoteAddr, r.Header.Get("X-Forwarded-For"), r.Header.Get("Fly-Client-IP"))

		if !limiter.Allow(ip, endpoint) {
			slog.Warn("rate limited", "ip", ip, "endpoint", endpoint)
			http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
			return
		}

		// Stricter per-IP limit for Sign/Complete transaction RPCs.
		if endpoint == "rpc" && (strings.HasSuffix(r.URL.Path, "/SignTransaction") || strings.HasSuffix(r.URL.Path, "/CompleteTransaction")) {
			if !limiter.Allow(ip, "tx") {
				slog.Warn("rate limited", "ip", ip, "endpoint", "tx")
				http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
				return
			}
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
			"go_version":     runtime.Version(),
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

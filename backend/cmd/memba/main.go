package main

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"connectrpc.com/connect"
	connectcors "connectrpc.com/cors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/cors"
	membav1connect "github.com/samouraiworld/memba/backend/gen/memba/v1/membav1connect"
	"github.com/samouraiworld/memba/backend/internal/auth"
	"github.com/samouraiworld/memba/backend/internal/db"
	"github.com/samouraiworld/memba/backend/internal/indexer"
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

	// v6 SEC-13: Fail loudly if ED25519_SEED is not set in production.
	// Without a persistent seed, server restarts invalidate all auth tokens.
	if os.Getenv("ED25519_SEED") == "" && os.Getenv("FLY_APP_NAME") != "" {
		slog.Error("ED25519_SEED is required in production — auth tokens will not survive restarts")
		os.Exit(1)
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

	// Start the NFT marketplace state-polling indexer (test13 realms).
	// NOTE: the NFT realms live on test13, so this uses its OWN rpc env
	// (NFT_RPC_URL) — NOT the testnet12-defaulted GNO_RPC_URL.
	const defaultV3Market = "gno.land/r/samcrew/memba_nft_market_v3"
	nftRPCURL := envOr("NFT_RPC_URL", "https://rpc.test13.testnets.gno.land:443")
	collectionRealm := envOr("NFT_COLLECTION_REALM", "gno.land/r/samcrew/memba_nft_v2")
	marketRealm := envOr("NFT_MARKET_REALM", "gno.land/r/samcrew/memba_nft_market_v2")
	indexer.StartNFTPoller(ctx, database, indexer.Config{
		RPCURL:          nftRPCURL,
		CollectionRealm: collectionRealm,
		MarketRealm:     marketRealm,
		CollectionID:    envOr("NFT_COLLECTION_ID", "genesis"),
		Interval:        durationOr("NFT_POLL_INTERVAL", 60*time.Second),
		Logger:          logger,
	})

	// Seed realm cursors from NFT_SEED_REALM_CURSOR (one-time operator backfill
	// lever). Format: comma-separated "realm@deployHeight" pairs. Each call is
	// INSERT OR IGNORE — will NOT rewind a realm whose cursor already exists.
	// Leave empty (the default) for normal operation.
	if seedSpec := os.Getenv("NFT_SEED_REALM_CURSOR"); seedSpec != "" {
		specs, parseErrs := parseSeedCursorSpec(seedSpec)
		for _, pe := range parseErrs {
			slog.Warn("NFT_SEED_REALM_CURSOR: skipping malformed entry", "error", pe)
		}
		for _, spec := range specs {
			if err := indexer.SeedRealmCursor(ctx, database, spec.Realm, spec.Height); err != nil {
				slog.Error("NFT_SEED_REALM_CURSOR: failed to seed realm cursor",
					"realm", spec.Realm, "deployHeight", spec.Height, "error", err)
			} else {
				slog.Info("NFT_SEED_REALM_CURSOR: seeded realm cursor (INSERT OR IGNORE)",
					"realm", spec.Realm, "deployHeight", spec.Height)
			}
		}
	}

	// Start the event-tailing indexer: polls /block_results, parses chain.Emit
	// GnoEvents from the NFT realms, and writes normalized listings/sales/offers/
	// ownership. This is the source of truth for floor, activity and portfolio.
	indexer.StartNFTTailer(ctx, database, indexer.TailerConfig{
		RPCURL:           nftRPCURL,
		WatchedRealms:    splitOrigins(envOr("NFT_WATCHED_REALMS", marketRealm+","+collectionRealm+","+defaultV3Market)),
		SaleVolumeRealms: splitOrigins(envOr("NFT_SALE_VOLUME_REALMS", defaultV3Market)),
		StartBlock:       int64Or("NFT_START_BLOCK", 260000),
		Confirmations:    int64Or("NFT_CONFIRMATIONS", 5),
		Interval:         durationOr("NFT_TAILER_INTERVAL", 3*time.Second),
		Logger:           logger,
	})

	// Initialize OAuth state store with app context for clean shutdown.
	oauthStore := service.NewOAuthStateStore(ctx)

	path, handler := membav1connect.NewMultisigServiceHandler(svc, connect.WithInterceptors())
	mux.Handle(path, rateLimitMiddleware("rpc", maxBodySize(1<<20, handler))) // 1MB max body

	// Health check — enhanced with DB, uptime, memory diagnostics
	mux.HandleFunc("/health", healthHandler(database, dbPath))

	// Prometheus metrics (observability keystone, P0-2) — exposes the signed-login
	// ratio (memba_auth_login_total) + Go runtime metrics for an external drain.
	// SEC-2: gated behind METRICS_BEARER when set (open otherwise so an existing
	// scrape isn't broken) — the login-result ratio + infra internals shouldn't be
	// served unauthenticated to the open internet.
	mux.Handle("/metrics", metricsAuthMiddleware(promhttp.Handler()))

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
		// escrow (v1) was redeployed to escrow_v2 on test13; the v1 path returns
		// InvalidPkgPathError there. gno paths are immutable, hence the _v2 suffix.
		escrowRealmPath = "gno.land/r/samcrew/escrow_v2"
	}
	mux.Handle("/api/marketplace/agents", rateLimitMiddleware("marketplace", service.HandleMarketplaceAgentsProxy(agentRegistryPath)))
	mux.Handle("/api/marketplace/escrow", rateLimitMiddleware("marketplace", service.HandleMarketplaceAgentsProxy(escrowRealmPath)))

	// DAO Analyst — LLM-powered governance analysis (proxies to free-tier LLMs)
	// v6 SEC-03: auth required to prevent API key abuse
	mux.Handle("/api/analyst/analyze", rateLimitMiddleware("analyst", requireAuthMiddleware(svc, service.HandleAnalystAnalyze())))
	// GET = PUBLIC, no-auth read of an already-cached report (zero LLM cost); POST =
	// auth-gated generation (v6 SEC-03: prevents unauthenticated 10-model LLM cost-drain).
	consensusGet := service.HandleAnalystConsensusGet(database)
	consensusPost := requireAuthMiddleware(svc, service.HandleAnalystConsensus(database))
	mux.Handle("/api/analyst/consensus", rateLimitMiddleware("analyst", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			consensusGet.ServeHTTP(w, r)
			return
		}
		consensusPost.ServeHTTP(w, r)
	})))

	// IPFS upload proxy — keeps Lighthouse API key server-side
	// v6 SEC-02: auth required to prevent API key abuse
	mux.Handle("/api/upload/avatar", rateLimitMiddleware("upload", requireAuthMiddleware(svc, service.HandleIPFSUpload())))

	// NFT media proxy — fetches from Lighthouse/IPFS gateways, caches server-side.
	// Public read endpoints (no auth); rate-limited.
	// SSRF-hardened: only ipfs:// and https:// public hosts are permitted.
	mux.Handle("/api/nft/image", rateLimitMiddleware("nft", service.HandleNFTImage()))
	mux.Handle("/api/nft/metadata", rateLimitMiddleware("nft", service.HandleNFTMetadata()))

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

// envOr returns the env var value, or fallback when unset/empty.
func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// durationOr parses the env var as a Go duration, or returns fallback.
func durationOr(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}

// int64Or parses the env var as a base-10 int64, or returns fallback.
func int64Or(key string, fallback int64) int64 {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	return fallback
}

// SeedSpec holds a parsed realm@height pair from NFT_SEED_REALM_CURSOR.
type SeedSpec struct {
	Realm  string
	Height int64
}

// parseSeedCursorSpec parses a comma-separated list of "realm@height" pairs
// from the NFT_SEED_REALM_CURSOR env var. Valid entries are returned in the
// first slice; one error per malformed entry is returned in the second slice.
// Callers should Warn-log errors and skip the offending entry — never fatal.
func parseSeedCursorSpec(s string) ([]SeedSpec, []error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil
	}
	parts := strings.Split(s, ",")
	var specs []SeedSpec
	var errs []error
	for _, raw := range parts {
		entry := strings.TrimSpace(raw)
		if entry == "" {
			continue
		}
		idx := strings.LastIndex(entry, "@")
		if idx < 0 {
			errs = append(errs, fmt.Errorf("NFT_SEED_REALM_CURSOR: missing '@' in %q", entry))
			continue
		}
		realm := strings.TrimSpace(entry[:idx])
		heightStr := strings.TrimSpace(entry[idx+1:])
		if realm == "" {
			errs = append(errs, fmt.Errorf("NFT_SEED_REALM_CURSOR: empty realm in %q", entry))
			continue
		}
		height, err := strconv.ParseInt(heightStr, 10, 64)
		if err != nil {
			errs = append(errs, fmt.Errorf("NFT_SEED_REALM_CURSOR: non-integer height in %q: %w", entry, err))
			continue
		}
		specs = append(specs, SeedSpec{Realm: realm, Height: height})
	}
	return specs, errs
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

// metricsAuthMiddleware gates the wrapped handler behind a scrape bearer token
// when METRICS_BEARER is set. When it's unset the handler stays open, so an
// existing Prometheus scrape keeps working — setting the env opts into auth.
// The token comparison is constant-time.
func metricsAuthMiddleware(next http.Handler) http.Handler {
	token := strings.TrimSpace(os.Getenv("METRICS_BEARER"))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token != "" {
			got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if subtle.ConstantTimeCompare([]byte(got), []byte(token)) != 1 {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
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

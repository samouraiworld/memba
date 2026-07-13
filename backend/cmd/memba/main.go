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
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"connectrpc.com/connect"
	connectcors "connectrpc.com/cors"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/cors"
	membav1connect "github.com/samouraiworld/memba/backend/gen/memba/v1/membav1connect"
	"github.com/samouraiworld/memba/backend/internal/arcade"
	"github.com/samouraiworld/memba/backend/internal/attestation"
	"github.com/samouraiworld/memba/backend/internal/auth"
	"github.com/samouraiworld/memba/backend/internal/db"
	"github.com/samouraiworld/memba/backend/internal/indexer"
	"github.com/samouraiworld/memba/backend/internal/metrics"
	"github.com/samouraiworld/memba/backend/internal/ratelimit"
	"github.com/samouraiworld/memba/backend/internal/service"
	_ "modernc.org/sqlite"
)

// appVersion is set at build time via: go build -ldflags "-X main.appVersion=v2.0.0"
var appVersion = "dev"

var startTime = time.Now()

// productionConfigWarnings returns non-fatal production hygiene warnings, logged loudly
// at startup but NEVER boot-blocking. Deliberately not fail-closed: some of these are
// intentional, tracked postures (e.g. the A2 Phase-1 unsigned-auth setting that keeps
// untransacted-wallet onboarding working), and bricking prod over a config value would
// be worse than the value itself. No-op off Fly (FLY_APP_NAME unset) so local dev keeps
// permissive defaults. getenv is injected for testability.
func productionConfigWarnings(getenv func(string) string) []string {
	if getenv("FLY_APP_NAME") == "" {
		return nil
	}
	var warns []string
	switch getenv(auth.AllowUnsignedAuthEnv) {
	case "1", "true", "TRUE":
		warns = append(warns, auth.AllowUnsignedAuthEnv+" is enabled — empty/invalid/address-only signatures are accepted (impersonation-capable; the A2 Phase-1 posture). Flip to enforce once the signed-login ratio ≈ 100% (OPS_RUNBOOK §2.1).")
	}
	if strings.TrimSpace(getenv("QUEST_ADMIN_ADDRESSES")) == "" {
		warns = append(warns, "QUEST_ADMIN_ADDRESSES is unset — quest-claim review falls back to the baked-in default admin; set it explicitly in production.")
	}
	if strings.TrimSpace(getenv("METRICS_BEARER")) == "" {
		warns = append(warns, "METRICS_BEARER is unset — /metrics is disabled (fail-closed in prod); set it to enable authenticated Prometheus scrapes.")
	}
	return warns
}

// litestreamManaged reports whether Litestream owns WAL checkpointing for this
// process (start.sh exports LITESTREAM_MANAGED=1 before `litestream replicate
// -exec`). When true the app must never checkpoint. Only the exact value "1"
// counts — fail toward self-checkpointing, which is the safe standalone default.
func litestreamManaged(getenv func(string) string) bool {
	return getenv("LITESTREAM_MANAGED") == "1"
}

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

	// `memba integrity-check` — boot-time gate run by start.sh BEFORE Litestream
	// starts replicating (the runtime image has no sqlite3 CLI; the driver is
	// embedded here). Exit 0 = healthy, non-zero = corrupt/missing, at which
	// point start.sh quarantines the file and restores from the replica.
	if len(os.Args) > 1 && os.Args[1] == "integrity-check" {
		if err := db.IntegrityCheck(dbPath); err != nil {
			slog.Error("integrity check failed", "path", dbPath, "error", err)
			os.Exit(1)
		}
		slog.Info("integrity check ok", "path", dbPath)
		return
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

	// Expose the connection-pool stats on /metrics (read-only; W6.5). On SQLite
	// with one writer, wait_count/wait_duration are the DB-contention signal.
	metrics.RegisterDBStats(prometheus.DefaultRegisterer, database)

	if err := db.Migrate(database); err != nil {
		slog.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}

	slog.Info("database initialized", "path", dbPath)

	// v6 SEC-13: Fail loudly if ED25519_SEED is not set in production.
	// Without a persistent seed, server restarts invalidate all auth tokens.
	if os.Getenv("ED25519_SEED") == "" && os.Getenv("FLY_APP_NAME") != "" {
		slog.Error("ED25519_SEED is required in production — auth tokens will not survive restarts")
		os.Exit(1)
	}

	// W0.6: surface unsafe/hygiene production config (unsigned-auth enabled, baked-in
	// quest admin, public /metrics) as loud startup warnings — never boot-blocking, so
	// a deliberate posture (e.g. A2 Phase-1) can't take prod down. No-op off Fly.
	for _, w := range productionConfigWarnings(os.Getenv) {
		slog.Warn("production config warning", "detail", w)
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

	// A3 flip-gate readout: retro-verify every stored multisig signature against
	// the reconstructed canonical sign-bytes and publish the totals on
	// memba_multisig_sig_verify_sweep. Read-only + log-only, async so a large
	// table can never delay boot. See OPS_RUNBOOK "Flipping
	// MEMBA_ENFORCE_MULTISIG_SIG_VERIFY".
	go service.SweepMultisigSigVerify(ctx, database)

	// Initialize per-endpoint rate limiter with app context for clean shutdown.
	limiter = ratelimit.New(ctx, ratelimit.DefaultConfigs())

	// Per-address quest rate limiter (Q-03) — layered on the per-IP limiter above.
	// Stops a sybil farm rotating IPs from grinding XP on one wallet and throttles
	// the expensive on-chain verification fan-out. Configurable via MEMBA_QUEST_*_RPM.
	envInt := func(name string, def int) int {
		if v := os.Getenv(name); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				return n
			}
		}
		return def
	}
	svc.SetUserLimiter(ratelimit.New(ctx, ratelimit.PerUserQuestConfigs(envInt)))

	// Attestation signer (Q-05) — offline ed25519 key that signs quest vouchers
	// the user broadcasts to memba_quest_attestation_v1. Unset = attestation off.
	if seed := os.Getenv("MEMBA_ATTESTATION_SEED"); seed != "" {
		signer, err := attestation.NewFromSeedHex(seed)
		if err != nil {
			slog.Error("invalid MEMBA_ATTESTATION_SEED — attestation disabled", "error", err)
			os.Exit(1)
		}
		svc.SetAttestationSigner(signer)
		slog.Info("attestation signer configured", "pubkey", signer.PublicKeyHex())
	}

	// Block Party feature flag + seed RPC source (B6). Disabled unless
	// BLOCKPARTY_ENABLED is "1"/"true"; BLOCKPARTY_SEED_RPC_URL overrides the
	// built-in default test13 node.
	bpEnabled := os.Getenv("BLOCKPARTY_ENABLED") == "1" || os.Getenv("BLOCKPARTY_ENABLED") == "true"
	svc.SetBlockParty(bpEnabled, os.Getenv("BLOCKPARTY_SEED_RPC_URL"))

	// Start nonce tracker GC with app context for clean shutdown.
	auth.StartNonceTracker(ctx)

	// W2.3 (NEW-INF-2): the same-volume `VACUUM INTO` backup scheduler is
	// RETIRED. It could not survive the one failure mode that actually
	// happened (volume loss — see OPS_RUNBOOK §4) and raced Litestream for
	// I/O. Litestream's off-volume S3 replica (WAL streaming + 24h snapshots,
	// 168h retention) is the single backup mechanism; boot-time
	// integrity-check + quarantine/restore (#719) covers corruption.
	// Restore procedure + RPO/RTO: docs/OPS_RUNBOOK.md §4.7.

	// Start the NFT marketplace state-polling indexer (test13 realms).
	// NOTE: the NFT realms live on test13, so this uses its OWN rpc env
	// (NFT_RPC_URL) — NOT the testnet12-defaulted GNO_RPC_URL.
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
		WatchedRealms:    splitOrigins(envOr("NFT_WATCHED_REALMS", defaultNFTWatchedRealms(marketRealm, collectionRealm))),
		SaleVolumeRealms: splitOrigins(envOr("NFT_SALE_VOLUME_REALMS", defaultNFTSaleVolumeRealms())),
		StartBlock:       int64Or("NFT_START_BLOCK", 260000),
		Confirmations:    int64Or("NFT_CONFIRMATIONS", 5),
		Interval:         durationOr("NFT_TAILER_INTERVAL", 3*time.Second),
		Logger:           logger,
	})

	// Start the social-feed indexer (W7.2): a separate goroutine + cursor +
	// raw ledger, decoupled from the NFT money-path tailer. Projects
	// memba_feed_v1 events into feed_posts for low-latency timeline reads.
	// Falls back to the NFT RPC URL when FEED_RPC_URL is unset (same chain).
	if feedRealms := envOr("FEED_WATCHED_REALMS", ""); feedRealms != "" {
		indexer.StartFeedTailer(ctx, database, indexer.FeedTailerConfig{
			RPCURL:        envOr("FEED_RPC_URL", nftRPCURL),
			WatchedRealms: splitOrigins(feedRealms),
			StartBlock:    int64Or("FEED_START_BLOCK", 260000),
			Confirmations: int64Or("FEED_CONFIRMATIONS", 5),
			Interval:      durationOr("FEED_TAILER_INTERVAL", 3*time.Second),
			Logger:        logger,
		})
	}

	// Initialize OAuth state store with app context for clean shutdown.
	oauthStore := service.NewOAuthStateStore(ctx)

	path, handler := membav1connect.NewMultisigServiceHandler(svc, connect.WithInterceptors(metrics.UnaryTimingInterceptor()))
	mux.Handle(path, rateLimitMiddleware("rpc", maxBodySize(1<<20, handler))) // 1MB max body

	// Health check — enhanced with DB, uptime, memory diagnostics
	mux.HandleFunc("/health", healthHandler(database, dbPath))

	// Prometheus metrics (observability keystone, P0-2) — exposes the signed-login
	// ratio (memba_auth_login_total) + Go runtime metrics for an external drain.
	// SEC-2: gated behind METRICS_BEARER when set; when unset it stays open off-Fly
	// (dev convenience) but fails closed in prod (503) — the login-result ratio,
	// per-method latency + DB internals shouldn't be served unauthenticated to the
	// open internet.
	mux.Handle("/metrics", metricsAuthMiddleware(promhttp.Handler()))

	// Render proxy — REST endpoints for ABCI queries (no auth, per-endpoint rate-limited)
	// NOTE: /api/eval was removed in v6 (SEC-01) — it allowed arbitrary qeval on any realm.
	// Use /api/render for legitimate read-only queries.
	mux.Handle("/api/render", rateLimitMiddleware("render", service.HandleRenderProxy()))
	mux.Handle("/api/balance", rateLimitMiddleware("balance", service.HandleBalanceProxy()))
	// Recent-activity feed: forwards GraphQL to the FIXED gno tx-indexer server-side
	// (the browser can't reach it — no CORS). Target is not client-controlled.
	mux.Handle("/api/indexer", rateLimitMiddleware("indexer", service.HandleIndexerProxy()))
	// Token launch dates: server-side cached {symbol: launchedAtISO} map. The
	// creation-time scan is too slow for the browser (exceeds the 10s indexer
	// proxy timeout), so it's computed + cached here and refreshed in background.
	mux.Handle("/api/token-launches", rateLimitMiddleware("token_launches", service.HandleTokenLaunches()))

	// Marketplace — cached realm proxies (60s server-side TTL)
	agentRegistryPath := os.Getenv("AGENT_REGISTRY_REALM_PATH")
	if agentRegistryPath == "" {
		// agent_registry_v2 = the IsUserCall-guarded successor (v1 UseCredit was
		// unguarded); keep in sync with the frontend agentRegistryPath binding.
		agentRegistryPath = "gno.land/r/samcrew/agent_registry_v2"
	}
	escrowRealmPath := os.Getenv("ESCROW_REALM_PATH")
	if escrowRealmPath == "" {
		// escrow_v3 = the IsUserCall-guarded successor (v2 FundMilestone was
		// unguarded); keep in sync with the frontend escrowPath binding.
		escrowRealmPath = "gno.land/r/samcrew/escrow_v3"
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
	// App Store media (2b): icons + screenshots, 5MB. Its own per-IP bucket (>7, since
	// one listing is up to 7 files) AND a per-authenticated-wallet cap layered inside
	// the auth middleware — a sybil rotating IPs still shares one bucket per address.
	mux.Handle("/api/upload/image", rateLimitMiddleware("upload_image", requireAuthUploadMiddleware(svc, service.HandleIPFSUploadImage())))

	// NFT media proxy — fetches from Lighthouse/IPFS gateways, caches server-side.
	// Public read endpoints (no auth); rate-limited.
	// SSRF-hardened: only ipfs:// and https:// public hosts are permitted.
	mux.Handle("/api/nft/image", rateLimitMiddleware("nft", service.HandleNFTImage()))
	mux.Handle("/api/nft/metadata", rateLimitMiddleware("nft", service.HandleNFTMetadata()))
	// Membas Genesis mint plumbing — both endpoints are OFF (404) until their
	// envs are set at ceremony time (brief §8): the allowlist proofs file and
	// the mint-ticket collection config.
	allowlistPath := os.Getenv("MEMBA_ALLOWLIST_PROOFS_PATH")
	if allowlistPath != "" {
		if _, err := os.Stat(allowlistPath); err != nil { // #nosec G703 -- operator-set deployment env (same trust as DB_PATH), never request input
			slog.Warn("MEMBA_ALLOWLIST_PROOFS_PATH is set but unreadable — allowlist-proof endpoint stays disabled", "path", allowlistPath, "error", err)
		}
	}
	mux.Handle("/api/nft/allowlist-proof", rateLimitMiddleware("nft", service.HandleAllowlistProof(allowlistPath)))
	mux.Handle("/api/nft/mint-ticket", rateLimitMiddleware("nft", service.HandleMintTicket(database, service.TicketConfig{
		CollectionID: os.Getenv("MEMBA_TICKET_COLLECTION_ID"),
		URIBase:      os.Getenv("MEMBA_TICKET_URI_BASE"),
		Prefix:       envOr("MEMBA_TICKET_PREFIX", "Memba"),
	})))

	// BARRICADE on-chain certify — the run-submit endpoint. OFF (404) until the
	// operator sets MEMBA_ARCADE_SUBMIT_ENABLED. Each submission is re-simulated in
	// a node subprocess (internal/arcade), so it also needs `node` on PATH; if it's
	// missing (or the worker can't init) the endpoint stays disabled with a warning
	// rather than 500ing at request time.
	arcadeEnabled := os.Getenv("MEMBA_ARCADE_SUBMIT_ENABLED") == "1" || os.Getenv("MEMBA_ARCADE_SUBMIT_ENABLED") == "true"
	var arcadeVerifier arcade.Verifier
	if arcadeEnabled {
		nodeBin := envOr("MEMBA_ARCADE_NODE_BIN", "node")
		if _, err := exec.LookPath(nodeBin); err != nil {
			slog.Warn("MEMBA_ARCADE_SUBMIT_ENABLED set but node not on PATH — arcade submit stays disabled", "nodeBin", nodeBin, "error", err)
			arcadeEnabled = false
		} else if runner, err := arcade.NewRunner(arcade.Config{NodeBin: nodeBin}); err != nil {
			slog.Error("arcade verify worker init failed — arcade submit disabled", "error", err)
			arcadeEnabled = false
		} else {
			arcadeVerifier = runner
			defer func() { _ = runner.Close() }()
			slog.Info("arcade submit endpoint enabled", "nodeBin", nodeBin)
		}
	}
	mux.Handle("/api/arcade/submit", rateLimitMiddleware("arcade_submit", arcade.HandleSubmit(arcade.SubmitConfig{
		Enabled:  arcadeEnabled,
		Store:    arcade.NewStore(database),
		Auth:     svc,
		Verifier: arcadeVerifier,
		Limiter:  svc,
	})))

	// BARRICADE day-close attester — writes the competitive board on-chain via a
	// dedicated low-privilege gnokey key (attester-pays). DORMANT until BOTH
	// MEMBA_ARCADE_ATTESTER_ENABLED and MEMBA_ARCADE_ATTESTER_KEY are set; the key
	// ceremony (generate + fund the key, AddAttester it on the realm) is an OWNER
	// step. Never the deploy multisig. Needs gnokey on PATH.
	if os.Getenv("MEMBA_ARCADE_ATTESTER_ENABLED") == "1" || os.Getenv("MEMBA_ARCADE_ATTESTER_ENABLED") == "true" {
		attesterKey := os.Getenv("MEMBA_ARCADE_ATTESTER_KEY")
		gnokeyBin := envOr("MEMBA_ARCADE_GNOKEY_BIN", "gnokey")
		_, gnokeyErr := exec.LookPath(gnokeyBin)
		switch {
		case attesterKey == "":
			slog.Warn("MEMBA_ARCADE_ATTESTER_ENABLED set but MEMBA_ARCADE_ATTESTER_KEY empty — attester stays dormant")
		case gnokeyErr != nil:
			slog.Warn("MEMBA_ARCADE_ATTESTER_ENABLED set but gnokey not on PATH — attester stays dormant", "gnokeyBin", gnokeyBin, "error", gnokeyErr)
		default:
			bcfg := arcade.AttesterConfig{
				Realm:     envOr("MEMBA_ARCADE_REALM", "gno.land/r/samcrew/memba_arcade_leaderboard_v1"),
				ChainID:   os.Getenv("GNO_CHAIN_ID"),
				Remote:    envOr("MEMBA_ARCADE_RPC_URL", os.Getenv("GNO_RPC_URL")),
				KeyName:   attesterKey,
				GnokeyBin: gnokeyBin,
			}
			arcade.StartDayCloseBatcher(ctx, arcade.NewStore(database), arcade.NewGnokeyBroadcaster(bcfg), arcade.BatcherConfig{
				Enabled:     true,
				MaxPerCycle: envInt("MEMBA_ARCADE_ATTEST_MAX_PER_CYCLE", 100),
				Interval:    durationOr("MEMBA_ARCADE_ATTEST_INTERVAL", 15*time.Minute),
			})
			slog.Info("arcade day-close attester enabled", "realm", bcfg.Realm, "key", attesterKey, "chainID", bcfg.ChainID)
		}
	}
	// Feed link-preview image proxy — serves only images vetted by GetLinkPreview
	// (signed token). SSRF-hardened via the shared safeTransport; gated by
	// MEMBA_ENABLE_LINK_PREVIEWS (returns 404 when off).
	mux.Handle("/api/link-image", rateLimitMiddleware("link_preview", svc.HandleLinkImage()))
	// Feed serving-blocklist (W8.2): operator lever to suppress a post from every
	// read path. Bearer-gated + fail-closed (404 unless FEED_MODERATION_BEARER set).
	mux.Handle("/api/feed/moderation", rateLimitMiddleware("feed_moderation", service.HandleFeedModeration(database)))

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
		Handler:      c.Handler(mux),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 90 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Periodic WAL checkpoint — bounds WAL growth during runtime so a crash
	// doesn't leave a multi-hundred-MB WAL that slows restart recovery. The
	// shutdown checkpoint (below) only fires on graceful stop.
	//
	// SKIPPED under Litestream (LITESTREAM_MANAGED=1, set by start.sh):
	// Litestream must be the sole checkpointer — it holds a long-lived read
	// lock and checkpoints on its own schedule after shipping WAL frames. An
	// app-forced checkpoint that wins during a Litestream lock lapse (restart,
	// transient error) can restart the WAL before frames are replicated,
	// leaving a gap in the replica until the next full snapshot.
	if litestreamManaged(os.Getenv) {
		slog.Info("WAL checkpointing delegated to Litestream (LITESTREAM_MANAGED=1)")
	} else {
		go func() {
			ticker := time.NewTicker(5 * time.Minute)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					if _, err := database.Exec("PRAGMA wal_checkpoint(PASSIVE)"); err != nil {
						slog.Warn("periodic WAL checkpoint failed", "error", err)
					}
				}
			}
		}()
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

	// WAL checkpoint before shutdown — ensures all writes are flushed to main DB
	// file. Skipped under Litestream (same ownership rule as the periodic one:
	// Litestream does a final sync after the subprocess exits, and a TRUNCATE
	// here races its read lock).
	if !litestreamManaged(os.Getenv) {
		if _, err := database.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
			slog.Error("WAL checkpoint failed on shutdown", "error", err)
		} else {
			slog.Info("WAL checkpoint completed")
		}
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

// The two live NFT trading engines (2026-07-10 ceremony): v3.1 is paused and
// winding down its open offers, v3.2 is the active engine. The old v3 engine
// (memba_nft_market_v3) was deauthorized 2026-06-27 and must never re-enter
// these defaults — it lingered here and pointed unset-env deployments at a
// dead realm, hiding every v3.1 sale from the backend until 2026-07-11.
const (
	nftMarketV31Realm = "gno.land/r/samcrew/memba_nft_market_v3_1"
	nftMarketV32Realm = "gno.land/r/samcrew/memba_nft_market_v3_2"
	// nftCollectionsRealm is the canonical collection registry + launchpad;
	// its CollectionCreated/Mint/MintPublic/MintAllowlist/RoyaltySet events
	// feed the token projection. NOT a sale-volume realm (mints ≠ sales).
	nftCollectionsRealm = "gno.land/r/samcrew/memba_collections"
)

// defaultNFTWatchedRealms is the NFT_WATCHED_REALMS fallback: the v2 pair,
// both post-ceremony engines, and the launchpad registry. Prod pins the same
// set in backend/fly.toml [env].
func defaultNFTWatchedRealms(marketRealm, collectionRealm string) string {
	return strings.Join([]string{marketRealm, collectionRealm, nftMarketV31Realm, nftMarketV32Realm, nftCollectionsRealm}, ",")
}

// defaultNFTSaleVolumeRealms is the NFT_SALE_VOLUME_REALMS fallback: engines
// whose volume comes from Sale events only. v3.2's seeded history emits
// "SaleSeeded", which the event dispatcher ignores — seeding cannot double-count.
func defaultNFTSaleVolumeRealms() string {
	return nftMarketV31Realm + "," + nftMarketV32Realm
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

// requireAuthUploadMiddleware is requireAuthMiddleware PLUS a per-authenticated-wallet
// upload cap. Auth itself is UNCHANGED — the same ValidateRESTToken contract — it just
// also recovers the address (ValidateRESTTokenAddress) to key the per-wallet
// AllowKey limiter (svc.AllowUpload). The per-IP `upload_image` bucket wraps this on
// the outside; this inner cap stops one authenticated wallet rotating IPs to burn the
// shared Lighthouse quota.
func requireAuthUploadMiddleware(svc *service.MultisigService, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
			http.Error(w, `{"error":"authorization required"}`, http.StatusUnauthorized)
			return
		}
		tokenJSON := strings.TrimPrefix(authHeader, "Bearer ")
		addr, err := svc.ValidateRESTTokenAddress(tokenJSON)
		if err != nil {
			slog.Warn("REST auth failed", "error", err)
			http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
			return
		}
		if !svc.AllowUpload(addr) {
			slog.Warn("upload rate limited (per-wallet)", "address", addr)
			http.Error(w, `{"error":"upload rate limit exceeded — slow down and retry shortly"}`, http.StatusTooManyRequests)
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
	// Fail-closed in prod: on Fly (FLY_APP_NAME set — the same signal the ED25519
	// seed check and productionConfigWarnings use), an unset bearer must NOT serve
	// metrics unauthenticated. The "open when unset" behavior is a local/dev
	// convenience only; in prod a missing bearer disables the endpoint rather than
	// silently exposing per-method latency + DB-contention internals publicly.
	onFly := os.Getenv("FLY_APP_NAME") != ""
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token == "" {
			if onFly {
				http.Error(w, `{"error":"metrics disabled: METRICS_BEARER unset"}`, http.StatusServiceUnavailable)
				return
			}
			next.ServeHTTP(w, r) // off-Fly: open for local scrapes
			return
		}
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if subtle.ConstantTimeCompare([]byte(got), []byte(token)) != 1 {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ── Rate limiter ─────────────────────────────────────────────────

// limiter is initialized in main() with a cancellable context.
var limiter *ratelimit.Limiter

// trustProxy reports whether the backend sits behind our trusted reverse proxy
// (the Fly.io edge), and may therefore honor proxy-set client-IP headers
// (Fly-Client-IP / X-Forwarded-For) for rate limiting. We trust an explicit
// TRUSTED_PROXY opt-in, or the platform-injected FLY_APP_NAME which is only
// present when running on Fly behind its edge (same signal used for the
// ED25519_SEED prod check above). Off the edge (e.g. local/direct), these
// headers are client-spoofable, so we fall back to RemoteAddr — see
// ratelimit.ExtractIP (finding S-F2).
var trustProxy = func() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("TRUSTED_PROXY"))) {
	case "1", "true", "yes", "fly":
		return true
	case "0", "false", "no":
		return false
	}
	return os.Getenv("FLY_APP_NAME") != ""
}()

func rateLimitMiddleware(endpoint string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := ratelimit.ExtractIP(trustProxy, r.RemoteAddr, r.Header.Get("X-Forwarded-For"), r.Header.Get("Fly-Client-IP"))

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

// healthPingTimeout bounds the DB Ping in the health handler so it doesn't
// block indefinitely when the single SQLite writer connection is held by the
// tailer or a long RPC. Fly's health check timeout is 10s; 2s gives us
// headroom for file-stat + memory-stat + JSON encode.
const healthPingTimeout = 2 * time.Second

// walSizeWarnBytes logs a warning when the WAL exceeds this threshold,
// indicating that periodic checkpointing may not be keeping up.
const walSizeWarnBytes = 50 * 1024 * 1024 // 50 MB

func healthHandler(database *sql.DB, dbPath string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		status := "ok"
		httpCode := http.StatusOK

		// DB liveness — bounded Ping so health doesn't block on the single writer conn.
		dbStatus := "ok"
		pingCtx, cancel := context.WithTimeout(r.Context(), healthPingTimeout)
		defer cancel()
		if err := database.PingContext(pingCtx); err != nil {
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

		// WAL size alert — log when WAL grows beyond threshold
		if walSize > walSizeWarnBytes {
			slog.Warn("WAL file exceeds threshold — checkpoint may be stalled",
				"wal_size_mb", walSize/(1024*1024), "threshold_mb", walSizeWarnBytes/(1024*1024))
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

package service

import (
	"context"
	"crypto/ed25519"
	srand "crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"connectrpc.com/connect"
	"golang.org/x/sync/singleflight"

	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/attestation"
	"github.com/samouraiworld/memba/backend/internal/auth"
	"github.com/samouraiworld/memba/backend/internal/metrics"
	"github.com/samouraiworld/memba/backend/internal/ratelimit"
)

// MultisigService implements the ConnectRPC MultisigService.
type MultisigService struct {
	db         *sql.DB
	publicKey  ed25519.PublicKey
	privateKey ed25519.PrivateKey
	// chainID is the Gno chain this server is configured for (env GNO_CHAIN_ID).
	// Used to bind newly-minted auth tokens to a specific chain (AUTH-CHAINID-01).
	chainID string
	// acceptedChainIDs is the set of chain IDs whose tokens this server will
	// VALIDATE. Defaults to {chainID}; set MEMBA_ACCEPTED_CHAIN_IDS (comma-
	// separated) to serve multiple chains during a transition (e.g. test12->test13)
	// so flipping the frontend default doesn't 401 the other chain's sessions.
	acceptedChainIDs []string
	// verifyOnChainQuest is a test seam for server-side quest verification.
	// nil in production (the real defaultVerifyOnChainQuest is used); tests
	// inject a deterministic stub so they never hit the network. See quest_verify.go.
	verifyOnChainQuest func(ctx context.Context, addr, questID, proof string) (bool, error)

	// userLimiter is the per-address quest rate limiter (Q-03). nil disables it
	// (the default in tests); production wires it via SetUserLimiter with the app
	// context so the GC goroutine stops on shutdown.
	userLimiter *ratelimit.Limiter

	// attSigner issues on-chain attestation vouchers (Q-05). nil disables
	// attestation (the default; production sets it from MEMBA_ATTESTATION_SEED).
	attSigner *attestation.Signer

	// Home snapshot cache (Phase 2) — single entry per chain_id, in-memory,
	// serve-stale-on-error. See home_rpc.go.
	homeCacheMu  sync.RWMutex
	homeCached   map[string]*membav1.HomeSnapshot
	homeCachedAt map[string]time.Time
	homeQuery    queryFunc
	// homeGroup collapses concurrent cache misses per chain_id so only one
	// assembly (8 network/DB reads) runs at a time — the rest share its result.
	homeGroup singleflight.Group

	// Block Party (B6): feature flag + seed RPC source for the daily-challenge
	// block fetcher. Disabled (false, empty seed) by default; wired in
	// production via SetBlockParty from BLOCKPARTY_ENABLED / BLOCKPARTY_SEED_RPC_URL.
	blockPartyEnabled bool
	blockPartySeedRPC string

	// lbRebuilding guards the background user_ranks rebuild (perf W1.3): a
	// stale-cache leaderboard read serves the current cache and triggers at
	// most one detached recompute instead of paying the full aggregation on
	// the request path. See GetLeaderboard / rebuildLeaderboardAsync.
	lbRebuilding atomic.Bool
}

// parseAcceptedChainIDs splits a comma-separated env value into a trimmed,
// non-empty set. When the env is unset, it falls back to the single configured
// chain (or nil/legacy-any when that is also empty).
func parseAcceptedChainIDs(env, defaultChainID string) []string {
	if strings.TrimSpace(env) == "" {
		if defaultChainID == "" {
			return nil
		}
		return []string{defaultChainID}
	}
	var out []string
	for p := range strings.SplitSeq(env, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// NewMultisigService creates a MultisigService.
// If ED25519_SEED is set (64 hex chars = 32 bytes), the keypair is deterministic
// and survives restarts. Otherwise a new keypair is generated and the seed is
// logged so the operator can persist it.
func NewMultisigService(db *sql.DB) (*MultisigService, error) {
	var privateKey ed25519.PrivateKey
	var publicKey ed25519.PublicKey

	if seedHex := os.Getenv("ED25519_SEED"); seedHex != "" {
		seed, err := hex.DecodeString(seedHex)
		if err != nil || len(seed) != ed25519.SeedSize {
			return nil, fmt.Errorf("ED25519_SEED must be %d hex chars", ed25519.SeedSize*2)
		}
		privateKey = ed25519.NewKeyFromSeed(seed)
		publicKey = privateKey.Public().(ed25519.PublicKey)
		slog.Info("loaded server keypair from ED25519_SEED")
	} else {
		var err error
		publicKey, privateKey, err = ed25519.GenerateKey(srand.Reader)
		if err != nil {
			return nil, err
		}
		slog.Warn("generated ephemeral keypair — set ED25519_SEED to persist",
			"pubkey_prefix", hex.EncodeToString(publicKey[:8])+"…")
	}

	chainID := os.Getenv("GNO_CHAIN_ID")
	if chainID == "" {
		slog.Warn("GNO_CHAIN_ID not set — auth tokens will be issued in legacy chainless mode (24h grace, then required)")
	}

	acceptedChainIDs := parseAcceptedChainIDs(os.Getenv("MEMBA_ACCEPTED_CHAIN_IDS"), chainID)
	slog.Info("auth: accepted token chain IDs", "chain_id", chainID, "accepted_chain_ids", acceptedChainIDs)

	return &MultisigService{
		db:               db,
		publicKey:        publicKey,
		privateKey:       privateKey,
		chainID:          chainID,
		acceptedChainIDs: acceptedChainIDs,
		homeCached:       make(map[string]*membav1.HomeSnapshot),
		homeCachedAt:     make(map[string]time.Time),
		homeQuery:        abciQuery,
	}, nil
}

// SetUserLimiter installs the per-address quest rate limiter (Q-03). Wired in
// production (cmd/memba) with the app context; left nil in tests, which disables
// per-user limiting so existing quest tests are unaffected.
func (s *MultisigService) SetUserLimiter(l *ratelimit.Limiter) {
	s.userLimiter = l
}

// SetAttestationSigner installs the offline attestation signer (Q-05). Wired in
// production from MEMBA_ATTESTATION_SEED; nil (the default, incl. tests) disables
// attestation so no vouchers are issued and GetAttestationVouchers is empty.
func (s *MultisigService) SetAttestationSigner(signer *attestation.Signer) {
	s.attSigner = signer
}

// SetBlockParty enables/disables the Block Party feature and configures the
// seed RPC node used to derive daily challenge blocks. An empty seedRPC
// leaves the previously configured value (including the built-in default)
// untouched, so callers can toggle `enabled` without needing to know the URL.
func (s *MultisigService) SetBlockParty(enabled bool, seedRPC string) {
	s.blockPartyEnabled = enabled
	if seedRPC != "" {
		s.blockPartySeedRPC = seedRPC
	}
}

// blockPartyFetcher returns the httpBlockFetcher configured for this service,
// falling back to the default test13 seed RPC when none has been set.
func (s *MultisigService) blockPartyFetcher() httpBlockFetcher {
	url := s.blockPartySeedRPC
	if url == "" {
		url = "https://rpc.testnet13.samourai.live:443"
	}
	return httpBlockFetcher{rpcURL: url}
}

// rateLimitUser enforces the per-address quest quota for endpoint. Returns a
// ResourceExhausted error when the wallet has exceeded its quota, nil otherwise
// (including when no limiter is configured). The error is deliberately terse —
// it carries no per-user detail an attacker could use to probe the window.
func (s *MultisigService) rateLimitUser(addr, endpoint string) error {
	if s.userLimiter == nil {
		return nil
	}
	if !s.userLimiter.AllowKey(addr, endpoint) {
		// Observability (Q-16): the farming/sybil signal. The counter is the durable
		// signal (alert on its rate); the Warn is a supplementary breadcrumb. Both
		// fire only on rejection, off the hot success path. Log volume is bounded by
		// the per-IP limiter per source, but scales with attacker count under
		// coordinated abuse — sample/downgrade to Debug if a real wave makes it noisy.
		metrics.QuestRateLimitExceeded.WithLabelValues(endpoint).Inc()
		slog.Warn("quest rate limit exceeded", "address", addr, "endpoint", endpoint)
		return connect.NewError(connect.CodeResourceExhausted, fmt.Errorf("quest rate limit exceeded — slow down and retry shortly"))
	}
	return nil
}

// authenticate validates a token and returns the user address. The rejection
// reason goes to logs ONLY — the wire carries a message-less Unauthenticated,
// same hygiene as GetToken's tokenDenied (2026-02 b64fd7f): token state
// (expired vs bad signature vs wrong chain, plus wrapped decode detail) is an
// oracle clients don't need, and no frontend parses these messages. If a
// client ever needs to distinguish a case, use the bare-code pattern
// (see auth.SessionRejectCode) — never the raw error.
func (s *MultisigService) authenticate(token *membav1.Token) (string, error) {
	if err := auth.ValidateToken(s.publicKey, token, s.acceptedChainIDs...); err != nil {
		slog.Warn("authenticate: token rejected", "error", err)
		return "", connect.NewError(connect.CodeUnauthenticated, nil)
	}
	return token.UserAddress, nil
}

// ValidateRESTToken validates a JSON-encoded auth token from an Authorization header.
// Used by REST endpoints (IPFS upload, analyst) that can't use ConnectRPC's token field.
func (s *MultisigService) ValidateRESTToken(tokenJSON string) error {
	var token membav1.Token
	if err := json.Unmarshal([]byte(tokenJSON), &token); err != nil {
		return fmt.Errorf("invalid token format: %w", err)
	}
	return auth.ValidateToken(s.publicKey, &token, s.acceptedChainIDs...)
}

// internalError logs the real error and returns a sanitized connect error.
func internalError(ctx string, err error) error {
	slog.Error(ctx, "error", err)
	return connect.NewError(connect.CodeInternal, nil)
}

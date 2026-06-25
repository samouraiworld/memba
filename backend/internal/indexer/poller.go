// Package indexer implements a lightweight state-polling NFT indexer.
//
// It periodically reads the live NFT realms via vm/qrender (the same JSON-RPC
// abci_query mechanism the render proxy uses) and caches collection / token /
// activity state in SQLite, served by the ConnectRPC NFT handlers.
//
// The poller is intentionally simple: it never panics the process, logs and
// skips sections that error (keeping partial freshness), and tolerates the
// known test13 platform quirk where a realm's no-path Render() route 500s.
package indexer

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const defaultPollInterval = 60 * time.Second

// Config holds the indexer's runtime configuration (env-driven in main).
type Config struct {
	RPCURL          string        // NFT_RPC_URL (test13 — NOT the backend GNO_RPC_URL)
	CollectionRealm string        // NFT_COLLECTION_REALM
	MarketRealm     string        // NFT_MARKET_REALM
	CollectionID    string        // NFT_COLLECTION_ID
	Interval        time.Duration // NFT_POLL_INTERVAL
	Logger          *slog.Logger
}

// StartNFTPoller starts a background goroutine that polls the NFT realms.
// It runs one poll immediately, then on every cfg.Interval tick. It stops
// cleanly on context cancellation. Errors are logged, never fatal.
func StartNFTPoller(ctx context.Context, database *sql.DB, cfg Config) {
	if cfg.Interval <= 0 {
		cfg.Interval = defaultPollInterval
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}

	go func() {
		cfg.Logger.Info("nft indexer: started",
			"rpc", cfg.RPCURL,
			"collection_realm", cfg.CollectionRealm,
			"market_realm", cfg.MarketRealm,
			"collection_id", cfg.CollectionID,
			"interval", cfg.Interval,
		)

		// Immediate first poll so the cache is warm shortly after boot.
		pollOnce(ctx, database, cfg)

		ticker := time.NewTicker(cfg.Interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				cfg.Logger.Info("nft indexer: stopped")
				return
			case <-ticker.C:
				pollOnce(ctx, database, cfg)
			}
		}
	}()
}

// pollOnce performs a single indexing cycle. Each section is independent: a
// failure in one (logged) does not prevent the others from refreshing.
//
// As of the event-tailing upgrade (migration 012 / tailer.go), listings, sales,
// floor, ownership and marketplace stats are written by the BlockTailer from
// chain.Emit events. The poller now only fills the metadata the events don't
// carry: collection name/symbol/supply/royalty and per-token URI. (Token owner
// is also event-derived, but the per-token render is kept as a cheap reconcile
// for the URI it provides alongside it.)
func pollOnce(ctx context.Context, database *sql.DB, cfg Config) {
	log := cfg.Logger
	colID := cfg.CollectionID

	// (a) Collection metadata.
	var supply int64
	if raw, err := queryRender(cfg.RPCURL, cfg.CollectionRealm+":"+colID); err != nil {
		log.Warn("nft indexer: collection render failed", "error", err)
	} else if col, perr := parseCollectionRender(raw); perr != nil {
		log.Warn("nft indexer: collection parse failed", "error", perr)
	} else {
		supply = col.Supply
		if err := upsertCollection(ctx, database, colID, cfg.CollectionRealm, col); err != nil {
			log.Warn("nft indexer: collection upsert failed", "error", err)
		}
	}

	// (b) Per-token URI (and owner) via the full, untruncated per-token render.
	for tid := int64(1); tid <= supply; tid++ {
		tokenID := strconv.FormatInt(tid, 10)
		raw, err := queryRender(cfg.RPCURL, fmt.Sprintf("%s:%s/%s", cfg.CollectionRealm, colID, tokenID))
		if err != nil {
			log.Warn("nft indexer: token render failed", "token", tokenID, "error", err)
			continue
		}
		tok, perr := parseTokenRender(raw)
		if perr != nil {
			log.Warn("nft indexer: token parse failed", "token", tokenID, "error", perr)
			continue
		}
		if err := upsertToken(ctx, database, colID, tokenID, tok); err != nil {
			log.Warn("nft indexer: token upsert failed", "token", tokenID, "error", err)
		}
	}
}

// ── Chain query ──────────────────────────────────────────────────────────────

// abci JSON-RPC types — match render_proxy.go's request/response shape exactly.
type abciQueryRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int             `json:"id"`
	Method  string          `json:"method"`
	Params  abciQueryParams `json:"params"`
}

type abciQueryParams struct {
	Path string `json:"path"`
	Data string `json:"data"`
}

type abciResponse struct {
	Result struct {
		Response struct {
			ResponseBase struct {
				Data string `json:"Data"`
				// RawMessage, not string: gno.land encodes a present ABCI error as a
				// JSON object for some failures, which would crash a string unmarshal.
				Error json.RawMessage `json:"Error"`
			} `json:"ResponseBase"`
		} `json:"response"`
	} `json:"result"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// queryRender issues a vm/qrender ABCI query for the given data string and
// returns the decoded Render() output. Mirrors abciQuery in render_proxy.go.
//
// The `data` param is base64-encoded on the wire (gno.land decodes it as base64;
// raw bytes fail with "Invalid params"). Callers pass the "<pkgpath>:<path>"
// colon syntax that vm/qrender requires.
func queryRender(rpcURL, data string) (string, error) {
	reqBody := abciQueryRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "abci_query",
		Params:  abciQueryParams{Path: "vm/qrender", Data: base64.StdEncoding.EncodeToString([]byte(data))},
	}
	payload, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(rpcURL, "application/json", strings.NewReader(string(payload)))
	if err != nil {
		return "", fmt.Errorf("rpc request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	var result abciResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("parse response: %w", err)
	}

	if result.Error != nil {
		return "", fmt.Errorf("rpc error: %s", result.Error.Message)
	}
	// gno.land sends "no error" as JSON null; a present error (string or object)
	// means the render failed — surface it so the caller can log + skip.
	if errMsg := strings.TrimSpace(string(result.Result.Response.ResponseBase.Error)); errMsg != "" && errMsg != "null" {
		return "", fmt.Errorf("abci error: %s", errMsg)
	}
	if result.Result.Response.ResponseBase.Data == "" {
		return "", nil
	}

	decoded, err := base64.StdEncoding.DecodeString(result.Result.Response.ResponseBase.Data)
	if err != nil {
		return "", fmt.Errorf("decode base64: %w", err)
	}
	return string(decoded), nil
}

// ── Pure parsers (unit-tested, no network) ───────────────────────────────────

// collectionInfo is the parsed collection metadata.
type collectionInfo struct {
	Name       string
	Symbol     string
	Supply     int64
	RoyaltyBPS int64
}

// tokenInfo is the parsed per-token state.
type tokenInfo struct {
	Owner string
	URI   string
}

var (
	reColName    = regexp.MustCompile(`(?m)^#\s+(.+?)\s*$`)
	reColSymbol  = regexp.MustCompile(`(?m)^Symbol:\s*(.+?)\s*$`)
	reColSupply  = regexp.MustCompile(`(?m)^Supply:\s*(\d+)`)
	reColRoyalty = regexp.MustCompile(`(?m)^Royalty BPS:\s*(\d+)`)

	reTokOwner = regexp.MustCompile(`(?m)^Owner:\s*(\S+)`)
	reTokURI   = regexp.MustCompile(`(?m)^URI:\s*(\S+)`)
)

// parseCollectionRender parses the collection metadata block.
func parseCollectionRender(s string) (collectionInfo, error) {
	if strings.TrimSpace(s) == "" {
		return collectionInfo{}, fmt.Errorf("empty collection render")
	}
	var c collectionInfo
	if m := reColName.FindStringSubmatch(s); m != nil {
		c.Name = strings.TrimSpace(m[1])
	}
	if m := reColSymbol.FindStringSubmatch(s); m != nil {
		c.Symbol = strings.TrimSpace(m[1])
	}
	if m := reColSupply.FindStringSubmatch(s); m != nil {
		c.Supply, _ = strconv.ParseInt(m[1], 10, 64)
	}
	if m := reColRoyalty.FindStringSubmatch(s); m != nil {
		c.RoyaltyBPS, _ = strconv.ParseInt(m[1], 10, 64)
	}
	if c.Name == "" {
		return collectionInfo{}, fmt.Errorf("collection name not found")
	}
	return c, nil
}

// parseTokenRender parses a single token's owner + URI.
func parseTokenRender(s string) (tokenInfo, error) {
	if strings.TrimSpace(s) == "" {
		return tokenInfo{}, fmt.Errorf("empty token render")
	}
	var t tokenInfo
	if m := reTokOwner.FindStringSubmatch(s); m != nil {
		t.Owner = strings.TrimSpace(m[1])
	}
	if m := reTokURI.FindStringSubmatch(s); m != nil {
		t.URI = strings.TrimSpace(m[1])
	}
	if t.Owner == "" {
		return tokenInfo{}, fmt.Errorf("token owner not found")
	}
	return t, nil
}

// ── DB writes ────────────────────────────────────────────────────────────────

func upsertCollection(ctx context.Context, db *sql.DB, colID, realm string, c collectionInfo) error {
	_, err := db.ExecContext(ctx, `
		INSERT INTO nft_collections (collection_id, realm, name, symbol, supply, royalty_bps, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(collection_id) DO UPDATE SET
			realm = excluded.realm,
			name = excluded.name,
			symbol = excluded.symbol,
			supply = excluded.supply,
			royalty_bps = excluded.royalty_bps,
			updated_at = CURRENT_TIMESTAMP`,
		colID, realm, c.Name, c.Symbol, c.Supply, c.RoyaltyBPS,
	)
	return err
}

func upsertToken(ctx context.Context, db *sql.DB, colID, tokenID string, t tokenInfo) error {
	// Preserve listed/price (owned by the listings section) on metadata upsert.
	_, err := db.ExecContext(ctx, `
		INSERT INTO nft_tokens (collection_id, token_id, owner, uri, updated_at)
		VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(collection_id, token_id) DO UPDATE SET
			owner = excluded.owner,
			uri = excluded.uri,
			updated_at = CURRENT_TIMESTAMP`,
		colID, tokenID, t.Owner, t.URI,
	)
	return err
}

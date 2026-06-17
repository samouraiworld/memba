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
				Data  string `json:"Data"`
				Error string `json:"Error"`
			} `json:"ResponseBase"`
		} `json:"response"`
	} `json:"result"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// queryRender issues a vm/qrender ABCI query for the given data string and
// returns the decoded Render() output. Mirrors abciQuery in render_proxy.go.
func queryRender(rpcURL, data string) (string, error) {
	reqBody := abciQueryRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "abci_query",
		Params:  abciQueryParams{Path: "vm/qrender", Data: data},
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
	if result.Result.Response.ResponseBase.Error != "" {
		return "", fmt.Errorf("abci error: %s", result.Result.Response.ResponseBase.Error)
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

// statsInfo is the parsed marketplace stats.
type statsInfo struct {
	TotalVolumeUgnot int64
	TotalSales       int64
	ActiveListings   int64
	ActiveOffers     int64
}

// listingInfo is a single parsed listing row from the market home table.
type listingInfo struct {
	TokenID    string
	PriceUgnot int64
}

// saleInfo is a single parsed sale row.
type saleInfo struct {
	SaleNo     int64
	TokenID    string
	PriceUgnot int64
	Seller     string
	Buyer      string
}

// gnotToUgnot converts a "X.XXXXXX GNOT" / "X.XXXXXX" amount string to ugnot
// (int64). Accepts an optional " GNOT" suffix and a fractional part of any
// length (padded/truncated to 6 decimals). Returns 0 for unparsable input.
func gnotToUgnot(s string) int64 {
	s = strings.TrimSpace(s)
	s = strings.TrimSuffix(s, "GNOT")
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}

	neg := false
	if strings.HasPrefix(s, "-") {
		neg = true
		s = s[1:]
	}

	whole := s
	frac := ""
	if dot := strings.IndexByte(s, '.'); dot >= 0 {
		whole = s[:dot]
		frac = s[dot+1:]
	}
	if whole == "" {
		whole = "0"
	}

	w, err := strconv.ParseInt(whole, 10, 64)
	if err != nil {
		return 0
	}

	// Normalize fractional part to exactly 6 digits.
	if len(frac) > 6 {
		frac = frac[:6]
	}
	for len(frac) < 6 {
		frac += "0"
	}
	f, err := strconv.ParseInt(frac, 10, 64)
	if err != nil {
		return 0
	}

	total := w*1_000_000 + f
	if neg {
		total = -total
	}
	return total
}

var (
	reColName    = regexp.MustCompile(`(?m)^#\s+(.+?)\s*$`)
	reColSymbol  = regexp.MustCompile(`(?m)^Symbol:\s*(.+?)\s*$`)
	reColSupply  = regexp.MustCompile(`(?m)^Supply:\s*(\d+)`)
	reColRoyalty = regexp.MustCompile(`(?m)^Royalty BPS:\s*(\d+)`)

	reTokOwner = regexp.MustCompile(`(?m)^Owner:\s*(\S+)`)
	reTokURI   = regexp.MustCompile(`(?m)^URI:\s*(\S+)`)

	reStatListings = regexp.MustCompile(`(?m)^\*\*Active Listings:\*\*\s*(\d+)`)
	reStatSales    = regexp.MustCompile(`(?m)^\*\*Total Sales:\*\*\s*(\d+)`)
	reStatVolume   = regexp.MustCompile(`(?m)^\*\*Total Volume:\*\*\s*([0-9.]+)`)
	reStatOffers   = regexp.MustCompile(`(?m)^\*\*Active Offers:\*\*\s*(\d+)`)
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

// parseStatsRender parses the marketplace :stats block.
func parseStatsRender(s string) (statsInfo, error) {
	if strings.TrimSpace(s) == "" {
		return statsInfo{}, fmt.Errorf("empty stats render")
	}
	var st statsInfo
	found := false
	if m := reStatListings.FindStringSubmatch(s); m != nil {
		st.ActiveListings, _ = strconv.ParseInt(m[1], 10, 64)
		found = true
	}
	if m := reStatSales.FindStringSubmatch(s); m != nil {
		st.TotalSales, _ = strconv.ParseInt(m[1], 10, 64)
		found = true
	}
	if m := reStatVolume.FindStringSubmatch(s); m != nil {
		st.TotalVolumeUgnot = gnotToUgnot(m[1])
		found = true
	}
	if m := reStatOffers.FindStringSubmatch(s); m != nil {
		st.ActiveOffers, _ = strconv.ParseInt(m[1], 10, 64)
		found = true
	}
	if !found {
		return statsInfo{}, fmt.Errorf("no stats fields found")
	}
	return st, nil
}

// parseListingsRender parses the market home listings table. Only token_id +
// price are reliably extractable (seller is truncated in Render).
func parseListingsRender(s string) ([]listingInfo, error) {
	if strings.TrimSpace(s) == "" {
		return nil, fmt.Errorf("empty home render")
	}
	var out []listingInfo
	for _, line := range strings.Split(s, "\n") {
		cols := splitTableRow(line)
		// Expected: | # | Collection | Token | Price | Seller |
		if len(cols) < 5 {
			continue
		}
		// Skip the header and separator rows.
		if cols[0] == "#" || strings.HasPrefix(cols[0], "---") || strings.HasPrefix(cols[0], ":--") {
			continue
		}
		tokenID := cols[2]
		// The first cell must be a numeric row index for a data row.
		if _, err := strconv.Atoi(cols[0]); err != nil {
			continue
		}
		if tokenID == "" {
			continue
		}
		out = append(out, listingInfo{
			TokenID:    tokenID,
			PriceUgnot: gnotToUgnot(cols[3]),
		})
	}
	return out, nil
}

// parseSalesRender parses the marketplace :sales table.
func parseSalesRender(s string) ([]saleInfo, error) {
	if strings.TrimSpace(s) == "" {
		return nil, fmt.Errorf("empty sales render")
	}
	var out []saleInfo
	for _, line := range strings.Split(s, "\n") {
		cols := splitTableRow(line)
		// Expected: | Sale | Collection | Token | Price | Seller | Buyer |
		if len(cols) < 6 {
			continue
		}
		if strings.EqualFold(cols[0], "Sale") || strings.HasPrefix(cols[0], "---") || strings.HasPrefix(cols[0], ":--") {
			continue
		}
		saleNo, err := strconv.ParseInt(cols[0], 10, 64)
		if err != nil {
			continue
		}
		out = append(out, saleInfo{
			SaleNo:     saleNo,
			TokenID:    cols[2],
			PriceUgnot: gnotToUgnot(cols[3]),
			Seller:     cols[4],
			Buyer:      cols[5],
		})
	}
	return out, nil
}

// splitTableRow splits a markdown table row into trimmed cell values, dropping
// the empty leading/trailing cells produced by the bounding pipes. Returns nil
// for non-table lines.
func splitTableRow(line string) []string {
	line = strings.TrimSpace(line)
	if !strings.HasPrefix(line, "|") {
		return nil
	}
	parts := strings.Split(line, "|")
	// Drop the empty first/last from the leading/trailing pipes.
	parts = parts[1 : len(parts)-1]
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return parts
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

func updateCollectionStats(ctx context.Context, db *sql.DB, colID string, st statsInfo) error {
	// Ensure the row exists (stats may arrive before/independent of metadata).
	_, err := db.ExecContext(ctx, `
		INSERT INTO nft_collections (collection_id, total_volume_ugnot, total_sales, active_listings, updated_at)
		VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(collection_id) DO UPDATE SET
			total_volume_ugnot = excluded.total_volume_ugnot,
			total_sales = excluded.total_sales,
			active_listings = excluded.active_listings,
			updated_at = CURRENT_TIMESTAMP`,
		colID, st.TotalVolumeUgnot, st.TotalSales, st.ActiveListings,
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

// applyListings resets all tokens to unlisted, marks the listed ones, and
// recomputes the collection floor (min listed price). Runs in a transaction so
// the listed-state snapshot is consistent.
func applyListings(ctx context.Context, db *sql.DB, colID string, listings []listingInfo) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx,
		`UPDATE nft_tokens SET listed = 0, price_ugnot = NULL WHERE collection_id = ?`, colID); err != nil {
		return err
	}

	var floor int64
	haveFloor := false
	for _, l := range listings {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO nft_tokens (collection_id, token_id, listed, price_ugnot, updated_at)
			VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(collection_id, token_id) DO UPDATE SET
				listed = 1,
				price_ugnot = excluded.price_ugnot,
				updated_at = CURRENT_TIMESTAMP`,
			colID, l.TokenID, l.PriceUgnot,
		); err != nil {
			return err
		}
		if l.PriceUgnot > 0 && (!haveFloor || l.PriceUgnot < floor) {
			floor = l.PriceUgnot
			haveFloor = true
		}
	}

	if haveFloor {
		if _, err := tx.ExecContext(ctx,
			`UPDATE nft_collections SET floor_price_ugnot = ?, updated_at = CURRENT_TIMESTAMP WHERE collection_id = ?`,
			floor, colID); err != nil {
			return err
		}
	} else {
		if _, err := tx.ExecContext(ctx,
			`UPDATE nft_collections SET floor_price_ugnot = NULL, updated_at = CURRENT_TIMESTAMP WHERE collection_id = ?`,
			colID); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func insertSales(ctx context.Context, db *sql.DB, colID string, sales []saleInfo) error {
	for _, s := range sales {
		_, err := db.ExecContext(ctx, `
			INSERT OR IGNORE INTO nft_activity
				(collection_id, sale_no, token_id, kind, price_ugnot, seller, buyer, created_at)
			VALUES (?, ?, ?, 'sale', ?, ?, ?, CURRENT_TIMESTAMP)`,
			colID, s.SaleNo, s.TokenID, s.PriceUgnot, s.Seller, s.Buyer,
		)
		if err != nil {
			return err
		}
	}
	return nil
}

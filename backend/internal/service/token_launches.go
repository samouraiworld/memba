package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// Token launch dates — the creation timestamp of each tokenfactory token.
//
// The tokenfactory realm stores NO creation time, so the only source is the
// tx-indexer: the `New` / `NewWithAdmin` call that minted the token. That query
// block-SCANS the indexer (there is no func index), taking ~15–30s — longer than
// the shared /api/indexer proxy's 10s timeout, which is why the browser cannot
// compute it. This endpoint does it server-side, ONCE, and caches the result
// long-term (launch dates are immutable). The map is keyed by symbol → RFC3339.

const (
	// tokenLaunchTTL bounds how soon a newly-created token's date appears; long
	// by design since the data is immutable.
	tokenLaunchTTL = 6 * time.Hour
	// tokenLaunchScanTimeout — the creation-block scan is slow (no func index);
	// give it a generous budget well above the 10s shared-proxy cap.
	tokenLaunchScanTimeout = 45 * time.Second
	indexerScanResponseMax = 8 << 20 // 8 MiB cap on the indexer response
)

// HandleTokenLaunches serves a cached {symbol: launchedAtISO} map of tokenfactory
// token creation times, computed server-side from the tx-indexer and refreshed
// in the background. GET only; public; honest — a symbol absent from the map has
// no resolved date (the frontend omits it rather than fabricating one).
func HandleTokenLaunches() http.Handler {
	var (
		mu         sync.RWMutex
		cached     map[string]string
		cachedAt   time.Time
		refreshing bool
	)

	// maybeRefresh kicks a single background refresh when the cache is stale or
	// empty. Never blocks the request — the slow scan happens off the hot path.
	maybeRefresh := func() {
		mu.Lock()
		stale := cached == nil || time.Since(cachedAt) > tokenLaunchTTL
		if !stale || refreshing {
			mu.Unlock()
			return
		}
		refreshing = true
		mu.Unlock()

		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), tokenLaunchScanTimeout)
			defer cancel()
			m, err := fetchTokenLaunchDates(ctx, homeSnapshotRPCURL())
			mu.Lock()
			refreshing = false
			if err != nil {
				slog.Warn("token launches refresh failed", "error", err)
				mu.Unlock()
				return
			}
			cached = m
			cachedAt = time.Now()
			mu.Unlock()
			slog.Info("token launches refreshed", "count", len(m))
		}()
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		maybeRefresh()

		mu.RLock()
		out := cached
		mu.RUnlock()
		if out == nil {
			out = map[string]string{} // not computed yet → empty (honest; dates omitted)
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "public, max-age=300")
		_ = json.NewEncoder(w).Encode(out)
	})
}

// fetchTokenLaunchDates resolves every tokenfactory token's symbol → creation
// time: one indexer scan for the creation blocks, then a per-token RPC /block
// time lookup. Best-effort per token (a failed time lookup omits that symbol).
func fetchTokenLaunchDates(ctx context.Context, rpcURL string) (map[string]string, error) {
	symBlock, err := scanTokenCreationBlocks(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(symBlock))
	for sym, height := range symBlock {
		t, terr := fetchBlockTime(ctx, rpcURL, height)
		if terr != nil || t == "" {
			slog.Debug("token launch: block time lookup failed", "symbol", sym, "height", height, "err", terr)
			continue // honest: omit rather than fabricate
		}
		out[sym] = t
	}
	return out, nil
}

// scanTokenCreationBlocks queries the tx-indexer for every New / NewWithAdmin
// call on the tokenfactory realm and returns symbol → creation block height.
// The `func` filter is selective (one tx per token ever created), so the scan is
// bounded by token count, not block range. args = [name, symbol, decimals, …].
func scanTokenCreationBlocks(ctx context.Context) (map[string]int64, error) {
	tip, err := indexerLatestBlock(ctx)
	if err != nil {
		return nil, fmt.Errorf("latest block: %w", err)
	}
	realm := tokenfactoryRealmPath()
	query := fmt.Sprintf(
		`{ transactions(filter:{ from_block_height:1, to_block_height:%d, message:[`+
			`{ vm_param:{ exec:{ pkg_path:%q, func:"New" }}},`+
			`{ vm_param:{ exec:{ pkg_path:%q, func:"NewWithAdmin" }}}] }) `+
			`{ block_height messages { value { __typename ... on MsgCall { func args } } } } }`,
		tip, realm, realm,
	)

	var resp creationScanResponse
	if err := postIndexerGraphQL(ctx, query, &resp); err != nil {
		return nil, err
	}
	if len(resp.Errors) > 0 {
		return nil, fmt.Errorf("indexer error: %s", resp.Errors[0].Message)
	}
	return extractCreationBlocks(resp.Data.Transactions), nil
}

// creationScanResponse is the decoded shape of the New/NewWithAdmin scan.
type creationScanResponse struct {
	Data struct {
		Transactions []creationTx `json:"transactions"`
	} `json:"data"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

type creationTx struct {
	BlockHeight int64 `json:"block_height"`
	Messages    []struct {
		Value struct {
			Typename string   `json:"__typename"`
			Func     string   `json:"func"`
			Args     []string `json:"args"`
		} `json:"value"`
	} `json:"messages"`
}

// extractCreationBlocks maps each token symbol → its EARLIEST creation block.
// Pure (unit-tested): a New/NewWithAdmin MsgCall carries args [name, symbol, …],
// so args[1] is the symbol. Non-creation messages and malformed args are skipped.
func extractCreationBlocks(txs []creationTx) map[string]int64 {
	out := map[string]int64{}
	for _, tx := range txs {
		for _, m := range tx.Messages {
			v := m.Value
			if v.Typename != "MsgCall" || (v.Func != "New" && v.Func != "NewWithAdmin") || len(v.Args) < 2 {
				continue
			}
			symbol := v.Args[1]
			if symbol == "" {
				continue
			}
			if prev, ok := out[symbol]; !ok || tx.BlockHeight < prev {
				out[symbol] = tx.BlockHeight // earliest = the original mint
			}
		}
	}
	return out
}

// indexerLatestBlock returns the indexer's tip height.
func indexerLatestBlock(ctx context.Context) (int64, error) {
	var resp struct {
		Data struct {
			LatestBlockHeight int64 `json:"latestBlockHeight"`
		} `json:"data"`
	}
	if err := postIndexerGraphQL(ctx, `{ latestBlockHeight }`, &resp); err != nil {
		return 0, err
	}
	if resp.Data.LatestBlockHeight <= 0 {
		return 0, fmt.Errorf("indexer returned no tip")
	}
	return resp.Data.LatestBlockHeight, nil
}

// fetchBlockTime returns the RFC3339 header time of block `height` from the RPC.
// Reuses the resilient RPC path (failover) the rest of the home snapshot uses.
func fetchBlockTime(ctx context.Context, rpcURL string, height int64) (string, error) {
	var b struct {
		Result struct {
			Block struct {
				Header struct {
					Time string `json:"time"`
				} `json:"header"`
			} `json:"block"`
		} `json:"result"`
	}
	if err := httpGetJSONResilient(ctx, rpcURL, fmt.Sprintf("/block?height=%d", height), &b); err != nil {
		return "", err
	}
	return b.Result.Block.Header.Time, nil
}

// postIndexerGraphQL POSTs a GraphQL query to the fixed tx-indexer (server-side;
// the browser can't, no CORS) and decodes the JSON body into out. Uses the
// caller's context deadline (set to the slow-scan budget), not the 10s shared
// proxy timeout.
func postIndexerGraphQL(ctx context.Context, query string, out any) error {
	body, err := json.Marshal(map[string]string{"query": query})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, indexerURL(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "memba-token-launches/1.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("indexer http %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, indexerScanResponseMax))
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

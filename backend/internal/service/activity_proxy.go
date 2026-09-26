package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"
)

// indexerURL returns the gno tx-indexer GraphQL endpoint (fixed; env-overridable).
// The default is the gno.land mainnet (gnoland-1) indexer since the 2026-09-23
// cutover.
// The browser cannot call it directly — the indexer sends no CORS headers — so the
// frontend POSTs its GraphQL queries to /api/indexer and we forward them here,
// server-side, where CORS does not apply.
func indexerURL() string {
	if v := os.Getenv("INDEXER_GRAPHQL_URL"); v != "" {
		return v
	}
	return "https://indexer.gno.land/graphql/query"
}

const (
	indexerProxyTimeout     = 10 * time.Second
	indexerMaxRequestBytes  = 8 << 10 // 8 KiB — GraphQL queries are tiny
	indexerMaxResponseBytes = 4 << 20 // 4 MiB — cap the relayed indexer response
	indexerProofMaxBytes    = 4 << 10
	indexerProofTTL         = 15 * time.Second
	indexerChainID          = "gnoland-1"
)

type indexerProofFlight struct {
	url  string
	done chan struct{}
	err  error
}

// A short proof is shared by concurrent requests so a busy page does not turn
// every GraphQL read into two additional indexer reads. A changed upstream URL
// never inherits the previous URL's proof.
type indexerChainGuard struct {
	mu        sync.Mutex
	url       string
	expiresAt time.Time
	flight    *indexerProofFlight
}

func (g *indexerChainGuard) verify(ctx context.Context, client *http.Client, url string) error {
	for {
		g.mu.Lock()
		if g.url == url && time.Now().Before(g.expiresAt) {
			g.mu.Unlock()
			return nil
		}
		if flight := g.flight; flight != nil {
			g.mu.Unlock()
			select {
			case <-flight.done:
				if flight.url == url {
					return flight.err
				}
			case <-ctx.Done():
				return ctx.Err()
			}
			continue
		}
		flight := &indexerProofFlight{url: url, done: make(chan struct{})}
		g.flight = flight
		g.mu.Unlock()

		proofCtx, cancel := context.WithTimeout(ctx, indexerProxyTimeout)
		err := verifyIndexerChain(proofCtx, client, url)
		cancel()

		g.mu.Lock()
		if err == nil {
			g.url = url
			g.expiresAt = time.Now().Add(indexerProofTTL)
		} else {
			g.expiresAt = time.Time{}
		}
		flight.err = err
		g.flight = nil
		close(flight.done)
		g.mu.Unlock()
		return err
	}
}

func indexerProofQuery(ctx context.Context, client *http.Client, url, query string, out any) error {
	body, err := json.Marshal(struct {
		Query string `json:"query"`
	}{Query: query})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "memba-indexer-proxy/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("indexer proof HTTP %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, indexerProofMaxBytes+1))
	if err != nil {
		return err
	}
	if len(raw) > indexerProofMaxBytes {
		return errors.New("indexer proof response too large")
	}
	var envelope struct {
		Data   json.RawMessage   `json:"data"`
		Errors []json.RawMessage `json:"errors"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return err
	}
	if len(envelope.Errors) != 0 || len(envelope.Data) == 0 || bytes.Equal(envelope.Data, []byte("null")) {
		return errors.New("indexer proof has errors or no data")
	}
	return json.Unmarshal(envelope.Data, out)
}

// Match the chain proof used by the fixed recent-submissions reader: the
// indexed tip must exist as exactly one block with the expected chain_id.
func verifyIndexerChain(ctx context.Context, client *http.Client, url string) error {
	var tip struct {
		LatestBlockHeight *int64 `json:"latestBlockHeight"`
	}
	if err := indexerProofQuery(ctx, client, url, `{ latestBlockHeight }`, &tip); err != nil {
		return err
	}
	if tip.LatestBlockHeight == nil || *tip.LatestBlockHeight < 1 {
		return errors.New("indexer proof has no valid tip")
	}
	var page struct {
		Blocks []struct {
			Height  *int64 `json:"height"`
			ChainID string `json:"chain_id"`
		} `json:"getBlocks"`
	}
	query := fmt.Sprintf(`{ getBlocks(where:{height:{eq:%d}}){height chain_id} }`, *tip.LatestBlockHeight)
	if err := indexerProofQuery(ctx, client, url, query, &page); err != nil {
		return err
	}
	if len(page.Blocks) != 1 || page.Blocks[0].Height == nil || *page.Blocks[0].Height != *tip.LatestBlockHeight || page.Blocks[0].ChainID != indexerChainID {
		return errors.New("indexer tip chain metadata mismatch")
	}
	return nil
}

// HandleIndexerProxy forwards a GraphQL POST to the FIXED gno tx-indexer and relays
// the JSON response. The target URL is server-controlled (not from the request, so
// no SSRF); the request body is size-capped; only POST is allowed. CORS is applied
// by the global middleware in main.go.
func HandleIndexerProxy() http.Handler {
	guard := &indexerChainGuard{}
	client := &http.Client{Timeout: indexerProxyTimeout}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}

		// Read at most maxRequestBytes+1 so we can detect an over-large body.
		body, err := io.ReadAll(io.LimitReader(r.Body, indexerMaxRequestBytes+1))
		if err != nil {
			http.Error(w, `{"error":"failed to read request"}`, http.StatusBadRequest)
			return
		}
		if len(body) > indexerMaxRequestBytes {
			http.Error(w, `{"error":"request too large"}`, http.StatusRequestEntityTooLarge)
			return
		}
		if len(body) == 0 {
			http.Error(w, `{"error":"empty request body"}`, http.StatusBadRequest)
			return
		}

		url := indexerURL()
		if err := guard.verify(r.Context(), client, url); err != nil {
			slog.Warn("indexer proxy: chain proof failed", "error", err)
			w.Header().Set("Cache-Control", "no-store")
			http.Error(w, `{"error":"indexer chain unavailable"}`, http.StatusServiceUnavailable)
			return
		}
		upstream, err := http.NewRequestWithContext(r.Context(), http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			slog.Warn("indexer proxy: build request failed", "error", err)
			http.Error(w, `{"error":"request build failed"}`, http.StatusInternalServerError)
			return
		}
		upstream.Header.Set("Content-Type", "application/json")
		upstream.Header.Set("User-Agent", "memba-indexer-proxy/1.0")

		resp, err := client.Do(upstream)
		if err != nil {
			slog.Warn("indexer proxy: upstream fetch failed", "url", url, "error", err)
			http.Error(w, `{"error":"upstream fetch failed"}`, http.StatusBadGateway)
			return
		}
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusOK {
			slog.Warn("indexer proxy: upstream non-200", "status", resp.StatusCode)
			http.Error(w, `{"error":"upstream returned error"}`, http.StatusBadGateway)
			return
		}

		// GraphQL errors come back as 200 with an `errors` array — relayed as-is so
		// the frontend surfaces a retry. Cap the relayed bytes defensively.
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "public, max-age=15")
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, io.LimitReader(resp.Body, indexerMaxResponseBytes))
	})
}

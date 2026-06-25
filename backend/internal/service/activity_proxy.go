package service

import (
	"bytes"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"
)

// indexerURL returns the gno tx-indexer GraphQL endpoint (fixed; env-overridable).
// The browser cannot call it directly — the indexer sends no CORS headers — so the
// frontend POSTs its GraphQL queries to /api/indexer and we forward them here,
// server-side, where CORS does not apply.
func indexerURL() string {
	if v := os.Getenv("INDEXER_GRAPHQL_URL"); v != "" {
		return v
	}
	return "https://indexer.test13.testnets.gno.land/graphql/query"
}

const (
	indexerProxyTimeout     = 10 * time.Second
	indexerMaxRequestBytes  = 8 << 10  // 8 KiB — GraphQL queries are tiny
	indexerMaxResponseBytes = 4 << 20  // 4 MiB — cap the relayed indexer response
)

// HandleIndexerProxy forwards a GraphQL POST to the FIXED gno tx-indexer and relays
// the JSON response. The target URL is server-controlled (not from the request, so
// no SSRF); the request body is size-capped; only POST is allowed. CORS is applied
// by the global middleware in main.go.
func HandleIndexerProxy() http.Handler {
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

		client := &http.Client{Timeout: indexerProxyTimeout}
		upstream, err := http.NewRequestWithContext(r.Context(), http.MethodPost, indexerURL(), bytes.NewReader(body))
		if err != nil {
			slog.Warn("indexer proxy: build request failed", "error", err)
			http.Error(w, `{"error":"request build failed"}`, http.StatusInternalServerError)
			return
		}
		upstream.Header.Set("Content-Type", "application/json")
		upstream.Header.Set("User-Agent", "memba-indexer-proxy/1.0")

		resp, err := client.Do(upstream)
		if err != nil {
			slog.Warn("indexer proxy: upstream fetch failed", "url", indexerURL(), "error", err)
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

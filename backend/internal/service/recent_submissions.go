package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	recentSubmissionsURL       = "https://indexer.gno.land/graphql/query"
	recentSubmissionsChainID   = "gnoland-1"
	recentSubmissionsWindow    = 10200
	recentSubmissionsMaxRows   = 12
	recentSubmissionsMaxBytes  = 64 << 10
	recentSubmissionsTimeout   = 5 * time.Second
	recentSubmissionsCacheTime = 60 * time.Second
)

type recentSubmissionRow struct {
	Path        string `json:"path"`
	Kind        string `json:"kind"`
	Creator     string `json:"creator"`
	TxHash      string `json:"txHash"`
	BlockHeight int64  `json:"blockHeight"`
	TxIndex     int64  `json:"txIndex"`
}

type recentSubmissionsDocument struct {
	ChainID       string                `json:"chainId"`
	Source        string                `json:"source"`
	CheckedAt     time.Time             `json:"checkedAt"`
	IndexedHeight int64                 `json:"indexedHeight"`
	WindowStart   int64                 `json:"windowStart"`
	WindowEnd     int64                 `json:"windowEnd"`
	Coverage      string                `json:"coverage"`
	Rows          []recentSubmissionRow `json:"rows"`
}

type recentSubmissionsFlight struct {
	done chan struct{}
	data []byte
	err  error
}

type recentSubmissionsReader struct {
	url     string
	client  *http.Client
	timeout time.Duration
	mu      sync.Mutex
	cache   []byte
	expiry  time.Time
	flight  *recentSubmissionsFlight
}

// HandleRecentSubmissions serves a fixed, bounded mainnet read. The upstream URL
// and GraphQL documents are server-owned; request parameters never reach them.
func HandleRecentSubmissions() http.Handler {
	return newRecentSubmissionsReader(recentSubmissionsURL, &http.Client{}).handler()
}

// newRecentSubmissionsReader permits a local mock indexer in tests only.
func newRecentSubmissionsReader(url string, client *http.Client) *recentSubmissionsReader {
	return &recentSubmissionsReader{url: url, client: client, timeout: recentSubmissionsTimeout}
}

func (s *recentSubmissionsReader) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusMethodNotAllowed)
			_, _ = io.WriteString(w, `{"error":"method not allowed"}`)
			return
		}
		if r.URL.RawQuery != "" {
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, `{"error":"query parameters are not supported"}`)
			return
		}
		data, err := s.read(r.Context())
		if err != nil {
			slog.Warn("recent submissions unavailable", "error", err)
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = io.WriteString(w, `{"error":"recent submissions unavailable"}`)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=60")
		_, _ = w.Write(data)
	})
}

func (s *recentSubmissionsReader) read(ctx context.Context) ([]byte, error) {
	s.mu.Lock()
	if len(s.cache) > 0 && time.Now().Before(s.expiry) {
		data := s.cache
		s.mu.Unlock()
		return data, nil
	}
	if flight := s.flight; flight != nil {
		s.mu.Unlock()
		select {
		case <-flight.done:
			return flight.data, flight.err
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	flight := &recentSubmissionsFlight{done: make(chan struct{})}
	s.flight = flight
	s.mu.Unlock()

	upstreamCtx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	doc, err := s.fetch(upstreamCtx)
	if err == nil {
		flight.data, err = json.Marshal(doc)
	}
	flight.err = err

	s.mu.Lock()
	if err == nil {
		s.cache = flight.data
		s.expiry = time.Now().Add(recentSubmissionsCacheTime)
	}
	s.flight = nil
	close(flight.done)
	s.mu.Unlock()
	return flight.data, flight.err
}

type recentGraphQLResponse struct {
	Data   json.RawMessage   `json:"data"`
	Errors []json.RawMessage `json:"errors"`
}

func (s *recentSubmissionsReader) graphql(ctx context.Context, query string, budget *int64) (json.RawMessage, error) {
	body, err := json.Marshal(struct {
		Query string `json:"query"`
	}{Query: query})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "memba-recent-submissions/1.0")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("indexer HTTP status %d", resp.StatusCode)
	}
	if *budget <= 0 {
		return nil, errors.New("indexer response budget exhausted")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, *budget+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > *budget {
		return nil, errors.New("indexer response exceeds byte cap")
	}
	*budget -= int64(len(raw))
	var envelope recentGraphQLResponse
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, err
	}
	if len(envelope.Errors) != 0 || len(envelope.Data) == 0 || bytes.Equal(envelope.Data, []byte("null")) {
		return nil, errors.New("indexer GraphQL error or missing data")
	}
	return envelope.Data, nil
}

func (s *recentSubmissionsReader) fetch(ctx context.Context) (recentSubmissionsDocument, error) {
	var zero recentSubmissionsDocument
	budget := int64(recentSubmissionsMaxBytes)
	raw, err := s.graphql(ctx, `{ latestBlockHeight }`, &budget)
	if err != nil {
		return zero, err
	}
	var tip struct {
		LatestBlockHeight *int64 `json:"latestBlockHeight"`
	}
	if err := json.Unmarshal(raw, &tip); err != nil {
		return zero, err
	}
	if tip.LatestBlockHeight == nil || *tip.LatestBlockHeight < 1 || *tip.LatestBlockHeight >= math.MaxInt32 {
		return zero, errors.New("invalid indexed height")
	}
	height := *tip.LatestBlockHeight
	start := height - recentSubmissionsWindow + 1
	if start < 1 {
		start = 1
	}
	query := fmt.Sprintf(`{
  getBlocks(where:{height:{eq:%d}}){height chain_id}
  getTransactions(
    where:{block_height:{gt:%d,lt:%d},success:{eq:true},messages:{typeUrl:{eq:"add_package"},route:{eq:"vm"},value:{MsgAddPackage:{}}}},
    order:{heightAndIndex:DESC}
  ){
    hash block_height index success
    messages{typeUrl route value{__typename ... on MsgAddPackage{creator package{path}}}}
  }
}`, height, start-1, height+1)
	raw, err = s.graphql(ctx, query, &budget)
	if err != nil {
		return zero, err
	}
	var page struct {
		Blocks []struct {
			Height  *int64 `json:"height"`
			ChainID string `json:"chain_id"`
		} `json:"getBlocks"`
		Transactions json.RawMessage `json:"getTransactions"`
	}
	if err := json.Unmarshal(raw, &page); err != nil {
		return zero, err
	}
	if len(page.Blocks) != 1 || page.Blocks[0].Height == nil || *page.Blocks[0].Height != height || page.Blocks[0].ChainID != recentSubmissionsChainID {
		return zero, errors.New("indexed tip chain metadata mismatch")
	}
	if len(page.Transactions) == 0 {
		return zero, errors.New("missing transactions field")
	}
	var txs []struct {
		Hash        string `json:"hash"`
		BlockHeight *int64 `json:"block_height"`
		Index       *int64 `json:"index"`
		Success     *bool  `json:"success"`
		Messages    []struct {
			TypeURL string `json:"typeUrl"`
			Route   string `json:"route"`
			Value   struct {
				TypeName string `json:"__typename"`
				Creator  string `json:"creator"`
				Package  struct {
					Path string `json:"path"`
				} `json:"package"`
			} `json:"value"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(page.Transactions, &txs); err != nil {
		return zero, err
	}
	rows := make([]recentSubmissionRow, 0)
	for _, tx := range txs {
		if strings.TrimSpace(tx.Hash) == "" || tx.BlockHeight == nil || *tx.BlockHeight < start || *tx.BlockHeight > height || tx.Index == nil || *tx.Index < 0 || tx.Success == nil || !*tx.Success {
			return zero, errors.New("malformed submission transaction")
		}
		found := false
		for _, msg := range tx.Messages {
			if msg.TypeURL != "add_package" || msg.Route != "vm" || msg.Value.TypeName != "MsgAddPackage" {
				continue
			}
			found = true
			path := msg.Value.Package.Path
			creator := msg.Value.Creator
			if !pkgPathRe.MatchString(path) || strings.TrimSpace(creator) == "" {
				return zero, errors.New("malformed submission package")
			}
			kind := "package"
			if strings.HasPrefix(path, "gno.land/r/") {
				kind = "realm"
			}
			rows = append(rows, recentSubmissionRow{Path: path, Kind: kind, Creator: creator, TxHash: tx.Hash, BlockHeight: *tx.BlockHeight, TxIndex: *tx.Index})
		}
		if !found {
			return zero, errors.New("transaction lacks MsgAddPackage")
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if a.BlockHeight != b.BlockHeight {
			return a.BlockHeight > b.BlockHeight
		}
		if a.TxIndex != b.TxIndex {
			return a.TxIndex > b.TxIndex
		}
		if a.TxHash != b.TxHash {
			return a.TxHash > b.TxHash
		}
		return a.Path < b.Path
	})
	unique := make([]recentSubmissionRow, 0, min(len(rows), recentSubmissionsMaxRows))
	seen := make(map[string]bool)
	for _, row := range rows {
		if seen[row.Path] {
			continue
		}
		seen[row.Path] = true
		unique = append(unique, row)
		if len(unique) == recentSubmissionsMaxRows {
			break
		}
	}
	return recentSubmissionsDocument{
		ChainID:       recentSubmissionsChainID,
		Source:        "official-mainnet-tx-indexer",
		CheckedAt:     time.Now().UTC(),
		IndexedHeight: height,
		WindowStart:   start,
		WindowEnd:     height,
		Coverage:      "window-only",
		Rows:          unique,
	}, nil
}

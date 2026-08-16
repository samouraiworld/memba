package metrics

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestAuthLoginTotal_CountsByResult(t *testing.T) {
	AuthLoginTotal.Reset()
	AuthLoginTotal.WithLabelValues("signed").Inc()
	AuthLoginTotal.WithLabelValues("signed").Inc()
	AuthLoginTotal.WithLabelValues("empty_rejected").Inc()

	if got := testutil.ToFloat64(AuthLoginTotal.WithLabelValues("signed")); got != 2 {
		t.Fatalf("signed counter = %v, want 2", got)
	}
	if got := testutil.ToFloat64(AuthLoginTotal.WithLabelValues("empty_rejected")); got != 1 {
		t.Fatalf("empty_rejected counter = %v, want 1", got)
	}
}

// The /metrics endpoint (promhttp over the default registry) must expose the
// auth-login signal so an external drain can compute the signed-login ratio.
func TestMetricsEndpoint_ExposesAuthLogin(t *testing.T) {
	AuthLoginTotal.WithLabelValues("signed").Inc()

	rec := httptest.NewRecorder()
	promhttp.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("/metrics status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "memba_auth_login_total") {
		t.Fatal("/metrics did not expose memba_auth_login_total")
	}
}

// The indexer gauges are the frozen-indexer signal: when last_block stops
// advancing while chain_head climbs, that indexer is stalled. They are labeled
// per indexer so the live feed tailer can never mask a stalled NFT tailer (or
// vice versa) — the topaz outage class was silent exactly because only the
// disabled NFT path owned these gauges.
func TestIndexerGauges_SetAndExposed(t *testing.T) {
	IndexerLastBlock.Reset()
	IndexerChainHead.Reset()
	IndexerLastBlock.WithLabelValues("nft").Set(1000)
	IndexerChainHead.WithLabelValues("nft").Set(1005)
	IndexerLastBlock.WithLabelValues("feed").Set(2000)
	IndexerChainHead.WithLabelValues("feed").Set(2003)

	for _, tc := range []struct {
		indexer string
		last    float64
		head    float64
	}{
		{"nft", 1000, 1005},
		{"feed", 2000, 2003},
	} {
		if got := testutil.ToFloat64(IndexerLastBlock.WithLabelValues(tc.indexer)); got != tc.last {
			t.Fatalf("indexer_last_block{indexer=%q} = %v, want %v", tc.indexer, got, tc.last)
		}
		if got := testutil.ToFloat64(IndexerChainHead.WithLabelValues(tc.indexer)); got != tc.head {
			t.Fatalf("indexer_chain_head{indexer=%q} = %v, want %v", tc.indexer, got, tc.head)
		}
	}

	rec := httptest.NewRecorder()
	promhttp.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	body := rec.Body.String()
	for _, want := range []string{
		`memba_indexer_last_block{indexer="nft"}`,
		`memba_indexer_last_block{indexer="feed"}`,
		`memba_indexer_chain_head{indexer="nft"}`,
		`memba_indexer_chain_head{indexer="feed"}`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("/metrics did not expose %s", want)
		}
	}
}

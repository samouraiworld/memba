// Package metrics holds the process-wide Prometheus metrics for the Memba
// backend. They register on the default registry and are exposed at /metrics
// (wired in cmd/memba). This is the observability keystone (audit P0-2): the
// production-decision signals that gate the auth-enforcement flips.
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// AuthLoginTotal counts auth-login attempts by result. result ∈ {signed,
// signed_invalid, signed_invalid_rejected, empty_allowed, empty_rejected}.
// signed / total is the signed-login ratio — the gate signal to watch before
// flipping MEMBA_ALLOW_UNSIGNED_AUTH / MEMBA_ENFORCE_MULTISIG_SIG_VERIFY to
// enforce. Incremented in internal/auth.logAuthLogin.
var AuthLoginTotal = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Name: "memba_auth_login_total",
		Help: "Auth-login attempts by result; signed/total is the signed-login-ratio gate signal.",
	},
	[]string{"result"},
)

// IndexerLastBlock / IndexerChainHead are the frozen-indexer signal: when
// LastBlock stops advancing while ChainHead climbs, the NFT tailer is stalled
// (this previously went unnoticed for ~150k blocks). Set in internal/indexer.
var (
	IndexerLastBlock = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "memba_indexer_last_block",
		Help: "Last block height the NFT tailer has processed (alert if it stops advancing).",
	})
	IndexerChainHead = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "memba_indexer_chain_head",
		Help: "Latest chain height the NFT tailer observed; chain_head - last_block is the indexer lag.",
	})
)

// NFTEventDropped counts NFT events the indexer skipped as malformed (audit
// F2/F12): e.g. a Sale with an unknown `via` or missing/garbled
// price/fee/royalty. These are otherwise silent — a nonzero rate signals
// on-chain event-schema drift, so alert on any increment. Incremented in
// internal/indexer (the same paths that slog.Warn the drop).
var NFTEventDropped = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Name: "memba_nft_event_dropped_total",
		Help: "NFT events the indexer skipped as malformed, by event type — alert on any (schema drift).",
	},
	[]string{"event"},
)

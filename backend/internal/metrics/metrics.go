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

// MultisigSigVerifyTotal counts live A3 multisig member-signature verifications
// at SignTransaction, by result. result ∈ {ok, mismatch, rejected} — mismatch is
// a failed verification ACCEPTED in log-only mode; rejected only occurs with
// MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1. ok/(ok+mismatch) is the flip-gate signal:
// enforce only when it reads ~100%. Incremented in internal/service.SignTransaction
// alongside the multisig_sig_verify slog signal.
var MultisigSigVerifyTotal = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Name: "memba_multisig_sig_verify_total",
		Help: "Live A3 multisig signature verifications by result; ok/(ok+mismatch) gates the enforce flip.",
	},
	[]string{"result"},
)

// MultisigSigVerifySweep reports the boot-time retro-verification of EVERY stored
// multisig member signature against sign-bytes reconstructed from the stored tx
// fields (internal/service.SweepMultisigSigVerify). result ∈ {ok, mismatch,
// legacy_shape, error}: legacy_shape rows predate the canonical stored shape and
// can never verify (expected for old rows); mismatch on RECENT rows is the signal
// that blocks the MEMBA_ENFORCE_MULTISIG_SIG_VERIFY flip. Gauges (not counters):
// each boot re-sweeps and SETS the current totals.
var MultisigSigVerifySweep = promauto.NewGaugeVec(
	prometheus.GaugeOpts{
		Name: "memba_multisig_sig_verify_sweep",
		Help: "Boot-time retro-verification of all stored multisig signatures, by result (ok/mismatch/legacy_shape/error).",
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

// QuestRateLimitExceeded counts per-address quest rate-limit rejections by
// endpoint (quest_write / quest_claim). A rising rate is the farming/sybil signal
// to watch before the badge mint carries value (Q-03/Q-16): a single wallet
// repeatedly hitting its quota, or many wallets doing so in lockstep, shows here.
// Incremented in internal/service.rateLimitUser alongside the slog.Warn.
var QuestRateLimitExceeded = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Name: "memba_quest_rate_limit_exceeded_total",
		Help: "Per-address quest rate-limit rejections by endpoint — the farming/sybil signal to watch.",
	},
	[]string{"endpoint"},
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

// IndexerLag is the computed lag in blocks (chain_head - last_block). A direct
// alertable gauge — fire when > 30 for more than 2 minutes. Set in the tailer
// alongside IndexerLastBlock/IndexerChainHead (Wave 1 hardening).
var IndexerLag = promauto.NewGauge(prometheus.GaugeOpts{
	Name: "memba_indexer_lag_blocks",
	Help: "Number of blocks the indexer is behind the chain tip; alert when > 30.",
})

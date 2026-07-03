package service

import (
	"context"
	"database/sql"
	"log/slog"

	"github.com/samouraiworld/memba/backend/internal/auth"
	"github.com/samouraiworld/memba/backend/internal/metrics"
)

// SweepMultisigSigVerify re-verifies EVERY stored multisig member signature
// against sign-bytes reconstructed from the stored transaction fields (the same
// A3 check SignTransaction runs live) and publishes the totals on the
// memba_multisig_sig_verify_sweep gauge plus a summary log line.
//
// This is the flip-gate readout for MEMBA_ENFORCE_MULTISIG_SIG_VERIFY: the
// signatures table holds REAL wallet signatures, so a sweep that reads
// mismatch=0 over the post-canonical rows is direct evidence the reconstruction
// matches what Adena actually signs. legacy_shape rows (stored before the
// canonical msgs/fee convergence) can never verify and are counted separately
// so they don't pollute the signal. Read-only; log-only; never blocks boot —
// it runs async from main.
func SweepMultisigSigVerify(ctx context.Context, db *sql.DB) map[string]int {
	counts := map[string]int{
		auth.SigVerifyOK:          0,
		auth.SigVerifyMismatch:    0,
		auth.SigVerifyLegacyShape: 0,
		auth.SigVerifyError:       0,
	}

	rows, err := db.QueryContext(ctx,
		`SELECT s.transaction_id, s.user_address, s.signature, s.created_at,
		        t.chain_id, t.msgs_json, t.fee_json, t.account_number, t.sequence, t.memo,
		        m.pubkey_json
		 FROM signatures s
		 JOIN transactions t ON t.id = s.transaction_id
		 JOIN multisigs m ON m.chain_id = t.chain_id AND m.address = t.multisig_address
		 ORDER BY s.created_at`)
	if err != nil {
		slog.Error("multisig_sig_verify_sweep: query", "error", err)
		return counts
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var (
			txID               int64
			signer, sig        string
			createdAt          string
			txf                auth.StoredTxFields
			multisigPubkeyJSON string
		)
		if err := rows.Scan(&txID, &signer, &sig, &createdAt,
			&txf.ChainID, &txf.MsgsJSON, &txf.FeeJSON, &txf.AccountNumber, &txf.Sequence, &txf.Memo,
			&multisigPubkeyJSON); err != nil {
			slog.Error("multisig_sig_verify_sweep: scan", "error", err)
			counts[auth.SigVerifyError]++
			continue
		}

		result, verr := auth.ClassifyStoredSignature(multisigPubkeyJSON, signer, sig, txf)
		counts[result]++
		if result != auth.SigVerifyOK {
			// Per-row detail so a mismatch is diagnosable without DB access. The
			// table is small (one row per member signature on pending/complete txs).
			slog.Warn("multisig_sig_verify_sweep: non-ok row",
				"result", result, "tx_id", txID, "signer", signer,
				"signed_at", createdAt, "err", verr.Error())
		}
	}
	if err := rows.Err(); err != nil {
		slog.Error("multisig_sig_verify_sweep: iterate", "error", err)
	}

	total := 0
	for result, n := range counts {
		metrics.MultisigSigVerifySweep.WithLabelValues(result).Set(float64(n))
		total += n
	}
	slog.Info("multisig_sig_verify_sweep: done",
		"metric", "multisig_sig_verify_sweep",
		"total", total,
		"ok", counts[auth.SigVerifyOK],
		"mismatch", counts[auth.SigVerifyMismatch],
		"legacy_shape", counts[auth.SigVerifyLegacyShape],
		"error", counts[auth.SigVerifyError],
		"hint", "flip "+auth.EnforceMultisigSigVerifyEnv+"=1 only when mismatch=0 over recent rows (see OPS_RUNBOOK)")
	return counts
}

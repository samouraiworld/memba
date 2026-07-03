package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"testing"

	"github.com/cosmos/cosmos-sdk/codec/legacy"
	"github.com/cosmos/cosmos-sdk/crypto/keys/multisig"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	cryptotypes "github.com/cosmos/cosmos-sdk/crypto/types"
	"github.com/cosmos/cosmos-sdk/types/bech32"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/samouraiworld/memba/backend/internal/auth"
	"github.com/samouraiworld/memba/backend/internal/metrics"
)

// TestSweepMultisigSigVerify seeds one signature row per sweep bucket and
// asserts the retro-sweep classifies each correctly and publishes the totals on
// the memba_multisig_sig_verify_sweep gauge — the MEMBA_ENFORCE_MULTISIG_SIG_VERIFY
// flip-gate readout.
func TestSweepMultisigSigVerify(t *testing.T) {
	const (
		chainID  = "test-13"
		acctNum  = 57
		feeJSON  = `{"gas_wanted":"2000000","gas_fee":"10000ugnot"}`
		// The pre-canonical (cosmos-shaped) fee older rows stored — it cannot be
		// reconstructed into gno sign-bytes and must bucket as legacy_shape.
		legacyFeeJSON = `{"amount":[{"denom":"ugnot","amount":"10000"}],"gas":"2000000"}`
	)

	ctx := context.Background()
	h := setup(t)

	priv := secp256k1.GenPrivKey()
	pub := priv.PubKey()
	memberAddr, err := bech32.ConvertAndEncode("g", pub.Address().Bytes())
	if err != nil {
		t.Fatal(err)
	}
	ms := multisig.NewLegacyAminoPubKey(1, []cryptotypes.PubKey{pub})
	pkJSON, err := legacy.Cdc.MarshalJSON(ms)
	if err != nil {
		t.Fatal(err)
	}
	msAddr, err := bech32.ConvertAndEncode("g", ms.Address())
	if err != nil {
		t.Fatal(err)
	}
	h.seedMultisig(t, chainID, msAddr, string(pkJSON), 1, 1, []string{memberAddr})

	msgsJSON := `[{"@type":"/vm.m_call","args":null,"caller":"` + memberAddr +
		`","send":"","max_deposit":"","pkg_path":"gno.land/r/samcrew/memba_dao","func":"Vote"}]`

	insertTx := func(t *testing.T, fee string, sequence uint64) int64 {
		t.Helper()
		res, err := h.db.Exec(
			`INSERT INTO transactions (chain_id, multisig_address, msgs_json, fee_json,
			   account_number, sequence, creator_address)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			chainID, msAddr, msgsJSON, fee, acctNum, sequence, memberAddr)
		if err != nil {
			t.Fatal("insert tx:", err)
		}
		id, err := res.LastInsertId()
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	insertSig := func(t *testing.T, txID int64, signer, sig string) {
		t.Helper()
		if _, err := h.db.Exec(
			`INSERT INTO signatures (transaction_id, user_address, signature) VALUES (?, ?, ?)`,
			txID, signer, sig); err != nil {
			t.Fatal("insert signature:", err)
		}
	}
	signCanonical := func(t *testing.T, sequence uint64) string {
		t.Helper()
		var msgs []json.RawMessage
		if err := json.Unmarshal([]byte(msgsJSON), &msgs); err != nil {
			t.Fatal(err)
		}
		signBytes, err := auth.CanonicalSignBytes(auth.SignDocInput{
			ChainID:       chainID,
			AccountNumber: acctNum,
			Sequence:      sequence,
			GasWanted:     2000000,
			GasFeeAmount:  10000,
			GasFeeDenom:   "ugnot",
			Msgs:          msgs,
		})
		if err != nil {
			t.Fatal(err)
		}
		raw, err := priv.Sign(signBytes)
		if err != nil {
			t.Fatal(err)
		}
		return base64.StdEncoding.EncodeToString(raw)
	}

	// ok: a genuine member signature over the reconstructed canonical bytes.
	insertSig(t, insertTx(t, feeJSON, 1), memberAddr, signCanonical(t, 1))
	// mismatch: valid base64, but signed over DIFFERENT bytes (wrong sequence).
	insertSig(t, insertTx(t, feeJSON, 2), memberAddr, signCanonical(t, 99))
	// legacy_shape: pre-canonical cosmos fee — reconstruction itself fails.
	insertSig(t, insertTx(t, legacyFeeJSON, 3), memberAddr, signCanonical(t, 3))
	// error: signer address is not a member of the multisig.
	outsider := secp256k1.GenPrivKey().PubKey()
	outsiderAddr, err := bech32.ConvertAndEncode("g", outsider.Address().Bytes())
	if err != nil {
		t.Fatal(err)
	}
	// Membership row so the JOIN-free sweep still sees the signature row itself.
	insertSig(t, insertTx(t, feeJSON, 4), outsiderAddr, signCanonical(t, 4))

	counts := SweepMultisigSigVerify(ctx, h.db)

	want := map[string]int{
		auth.SigVerifyOK:          1,
		auth.SigVerifyMismatch:    1,
		auth.SigVerifyLegacyShape: 1,
		auth.SigVerifyError:       1,
	}
	for result, n := range want {
		if counts[result] != n {
			t.Errorf("counts[%s] = %d, want %d", result, counts[result], n)
		}
		if got := testutil.ToFloat64(metrics.MultisigSigVerifySweep.WithLabelValues(result)); got != float64(n) {
			t.Errorf("gauge %s = %v, want %d", result, got, n)
		}
	}
}

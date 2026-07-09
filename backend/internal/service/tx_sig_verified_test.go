package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"testing"

	"connectrpc.com/connect"
	"github.com/cosmos/cosmos-sdk/codec/legacy"
	"github.com/cosmos/cosmos-sdk/crypto/keys/multisig"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	cryptotypes "github.com/cosmos/cosmos-sdk/crypto/types"
	"github.com/cosmos/cosmos-sdk/types/bech32"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/auth"
)

// TestSignTransaction_StoresVerifiedVerdict pins the per-signature verified
// flag: SignTransaction records the A3 verification verdict on every stored
// signature — in BOTH log-only and enforce modes — and transaction reads
// return it, so quorum displays can distinguish cryptographically verified
// signatures from merely-submitted ones during the log-only rollout window.
func TestSignTransaction_StoresVerifiedVerdict(t *testing.T) {
	const (
		chainID  = "test13"
		acctNum  = 5
		sequence = 9
		feeJSON  = `{"gas_wanted":"200000","gas_fee":"1000000ugnot"}`
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

	token := h.makeToken(t, memberAddr)
	createTx := func(t *testing.T) uint32 {
		t.Helper()
		resp, err := h.svc.CreateTransaction(ctx, connect.NewRequest(&membav1.CreateTransactionRequest{
			AuthToken:       token,
			ChainId:         chainID,
			MultisigAddress: msAddr,
			MsgsJson:        msgsJSON,
			FeeJson:         feeJSON,
			AccountNumber:   acctNum,
			Sequence:        sequence,
		}))
		if err != nil {
			t.Fatal("CreateTransaction:", err)
		}
		return resp.Msg.GetTransactionId()
	}

	var msgs []json.RawMessage
	if err := json.Unmarshal([]byte(msgsJSON), &msgs); err != nil {
		t.Fatal(err)
	}
	signBytes, err := auth.CanonicalSignBytes(auth.SignDocInput{
		ChainID:       chainID,
		AccountNumber: acctNum,
		Sequence:      sequence,
		GasWanted:     200000,
		GasFeeAmount:  1000000,
		GasFeeDenom:   "ugnot",
		Msgs:          msgs,
	})
	if err != nil {
		t.Fatal(err)
	}
	rawSig, err := priv.Sign(signBytes)
	if err != nil {
		t.Fatal(err)
	}
	validSig := base64.StdEncoding.EncodeToString(rawSig)
	bogusSig := base64.StdEncoding.EncodeToString([]byte("this is not a valid signature!!!"))

	sign := func(t *testing.T, txID uint32, sig string) {
		t.Helper()
		if _, err := h.svc.SignTransaction(ctx, connect.NewRequest(&membav1.SignTransactionRequest{
			AuthToken:     token,
			TransactionId: txID,
			Signature:     sig,
		})); err != nil {
			t.Fatal("SignTransaction:", err)
		}
	}

	// readSig fetches the single signature row back through GetTransaction —
	// the same path TransactionView renders from.
	readSig := func(t *testing.T, txID uint32) *membav1.Signature {
		t.Helper()
		resp, err := h.svc.GetTransaction(ctx, connect.NewRequest(&membav1.GetTransactionRequest{
			AuthToken:     token,
			TransactionId: txID,
		}))
		if err != nil {
			t.Fatal("GetTransaction:", err)
		}
		sigs := resp.Msg.GetTransaction().GetSignatures()
		if len(sigs) != 1 {
			t.Fatalf("expected 1 signature, got %d", len(sigs))
		}
		return sigs[0]
	}

	t.Run("log-only mode: valid signature stored verified=true", func(t *testing.T) {
		t.Setenv(auth.EnforceMultisigSigVerifyEnv, "0")
		txID := createTx(t)
		sign(t, txID, validSig)
		if sig := readSig(t, txID); !sig.GetVerified() {
			t.Fatal("expected a valid signature to be stored with verified=true")
		}
	})

	t.Run("log-only mode: bogus signature stored verified=false", func(t *testing.T) {
		t.Setenv(auth.EnforceMultisigSigVerifyEnv, "0")
		txID := createTx(t)
		sign(t, txID, bogusSig)
		if sig := readSig(t, txID); sig.GetVerified() {
			t.Fatal("expected a bogus signature to be stored with verified=false")
		}
	})

	t.Run("enforce mode: valid signature stored verified=true", func(t *testing.T) {
		t.Setenv(auth.EnforceMultisigSigVerifyEnv, "1")
		txID := createTx(t)
		sign(t, txID, validSig)
		if sig := readSig(t, txID); !sig.GetVerified() {
			t.Fatal("expected verdict to be recorded in enforce mode too")
		}
	})

	t.Run("re-sign upsert updates the verdict", func(t *testing.T) {
		t.Setenv(auth.EnforceMultisigSigVerifyEnv, "0")
		txID := createTx(t)
		sign(t, txID, bogusSig)
		if sig := readSig(t, txID); sig.GetVerified() {
			t.Fatal("precondition: bogus signature must start verified=false")
		}
		sign(t, txID, validSig)
		if sig := readSig(t, txID); !sig.GetVerified() {
			t.Fatal("expected re-signing with a valid signature to flip verified=true")
		}
	})

	t.Run("Transactions list returns the verdict", func(t *testing.T) {
		t.Setenv(auth.EnforceMultisigSigVerifyEnv, "0")
		txID := createTx(t)
		sign(t, txID, validSig)
		resp, err := h.svc.Transactions(ctx, connect.NewRequest(&membav1.TransactionsRequest{
			AuthToken:       token,
			ChainId:         chainID,
			MultisigAddress: msAddr,
		}))
		if err != nil {
			t.Fatal("Transactions:", err)
		}
		found := false
		for _, tx := range resp.Msg.GetTransactions() {
			if tx.GetId() != txID {
				continue
			}
			found = true
			sigs := tx.GetSignatures()
			if len(sigs) != 1 || !sigs[0].GetVerified() {
				t.Fatalf("expected the list read to return verified=true, got %+v", sigs)
			}
		}
		if !found {
			t.Fatalf("transaction %d not returned by Transactions list", txID)
		}
	})
}

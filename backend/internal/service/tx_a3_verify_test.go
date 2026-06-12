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

// TestSignTransaction_A3Verification exercises the A3 wiring in SignTransaction:
// the handler reconstructs canonical sign-bytes from the stored tx fields and
// verifies the member signature, gated by MEMBA_ENFORCE_MULTISIG_SIG_VERIFY.
func TestSignTransaction_A3Verification(t *testing.T) {
	const (
		chainID  = "test12"
		acctNum  = 5
		sequence = 9
		feeJSON  = `{"gas_wanted":"200000","gas_fee":"1000000ugnot"}`
	)

	ctx := context.Background()
	h := setup(t)

	// A real (in-Go) member keypair so we can produce a genuinely valid signature.
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

	msgsJSON := `[{"@type":"/bank.MsgSend","from_address":"` + memberAddr +
		`","to_address":"` + memberAddr + `","amount":"1ugnot"}]`

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

	// Build the canonical sign-bytes the handler will reconstruct, and sign them.
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

	sign := func(t *testing.T, txID uint32, sig string) error {
		t.Helper()
		_, err := h.svc.SignTransaction(ctx, connect.NewRequest(&membav1.SignTransactionRequest{
			AuthToken:     token,
			TransactionId: txID,
			Signature:     sig,
		}))
		return err
	}

	t.Run("enforce mode rejects a bogus signature", func(t *testing.T) {
		t.Setenv(auth.EnforceMultisigSigVerifyEnv, "1")
		if err := sign(t, createTx(t), bogusSig); err == nil {
			t.Fatal("expected enforce mode to reject a bogus signature")
		} else if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", err)
		}
	})

	t.Run("enforce mode accepts a valid signature", func(t *testing.T) {
		t.Setenv(auth.EnforceMultisigSigVerifyEnv, "1")
		if err := sign(t, createTx(t), validSig); err != nil {
			t.Fatalf("expected enforce mode to accept a valid signature, got: %v", err)
		}
	})

	t.Run("log-only mode (default) accepts even a bogus signature", func(t *testing.T) {
		t.Setenv(auth.EnforceMultisigSigVerifyEnv, "0")
		if err := sign(t, createTx(t), bogusSig); err != nil {
			t.Fatalf("expected log-only mode to accept (lockout-safe), got: %v", err)
		}
	})
}

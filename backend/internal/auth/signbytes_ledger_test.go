package auth

import (
	"encoding/base64"
	"encoding/json"
	"testing"

	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
)

// gnolang/gno#6173 moved the fee inside the signed document from
//
//	{"gas_fee":"1ugnot","gas_wanted":"0"}
//
// to the shape the Ledger Cosmos app will parse:
//
//	{"amount":[{"denom":"ugnot","amount":"1"}],"gas":"0"}
//
// Wallets build this payload themselves, so they will not all move on the same
// day. gno's own node accepts BOTH renderings at verification (ante.go falls
// back to GetSignBytesLegacy). Memba verifies signatures that wallets produce,
// so it has to do the same or logins break the moment Adena updates.
//
// These tests deliberately hand-build the expected Cosmos-shape document rather
// than calling a production helper: they describe what a wallet will sign, not
// how we happen to render it.

// ledgerShapeLoginBytes returns the login-challenge sign-bytes as a wallet on the
// post-#6173 rendering would produce them.
func ledgerShapeLoginBytes(t *testing.T, chainID, userAddress string, nonce []byte) []byte {
	t.Helper()
	msg, err := json.Marshal(loginMsg{
		Type:       "/vm.m_call",
		Caller:     userAddress,
		Send:       "",
		MaxDeposit: "",
		PkgPath:    LoginPkgPath,
		Func:       LoginFunc,
	})
	if err != nil {
		t.Fatalf("marshal login msg: %v", err)
	}
	doc := map[string]any{
		"chain_id":       chainID,
		"account_number": "0",
		"sequence":       "0",
		"fee": map[string]any{
			// The login challenge uses a nominal 1ugnot fee and gas_wanted 0.
			"amount": []any{map[string]any{"denom": "ugnot", "amount": "1"}},
			"gas":    "0",
		},
		"msgs": []json.RawMessage{msg},
		"memo": LoginChallengeMemo(nonce),
	}
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal doc: %v", err)
	}
	// Same final sortJSON pass gno applies.
	var generic any
	if err := json.Unmarshal(raw, &generic); err != nil {
		t.Fatalf("sortJSON unmarshal: %v", err)
	}
	sorted, err := json.Marshal(generic)
	if err != nil {
		t.Fatalf("sortJSON marshal: %v", err)
	}
	return sorted
}

func TestVerifyLoginChallenge_AcceptsLedgerShapeSignature(t *testing.T) {
	priv := secp256k1.GenPrivKey()
	pub := priv.PubKey().(*secp256k1.PubKey)

	chainID := "gnoland-1"
	user := "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
	nonce := []byte("0123456789abcdef")

	// A wallet on the post-#6173 rendering signs the Cosmos-shape document.
	payload := ledgerShapeLoginBytes(t, chainID, user, nonce)
	sig, err := priv.Sign(payload)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	err = VerifyLoginChallengeSignature(pub, chainID, user, nonce, base64.StdEncoding.EncodeToString(sig))
	if err != nil {
		t.Fatalf("login signature made over the Ledger-shape rendering must verify, got: %v", err)
	}
}

func TestVerifyLoginChallenge_StillAcceptsLegacySignature(t *testing.T) {
	priv := secp256k1.GenPrivKey()
	pub := priv.PubKey().(*secp256k1.PubKey)

	chainID := "gnoland-1"
	user := "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
	nonce := []byte("0123456789abcdef")

	// A wallet that has NOT moved yet signs the legacy document. This must keep
	// working; it is the case every wallet is in today.
	payload, err := LoginChallengeSignBytes(chainID, user, nonce)
	if err != nil {
		t.Fatalf("build legacy sign bytes: %v", err)
	}
	sig, err := priv.Sign(payload)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	if err := VerifyLoginChallengeSignature(pub, chainID, user, nonce, base64.StdEncoding.EncodeToString(sig)); err != nil {
		t.Fatalf("legacy login signature must still verify, got: %v", err)
	}
}

func TestVerifyLoginChallenge_RejectsSignatureOverADifferentDocument(t *testing.T) {
	priv := secp256k1.GenPrivKey()
	pub := priv.PubKey().(*secp256k1.PubKey)

	chainID := "gnoland-1"
	user := "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
	nonce := []byte("0123456789abcdef")

	// Accepting two renderings must not mean accepting anything. A signature over
	// a DIFFERENT nonce must still be refused under both.
	other, err := LoginChallengeSignBytes(chainID, user, []byte("ffffffffffffffff"))
	if err != nil {
		t.Fatalf("build sign bytes: %v", err)
	}
	sig, err := priv.Sign(other)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	if err := VerifyLoginChallengeSignature(pub, chainID, user, nonce, base64.StdEncoding.EncodeToString(sig)); err == nil {
		t.Fatal("a signature over a different challenge must be rejected under both renderings")
	}
}

func TestLedgerAndLegacyRenderingsAreDistinct(t *testing.T) {
	chainID := "gnoland-1"
	user := "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
	nonce := []byte("0123456789abcdef")

	legacy, err := LoginChallengeSignBytes(chainID, user, nonce)
	if err != nil {
		t.Fatalf("legacy: %v", err)
	}
	ledger := ledgerShapeLoginBytes(t, chainID, user, nonce)

	// If the two ever coincided, accepting both would be vacuous and the other
	// tests here would pass for the wrong reason.
	if string(legacy) == string(ledger) {
		t.Fatalf("the two renderings must differ, both were: %s", legacy)
	}
}

// ── A3: the multisig submission guard has the same exposure ──────────────────
// A member signing with a post-#6173 wallet must not have their signature
// classified as a mismatch at submission time.

func ledgerShapeStoredBytes(t *testing.T, txf StoredTxFields) []byte {
	t.Helper()
	in, err := signDocInputFromStored(txf)
	if err != nil {
		t.Fatalf("signDocInputFromStored: %v", err)
	}
	b, err := CanonicalSignBytesLedger(in)
	if err != nil {
		t.Fatalf("CanonicalSignBytesLedger: %v", err)
	}
	return b
}

func storedTxForLedgerTest() StoredTxFields {
	return StoredTxFields{
		ChainID:       "gnoland-1",
		AccountNumber: 7,
		Sequence:      3,
		MsgsJSON:      `[{"@type":"/bank.MsgSend","from_address":"g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5","to_address":"g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5","amount":"1ugnot"}]`,
		FeeJSON:       `{"gas_wanted":"2000000","gas_fee":"1000000ugnot"}`,
		Memo:          "",
	}
}

func TestClassifyStoredSignature_AcceptsLedgerShapeSignature(t *testing.T) {
	priv := secp256k1.GenPrivKey()
	msJSON, signerAddr := memberMultisig(t, priv.PubKey())
	txf := storedTxForLedgerTest()

	sig, err := priv.Sign(ledgerShapeStoredBytes(t, txf))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	state, err := ClassifyStoredSignature(msJSON, signerAddr, base64.StdEncoding.EncodeToString(sig), txf)
	if err != nil {
		t.Fatalf("a member signing with a post-#6173 wallet must verify, got %s: %v", state, err)
	}
	if state != SigVerifyOK {
		t.Fatalf("expected %s, got %s", SigVerifyOK, state)
	}
}

func TestClassifyStoredSignature_StillRejectsAForeignSignature(t *testing.T) {
	priv := secp256k1.GenPrivKey()
	msJSON, signerAddr := memberMultisig(t, priv.PubKey())
	txf := storedTxForLedgerTest()

	// Signed over a DIFFERENT document. Accepting two renderings must not widen
	// into accepting anything.
	other := storedTxForLedgerTest()
	other.Sequence = 99
	sig, err := priv.Sign(ledgerShapeStoredBytes(t, other))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	if _, err := ClassifyStoredSignature(msJSON, signerAddr, base64.StdEncoding.EncodeToString(sig), txf); err == nil {
		t.Fatal("a signature over a different sequence must still be rejected")
	}
}

// A ZERO FEE MUST RENDER AS AN EMPTY LIST, not as a coin of amount 0. Cosmos's
// Coins carries no zero entries and the Ledger displays every coin it is given,
// so {"denom":"","amount":"0"} would be wrong and likely rejected — reintroducing,
// for zero-fee documents, exactly the failure #6173 exists to fix. gno pins the
// same rule in tm2/pkg/std/doc.go feeAmount(). Zero fees are not hypothetical:
// genesis transactions are signed with GetSignBytes(chainID, 0, 0).
func TestLedgerRendering_ZeroFeeIsAnEmptyAmountList(t *testing.T) {
	got, err := CanonicalSignBytesLedger(SignDocInput{
		ChainID:      "gnoland-1",
		GasWanted:    0,
		GasFeeAmount: 0,
		GasFeeDenom:  "ugnot",
		Memo:         "",
	})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	var doc struct {
		Fee struct {
			Amount []map[string]string `json:"amount"`
			Gas    string              `json:"gas"`
		} `json:"fee"`
	}
	if err := json.Unmarshal(got, &doc); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(doc.Fee.Amount) != 0 {
		t.Fatalf("a zero fee must render as an EMPTY amount list, got %v (full doc: %s)", doc.Fee.Amount, got)
	}
	if doc.Fee.Gas != "0" {
		t.Fatalf("gas must still render as \"0\", got %q", doc.Fee.Gas)
	}
}

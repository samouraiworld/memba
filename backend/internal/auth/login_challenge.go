package auth

import (
	"encoding/base64"
	"encoding/json"
	"fmt"

	"github.com/pkg/errors"
)

// A2 login proof — Adena has no ADR-036 (only tx-shaped signing), so the login
// challenge is a NON-BROADCAST, tx-shaped sign-doc the user signs via Adena and the
// backend reconstructs + verifies over gno-canonical sign-bytes (CanonicalSignBytes).
//
// The doc is a sentinel /vm.m_call that is never deployed/broadcast; the server
// challenge nonce lives in the memo (anti-replay binding, also human-readable in the
// wallet prompt). account_number/sequence/fee are zero so it is not a usable tx.
// See docs/planning/MEMBA_AAA_A2A3_SIGNBYTES_DESIGN.md §5 (A2).
const (
	// LoginPkgPath is a sentinel realm path — intentionally never deployed, so the
	// challenge can never be broadcast as a meaningful transaction.
	LoginPkgPath = "gno.land/r/memba/login"
	// LoginFunc names the sentinel function in the login challenge.
	LoginFunc = "ProveKeyOwnership"
)

// LoginChallengeMemo is the canonical memo of the login challenge: the client magic
// (anti-phishing, shows intent in the wallet) plus the base64 server nonce (binds
// the signature to this one challenge).
func LoginChallengeMemo(nonce []byte) string {
	return ClientMagic + " | nonce: " + base64.StdEncoding.EncodeToString(nonce)
}

// loginMsg is the sentinel MsgCall, marshaled to match the EXACT doc Adena signs.
// Adena proto-roundtrips each msg before signing (MsgCall.decode -> MsgCall.toJSON;
// adena-module messages.ts:50-60 via sign-gno-document.ts): ts-proto OMITS an empty
// repeated `args` (no key at all) but EMITS the empty scalar `send`/`max_deposit`.
// So `args` carries omitempty (a no-arg login => key omitted), while send/max_deposit
// are always present as "". Verified byte-exact against a real Adena login signature
// in login_challenge_realvector_test.go. (gnokey would omit all three, but the login
// doc is never broadcast — A2 matches Adena, not gnokey.) See design §9.
type loginMsg struct {
	Type       string   `json:"@type"`
	Args       []string `json:"args,omitempty"`
	Caller     string   `json:"caller"`
	Send       string   `json:"send"`
	MaxDeposit string   `json:"max_deposit"`
	PkgPath    string   `json:"pkg_path"`
	Func       string   `json:"func"`
}

// LoginChallengeSignBytes reconstructs the gno-canonical sign-bytes of the login
// challenge for (chainID, userAddress, nonce). The frontend must build a
// byte-identical doc for Adena to sign; the backend verifies the user's signature
// over these bytes. Deterministic in its inputs — never derived from client bytes.
func LoginChallengeSignBytes(chainID, userAddress string, nonce []byte) ([]byte, error) {
	msg, err := json.Marshal(loginMsg{
		Type:       "/vm.m_call",
		Caller:     userAddress,
		Send:       "",
		MaxDeposit: "",
		PkgPath:    LoginPkgPath,
		Func:       LoginFunc,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal login msg: %w", err)
	}
	return CanonicalSignBytes(SignDocInput{
		ChainID:       chainID,
		AccountNumber: 0,
		Sequence:      0,
		GasWanted:     0,
		// Nominal non-zero gas_fee ("1ugnot"). Adena's validateTransactionDocumentFee
		// REJECTS an empty gas_fee (falsy string) before showing the sign popup, so the
		// fee must be a non-empty coin string. The doc is never broadcast, so the value
		// is irrelevant — it only needs to match what Adena signs. See design §9.
		GasFeeAmount: 1,
		GasFeeDenom:  "ugnot",
		Msgs:         []json.RawMessage{msg},
		Memo:         LoginChallengeMemo(nonce),
	})
}

// VerifyLoginChallengeSignature verifies sigBase64 over the reconstructed login
// challenge sign-bytes for the given user. Returns an error on any failure.
func VerifyLoginChallengeSignature(pubKey interface{ VerifySignature(msg, sig []byte) bool }, chainID, userAddress string, nonce []byte, sigBase64 string) error {
	sig, err := base64.StdEncoding.DecodeString(sigBase64)
	if err != nil {
		return errors.Wrap(err, "failed to decode user signature")
	}
	signBytes, err := LoginChallengeSignBytes(chainID, userAddress, nonce)
	if err != nil {
		return errors.Wrap(err, "failed to build login challenge sign bytes")
	}
	if !pubKey.VerifySignature(signBytes, sig) {
		return errors.New("invalid user signature")
	}
	return nil
}

package auth

import (
	"encoding/base64"
	"testing"
)

// Real Adena login signature captured from production memba-backend logs
// (2026-06-23) that returned result=signed_invalid. Non-sensitive: a single-use,
// non-broadcast login-challenge signature over a public pubkey/address — it leaks
// no private key and cannot be replayed (the nonce is one-shot + server-bound).
//
// Guards that LoginChallengeSignBytes reconstructs the EXACT doc Adena signs.
// Adena's signing pipeline (adena-module sign-gno-document.ts) proto-roundtrips
// each msg (MsgCall.decode -> MsgCall.toJSON, messages.ts:50-60): ts-proto OMITS
// an empty repeated `args` but EMITS empty scalar `send`/`max_deposit`. The login
// doc therefore has no `args` key — not "args":null.
const (
	realLoginAddr     = "g187sfsghc9tqayr5rgdmpy2tetnq9ttluxuk79h"
	realLoginNonceB64 = "MP5b2kinL5shAbw8hK7YZwXd41j9Vho5vl8BLP0uTDM="
	realLoginChainID  = "test-13"
	realLoginPubKey   = `{"type":"tendermint/PubKeySecp256k1","value":"A11OyvOPLagDVsrHEKIBIExVRF5lt7wVCj+fUZRBL1/t"}`
	realLoginSigB64   = "0e75YMVunc5Ummsmy9gw2DeJbhunVFwseiFi6f6+TidWNFxOgXticXoIGtUkCoeSSHhs9SD7yyuh10h8bP7U3A=="
)

func TestLoginChallengeSignBytes_VerifiesRealAdenaSignature(t *testing.T) {
	pub, err := ParsePubKeyJSON(realLoginPubKey)
	if err != nil {
		t.Fatalf("parse pubkey: %v", err)
	}
	nonce, err := base64.StdEncoding.DecodeString(realLoginNonceB64)
	if err != nil {
		t.Fatalf("decode nonce: %v", err)
	}
	if err := VerifyLoginChallengeSignature(pub, realLoginChainID, realLoginAddr, nonce, realLoginSigB64); err != nil {
		sb, _ := LoginChallengeSignBytes(realLoginChainID, realLoginAddr, nonce)
		t.Fatalf("real Adena login signature did NOT verify: %v\nreconstructed sign-bytes: %s", err, string(sb))
	}
}

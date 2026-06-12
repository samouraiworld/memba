package auth

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/cosmos/cosmos-sdk/codec/legacy"
	"github.com/cosmos/cosmos-sdk/crypto/keys/multisig"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	cryptotypes "github.com/cosmos/cosmos-sdk/crypto/types"
	"github.com/cosmos/cosmos-sdk/types/bech32"
)

// storedFieldsFromFixture rebuilds the persisted transaction columns (as the
// transactions table stores them) from a sign-bytes golden vector.
func storedFieldsFromFixture(t *testing.T, f signBytesFixture) StoredTxFields {
	t.Helper()
	msgsJSON, err := json.Marshal(f.UnsignedTx.Msg)
	if err != nil {
		t.Fatalf("marshal msgs: %v", err)
	}
	feeJSON, err := json.Marshal(f.UnsignedTx.Fee)
	if err != nil {
		t.Fatalf("marshal fee: %v", err)
	}
	return StoredTxFields{
		ChainID:       f.ChainID,
		AccountNumber: f.AccountNumber,
		Sequence:      f.AccountSequence,
		MsgsJSON:      string(msgsJSON),
		FeeJSON:       string(feeJSON),
		Memo:          f.UnsignedTx.Memo,
	}
}

// memberMultisig builds a 2-of-3 multisig amino-JSON pubkey containing signerPub
// plus two throwaway members, and returns the JSON and signerPub's bech32 address
// (derived the same way the auth token derives member addresses).
func memberMultisig(t *testing.T, signerPub cryptotypes.PubKey) (pubkeyJSON, signerAddr string) {
	t.Helper()
	ms := multisig.NewLegacyAminoPubKey(2, []cryptotypes.PubKey{
		signerPub,
		secp256k1.GenPrivKey().PubKey(),
		secp256k1.GenPrivKey().PubKey(),
	})
	raw, err := legacy.Cdc.MarshalJSON(ms)
	if err != nil {
		t.Fatalf("marshal multisig pubkey: %v", err)
	}
	addr, err := bech32.ConvertAndEncode("g", signerPub.Address().Bytes())
	if err != nil {
		t.Fatalf("encode signer address: %v", err)
	}
	return string(raw), addr
}

func fixturePubKey(t *testing.T, f signBytesFixture) *secp256k1.PubKey {
	t.Helper()
	b, err := base64.StdEncoding.DecodeString(f.PubKeyB64)
	if err != nil {
		t.Fatalf("decode pubkey: %v", err)
	}
	return &secp256k1.PubKey{Key: b}
}

// TestVerifyMultisigMemberSignature_AcceptsRealSignature proves a real gnokey
// member signature verifies against sign-bytes reconstructed from the stored tx
// columns (the A3 server-side check), across every msg type.
func TestVerifyMultisigMemberSignature_AcceptsRealSignature(t *testing.T) {
	for name, f := range loadSignBytesFixtures(t) {
		t.Run(name, func(t *testing.T) {
			pub := fixturePubKey(t, f)
			pubkeyJSON, signerAddr := memberMultisig(t, pub)
			txf := storedFieldsFromFixture(t, f)

			if err := VerifyMultisigMemberSignature(pubkeyJSON, signerAddr, f.SignatureB64, txf); err != nil {
				t.Fatalf("expected real member signature to verify, got: %v", err)
			}
		})
	}
}

func TestVerifyMultisigMemberSignature_Rejects(t *testing.T) {
	f := loadSignBytesFixtures(t)["send_basic"]
	pub := fixturePubKey(t, f)
	pubkeyJSON, signerAddr := memberMultisig(t, pub)
	txf := storedFieldsFromFixture(t, f)

	t.Run("tampered signature", func(t *testing.T) {
		bad := "AAAA" + f.SignatureB64[4:]
		if err := VerifyMultisigMemberSignature(pubkeyJSON, signerAddr, bad, txf); err == nil {
			t.Fatal("expected tampered signature to be rejected")
		}
	})

	t.Run("wrong sequence breaks verification", func(t *testing.T) {
		bad := txf
		bad.Sequence = txf.Sequence + 1
		if err := VerifyMultisigMemberSignature(pubkeyJSON, signerAddr, f.SignatureB64, bad); err == nil {
			t.Fatal("expected signature over a different sequence to be rejected")
		}
	})

	t.Run("signer not a member", func(t *testing.T) {
		outsider := secp256k1.GenPrivKey().PubKey()
		otherAddr, err := bech32.ConvertAndEncode("g", outsider.Address().Bytes())
		if err != nil {
			t.Fatal(err)
		}
		err = VerifyMultisigMemberSignature(pubkeyJSON, otherAddr, f.SignatureB64, txf)
		if err == nil || !strings.Contains(err.Error(), "not a member") {
			t.Fatalf("expected not-a-member rejection, got: %v", err)
		}
	})

	t.Run("malformed signature base64", func(t *testing.T) {
		if err := VerifyMultisigMemberSignature(pubkeyJSON, signerAddr, "!!!not base64!!!", txf); err == nil {
			t.Fatal("expected malformed base64 to be rejected")
		}
	})

	t.Run("malformed msgs_json", func(t *testing.T) {
		bad := txf
		bad.MsgsJSON = "{not an array}"
		if err := VerifyMultisigMemberSignature(pubkeyJSON, signerAddr, f.SignatureB64, bad); err == nil {
			t.Fatal("expected malformed msgs_json to error")
		}
	})
}

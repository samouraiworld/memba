package gnomultisig

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"testing"

	"github.com/gnolang/gno/tm2/pkg/amino"
	ctypes "github.com/gnolang/gno/tm2/pkg/bft/rpc/core/types"
	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/crypto/multisig"
	"github.com/gnolang/gno/tm2/pkg/crypto/secp256k1"
	"github.com/gnolang/gno/tm2/pkg/std"
)

// Public, disposable fixture scalars. NEVER use these keys outside tests.
func signingFixture(t *testing.T) (multisig.PubKeyMultisigThreshold, []secp256k1.PrivKeySecp256k1, Fields) {
	t.Helper()
	keys := make([]secp256k1.PrivKeySecp256k1, 3)
	pubs := make([]crypto.PubKey, 3)
	for i := range keys {
		keys[i][31] = byte(i + 1)
		pubs[i] = keys[i].PubKey()
	}
	pk := multisig.NewPubKeyMultisigThreshold(2, pubs).(multisig.PubKeyMultisigThreshold)
	f := Fields{ChainID: "memba-native-local", MsgsJSON: fmt.Sprintf(`[{"@type":"/bank.MsgSend","from_address":"%s","to_address":"%s","amount":"100ugnot"}]`, pk.Address(), pubs[0].Address()), FeeJSON: `{"gas_wanted":"1000000","gas_fee":"100000ugnot"}`, Memo: "disposable local fixture"}
	return pk, keys, f
}

func signPartial(t *testing.T, pk multisig.PubKeyMultisigThreshold, key secp256k1.PrivKeySecp256k1, f Fields, legacy bool) Partial {
	t.Helper()
	tx, err := Transaction(f, pk.Address().String())
	if err != nil {
		t.Fatal(err)
	}
	b, err := tx.GetSignBytes(f.ChainID, f.AccountNumber, f.Sequence)
	if legacy {
		b, err = tx.GetSignBytesLegacy(f.ChainID, f.AccountNumber, f.Sequence)
	}
	if err != nil {
		t.Fatal(err)
	}
	sig, err := key.Sign(b)
	if err != nil {
		t.Fatal(err)
	}
	return Partial{Address: key.PubKey().Address().String(), Value: base64.StdEncoding.EncodeToString(sig)}
}

func TestNativeAggregateSparseAndRoundTrip(t *testing.T) {
	pk, keys, f := signingFixture(t)
	for _, legacy := range []bool{false, true} {
		t.Run(fmt.Sprint("legacy=", legacy), func(t *testing.T) {
			partials := []Partial{signPartial(t, pk, keys[2], f, legacy), signPartial(t, pk, keys[0], f, legacy)}
			tx, b, err := Assemble(pk, f, partials)
			if err != nil {
				t.Fatal(err)
			}
			if err := ValidateSigned(pk, f, b); err != nil {
				t.Fatal(err)
			}
			var decoded std.Tx
			if err := amino.Unmarshal(b, &decoded); err != nil {
				t.Fatal(err)
			}
			if _, err := std.VerifySignaturePayload(decoded.Signatures[0].PubKey, decoded.SignDoc(f.ChainID, f.AccountNumber, f.Sequence), decoded.Signatures[0].Signature); err != nil {
				t.Fatal(err)
			}
			var agg multisig.Multisignature
			if err := amino.Unmarshal(decoded.Signatures[0].Signature, &agg); err != nil {
				t.Fatal(err)
			}
			if !agg.BitArray.GetIndex(0) || agg.BitArray.GetIndex(1) || !agg.BitArray.GetIndex(2) {
				t.Fatal("wrong sparse member positions")
			}
			j, err := amino.MarshalJSON(tx)
			if err != nil {
				t.Fatal(err)
			}
			var fromJSON std.Tx
			if err := amino.UnmarshalJSON(j, &fromJSON); err != nil {
				t.Fatal(err)
			}
			roundtrip, err := amino.Marshal(fromJSON)
			if err != nil || !bytes.Equal(b, roundtrip) {
				t.Fatal("native JSON export differs from broadcast bytes")
			}
		})
	}
}

func TestNativeReceiptBindsAllStoredFields(t *testing.T) {
	pk, keys, f := signingFixture(t)
	for name, change := range map[string]func(*Fields){"chain": func(f *Fields) { f.ChainID = "other" }, "account": func(f *Fields) { f.AccountNumber++ }, "sequence": func(f *Fields) { f.Sequence++ }, "memo": func(f *Fields) { f.Memo += "changed" }, "fee": func(f *Fields) { f.FeeJSON = `{"gas_wanted":"1000000","gas_fee":"100001ugnot"}` }} {
		t.Run(name, func(t *testing.T) {
			other := f
			change(&other)
			_, b, err := Assemble(pk, other, []Partial{signPartial(t, pk, keys[0], other, false), signPartial(t, pk, keys[2], other, false)})
			if err != nil {
				t.Fatal(err)
			}
			if err := ValidateSigned(pk, f, b); err == nil {
				t.Fatal("unrelated signed receipt accepted")
			}
		})
	}
}

func TestNativeRPCResponseShape(t *testing.T) {
	b, err := amino.MarshalJSON(ctypes.ResultBroadcastTxCommit{Height: 1})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("native RPC response: %s", b)
}

func TestNativeAggregateRejectsInvalidSets(t *testing.T) {
	pk, keys, f := signingFixture(t)
	a, b := signPartial(t, pk, keys[0], f, false), signPartial(t, pk, keys[2], f, false)
	bad := b
	bad.Value = base64.StdEncoding.EncodeToString(make([]byte, 64))
	outsider := b
	outsider.Address = "g1outsider"
	for name, ps := range map[string][]Partial{"underquorum": {a}, "duplicate": {a, a}, "outsider": {a, outsider}, "bad_signature": {a, bad}, "mixed_renderings": {a, signPartial(t, pk, keys[2], f, true)}} {
		t.Run(name, func(t *testing.T) {
			if _, _, err := Assemble(pk, f, ps); err == nil {
				t.Fatal("accepted invalid aggregate")
			}
		})
	}
	for _, mutate := range []func(*Fields){func(f *Fields) { f.ChainID = "other" }, func(f *Fields) { f.Sequence++ }, func(f *Fields) { f.AccountNumber++ }, func(f *Fields) { f.Memo += "changed" }, func(f *Fields) { f.FeeJSON = `{"gas_wanted":"1000000","gas_fee":"100001ugnot"}` }} {
		changed := f
		mutate(&changed)
		if _, _, err := Assemble(pk, changed, []Partial{a, b}); err == nil {
			t.Fatal("accepted changed signed field")
		}
	}
}

func TestNativeTransactionSignerAndShape(t *testing.T) {
	pk, _, f := signingFixture(t)
	for _, raw := range []string{
		`[]`, `null`, `[{"@type":"/vm.m_run"}]`,
		fmt.Sprintf(`[{"@type":"/bank.MsgSend","from_address":"%s","to_address":"%s","amount":"1ugnot","extra":true}]`, pk.Address(), pk.PubKeys[0].Address()),
		fmt.Sprintf(`[{"@type":"/bank.MsgSend","from_address":"%s","to_address":"%s","amount":"1ugnot"}]`, pk.PubKeys[0].Address(), pk.Address()),
	} {
		changed := f
		changed.MsgsJSON = raw
		if _, err := Transaction(changed, pk.Address().String()); err == nil {
			t.Fatal("accepted invalid message", raw)
		}
	}
}

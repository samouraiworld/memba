package gnomultisig

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"

	"github.com/gnolang/gno/gno.land/pkg/sdk/vm"
	"github.com/gnolang/gno/tm2/pkg/amino"
	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/crypto/multisig"
	"github.com/gnolang/gno/tm2/pkg/sdk/bank"
	"github.com/gnolang/gno/tm2/pkg/std"
)

var ErrSignature = errors.New("invalid, mixed-rendering, or insufficient native multisig signatures")

type Fields struct {
	ChainID                 string
	AccountNumber, Sequence uint64
	MsgsJSON, FeeJSON, Memo string
}

type Partial struct{ Address, Value string }

// Transaction accepts the deliberately small supported message surface, checks
// every signer, and decodes using the same registered types as the pinned node.
// Callers may canonicalize a NEW proposal with MessagesJSON, never an existing
// signed record. Signing and export use the typed node payload directly.
func Transaction(f Fields, address string) (std.Tx, error) {
	var tx std.Tx
	if f.ChainID == "" || len(f.MsgsJSON) > 102400 || len(f.FeeJSON) > 4096 || len(f.Memo) > 256 || StrictJSON([]byte(f.MsgsJSON)) != nil || StrictJSON([]byte(f.FeeJSON)) != nil {
		return tx, ErrInvalid
	}
	var msgs []map[string]json.RawMessage
	if json.Unmarshal([]byte(f.MsgsJSON), &msgs) != nil || len(msgs) == 0 || len(msgs) > 100 {
		return tx, ErrInvalid
	}
	for _, msg := range msgs {
		var kind string
		if json.Unmarshal(msg["@type"], &kind) != nil {
			return tx, ErrInvalid
		}
		allowed := map[string]bool{"@type": true}
		switch kind {
		case "/bank.MsgSend":
			for _, k := range []string{"from_address", "to_address", "amount"} {
				allowed[k] = true
			}
		case "/vm.m_call":
			for _, k := range []string{"caller", "send", "max_deposit", "pkg_path", "func", "args"} {
				allowed[k] = true
			}
		default:
			return tx, ErrInvalid
		}
		for k := range msg {
			if !allowed[k] {
				return tx, ErrInvalid
			}
		}
	}
	var fee map[string]json.RawMessage
	if json.Unmarshal([]byte(f.FeeJSON), &fee) != nil || len(fee) != 2 || fee["gas_wanted"] == nil || fee["gas_fee"] == nil {
		return tx, ErrInvalid
	}
	raw, err := json.Marshal(struct {
		Msg  json.RawMessage `json:"msg"`
		Fee  json.RawMessage `json:"fee"`
		Memo string          `json:"memo"`
	}{json.RawMessage(f.MsgsJSON), json.RawMessage(f.FeeJSON), f.Memo})
	if err != nil || amino.UnmarshalJSON(raw, &tx) != nil || tx.Fee.GasWanted <= 0 || !tx.Fee.GasFee.IsValid() {
		return tx, ErrInvalid
	}
	for _, msg := range tx.Msgs {
		switch msg.(type) {
		case bank.MsgSend, vm.MsgCall:
		default:
			return tx, ErrInvalid
		}
		if msg.ValidateBasic() != nil {
			return tx, ErrInvalid
		}
	}
	signers := tx.GetSigners()
	if len(signers) != 1 || signers[0].String() != address {
		return tx, ErrInvalid
	}
	tx.Signatures = []std.Signature{{}}
	if tx.ValidateBasic() != nil {
		return tx, ErrInvalid
	}
	tx.Signatures = nil
	return tx, nil
}

func MessagesJSON(tx std.Tx) (string, error) {
	b, err := amino.MarshalJSON(tx.Msgs)
	return string(b), err
}

func FeeJSON(tx std.Tx) (string, error) {
	b, err := amino.MarshalJSON(tx.Fee)
	return string(b), err
}

// ValidateSigned accepts any valid quorum for this exact stored proposal.
// A late extra partial changes an assembled transaction's hash, but cannot make
// an already-executed, correctly signed quorum cease to be this proposal.
func ValidateSigned(pk multisig.PubKeyMultisigThreshold, f Fields, raw []byte) error {
	want, err := Transaction(f, pk.Address().String())
	if err != nil {
		return err
	}
	var got std.Tx
	if amino.Unmarshal(raw, &got) != nil || len(got.Signatures) != 1 {
		return ErrInvalid
	}
	sig := got.Signatures[0]
	if sig.PubKey == nil || !pk.Equals(sig.PubKey) || sig.SessionAddr != (crypto.Address{}) {
		return ErrInvalid
	}
	got.Signatures = nil
	wantBytes, err := amino.Marshal(want)
	if err != nil {
		return err
	}
	gotBytes, err := amino.Marshal(got)
	if err != nil || !bytes.Equal(wantBytes, gotBytes) {
		return ErrInvalid
	}
	r, err := std.VerifySignaturePayload(pk, want.SignDoc(f.ChainID, f.AccountNumber, f.Sequence), sig.Signature)
	if err != nil || r == std.PayloadRenderingNone {
		return ErrSignature
	}
	return nil
}

// VerifyPartial returns the rendering, so callers can forbid combining two
// individually valid signatures that the chain cannot verify as one aggregate.
func VerifyPartial(pk multisig.PubKeyMultisigThreshold, f Fields, tx std.Tx, p Partial) (std.PayloadRendering, int, error) {
	b, err := base64.StdEncoding.Strict().DecodeString(p.Value)
	if err != nil || len(b) != 64 || base64.StdEncoding.EncodeToString(b) != p.Value {
		return 0, -1, ErrSignature
	}
	for i, member := range pk.PubKeys {
		if member.Address().String() == p.Address {
			r, err := std.VerifySignaturePayload(member, tx.SignDoc(f.ChainID, f.AccountNumber, f.Sequence), b)
			if err != nil || r == std.PayloadRenderingNone {
				return 0, -1, ErrSignature
			}
			return r, i, nil
		}
	}
	return 0, -1, ErrSignature
}

// Assemble verifies all partials independently, preserves the registered key
// positions (including sparse slots), then verifies the complete native blob.
// It has no network, DB, keybase, signing or broadcast side effects.
func Assemble(pk multisig.PubKeyMultisigThreshold, f Fields, partials []Partial) (std.Tx, []byte, error) {
	tx, err := Transaction(f, pk.Address().String())
	if err != nil {
		return tx, nil, err
	}
	if uint(len(partials)) < pk.K || len(partials) > len(pk.PubKeys) {
		return tx, nil, ErrSignature
	}
	agg := multisig.NewMultisig(len(pk.PubKeys))
	seen := map[int]bool{}
	var rendering std.PayloadRendering
	for _, p := range partials {
		r, i, err := VerifyPartial(pk, f, tx, p)
		if err != nil || seen[i] || (rendering != 0 && rendering != r) {
			return tx, nil, ErrSignature
		}
		seen[i] = true
		rendering = r
		b, _ := base64.StdEncoding.DecodeString(p.Value)
		if agg.AddSignature(b, i) != nil {
			return tx, nil, ErrSignature
		}
	}
	sig, err := amino.Marshal(agg)
	if err != nil {
		return tx, nil, err
	}
	if r, err := std.VerifySignaturePayload(pk, tx.SignDoc(f.ChainID, f.AccountNumber, f.Sequence), sig); err != nil || r == std.PayloadRenderingNone {
		return tx, nil, ErrSignature
	}
	tx.Signatures = []std.Signature{{PubKey: pk, Signature: sig}}
	if tx.ValidateBasic() != nil {
		return tx, nil, ErrInvalid
	}
	b, err := amino.Marshal(tx)
	return tx, b, err
}

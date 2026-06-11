package auth

import (
	"encoding/json"
	"fmt"
	"strconv"
)

// CanonicalSignBytes reproduces gno's canonical transaction sign-bytes
//
//	signBytes = sortJSON(aminoJSON(SignDoc))
//	SignDoc   = {chain_id, account_number, sequence, fee{gas_fee, gas_wanted}, msgs, memo}
//
// It is proven byte-equal to gno's std.GetSignBytes / `gnokey sign` by the golden
// vectors in testdata/signbytes (see scripts/gen-signbytes-vectors.sh). Both A2
// (login auth) and A3 (multisig submission verification) verify signatures over it.
//
// Reference (gno @ chain/test12, byte-identical on v1.0.0/v1.1.0):
//   - sortJSON = json.Unmarshal->json.Marshal           tm2/pkg/std/utils.go:10-22
//   - GetSignaturePayload = sortJSON(amino.MarshalJSON)  tm2/pkg/std/doc.go:24-42
//   - int64/uint64 -> quoted JSON strings               tm2/pkg/amino/json_encode.go:86-92
//   - Coin.String(): zero amount -> ""                  tm2/pkg/std/coin.go:55-62
//
// Msgs are passed through as already-canonical amino-JSON (e.g.
// {"@type":"/vm.m_call",...}) exactly as produced by the client / Adena and stored
// by the backend; the final sortJSON pass re-canonicalizes the whole document, so
// this handles /vm.m_call, /bank.MsgSend, /vm.m_addpkg (and any future msg) with no
// per-msg code. See docs/planning/MEMBA_AAA_A2A3_SIGNBYTES_DESIGN.md.
type SignDocInput struct {
	ChainID       string
	AccountNumber uint64
	Sequence      uint64
	GasWanted     int64
	GasFeeAmount  int64 // 0 => gas_fee serializes to "" (zero-Coin trap)
	GasFeeDenom   string
	Msgs          []json.RawMessage
	Memo          string
}

// signDocEnvelope mirrors gno's std.SignDoc amino-JSON shape: 64-bit ints are
// quoted strings, Fee.GasFee is the coin string, msgs ride through verbatim.
type signDocEnvelope struct {
	ChainID       string            `json:"chain_id"`
	AccountNumber string            `json:"account_number"`
	Sequence      string            `json:"sequence"`
	Fee           signDocFee        `json:"fee"`
	Msgs          []json.RawMessage `json:"msgs"`
	Memo          string            `json:"memo"`
}

type signDocFee struct {
	GasFee    string `json:"gas_fee"`
	GasWanted string `json:"gas_wanted"`
}

// coinString matches gno std.Coin.String() (coin.go:55-62): a zero amount yields
// the empty string, never "0denom".
func coinString(amount int64, denom string) string {
	if amount == 0 {
		return ""
	}
	return fmt.Sprintf("%d%s", amount, denom)
}

// CanonicalSignBytes returns the gno-canonical sign-bytes for the given SignDoc.
func CanonicalSignBytes(in SignDocInput) ([]byte, error) {
	msgs := in.Msgs
	if msgs == nil {
		msgs = []json.RawMessage{}
	}
	env := signDocEnvelope{
		ChainID:       in.ChainID,
		AccountNumber: strconv.FormatUint(in.AccountNumber, 10),
		Sequence:      strconv.FormatUint(in.Sequence, 10),
		Fee: signDocFee{
			GasFee:    coinString(in.GasFeeAmount, in.GasFeeDenom),
			GasWanted: strconv.FormatInt(in.GasWanted, 10),
		},
		Msgs: msgs,
		Memo: in.Memo,
	}

	aminoJSON, err := json.Marshal(env)
	if err != nil {
		return nil, fmt.Errorf("marshal sign doc: %w", err)
	}

	// Final pass = gno tm2 sortJSON (utils.go:10-22): unmarshal then marshal sorts
	// object keys alphabetically, strips whitespace, and inherits Go's HTML-escaping
	// of < > &. Never hand-emit the sorted bytes.
	var generic any
	if err := json.Unmarshal(aminoJSON, &generic); err != nil {
		return nil, fmt.Errorf("sortJSON unmarshal: %w", err)
	}
	sorted, err := json.Marshal(generic)
	if err != nil {
		return nil, fmt.Errorf("sortJSON marshal: %w", err)
	}
	return sorted, nil
}

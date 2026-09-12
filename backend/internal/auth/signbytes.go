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

// signDocFeeLedger is the fee as gnolang/gno#6173 renders it: the shape the
// Ledger Cosmos app will parse. Inside "fee" that app allows only amount, gas,
// granter and payer, so gno's own gas_fee/gas_wanted keys are refused and the
// device signs nothing. Wallets build this payload themselves and will not all
// move on the same day, so gno's node accepts BOTH renderings (ante.go falls
// back to GetSignBytesLegacy) and so must we — we verify what wallets produce.
type signDocFeeLedger struct {
	Amount []signDocCoin `json:"amount"`
	Gas    string        `json:"gas"`
}

// signDocCoin spells a coin out as an object, because amino renders std.Coin as
// the single string "1000000ugnot" and the allowlist wants {denom, amount}.
type signDocCoin struct {
	Denom  string `json:"denom"`
	Amount string `json:"amount"`
}

type signDocEnvelopeLedger struct {
	ChainID       string            `json:"chain_id"`
	AccountNumber string            `json:"account_number"`
	Sequence      string            `json:"sequence"`
	Fee           signDocFeeLedger  `json:"fee"`
	Msgs          []json.RawMessage `json:"msgs"`
	Memo          string            `json:"memo"`
}

// ledgerFeeAmount renders the fee coin as Cosmos renders a coin list.
//
// A ZERO FEE IS AN EMPTY LIST, not a list holding a zero coin — Cosmos's Coins
// carries no zero entries, and the device displays every coin it is given, so
// {"denom":"","amount":"0"} would be both wrong and likely rejected. This
// mirrors gno's feeAmount() in tm2/pkg/std/doc.go.
func ledgerFeeAmount(amount int64, denom string) []signDocCoin {
	if amount == 0 {
		return []signDocCoin{}
	}
	return []signDocCoin{{Denom: denom, Amount: strconv.FormatInt(amount, 10)}}
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

	return sortJSONDoc(env, "sign doc")
}

// CanonicalSignBytesLedger returns the same document with the fee rendered in
// the post-gnolang/gno#6173 shape. Used only for VERIFICATION: a wallet that has
// adopted that rendering signs these bytes instead. Memba keeps producing the
// legacy rendering, which the chain still accepts.
func CanonicalSignBytesLedger(in SignDocInput) ([]byte, error) {
	msgs := in.Msgs
	if msgs == nil {
		msgs = []json.RawMessage{}
	}
	env := signDocEnvelopeLedger{
		ChainID:       in.ChainID,
		AccountNumber: strconv.FormatUint(in.AccountNumber, 10),
		Sequence:      strconv.FormatUint(in.Sequence, 10),
		Fee: signDocFeeLedger{
			Amount: ledgerFeeAmount(in.GasFeeAmount, in.GasFeeDenom),
			Gas:    strconv.FormatInt(in.GasWanted, 10),
		},
		Msgs: msgs,
		Memo: in.Memo,
	}
	return sortJSONDoc(env, "ledger sign doc")
}

// sortJSONDoc marshals then applies gno tm2's sortJSON (utils.go:10-22):
// unmarshal then marshal sorts object keys alphabetically, strips whitespace,
// and inherits Go's HTML-escaping of < > &. Never hand-emit the sorted bytes.
func sortJSONDoc(env any, what string) ([]byte, error) {
	aminoJSON, err := json.Marshal(env)
	if err != nil {
		return nil, fmt.Errorf("marshal %s: %w", what, err)
	}
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

// VerifySignDocSignature reports whether sig is valid over EITHER rendering of
// the document. Accepting both is safe for the same reason it is safe in gno:
// the two fee key sets are disjoint ("gas_fee"/"gas_wanted" against
// "amount"/"gas"), so the two payloads can never coincide and one signature
// still authorises exactly one document.
func VerifySignDocSignature(pubKey interface{ VerifySignature(msg, sig []byte) bool }, in SignDocInput, sig []byte) bool {
	if legacy, err := CanonicalSignBytes(in); err == nil {
		if pubKey.VerifySignature(legacy, sig) {
			return true
		}
	}
	ledger, err := CanonicalSignBytesLedger(in)
	if err != nil {
		return false
	}
	return pubKey.VerifySignature(ledger, sig)
}

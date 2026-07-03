package auth

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/cosmos/cosmos-sdk/codec/legacy"
	"github.com/cosmos/cosmos-sdk/crypto/keys/multisig"
	cryptotypes "github.com/cosmos/cosmos-sdk/crypto/types"
	"github.com/cosmos/cosmos-sdk/types/bech32"
)

// EnforceMultisigSigVerifyEnv gates A3 server-side signature verification, two-phase
// and lockout-safe like AllowUnsignedAuthEnv. Default (unset / "0" / "false") is
// LOG-ONLY: a failing verification is recorded on the multisig_sig_verify gate
// signal but the signature is still accepted, so a reconstruction edge case cannot
// lock out legitimate signers before real Adena member signatures are observed
// verifying. Set to "1"/"true" to ENFORCE (reject failures) once the gate signal
// shows ~100% multisig_sig_verify{result=ok}.
const EnforceMultisigSigVerifyEnv = "MEMBA_ENFORCE_MULTISIG_SIG_VERIFY"

// EnforceMultisigSigVerify reports whether A3 verification rejects on failure.
func EnforceMultisigSigVerify() bool {
	switch os.Getenv(EnforceMultisigSigVerifyEnv) {
	case "1", "true", "TRUE":
		return true
	default:
		return false
	}
}

// StoredTxFields are the persisted transaction columns (transactions table) needed
// to reconstruct the canonical sign-bytes a multisig member signed. msgs_json and
// fee_json are stored verbatim in amino-JSON form. A3 reconstructs sign-bytes from
// these AUTHORITATIVE fields and never from client-supplied body_bytes — a
// self-consistent {doc, sig} pair over a divergent doc would verify yet die at
// broadcast. See docs/planning/MEMBA_AAA_A2A3_SIGNBYTES_DESIGN.md §5.
type StoredTxFields struct {
	ChainID       string
	AccountNumber uint64
	Sequence      uint64
	MsgsJSON      string // amino-JSON array of msgs, e.g. [{"@type":"/vm.m_call",...}]
	FeeJSON       string // amino-JSON {"gas_wanted":"...","gas_fee":"...ugnot"}
	Memo          string
}

type aminoFeeJSON struct {
	GasWanted string `json:"gas_wanted"`
	GasFee    string `json:"gas_fee"`
}

// parseSingleCoin splits a gno coin string ("1000000ugnot", "" => 0/"") into amount
// and denom. gno Fee.GasFee is a single Coin, so a comma (multi-coin) is rejected.
func parseSingleCoin(coin string) (int64, string, error) {
	if coin == "" {
		return 0, "", nil
	}
	if strings.ContainsRune(coin, ',') {
		return 0, "", fmt.Errorf("unexpected multi-coin gas_fee %q", coin)
	}
	i := 0
	for i < len(coin) && coin[i] >= '0' && coin[i] <= '9' {
		i++
	}
	if i == 0 || i == len(coin) {
		return 0, "", fmt.Errorf("malformed coin %q", coin)
	}
	amount, err := strconv.ParseInt(coin[:i], 10, 64)
	if err != nil {
		return 0, "", fmt.Errorf("parse coin amount %q: %w", coin, err)
	}
	return amount, coin[i:], nil
}

// signDocInputFromStored converts stored amino-JSON tx fields into a SignDocInput.
func signDocInputFromStored(txf StoredTxFields) (SignDocInput, error) {
	var msgs []json.RawMessage
	if err := json.Unmarshal([]byte(txf.MsgsJSON), &msgs); err != nil {
		return SignDocInput{}, fmt.Errorf("parse msgs_json: %w", err)
	}
	var fee aminoFeeJSON
	if err := json.Unmarshal([]byte(txf.FeeJSON), &fee); err != nil {
		return SignDocInput{}, fmt.Errorf("parse fee_json: %w", err)
	}
	gasWanted, err := strconv.ParseInt(fee.GasWanted, 10, 64)
	if err != nil {
		return SignDocInput{}, fmt.Errorf("parse gas_wanted %q: %w", fee.GasWanted, err)
	}
	feeAmount, feeDenom, err := parseSingleCoin(fee.GasFee)
	if err != nil {
		return SignDocInput{}, err
	}
	return SignDocInput{
		ChainID:       txf.ChainID,
		AccountNumber: txf.AccountNumber,
		Sequence:      txf.Sequence,
		GasWanted:     gasWanted,
		GasFeeAmount:  feeAmount,
		GasFeeDenom:   feeDenom,
		Msgs:          msgs,
		Memo:          txf.Memo,
	}, nil
}

// memberPubKeyForAddress parses a multisig amino pubkey and returns the member
// pubkey whose derived address equals signerAddress.
func memberPubKeyForAddress(multisigPubkeyJSON, signerAddress string) (cryptotypes.PubKey, error) {
	var ms multisig.LegacyAminoPubKey
	if err := legacy.Cdc.UnmarshalJSON([]byte(multisigPubkeyJSON), &ms); err != nil {
		return nil, fmt.Errorf("parse multisig pubkey: %w", err)
	}
	_, signerBytes, err := bech32.DecodeAndConvert(signerAddress)
	if err != nil {
		return nil, fmt.Errorf("decode signer address %q: %w", signerAddress, err)
	}
	for _, pk := range ms.GetPubKeys() {
		if string(pk.Address().Bytes()) == string(signerBytes) {
			return pk, nil
		}
	}
	return nil, fmt.Errorf("address %s is not a member of this multisig", signerAddress)
}

// Sweep-result buckets for ClassifyStoredSignature. They separate "the bytes
// don't verify" (the flip-blocking signal) from "the stored row predates the
// canonical shape and can never be reconstructed" (expected for legacy rows).
const (
	SigVerifyOK          = "ok"           // signature verifies over the reconstructed bytes
	SigVerifyMismatch    = "mismatch"     // reconstruction succeeded but the signature does not verify
	SigVerifyLegacyShape = "legacy_shape" // stored msgs/fee cannot be reconstructed (pre-canonical row)
	SigVerifyError       = "error"        // row-level problem: bad base64, unparsable multisig pubkey, non-member signer
)

// ClassifyStoredSignature re-verifies one stored signature row and buckets the
// outcome for the A3 flip-gate readout (SweepMultisigSigVerify and the live
// SignTransaction signal). The returned error carries the failure detail for
// logging; it is nil only for SigVerifyOK.
func ClassifyStoredSignature(multisigPubkeyJSON, signerAddress, sigBase64 string, txf StoredTxFields) (string, error) {
	in, err := signDocInputFromStored(txf)
	if err != nil {
		return SigVerifyLegacyShape, err
	}
	signBytes, err := CanonicalSignBytes(in)
	if err != nil {
		return SigVerifyLegacyShape, fmt.Errorf("reconstruct sign bytes: %w", err)
	}

	sig, err := base64.StdEncoding.DecodeString(sigBase64)
	if err != nil {
		return SigVerifyError, fmt.Errorf("signature is not valid base64: %w", err)
	}

	memberPub, err := memberPubKeyForAddress(multisigPubkeyJSON, signerAddress)
	if err != nil {
		return SigVerifyError, err
	}

	if !memberPub.VerifySignature(signBytes, sig) {
		return SigVerifyMismatch, fmt.Errorf("signature does not verify for member %s; "+
			"check the account number, sequence, and chain were not modified after signing", signerAddress)
	}
	return SigVerifyOK, nil
}

// VerifyMultisigMemberSignature checks that sigBase64 was produced by signerAddress
// (a member of the multisig described by multisigPubkeyJSON) over the canonical
// sign-bytes reconstructed from txf. Returns a descriptive error on any failure.
//
// This is the A3 server-side guard: it rejects garbage/wrong-key/wrong-sequence
// pastes at submission instead of surfacing a false "Signed" that dies at broadcast.
func VerifyMultisigMemberSignature(multisigPubkeyJSON, signerAddress, sigBase64 string, txf StoredTxFields) error {
	_, err := ClassifyStoredSignature(multisigPubkeyJSON, signerAddress, sigBase64, txf)
	return err
}

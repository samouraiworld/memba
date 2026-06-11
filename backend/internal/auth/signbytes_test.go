package auth

import (
	"encoding/base64"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
)

// updateGolden regenerates committed golden files from current (verified) output.
var updateGolden = flag.Bool("update-golden", false, "regenerate sign-bytes golden files")

// signBytesFixture mirrors the JSON emitted by scripts/gen-signbytes-vectors.sh.
// Each fixture pairs an unsigned amino-JSON tx with a REAL `gnokey sign` signature
// over gno's canonical sign-bytes. If our CanonicalSignBytes output verifies against
// that signature, our bytes are byte-equal to gnokey's (and to the chain at broadcast).
type signBytesFixture struct {
	Description     string `json:"description"`
	GnokeyVersion   string `json:"gnokey_version"`
	ChainID         string `json:"chain_id"`
	AccountNumber   uint64 `json:"account_number"`
	AccountSequence uint64 `json:"account_sequence"`
	UnsignedTx      struct {
		Msg []json.RawMessage `json:"msg"`
		Fee struct {
			GasWanted string `json:"gas_wanted"`
			GasFee    string `json:"gas_fee"`
		} `json:"fee"`
		Memo string `json:"memo"`
	} `json:"unsigned_tx"`
	PubKeyB64    string `json:"pub_key_b64"`
	SignatureB64 string `json:"signature_b64"`
}

// parseCoinAmount splits a gno coin string ("1000000ugnot", "" => 0/"") into its
// integer amount and denom. The empty string is the zero-coin canonical form.
func parseCoinAmount(t *testing.T, coin string) (int64, string) {
	t.Helper()
	if coin == "" {
		return 0, ""
	}
	i := 0
	for i < len(coin) && coin[i] >= '0' && coin[i] <= '9' {
		i++
	}
	amount, err := strconv.ParseInt(coin[:i], 10, 64)
	if err != nil {
		t.Fatalf("parse coin amount %q: %v", coin, err)
	}
	return amount, coin[i:]
}

func loadSignBytesFixtures(t *testing.T) map[string]signBytesFixture {
	t.Helper()
	dir := filepath.Join("testdata", "signbytes")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read fixtures dir: %v", err)
	}
	out := make(map[string]signBytesFixture)
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			t.Fatalf("read fixture %s: %v", e.Name(), err)
		}
		var f signBytesFixture
		if err := json.Unmarshal(raw, &f); err != nil {
			t.Fatalf("unmarshal fixture %s: %v", e.Name(), err)
		}
		out[strings.TrimSuffix(e.Name(), ".json")] = f
	}
	if len(out) == 0 {
		t.Fatal("no sign-bytes fixtures found — run scripts/gen-signbytes-vectors.sh")
	}
	return out
}

func (f signBytesFixture) toInput(t *testing.T) SignDocInput {
	t.Helper()
	gasWanted, err := strconv.ParseInt(f.UnsignedTx.Fee.GasWanted, 10, 64)
	if err != nil {
		t.Fatalf("parse gas_wanted %q: %v", f.UnsignedTx.Fee.GasWanted, err)
	}
	feeAmount, feeDenom := parseCoinAmount(t, f.UnsignedTx.Fee.GasFee)
	return SignDocInput{
		ChainID:       f.ChainID,
		AccountNumber: f.AccountNumber,
		Sequence:      f.AccountSequence,
		GasWanted:     gasWanted,
		GasFeeAmount:  feeAmount,
		GasFeeDenom:   feeDenom,
		Msgs:          f.UnsignedTx.Msg,
		Memo:          f.UnsignedTx.Memo,
	}
}

// TestCanonicalSignBytes_VerifiesRealGnokeySignature is the primary byte-equality
// proof: across every fixture (m_call, MsgSend, m_addpkg + edge cases), the real
// gnokey signature must verify against our reconstructed sign-bytes. A divergent
// byte string would fail secp256k1 verification.
func TestCanonicalSignBytes_VerifiesRealGnokeySignature(t *testing.T) {
	for name, f := range loadSignBytesFixtures(t) {
		t.Run(name, func(t *testing.T) {
			sb, err := CanonicalSignBytes(f.toInput(t))
			if err != nil {
				t.Fatalf("CanonicalSignBytes: %v", err)
			}

			pubBytes, err := base64.StdEncoding.DecodeString(f.PubKeyB64)
			if err != nil {
				t.Fatalf("decode pubkey: %v", err)
			}
			sig, err := base64.StdEncoding.DecodeString(f.SignatureB64)
			if err != nil {
				t.Fatalf("decode signature: %v", err)
			}
			pub := &secp256k1.PubKey{Key: pubBytes}

			if !pub.VerifySignature(sb, sig) {
				t.Fatalf("gnokey signature did NOT verify against reconstructed sign-bytes\n"+
					"fixture: %s (%s)\nsign-bytes: %s", name, f.Description, sb)
			}
		})
	}
}

// TestCanonicalSignBytes_FormatInvariants locks the amino-JSON encoding traps that a
// naive implementation gets wrong, on the escape-heavy m_call fixture.
func TestCanonicalSignBytes_FormatInvariants(t *testing.T) {
	f := loadSignBytesFixtures(t)["call_args_escapes"]
	sb, err := CanonicalSignBytes(f.toInput(t))
	if err != nil {
		t.Fatalf("CanonicalSignBytes: %v", err)
	}
	got := string(sb)

	invariants := []struct {
		desc string
		want string
	}{
		{"uint64 account_number is a quoted string", `"account_number":"7"`},
		{"uint64 sequence is a quoted string", `"sequence":"13"`},
		{"gas_wanted is a quoted string", `"gas_wanted":"2000000"`},
		{"gas_fee is the coin string", `"gas_fee":"1000000ugnot"`},
		{"msg is inlined with @type (not value-wrapped)", `{"@type":"/vm.m_call"`},
		{"empty send coin is the empty string", `"send":""`},
		{"empty max_deposit coin is the empty string", `"max_deposit":""`},
	}
	for _, inv := range invariants {
		if !strings.Contains(got, inv.want) {
			t.Errorf("%s: output missing %q\nfull: %s", inv.desc, inv.want, got)
		}
	}

	// HTML-escaping: < > & must be \uXXXX-escaped while non-ASCII stays raw UTF-8.
	// We derive the expected escaped form via the same json.Marshal gno's sortJSON
	// uses, instead of hand-typing the escape sequences.
	escapedMemo, _ := json.Marshal(f.UnsignedTx.Memo)
	if !strings.Contains(got, `"memo":`+string(escapedMemo)) {
		t.Errorf("memo not HTML-escaped like gno sortJSON; want memo=%s\nfull: %s", escapedMemo, got)
	}
	if strings.Contains(got, "memba<test>") {
		t.Errorf("memo contains UNescaped < > & — diverges from gno canonical form\nfull: %s", got)
	}

	// Keys must be alphabetically sorted at every level (sortJSON contract): the
	// top-level doc begins with account_number, and the inlined msg begins with @type.
	if !strings.HasPrefix(got, `{"account_number":"7","chain_id":`) {
		t.Errorf("top-level keys not sorted; got prefix: %s", got[:min(70, len(got))])
	}
	if !strings.Contains(got, `"msgs":[{"@type":"/vm.m_call","args":["hello","world"],"caller":`) {
		t.Errorf("msg keys not sorted / not @type-inlined; got: %s", got)
	}

	// Golden master: the full canonical byte string lives in a committed golden file
	// (avoids hand-typed escape sequences). It is proven byte-equal to `gnokey sign`
	// by TestCanonicalSignBytes_VerifiesRealGnokeySignature and guards format drift.
	// Regenerate with: go test ./internal/auth -run FormatInvariants -update-golden
	goldenPath := filepath.Join("testdata", "signbytes", "call_args_escapes.golden")
	if *updateGolden {
		if err := os.WriteFile(goldenPath, sb, 0o644); err != nil {
			t.Fatalf("write golden: %v", err)
		}
	}
	want, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("read golden (run with -update-golden to create): %v", err)
	}
	if got != string(want) {
		t.Errorf("golden mismatch:\n got: %s\nwant: %s", got, want)
	}
}

func TestCoinString(t *testing.T) {
	cases := []struct {
		amount int64
		denom  string
		want   string
	}{
		{0, "ugnot", ""}, // zero amount => "" (gno coin.go IsZero branch)
		{0, "", ""},
		{1000000, "ugnot", "1000000ugnot"},
		{1, "foo", "1foo"},
	}
	for _, c := range cases {
		if got := coinString(c.amount, c.denom); got != c.want {
			t.Errorf("coinString(%d, %q) = %q, want %q", c.amount, c.denom, got, c.want)
		}
	}
}

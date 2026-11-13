package gnomultisig

import (
	"bytes"
	"encoding/hex"
	"testing"

	"github.com/gnolang/gno/tm2/pkg/amino"
	"github.com/gnolang/gno/tm2/pkg/std"
)

// oldEncodingHex is the fixture transaction from signingFixture, assembled by
// the gno SDK pinned before gnolang/gno#6399 (v0.0.0-20260914072242-1bf7282dd85e).
// That encoder writes the zero SessionAddr of the master signature as the
// bech32 string g1qqq…luuxe. Since gnolang/gno#6406 a node decodes every
// transaction with amino.UnmarshalCanonical and refuses these bytes.
const oldEncodingHex = "0a6f0a0d2f62616e6b2e4d736753656e64125e0a286731397678656a6d3772356b7a3336327663337267686466326d737472" +
	"787a727676756178326e731228673177353038643671656a7874646734793572337a6172766172793063357877376b667074" +
	"6577751a0831303075676e6f7412110880897a120b31303030303075676e6f741a88030acd010a122f746d2e5075624b6579" +
	"4d756c746973696712b6010802123a0a132f746d2e5075624b6579536563703235366b3112230a210279be667ef9dcbbac55" +
	"a06295ce870b07029bfcdb2dce28d959f2815b16f81798123a0a132f746d2e5075624b6579536563703235366b3112230a21" +
	"02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5123a0a132f746d2e5075624b6579536563" +
	"703235366b3112230a2102f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9128b010a050803" +
	"1201a01240cf5c25b67e61779d097f5bc37eec1636e9dcc49a133064a529972a9c0aa1c972115499651dc4f715ef5fbc330d" +
	"fcb740bbcd222d93fff94033e4cfcf33bf623a1240a94552759acbafe72ce8f4cf6afacc3f7e832caa8f8362400f992b4c82" +
	"dc2bfa12bb714f0247644788b8f2a8c88d3165e8965674d2881a2dca87a40de212a48c1a2867317171717171717171717171" +
	"717171717171717171717171717171717171717171716c757578652218646973706f7361626c65206c6f63616c2066697874" +
	"757265"

// zeroSessionAddrField is the signature field the old encoder wrote: field 3,
// length 40, the bech32 text of the zero address.
const zeroSessionAddrField = "1a28" + "67317171717171717171717171717171717171717171717171717171717171717171716c75757865"

func assembleFixture(t *testing.T) []byte {
	t.Helper()
	pk, keys, f := signingFixture(t)
	_, b, err := Assemble(pk, f, []Partial{signPartial(t, pk, keys[2], f, false), signPartial(t, pk, keys[0], f, false)})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// expectedCanonical derives the canonical bytes from the old ones by hand:
// drop the zero SessionAddr field and shrink the signature's length prefix
// (0x0188 = 392 bytes, varint 88 03) by the 42 bytes removed (350, varint de 02).
func expectedCanonical(t *testing.T) []byte {
	t.Helper()
	h := oldEncodingHex
	if !bytes.Contains([]byte(h), []byte(zeroSessionAddrField)) || !bytes.Contains([]byte(h), []byte("1a88030a")) {
		t.Fatal("old fixture no longer has the expected shape")
	}
	h = string(bytes.Replace([]byte(h), []byte(zeroSessionAddrField), nil, 1))
	h = string(bytes.Replace([]byte(h), []byte("1a88030a"), []byte("1ade020a"), 1))
	b, err := hex.DecodeString(h)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// TestNativeAssembleCanonicalGolden pins the exact bytes Memba broadcasts for a
// native multisig transaction. Any change of encoder (SDK bump, amino change)
// fails here before it can reach the chain.
func TestNativeAssembleCanonicalGolden(t *testing.T) {
	got := assembleFixture(t)
	want := expectedCanonical(t)
	if !bytes.Equal(got, want) {
		t.Fatalf("assembled bytes changed:\n got  %x\n want %x", got, want)
	}
	var tx std.Tx
	if err := amino.UnmarshalCanonical(got, &tx); err != nil {
		t.Fatalf("a node running gnolang/gno#6406 would refuse these bytes: %v", err)
	}
}

// TestNativeOldEncodingRefusedByCanonicalDecoder is the negative control: the
// bytes the previous SDK produced decode leniently into the same transaction,
// but the canonical decoder the chain uses since gnolang/gno#6406 refuses them.
func TestNativeOldEncodingRefusedByCanonicalDecoder(t *testing.T) {
	old, err := hex.DecodeString(oldEncodingHex)
	if err != nil {
		t.Fatal(err)
	}
	var strict std.Tx
	if err := amino.UnmarshalCanonical(old, &strict); err == nil {
		t.Fatal("canonical decoder accepted the pre-#6399 encoding; the negative control is vacuous")
	}
	var lenient std.Tx
	if err := amino.Unmarshal(old, &lenient); err != nil {
		t.Fatal(err)
	}
	reencoded, err := amino.Marshal(lenient)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(reencoded, assembleFixture(t)) {
		t.Fatal("old and new encodings are not the same transaction")
	}
}

// TestNativeAggregateExactThreshold: since gno-fixes #292 a K-of-N
// multisignature must carry exactly K signatures, so Assemble refuses more.
func TestNativeAggregateExactThreshold(t *testing.T) {
	pk, keys, f := signingFixture(t)
	all := []Partial{signPartial(t, pk, keys[0], f, false), signPartial(t, pk, keys[1], f, false), signPartial(t, pk, keys[2], f, false)}
	if _, _, err := Assemble(pk, f, all); err == nil {
		t.Fatal("assembled 3 signatures on a 2-of-3")
	}
	if _, _, err := Assemble(pk, f, all[:2]); err != nil {
		t.Fatal(err)
	}
}

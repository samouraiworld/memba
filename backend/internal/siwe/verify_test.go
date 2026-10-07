package siwe

import (
	"encoding/hex"
	"errors"
	"strings"
	"testing"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"

	"github.com/samouraiworld/memba/backend/internal/address"
)

// Signatures produced by viem 2.57.3 (account.signMessage) with private key 1,
// whose address 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf is well known.
const (
	sigWithStatement    = "bd2300476511a6f7f76d99dc5a6df620a2d1fcd0ea90a33322fb5bf17c96a24e73844d452336ee69804b72034f8486f6a0fca8c42f001ad1b5701dce87d2a7b21c"
	sigWithoutStatement = "9ef265e2dfb7cd0222a47c8e8aa52ca4bdd0c47fa979d069271c12c9d59b7cea1f3cc4f730c05d75ce435b4b775829a2cf86026c3d8d5356d7d68877281ed5ac1b"
)

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(strings.TrimPrefix(s, "0x"))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestEIP191HashKnownAnswer(t *testing.T) {
	// viem / ethers hashMessage("Hello World").
	h := EIP191Hash("Hello World")
	if hex.EncodeToString(h[:]) != "a1de988600a42c4b4ab089b619297c17d53cffae5d5120d82d8a92d0bb3b78f2" {
		t.Fatalf("EIP191Hash = %x", h)
	}
}

func TestPubKeyAddressKnownKeys(t *testing.T) {
	for k, want := range map[byte]string{
		1: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
		2: "0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF",
	} {
		var seed [32]byte
		seed[31] = k
		got := address.ChecksumHex(PubKeyAddress(secp256k1.PrivKeyFromBytes(seed[:]).PubKey()))
		if got != want {
			t.Errorf("key %d: %s, want %s", k, got, want)
		}
	}
}

func TestVerifyEOAViemVectors(t *testing.T) {
	for msg, sig := range map[string]string{viemWithStatement: sigWithStatement, viemWithoutStatement: sigWithoutStatement} {
		m, err := Parse(msg)
		if err != nil {
			t.Fatal(err)
		}
		s := mustHex(t, sig)
		if err := VerifyEOA(m, s); err != nil {
			t.Fatalf("valid viem signature refused: %v", err)
		}
		// v as 0/1 is the same signature.
		s01 := append([]byte(nil), s...)
		s01[64] -= 27
		if err := VerifyEOA(m, s01); err != nil {
			t.Fatalf("v in {0,1} refused: %v", err)
		}
		// Any change to the signed text breaks it.
		m2, _ := Parse(strings.Replace(msg, "Nonce: ", "Nonce: 9", 1))
		if err := VerifyEOA(m2, s); !errors.Is(err, ErrSignature) {
			t.Fatalf("tampered message accepted: %v", err)
		}
	}
}

func TestRecoverAddressRejects(t *testing.T) {
	m, err := Parse(viemWithStatement)
	if err != nil {
		t.Fatal(err)
	}
	h := EIP191Hash(Format(m))
	good := mustHex(t, sigWithStatement)

	// The high-s twin (s' = n - s, v flipped) recovers the same key in a naive
	// verifier; it must be refused here.
	var s secp256k1.ModNScalar
	s.SetByteSlice(good[32:64])
	s.Negate()
	twin := append([]byte(nil), good...)
	sb := s.Bytes()
	copy(twin[32:64], sb[:])
	twin[64] ^= 1

	// secp256k1 group order n.
	n := mustHex(t, "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141")
	cases := map[string][]byte{
		"empty":   nil,
		"64 byte": good[:64],
		"66 byte": append(append([]byte(nil), good...), 0),
		"v = 29":  append(append([]byte(nil), good[:64]...), 29),
		"v = 2":   append(append([]byte(nil), good[:64]...), 2),
		"high s":  twin,
		"r = 0":   append(make([]byte, 32), good[32:]...),
		"s = 0":   append(append(append([]byte(nil), good[:32]...), make([]byte, 32)...), good[64]),
		"r = n":   append(append([]byte(nil), n...), good[32:]...),
	}
	for name, sig := range cases {
		if _, err := RecoverAddress(h, sig); !errors.Is(err, ErrSignature) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
	if a, err := RecoverAddress(h, good); err != nil || a != m.Address {
		t.Fatalf("good signature: %x %v", a, err)
	}
}

func TestVerifyEOARoundTripWithDecredSigner(t *testing.T) {
	var seed [32]byte
	seed[31] = 7
	key := secp256k1.PrivKeyFromBytes(seed[:])
	addr := PubKeyAddress(key.PubKey())
	msg := strings.Replace(viemWithStatement, "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf", address.ChecksumHex(addr), 1)
	m, err := Parse(msg)
	if err != nil {
		t.Fatal(err)
	}
	h := EIP191Hash(msg)
	c := ecdsa.SignCompact(key, h[:], false) // <27+v> || R || S
	sig := append(append([]byte(nil), c[1:]...), c[0])
	if err := VerifyEOA(m, sig); err != nil {
		t.Fatal(err)
	}
	// Another key's valid signature over the same message is not the address's.
	seed[31] = 8
	c = ecdsa.SignCompact(secp256k1.PrivKeyFromBytes(seed[:]), h[:], false)
	if err := VerifyEOA(m, append(append([]byte(nil), c[1:]...), c[0])); !errors.Is(err, ErrSignature) {
		t.Fatalf("foreign key accepted: %v", err)
	}
}

func FuzzRecoverAddress(f *testing.F) {
	f.Add(make([]byte, 32), make([]byte, 65))
	f.Fuzz(func(t *testing.T, hash, sig []byte) {
		var h [32]byte
		copy(h[:], hash)
		_, _ = RecoverAddress(h, sig) // must never panic
	})
}

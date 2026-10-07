package address

import (
	"encoding/hex"
	"errors"
	"strings"
	"testing"
)

// EIP-55 reference vectors (https://eips.ethereum.org/EIPS/eip-55).
var eip55Vectors = []string{
	"0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
	"0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
	"0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
	"0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
}

func TestKeccak256KnownAnswers(t *testing.T) {
	for in, want := range map[string]string{
		"":    "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
		"abc": "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
	} {
		got := Keccak256([]byte(in))
		if hex.EncodeToString(got[:]) != want {
			t.Errorf("Keccak256(%q) = %x, want %s", in, got, want)
		}
	}
	// Split input hashes like the concatenation.
	if Keccak256([]byte("a"), []byte("bc")) != Keccak256([]byte("abc")) {
		t.Error("Keccak256 must hash the concatenation of its arguments")
	}
}

func TestChecksumHexEIP55Vectors(t *testing.T) {
	for _, v := range eip55Vectors {
		b, err := ParseEVM(strings.ToLower(v))
		if err != nil {
			t.Fatalf("ParseEVM(lower %s): %v", v, err)
		}
		if got := ChecksumHex(b); got != v {
			t.Errorf("ChecksumHex = %s, want %s", got, v)
		}
		if _, err := ParseEVM(v); err != nil {
			t.Errorf("ParseEVM(%s) rejected a valid checksum: %v", v, err)
		}
	}
}

func TestParse(t *testing.T) {
	const gno = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
	const evmMixed = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"
	const evmLower = "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"
	// Flip the case of one letter: still hex, wrong checksum.
	evmBadSum := strings.Replace(evmMixed, "aA", "AA", 1)

	cases := []struct {
		name    string
		in      string
		want    string
		kind    Kind
		chainID uint64
		err     error
	}{
		{"gno canonical", gno, gno, KindGno, 0, nil},
		{"gno upper rejected", strings.ToUpper(gno), "", KindInvalid, 0, ErrInvalid},
		{"gno bad checksum", gno[:len(gno)-1] + "6", "", KindInvalid, 0, ErrInvalid},
		{"gno wrong hrp", "cosmos1jg8mtutu9khhfwc4nxmuhcpftf0pajdhwq3vxg", "", KindInvalid, 0, ErrInvalid},
		{"evm lower", evmLower, evmLower, KindEVM, 0, nil},
		{"evm eip55", evmMixed, evmLower, KindEVM, 0, nil},
		{"evm all upper", "0x" + strings.ToUpper(evmLower[2:]), evmLower, KindEVM, 0, nil},
		{"evm bad checksum", evmBadSum, "", KindInvalid, 0, ErrChecksum},
		{"evm upper 0X", "0X" + evmLower[2:], "", KindInvalid, 0, ErrInvalid},
		{"evm short", evmLower[:41], "", KindInvalid, 0, ErrInvalid},
		{"evm long", evmLower + "0", "", KindInvalid, 0, ErrInvalid},
		{"evm non hex", "0x" + strings.Repeat("g", 40), "", KindInvalid, 0, ErrInvalid},
		{"evm trailing space", evmLower + " ", "", KindInvalid, 0, ErrInvalid},
		{"caip10 base", "eip155:8453:" + evmMixed, "eip155:8453:" + evmLower, KindEVMScoped, 8453, nil},
		{"caip10 sepolia", "eip155:84532:" + evmLower, "eip155:84532:" + evmLower, KindEVMScoped, 84532, nil},
		{"caip10 leading zero", "eip155:08453:" + evmLower, "", KindInvalid, 0, ErrInvalid},
		{"caip10 zero chain", "eip155:0:" + evmLower, "", KindInvalid, 0, ErrInvalid},
		{"caip10 signed", "eip155:+8453:" + evmLower, "", KindInvalid, 0, ErrInvalid},
		{"caip10 overflow", "eip155:18446744073709551616:" + evmLower, "", KindInvalid, 0, ErrInvalid},
		{"caip10 no address", "eip155:8453", "", KindInvalid, 0, ErrInvalid},
		{"caip10 bad checksum", "eip155:8453:" + evmBadSum, "", KindInvalid, 0, ErrChecksum},
		{"caip10 other namespace", "cosmos:cosmoshub-4:" + evmLower, "", KindInvalid, 0, ErrInvalid},
		{"empty", "", "", KindInvalid, 0, ErrInvalid},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a, err := Parse(tc.in)
			if !errors.Is(err, tc.err) {
				t.Fatalf("Parse(%q) err = %v, want %v", tc.in, err, tc.err)
			}
			if a.String() != tc.want || a.Kind() != tc.kind || a.ChainID() != tc.chainID {
				t.Fatalf("Parse(%q) = (%q, %v, %d), want (%q, %v, %d)",
					tc.in, a.String(), a.Kind(), a.ChainID(), tc.want, tc.kind, tc.chainID)
			}
			if err == nil {
				c, cerr := Canonical(tc.in)
				if cerr != nil || c != tc.want {
					t.Fatalf("Canonical(%q) = %q, %v", tc.in, c, cerr)
				}
			}
		})
	}
}

// The three canonical spaces never overlap: an EOA and the same bytes scoped to
// a chain are distinct identities, and neither can spell a Gno address.
func TestCanonicalFormsAreDisjoint(t *testing.T) {
	b, err := ParseEVM(strings.ToLower(eip55Vectors[0]))
	if err != nil {
		t.Fatal(err)
	}
	eoa, base, sep := EOA(b).String(), Scoped(8453, b).String(), Scoped(84532, b).String()
	if eoa == base || base == sep || eoa == sep {
		t.Fatalf("identities collide: %s %s %s", eoa, base, sep)
	}
	for _, s := range []string{eoa, base, sep} {
		if strings.HasPrefix(s, "g1") {
			t.Fatalf("%s spells a Gno address", s)
		}
	}
	if Scoped(0, b).Kind() != KindInvalid {
		t.Fatal("Scoped(0, …) must be invalid")
	}
	if got, ok := Scoped(8453, b).EVM(); !ok || got != b {
		t.Fatal("EVM() must return the scoped address bytes")
	}
	if _, ok := (Address{}).EVM(); ok {
		t.Fatal("zero Address has no EVM bytes")
	}
}

func TestCAIP2(t *testing.T) {
	if CAIP2(8453) != "eip155:8453" {
		t.Fatal(CAIP2(8453))
	}
	for in, want := range map[string]uint64{"eip155:8453": 8453, "eip155:84532": 84532, "eip155:1": 1} {
		if got, err := ParseCAIP2(in); err != nil || got != want {
			t.Errorf("ParseCAIP2(%q) = %d, %v", in, got, err)
		}
	}
	for _, bad := range []string{"", "eip155:", "eip155:0", "eip155:01", "eip155:84 53", "eip155:-1", "gnoland-1", "EIP155:8453", "eip155:8453:0x"} {
		if _, err := ParseCAIP2(bad); err == nil {
			t.Errorf("ParseCAIP2(%q) accepted", bad)
		}
	}
	for in, want := range map[string]bool{"eip155:8453": true, "eip155:": true, "eip155:junk": true, "gnoland-1": false, "test12": false, "": false} {
		if IsEVMChainID(in) != want {
			t.Errorf("IsEVMChainID(%q) != %v", in, want)
		}
	}
}

func FuzzParse(f *testing.F) {
	for _, s := range append([]string{
		"g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5",
		"0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed",
		"eip155:8453:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
		"eip155:0:0x", "0X", "",
	}, eip55Vectors...) {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		a, err := Parse(s)
		if err != nil {
			if a.Kind() != KindInvalid || a.String() != "" {
				t.Fatalf("error with a non-zero address for %q", s)
			}
			return
		}
		c := a.String()
		// Canonical is a fixed point and round-trips to the same identity.
		b, err := Parse(c)
		if err != nil || b != a || b.String() != c {
			t.Fatalf("canonical %q of %q does not round-trip: %v", c, s, err)
		}
		if c != strings.ToLower(c) {
			t.Fatalf("canonical form %q is not lower case", c)
		}
		// The Kind is decided by the canonical prefix alone.
		switch {
		case strings.HasPrefix(c, "g1"):
			if a.Kind() != KindGno {
				t.Fatalf("%q: kind %v", c, a.Kind())
			}
		case strings.HasPrefix(c, "0x"):
			if a.Kind() != KindEVM || len(c) != 42 {
				t.Fatalf("%q: kind %v", c, a.Kind())
			}
		case strings.HasPrefix(c, "eip155:"):
			if a.Kind() != KindEVMScoped || a.ChainID() == 0 {
				t.Fatalf("%q: kind %v", c, a.Kind())
			}
		default:
			t.Fatalf("unexpected canonical form %q", c)
		}
	})
}

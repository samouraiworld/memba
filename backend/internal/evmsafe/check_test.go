package evmsafe

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

// Real code read from Base Sepolia (testdata/safe150_code.json): a SafeL2
// v1.5.0 proxy and its singleton. Their hashes must be the ones in the tables.
type fixtures struct {
	Proxy150   string `json:"proxy150"`
	SafeL2_150 string `json:"safeL2_150"`
}

func loadCode(t *testing.T) (proxy, singleton []byte) {
	t.Helper()
	raw, err := os.ReadFile("testdata/safe150_code.json")
	if err != nil {
		t.Fatal(err)
	}
	var f fixtures
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	dec := func(s string) []byte {
		b, err := hex.DecodeString(strings.TrimPrefix(s, "0x"))
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	return dec(f.Proxy150), dec(f.SafeL2_150)
}

func addr(s string) [20]byte {
	var a [20]byte
	b, _ := hex.DecodeString(strings.TrimPrefix(s, "0x"))
	copy(a[:], b)
	return a
}

var (
	safeAddr   = addr("0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe")
	alice      = addr("0xa11ce00000000000000000000000000000000001")
	bob        = addr("0xb0b0000000000000000000000000000000000002")
	l2Single   = addr("0xedd160febbd92e350d4d398fb636302fccd67c7e")
	errOffline = errors.New("offline")
)

// abiBytes encodes one dynamic bytes/string return value.
func abiBytes(b []byte) []byte {
	out := append(word(32), word(uint64(len(b)))...)
	padded := make([]byte, (len(b)+31)/32*32)
	copy(padded, b)
	return append(out, padded...)
}

func abiAddresses(as ...[20]byte) []byte {
	out := append(word(32), word(uint64(len(as)))...)
	for _, a := range as {
		out = append(out, append(make([]byte, 12), a[:]...)...)
	}
	return out
}

type fakeChain struct {
	chainID   uint64
	code      map[[20]byte][]byte
	singleton [20]byte
	version   string
	owners    [][20]byte
	fail      string // the read that fails: "chain", "code", "slot", "version", "owners"
	calls     []string
}

func (f *fakeChain) ChainID(context.Context) (uint64, error) {
	if f.fail == "chain" {
		return 0, errOffline
	}
	return f.chainID, nil
}

func (f *fakeChain) Code(_ context.Context, a [20]byte) ([]byte, error) {
	if f.fail == "code" {
		return nil, errOffline
	}
	return f.code[a], nil
}

func (f *fakeChain) Call(_ context.Context, to *[20]byte, data []byte) ([]byte, error) {
	if to == nil || *to != safeAddr {
		return nil, errors.New("unexpected target")
	}
	switch {
	case bytes.HasPrefix(data, selGetStorageAt):
		f.calls = append(f.calls, "slot")
		if f.fail == "slot" {
			return nil, errOffline
		}
		if !bytes.Equal(data[4:], append(word(0), word(1)...)) {
			return nil, errors.New("unexpected storage read")
		}
		return abiBytes(append(make([]byte, 12), f.singleton[:]...)), nil
	case bytes.Equal(data, selVersion):
		f.calls = append(f.calls, "version")
		if f.fail == "version" {
			return nil, errOffline
		}
		return abiBytes([]byte(f.version)), nil
	case bytes.Equal(data, selGetOwners):
		f.calls = append(f.calls, "owners")
		if f.fail == "owners" {
			return nil, errOffline
		}
		return abiAddresses(f.owners...), nil
	}
	return nil, errors.New("unexpected call")
}

func realSafe(t *testing.T) *fakeChain {
	proxy, singleton := loadCode(t)
	return &fakeChain{
		chainID:   84532,
		code:      map[[20]byte][]byte{safeAddr: proxy, l2Single: singleton},
		singleton: l2Single,
		version:   "1.5.0",
		owners:    [][20]byte{alice, bob},
	}
}

func TestFixturesMatchTheTables(t *testing.T) {
	proxy, singleton := loadCode(t)
	if ProxyCodeHashes[keccakHex(proxy)] != "1.5.0" {
		t.Fatalf("proxy fixture hash %s is not the v1.5.0 proxy", keccakHex(proxy))
	}
	s, ok := singletonAt(lowerHex(l2Single))
	if !ok || s.CodeHash != keccakHex(singleton) || !s.L2 || s.Version != "1.5.0" {
		t.Fatalf("singleton fixture does not match the table: %+v", s)
	}
}

func TestCheckOwner(t *testing.T) {
	ctx := context.Background()
	f := realSafe(t)
	if v, err := CheckOwner(ctx, f, 84532, safeAddr, bob); err != nil || v != Owner {
		t.Fatalf("owner: got %v %v", v, err)
	}
	if v, err := CheckOwner(ctx, realSafe(t), 84532, safeAddr, addr("0xc0ffee0000000000000000000000000000000003")); err != nil || v != NotOwner {
		t.Fatalf("not an owner: got %v %v", v, err)
	}
}

func TestCheckOwnerRefusesLookAlikes(t *testing.T) {
	ctx := context.Background()
	cases := map[string]func(f *fakeChain){
		"no contract":        func(f *fakeChain) { delete(f.code, safeAddr) },
		"unknown proxy code": func(f *fakeChain) { f.code[safeAddr] = []byte{0x60, 0x80, 0x60, 0x40} },
		"unknown singleton":  func(f *fakeChain) { f.singleton = bob },
		"tampered singleton": func(f *fakeChain) { f.code[l2Single] = append([]byte{}, 0x00) },
		"no singleton code":  func(f *fakeChain) { delete(f.code, l2Single) },
		"lying VERSION":      func(f *fakeChain) { f.version = "1.4.1" },
	}
	for name, mutate := range cases {
		f := realSafe(t)
		mutate(f)
		// Even an account the fake lists as an owner is refused: the contract is not a Safe.
		if v, err := CheckOwner(ctx, f, 84532, safeAddr, alice); err != nil || v != NotASafe {
			t.Fatalf("%s: got %v %v, want NotASafe", name, v, err)
		}
	}
	// getOwners is never asked of a contract that is not a recognised Safe.
	f := realSafe(t)
	f.code[safeAddr] = []byte{0x60}
	_, _ = CheckOwner(ctx, f, 84532, safeAddr, alice)
	if len(f.calls) != 0 {
		t.Fatalf("calls made to an unrecognised contract: %v", f.calls)
	}
}

func TestCheckOwnerOutageIsNeverAVerdict(t *testing.T) {
	ctx := context.Background()
	for _, fail := range []string{"chain", "code", "slot", "version", "owners"} {
		f := realSafe(t)
		f.fail = fail
		if _, err := CheckOwner(ctx, f, 84532, safeAddr, alice); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("%s failing: err = %v, want ErrUnavailable", fail, err)
		}
	}
	f := realSafe(t)
	f.chainID = 1
	if _, err := CheckOwner(ctx, f, 84532, safeAddr, alice); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("wrong chain: err = %v, want ErrUnavailable", err)
	}
	f = realSafe(t)
	f.owners = nil
	if _, err := CheckOwner(ctx, f, 84532, safeAddr, alice); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("no owners: err = %v, want ErrUnavailable", err)
	}
}

func TestABIReadersRefuseMalformedAnswers(t *testing.T) {
	for _, b := range [][]byte{nil, word(32), append(word(64), word(1)...), append(word(33), word(0)...), append(word(32), word(5)...)} {
		if _, err := readBytes(b); err == nil {
			t.Fatalf("readBytes(%x) accepted", b)
		}
	}
	dirty := append(word(32), word(1)...)
	dirty = append(dirty, append([]byte{1}, make([]byte, 31)...)...)
	if _, err := readAddresses(dirty); err == nil {
		t.Fatal("readAddresses accepted a word with high bytes set")
	}
	if _, err := readAddresses(append(word(32), word(2)...)); err == nil {
		t.Fatal("readAddresses accepted an array past the end")
	}
}

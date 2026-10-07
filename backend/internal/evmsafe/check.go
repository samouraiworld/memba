package evmsafe

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"

	"github.com/samouraiworld/memba/backend/internal/address"
)

// Reader is the JSON-RPC the check needs; *evmauth.Client provides it.
type Reader interface {
	ChainID(ctx context.Context) (uint64, error)
	Code(ctx context.Context, addr [20]byte) ([]byte, error)
	Call(ctx context.Context, to *[20]byte, data []byte) ([]byte, error)
}

// Verdict is what the chain says about an account and a Safe.
type Verdict int

const (
	// Owner: the address is a recognised Safe and the account is one of its owners.
	Owner Verdict = iota
	// NotOwner: a recognised Safe, but the account is not an owner.
	NotOwner
	// NotASafe: no contract, or a contract that is not a Safe Memba recognises.
	NotASafe
)

// ErrUnavailable is any read that failed or answered as another chain: it
// never means "not a Safe" (an outage is not an absence).
var ErrUnavailable = errors.New("evmsafe: chain unavailable")

var (
	selGetStorageAt = mustHex("5624b25b") // getStorageAt(uint256,uint256): StorageAccessible, Safe >= 1.3.0
	selVersion      = mustHex("ffa1ad74") // VERSION()
	selGetOwners    = mustHex("a0e67e2b") // getOwners()
)

func mustHex(s string) []byte {
	b, err := hex.DecodeString(s)
	if err != nil {
		panic(err)
	}
	return b
}

func keccakHex(b []byte) string {
	h := address.Keccak256(b)
	return "0x" + hex.EncodeToString(h[:])
}

func lowerHex(a [20]byte) string { return "0x" + hex.EncodeToString(a[:]) }

// CheckOwner reports whether account owns the Safe at safe on chainID. The
// RPC must answer as chainID; then the proxy's code, its singleton (slot 0,
// read through the Safe's own getStorageAt) and the singleton's code must be
// the published ones, and VERSION() must agree, before getOwners() is read.
func CheckOwner(ctx context.Context, r Reader, chainID uint64, safe, account [20]byte) (Verdict, error) {
	id, err := r.ChainID(ctx)
	if err != nil {
		return 0, fmt.Errorf("%w: chain id", ErrUnavailable)
	}
	if id != chainID {
		return 0, fmt.Errorf("%w: the RPC serves chain %d, not %d", ErrUnavailable, id, chainID)
	}
	code, err := r.Code(ctx, safe)
	if err != nil {
		return 0, fmt.Errorf("%w: code", ErrUnavailable)
	}
	if len(code) == 0 {
		return NotASafe, nil
	}
	if _, ok := ProxyCodeHashes[keccakHex(code)]; !ok {
		return NotASafe, nil
	}

	// getStorageAt(offset 0, length 1): slot 0 of the proxy, its singleton.
	slot, err := r.Call(ctx, &safe, append(append(append([]byte{}, selGetStorageAt...), word(0)...), word(1)...))
	if err != nil {
		return 0, fmt.Errorf("%w: singleton", ErrUnavailable)
	}
	raw, err := readBytes(slot)
	if err != nil || len(raw) != 32 {
		return NotASafe, nil
	}
	singletonAddr, err := wordAddress(raw)
	if err != nil {
		return NotASafe, nil
	}
	singleton, ok := singletonAt(lowerHex(singletonAddr))
	if !ok {
		return NotASafe, nil
	}
	singletonCode, err := r.Code(ctx, singletonAddr)
	if err != nil {
		return 0, fmt.Errorf("%w: singleton code", ErrUnavailable)
	}
	if keccakHex(singletonCode) != singleton.CodeHash {
		return NotASafe, nil
	}

	out, err := r.Call(ctx, &safe, selVersion)
	if err != nil {
		return 0, fmt.Errorf("%w: version", ErrUnavailable)
	}
	version, err := readBytes(out)
	if err != nil || string(version) != singleton.Version {
		return NotASafe, nil
	}
	out, err = r.Call(ctx, &safe, selGetOwners)
	if err != nil {
		return 0, fmt.Errorf("%w: owners", ErrUnavailable)
	}
	owners, err := readAddresses(out)
	if err != nil || len(owners) == 0 {
		return 0, fmt.Errorf("%w: owners unreadable", ErrUnavailable)
	}
	for _, o := range owners {
		if o == account {
			return Owner, nil
		}
	}
	return NotOwner, nil
}

func word(n uint64) []byte {
	w := make([]byte, 32)
	new(big.Int).SetUint64(n).FillBytes(w)
	return w
}

var errABI = errors.New("evmsafe: malformed ABI answer")

func wordAt(b []byte, i int) ([]byte, error) {
	if i < 0 || (i+1)*32 > len(b) {
		return nil, errABI
	}
	return b[i*32 : (i+1)*32], nil
}

func wordIndex(w []byte) (int, error) {
	n := new(big.Int).SetBytes(w)
	if !n.IsInt64() || n.Int64() > 1<<20 {
		return 0, errABI
	}
	return int(n.Int64()), nil
}

func wordAddress(w []byte) ([20]byte, error) {
	var a [20]byte
	for _, b := range w[:12] {
		if b != 0 {
			return a, errABI
		}
	}
	copy(a[:], w[12:])
	return a, nil
}

// readBytes decodes a single dynamic `bytes` / `string` return value.
func readBytes(b []byte) ([]byte, error) {
	head, err := wordAt(b, 0)
	if err != nil {
		return nil, err
	}
	off, err := wordIndex(head)
	if err != nil || off%32 != 0 {
		return nil, errABI
	}
	lw, err := wordAt(b, off/32)
	if err != nil {
		return nil, err
	}
	n, err := wordIndex(lw)
	if err != nil || off+32+n > len(b) {
		return nil, errABI
	}
	return b[off+32 : off+32+n], nil
}

// readAddresses decodes a single dynamic `address[]` return value.
func readAddresses(b []byte) ([][20]byte, error) {
	head, err := wordAt(b, 0)
	if err != nil {
		return nil, err
	}
	off, err := wordIndex(head)
	if err != nil || off%32 != 0 {
		return nil, errABI
	}
	lw, err := wordAt(b, off/32)
	if err != nil {
		return nil, err
	}
	n, err := wordIndex(lw)
	if err != nil {
		return nil, err
	}
	out := make([][20]byte, 0, n)
	for i := range n {
		w, err := wordAt(b, off/32+1+i)
		if err != nil {
			return nil, err
		}
		a, err := wordAddress(w)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}

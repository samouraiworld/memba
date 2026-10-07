// Package address parses and canonicalises the account identifiers the backend
// stores: gno.land bech32 addresses and EVM addresses.
//
// Every address column in the database is free TEXT, so Gno and EVM identities
// can share a table only if their canonical spellings can never collide. They
// cannot, by construction:
//
//   - Gno:        lower-case bech32 "g1…" (prefix "g", 20-byte payload).
//   - EVM:        lower-case "0x" + 40 hex, chain-agnostic. Used for a key
//     holder (an EOA), whose key controls the same address on every chain.
//   - EVM scoped: CAIP-10 "eip155:<chainId>:0x…" in lower case. Used for a
//     contract account (a Safe, a smart wallet): the same address on another
//     chain can have other owners, so the identity is bound to one chain.
//
// EIP-55 mixed case is accepted on input only when its checksum is valid, and
// is produced for display only (ChecksumHex). Nothing in this package touches
// the network.
package address

import (
	"encoding/hex"
	"errors"
	"strconv"
	"strings"

	"github.com/cosmos/cosmos-sdk/types/bech32"
	"golang.org/x/crypto/sha3"
)

// Kind tells which identity space an Address belongs to.
type Kind int

const (
	// KindInvalid is the zero value: not a parsed address.
	KindInvalid Kind = iota
	// KindGno is a gno.land bech32 user address ("g1…").
	KindGno
	// KindEVM is a chain-agnostic EVM address ("0x…"), for key holders.
	KindEVM
	// KindEVMScoped is a CAIP-10 EVM account bound to one chain
	// ("eip155:<chainId>:0x…"), for contract accounts.
	KindEVMScoped
)

// EIP155Namespace is the CAIP-2 namespace of EVM chains.
const EIP155Namespace = "eip155"

const eip155Prefix = EIP155Namespace + ":"

var (
	// ErrInvalid is returned for any string that is not a canonical-able address.
	ErrInvalid = errors.New("address: invalid")
	// ErrChecksum is returned for a mixed-case EVM address whose EIP-55
	// checksum does not match.
	ErrChecksum = errors.New("address: bad EIP-55 checksum")
)

// Address is a parsed, canonical account identifier. The zero value is invalid.
type Address struct {
	kind    Kind
	chainID uint64   // KindEVMScoped only
	evm     [20]byte // KindEVM, KindEVMScoped
	gno     string   // KindGno: the canonical lower-case bech32 text
}

// Kind returns the identity space of a.
func (a Address) Kind() Kind { return a.kind }

// ChainID returns the EIP-155 chain id of a KindEVMScoped address, else 0.
func (a Address) ChainID() uint64 { return a.chainID }

// EVM returns the 20 address bytes of an EVM address (scoped or not).
func (a Address) EVM() ([20]byte, bool) {
	return a.evm, a.kind == KindEVM || a.kind == KindEVMScoped
}

// String returns the canonical storage form ("" for the zero value).
func (a Address) String() string {
	switch a.kind {
	case KindGno:
		return a.gno
	case KindEVM:
		return lowerHex(a.evm)
	case KindEVMScoped:
		return CAIP2(a.chainID) + ":" + lowerHex(a.evm)
	default:
		return ""
	}
}

// EOA returns the chain-agnostic identity of an EVM key holder.
func EOA(a [20]byte) Address { return Address{kind: KindEVM, evm: a} }

// Scoped returns the chain-bound identity of an EVM contract account. chainID
// must be non-zero; a zero chain id yields the invalid zero Address.
func Scoped(chainID uint64, a [20]byte) Address {
	if chainID == 0 {
		return Address{}
	}
	return Address{kind: KindEVMScoped, chainID: chainID, evm: a}
}

// Parse accepts the three canonical forms, plus EIP-55 / all-upper-case hex for
// EVM addresses, and returns the parsed address. Surrounding whitespace is NOT
// trimmed: callers that accept user input trim it first, so a stored key can
// never differ from what was validated.
func Parse(s string) (Address, error) {
	switch {
	case strings.HasPrefix(s, "g1"):
		if !isCanonicalGno(s) {
			return Address{}, ErrInvalid
		}
		return Address{kind: KindGno, gno: s}, nil
	case strings.HasPrefix(s, "0x"):
		b, err := ParseEVM(s)
		if err != nil {
			return Address{}, err
		}
		return EOA(b), nil
	case strings.HasPrefix(s, eip155Prefix):
		ref, addr, ok := strings.Cut(s[len(eip155Prefix):], ":")
		if !ok {
			return Address{}, ErrInvalid
		}
		id, err := parseChainRef(ref)
		if err != nil {
			return Address{}, err
		}
		b, err := ParseEVM(addr)
		if err != nil {
			return Address{}, err
		}
		return Scoped(id, b), nil
	default:
		return Address{}, ErrInvalid
	}
}

// Canonical returns the canonical storage form of s, or an error when s is not
// an address Parse accepts.
func Canonical(s string) (string, error) {
	a, err := Parse(s)
	if err != nil {
		return "", err
	}
	return a.String(), nil
}

// isCanonicalGno mirrors service.isValidGnoAddress: lower-case bech32, prefix
// "g", 20-byte payload, valid checksum.
func isCanonicalGno(s string) bool {
	if s != strings.ToLower(s) {
		return false
	}
	hrp, data, err := bech32.DecodeAndConvert(s)
	return err == nil && hrp == "g" && len(data) == 20
}

// ParseEVM parses "0x" + 40 hex digits. All-lower and all-upper hex are
// accepted as unchecksummed (EIP-55); any other mix of cases must carry a
// valid EIP-55 checksum. An upper-case "0X" prefix is rejected.
func ParseEVM(s string) ([20]byte, error) {
	var out [20]byte
	if len(s) != 42 || s[:2] != "0x" {
		return out, ErrInvalid
	}
	body := s[2:]
	if _, err := hex.Decode(out[:], []byte(body)); err != nil {
		return [20]byte{}, ErrInvalid
	}
	if body == strings.ToLower(body) || body == strings.ToUpper(body) {
		return out, nil
	}
	if ChecksumHex(out) != s {
		return [20]byte{}, ErrChecksum
	}
	return out, nil
}

// ChecksumHex returns the EIP-55 mixed-case spelling of a, for display.
func ChecksumHex(a [20]byte) string {
	lower := hex.EncodeToString(a[:])
	h := Keccak256([]byte(lower))
	out := []byte("0x" + lower)
	for i := range 40 {
		c := out[2+i]
		if c < 'a' || c > 'f' {
			continue
		}
		nibble := h[i/2]
		if i%2 == 0 {
			nibble >>= 4
		}
		if nibble&0x0f >= 8 {
			out[2+i] = c - ('a' - 'A')
		}
	}
	return string(out)
}

// Keccak256 is the Ethereum (legacy, pre-NIST padding) Keccak-256 of the
// concatenation of data.
func Keccak256(data ...[]byte) [32]byte {
	h := sha3.NewLegacyKeccak256()
	for _, d := range data {
		h.Write(d) // hash.Hash.Write never returns an error
	}
	var out [32]byte
	h.Sum(out[:0])
	return out
}

// CAIP2 returns the CAIP-2 chain id of an EVM chain, e.g. "eip155:8453".
func CAIP2(chainID uint64) string {
	return eip155Prefix + strconv.FormatUint(chainID, 10)
}

// ParseCAIP2 parses an "eip155:<decimal>" chain id. The reference must be a
// positive decimal without leading zeros, so each chain has one spelling.
func ParseCAIP2(s string) (uint64, error) {
	if !strings.HasPrefix(s, eip155Prefix) {
		return 0, ErrInvalid
	}
	return parseChainRef(s[len(eip155Prefix):])
}

// IsEVMChainID reports whether s names a chain in the eip155 namespace. It is
// a prefix test only, deliberately loose: it is what auth uses to keep every
// EVM-chain token out of Gno-only handlers, so anything that even claims the
// namespace must match.
func IsEVMChainID(s string) bool { return strings.HasPrefix(s, eip155Prefix) }

func parseChainRef(ref string) (uint64, error) {
	if ref == "" || len(ref) > 20 || ref[0] == '0' {
		return 0, ErrInvalid
	}
	for i := 0; i < len(ref); i++ {
		if ref[i] < '0' || ref[i] > '9' {
			return 0, ErrInvalid
		}
	}
	id, err := strconv.ParseUint(ref, 10, 64)
	if err != nil || id == 0 {
		return 0, ErrInvalid
	}
	return id, nil
}

func lowerHex(a [20]byte) string { return "0x" + hex.EncodeToString(a[:]) }

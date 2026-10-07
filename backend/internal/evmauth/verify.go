package evmauth

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

// MaxSignatureBytes bounds a contract-account signature. ERC-6492 wrappers
// carry the account's factory calldata and passkey signatures carry WebAuthn
// data, so this is far above an EOA signature, and far below anything that
// could make an eth_call expensive to relay.
const MaxSignatureBytes = 8 << 10

// chainCheckTTL is how long one successful eth_chainId identity check is
// trusted before it is asked again.
const chainCheckTTL = time.Minute

// maxConcurrent caps the verifications in flight per chain, so login traffic
// cannot spend the RPC provider's quota faster than this.
const maxConcurrent = 8

// magicValue is bytes4(keccak256("isValidSignature(bytes32,bytes)")), the
// EIP-1271 success value; the same four bytes are the function selector.
var magicValue = []byte{0x16, 0x26, 0xba, 0x7e}

// erc6492Suffix ends every ERC-6492 wrapped signature.
var erc6492Suffix = bytes.Repeat([]byte{0x64, 0x92}, 16)

// erc6492ValidatorHex is the creation code of the ERC-6492 reference
// off-chain validator (ValidateSigOffchain, CC0, from the ERC). It is
// byte-identical to viem 2.57.3 `erc6492SignatureValidatorByteCode` and to the
// constant of the SIWE reference libraries; the test pins its SHA-256. Its
// constructor takes (address signer, bytes32 hash, bytes signature) and returns
// one byte, 0x01 for valid. For a wrapped signature it first runs the factory
// call inside the simulation, so an undeployed account validates as if it
// existed, then calls isValidSignature. For an unwrapped one it calls
// isValidSignature when the signer has code, else falls back to ecrecover.
//
//go:embed erc6492_validator.hex
var erc6492ValidatorHex string

var erc6492Validator = func() []byte {
	b, err := hex.DecodeString(strings.TrimSpace(erc6492ValidatorHex))
	if err != nil || len(b) == 0 {
		panic("evmauth: embedded ERC-6492 validator is not hex")
	}
	return b
}()

// Verifier checks contract-account signatures on one chain.
type Verifier struct {
	chainID uint64
	client  *Client
	sem     chan struct{}
	now     func() time.Time

	mu        sync.Mutex
	checkedAt time.Time
}

// NewVerifier returns a verifier for chainID that asks client.
func NewVerifier(chainID uint64, client *Client) *Verifier {
	return &Verifier{chainID: chainID, client: client, sem: make(chan struct{}, maxConcurrent), now: time.Now}
}

// ChainID is the chain this verifier checks signatures on.
func (v *Verifier) ChainID() uint64 { return v.chainID }

// CheckChain asks the endpoint which chain it serves and fails with
// ErrWrongChain unless it is the verifier's. An answering endpoint is not
// proof of the chain it answers for: it is asked, then trusted for
// chainCheckTTL.
func (v *Verifier) CheckChain(ctx context.Context) error {
	v.mu.Lock()
	fresh := !v.checkedAt.IsZero() && v.now().Sub(v.checkedAt) < chainCheckTTL
	v.mu.Unlock()
	if fresh {
		return nil
	}
	id, err := v.client.ChainID(ctx)
	if err != nil {
		return err
	}
	if id != v.chainID {
		return ErrWrongChain
	}
	v.mu.Lock()
	v.checkedAt = v.now()
	v.mu.Unlock()
	return nil
}

func (v *Verifier) forgetChainCheck() {
	v.mu.Lock()
	v.checkedAt = time.Time{}
	v.mu.Unlock()
}

// Verify reports whether sig is account's signature of hash on this chain. For
// a SIWE login hash is the EIP-191 digest of the message. See the package doc
// for the meaning of the three outcomes.
func (v *Verifier) Verify(ctx context.Context, account [20]byte, hash [32]byte, sig []byte) (bool, error) {
	if len(sig) > MaxSignatureBytes {
		return false, nil
	}
	select {
	case v.sem <- struct{}{}:
		defer func() { <-v.sem }()
	case <-ctx.Done():
		return false, fmt.Errorf("%w: busy", ErrUnavailable)
	}
	if err := v.CheckChain(ctx); err != nil {
		v.forgetChainCheck()
		return false, err
	}

	if bytes.HasSuffix(sig, erc6492Suffix) {
		out, err := v.client.Call(ctx, nil, append(append([]byte(nil), erc6492Validator...), encodeValidatorArgs(account, hash, sig)...))
		if errors.Is(err, errReverted) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		return len(out) == 1 && out[0] == 0x01, nil
	}

	code, err := v.client.Code(ctx, account)
	if err != nil {
		return false, err
	}
	if len(code) == 0 {
		// No contract and no deployment data: nothing can vouch for it here.
		return false, nil
	}
	out, err := v.client.Call(ctx, &account, encodeIsValidSignature(hash, sig))
	if errors.Is(err, errReverted) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return isMagicWord(out), nil
}

// isMagicWord accepts exactly an ABI-encoded bytes4 magic value: 32 bytes, the
// magic value left-aligned, zero padding.
func isMagicWord(out []byte) bool {
	return len(out) == 32 && bytes.Equal(out[:4], magicValue) && bytes.Count(out[4:], []byte{0}) == 28
}

// encodeIsValidSignature is the calldata of isValidSignature(bytes32, bytes).
func encodeIsValidSignature(hash [32]byte, sig []byte) []byte {
	out := append([]byte(nil), magicValue...)
	out = append(out, hash[:]...)
	out = append(out, word(64)...) // offset of the bytes argument
	return append(out, encodeBytes(sig)...)
}

// encodeValidatorArgs is the ABI encoding of the validator constructor
// arguments (address, bytes32, bytes).
func encodeValidatorArgs(account [20]byte, hash [32]byte, sig []byte) []byte {
	out := make([]byte, 12, 12+20)
	out = append(out, account[:]...)
	out = append(out, hash[:]...)
	out = append(out, word(96)...) // three head words precede the bytes tail
	return append(out, encodeBytes(sig)...)
}

func word(n uint64) []byte {
	w := make([]byte, 32)
	binary.BigEndian.PutUint64(w[24:], n)
	return w
}

// encodeBytes is the tail of a dynamic bytes value: length, then the data
// right-padded to a 32-byte boundary.
func encodeBytes(b []byte) []byte {
	out := word(uint64(len(b)))
	out = append(out, b...)
	if pad := (32 - len(b)%32) % 32; pad > 0 {
		out = append(out, make([]byte, pad)...)
	}
	return out
}

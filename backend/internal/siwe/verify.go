package siwe

import (
	"errors"
	"strconv"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"

	"github.com/samouraiworld/memba/backend/internal/address"
)

// ErrSignature is returned when an EOA signature is malformed or was not made
// by the message's address.
var ErrSignature = errors.New("siwe: invalid signature")

// EIP191Hash is the personal_sign digest of msg:
// keccak256("\x19Ethereum Signed Message:\n" || len(msg) || msg).
// It is also the hash an EIP-1271 wallet is asked to validate.
func EIP191Hash(msg string) [32]byte {
	return address.Keccak256(
		[]byte("\x19Ethereum Signed Message:\n"+strconv.Itoa(len(msg))),
		[]byte(msg),
	)
}

// RecoverAddress returns the address of the key that produced the 65-byte
// Ethereum signature r || s || v over hash. v may be 27/28 or 0/1. A high-s
// signature (s > n/2) is refused: every standard signer emits low-s, and
// refusing the twin keeps one valid spelling per signature.
func RecoverAddress(hash [32]byte, sig []byte) ([20]byte, error) {
	if len(sig) != 65 {
		return [20]byte{}, ErrSignature
	}
	v := sig[64]
	if v >= 27 {
		v -= 27
	}
	if v > 1 {
		return [20]byte{}, ErrSignature
	}
	var r, s secp256k1.ModNScalar
	if overflow := r.SetByteSlice(sig[:32]); overflow || r.IsZero() {
		return [20]byte{}, ErrSignature
	}
	if overflow := s.SetByteSlice(sig[32:64]); overflow || s.IsZero() || s.IsOverHalfOrder() {
		return [20]byte{}, ErrSignature
	}
	// decred's compact format: <27 + recovery id> || R || S (uncompressed key).
	compact := make([]byte, 65)
	compact[0] = 27 + v
	copy(compact[1:], sig[:64])
	pub, _, err := ecdsa.RecoverCompact(compact, hash[:])
	if err != nil {
		return [20]byte{}, ErrSignature
	}
	return PubKeyAddress(pub), nil
}

// PubKeyAddress is the Ethereum address of a secp256k1 public key: the last 20
// bytes of keccak256 of the 64-byte uncompressed X || Y.
func PubKeyAddress(pub *secp256k1.PublicKey) [20]byte {
	h := address.Keccak256(pub.SerializeUncompressed()[1:])
	var a [20]byte
	copy(a[:], h[12:])
	return a
}

// VerifyEOA checks that sig is a personal_sign signature of m by m.Address.
// It hashes Format(m), which for a parsed message is exactly the parsed bytes.
// A contract account cannot pass here; its signature goes to EIP-1271.
func VerifyEOA(m *Message, sig []byte) error {
	got, err := RecoverAddress(EIP191Hash(Format(m)), sig)
	if err != nil {
		return err
	}
	if got != m.Address {
		return ErrSignature
	}
	return nil
}

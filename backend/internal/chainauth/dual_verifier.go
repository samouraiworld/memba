// Package chainauth provides a dual-chain authentication verifier for the Memba backend.
//
// It extends the existing Gno auth system (internal/auth) to also verify
// EVM-origin login proofs using SIWE (Sign-In With Ethereum / EIP-4361).
//
// Flow:
//  1. Client sends LoginProof (family + signature + address)
//  2. DualVerifier routes to GnoVerifier or EvmVerifier based on family
//  3. Verifier validates the signature and returns the authenticated address
//
// The existing auth package handles Gno verification; this package adds
// the EVM layer and the routing dispatcher.
package chainauth

import (
	"fmt"
	"strings"
)

// ChainFamily identifies the blockchain technology.
type ChainFamily string

const (
	FamilyGno ChainFamily = "gno"
	FamilyEVM ChainFamily = "evm"
)

// LoginProof is the chain-agnostic login proof from the frontend.
type LoginProof struct {
	Family    ChainFamily `json:"family"`
	Address   string      `json:"address"`
	Signature string      `json:"signature"`
	ChainID   string      `json:"chainId"`

	// Gno-specific
	SignDoc    []byte `json:"signDoc,omitempty"`
	PubkeyJSON string `json:"pubkeyJson,omitempty"`

	// EVM-specific
	SiweMessage string `json:"siweMessage,omitempty"`
}

// VerifyResult is returned on successful verification.
type VerifyResult struct {
	Address string
	Family  ChainFamily
	ChainID string
}

// Verifier validates a login proof for a specific chain family.
type Verifier interface {
	// Family returns which chain family this verifier handles.
	Family() ChainFamily

	// Verify validates the login proof and returns the authenticated address.
	// Returns an error if the proof is invalid.
	Verify(proof *LoginProof, expectedNonce []byte) (*VerifyResult, error)
}

// DualVerifier routes login proofs to the correct chain-specific verifier.
type DualVerifier struct {
	gno Verifier
	evm Verifier
}

// NewDualVerifier creates a dual-chain verifier.
// gnoVerifier handles Gno (ADR-036) proofs.
// evmVerifier handles EVM (SIWE) proofs. Can be nil if EVM is not yet enabled.
func NewDualVerifier(gnoVerifier, evmVerifier Verifier) *DualVerifier {
	return &DualVerifier{
		gno: gnoVerifier,
		evm: evmVerifier,
	}
}

// Verify routes the proof to the correct verifier based on the family field.
func (d *DualVerifier) Verify(proof *LoginProof, expectedNonce []byte) (*VerifyResult, error) {
	switch proof.Family {
	case FamilyGno:
		if d.gno == nil {
			return nil, fmt.Errorf("gno verifier not configured")
		}
		return d.gno.Verify(proof, expectedNonce)

	case FamilyEVM:
		if d.evm == nil {
			return nil, fmt.Errorf("evm verifier not configured — EVM auth is not yet enabled")
		}
		return d.evm.Verify(proof, expectedNonce)

	default:
		return nil, fmt.Errorf("unsupported chain family: %q", proof.Family)
	}
}

// DetectFamily infers the chain family from an address string.
func DetectFamily(address string) ChainFamily {
	if strings.HasPrefix(address, "g1") {
		return FamilyGno
	}
	if strings.HasPrefix(address, "0x") || strings.HasPrefix(address, "0X") {
		return FamilyEVM
	}
	return "" // Unknown
}

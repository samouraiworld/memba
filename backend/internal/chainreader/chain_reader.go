// Package chainreader provides a chain-agnostic interface for reading on-chain
// data from the Memba backend. It abstracts the difference between Gno ABCI
// queries and EVM JSON-RPC calls.
//
// The backend uses this to:
// - Verify DAO membership (attestation, quest verification)
// - Read token balances (OTC, marketplace)
// - Validate on-chain state (escrow status, candidature deposits)
package chainreader

import (
	"context"
	"fmt"
)

// ChainFamily identifies the blockchain technology.
type ChainFamily string

const (
	FamilyGno ChainFamily = "gno"
	FamilyEVM ChainFamily = "evm"
)

// DAOMember represents a member returned from on-chain queries.
type DAOMember struct {
	Address     string   `json:"address"`
	Roles       []string `json:"roles"`
	VotingPower int64    `json:"votingPower"`
}

// TokenBalance represents a token balance.
type TokenBalance struct {
	Address  string `json:"address"`
	Balance  string `json:"balance"` // String for precision (uint256)
	Decimals int    `json:"decimals"`
}

// ChainReader reads on-chain data from either Gno or EVM chains.
type ChainReader interface {
	// Family returns which chain family this reader handles.
	Family() ChainFamily

	// IsDAOMember checks if an address is a member of the given DAO.
	IsDAOMember(ctx context.Context, daoID string, address string) (bool, error)

	// GetDAOMembers returns all members of the given DAO.
	GetDAOMembers(ctx context.Context, daoID string) ([]DAOMember, error)

	// GetTokenBalance returns the token balance for an address.
	GetTokenBalance(ctx context.Context, tokenID string, address string) (*TokenBalance, error)

	// GetNativeBalance returns the native token balance (GNOT or ETH) in smallest unit.
	GetNativeBalance(ctx context.Context, address string) (string, error)
}

// DualReader routes reads to the correct chain-specific reader.
type DualReader struct {
	gno ChainReader
	evm ChainReader
}

// NewDualReader creates a dual-chain reader.
func NewDualReader(gnoReader, evmReader ChainReader) *DualReader {
	return &DualReader{
		gno: gnoReader,
		evm: evmReader,
	}
}

// ForFamily returns the reader for the specified chain family.
func (d *DualReader) ForFamily(family ChainFamily) (ChainReader, error) {
	switch family {
	case FamilyGno:
		if d.gno == nil {
			return nil, fmt.Errorf("gno reader not configured")
		}
		return d.gno, nil
	case FamilyEVM:
		if d.evm == nil {
			return nil, fmt.Errorf("evm reader not configured")
		}
		return d.evm, nil
	default:
		return nil, fmt.Errorf("unsupported chain family: %q", family)
	}
}

// ForAddress auto-detects the chain family from the address and returns the reader.
func (d *DualReader) ForAddress(address string) (ChainReader, error) {
	family := detectFamily(address)
	if family == "" {
		return nil, fmt.Errorf("cannot detect chain family for address: %q", address)
	}
	return d.ForFamily(family)
}

func detectFamily(address string) ChainFamily {
	if len(address) > 2 && address[:2] == "g1" {
		return FamilyGno
	}
	if len(address) > 2 && (address[:2] == "0x" || address[:2] == "0X") {
		return FamilyEVM
	}
	return ""
}

package evmreader

import (
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/samouraiworld/memba/backend/internal/chainreader"
)

func TestEvmReader_Family(t *testing.T) {
	// We can't test against a real RPC without a running node,
	// but we can verify the struct satisfies the interface and
	// returns the correct family.

	reader := &EvmReader{
		addresses: ContractAddresses{
			DAO: common.HexToAddress("0x1234567890abcdef1234567890abcdef12345678"),
		},
	}

	if reader.Family() != chainreader.FamilyEVM {
		t.Errorf("expected FamilyEVM, got %q", reader.Family())
	}
}

func TestEvmReader_ResolveDAO(t *testing.T) {
	defaultDAO := common.HexToAddress("0xaaaa")
	reader := &EvmReader{
		addresses: ContractAddresses{DAO: defaultDAO},
	}

	// Address input → use directly
	addr := reader.resolveDAO("0xbbbb")
	if addr != common.HexToAddress("0xbbbb") {
		t.Errorf("expected 0xbbbb, got %s", addr.Hex())
	}

	// Non-address input → use default
	addr = reader.resolveDAO("my-dao")
	if addr != defaultDAO {
		t.Errorf("expected default DAO %s, got %s", defaultDAO.Hex(), addr.Hex())
	}
}

// TestEvmReader_ImplementsInterface ensures compile-time interface satisfaction.
func TestEvmReader_ImplementsInterface(t *testing.T) {
	var _ chainreader.ChainReader = (*EvmReader)(nil)
}

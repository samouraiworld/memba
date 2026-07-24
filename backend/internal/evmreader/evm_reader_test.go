package evmreader

import (
	"math/big"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/accounts/abi"
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

// mustDAOABI parses the reader's own DAO ABI for round-trip packing in tests.
func mustDAOABI(t *testing.T) abi.ABI {
	t.Helper()
	a, err := abi.JSON(strings.NewReader(daoABIJSON))
	if err != nil {
		t.Fatalf("parse DAO ABI: %v", err)
	}
	return a
}

// A-6: decodeMemberView must actually return the member. The old code asserted geth's
// tag-carrying anonymous struct against an untagged literal, which never matched, so every
// member was silently dropped and GetDAOMembers returned an empty slice with a nil error.
func TestDecodeMemberView_RoundTrip(t *testing.T) {
	daoABI := mustDAOABI(t)

	addr := common.HexToAddress("0x00000000000000000000000000000000000000Ab")
	packed, err := daoABI.Methods["getMemberByIndex"].Outputs.Pack(struct {
		Addr        common.Address
		VotingPower *big.Int
		Roles       []string
	}{Addr: addr, VotingPower: big.NewInt(7), Roles: []string{"member", "admin"}})
	if err != nil {
		t.Fatalf("pack member view: %v", err)
	}

	member, err := decodeMemberView(daoABI, packed)
	if err != nil {
		t.Fatalf("decodeMemberView returned error: %v", err)
	}
	if member.Address != strings.ToLower(addr.Hex()) {
		t.Errorf("address: got %q want %q", member.Address, strings.ToLower(addr.Hex()))
	}
	if member.VotingPower != 7 {
		t.Errorf("votingPower: got %d want 7", member.VotingPower)
	}
	if len(member.Roles) != 2 || member.Roles[0] != "member" || member.Roles[1] != "admin" {
		t.Errorf("roles: got %v want [member admin]", member.Roles)
	}
}

// A-7: boundedMemberCount rejects the values an attacker-chosen contract could return to
// force a giant allocation, and accepts a legitimate in-range count.
func TestBoundedMemberCount(t *testing.T) {
	const max = int64(1000)
	huge := new(big.Int).Lsh(big.NewInt(1), 65) // 2^65, overflows int64

	cases := []struct {
		name    string
		raw     *big.Int
		wantErr bool
		want    int64
	}{
		{"in range", big.NewInt(500), false, 500},
		{"at cap", big.NewInt(1000), false, 1000},
		{"zero", big.NewInt(0), false, 0},
		{"above cap", big.NewInt(1001), true, 0},
		{"int64 overflow", huge, true, 0},
		{"negative", big.NewInt(-1), true, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := boundedMemberCount(tc.raw, max)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error for %s, got count %d", tc.raw, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Errorf("got %d want %d", got, tc.want)
			}
		})
	}
}

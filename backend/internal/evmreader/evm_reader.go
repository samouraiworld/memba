// Package evmreader implements ChainReader for EVM chains using go-ethereum ethclient.
//
// It reads on-chain data from Memba smart contracts deployed on Robinhood Chain
// (or any EVM-compatible chain). Uses ABI-encoded contract calls via ethclient.
package evmreader

import (
	"context"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"

	"github.com/samouraiworld/memba/backend/internal/chainreader"
)

// ContractAddresses holds the deployed contract addresses for a network.
type ContractAddresses struct {
	DAO          common.Address
	TokenFactory common.Address
}

// Config holds the EvmReader configuration.
type Config struct {
	RPCURL    string
	Addresses ContractAddresses
	// MaxMembers caps how many members GetDAOMembers will iterate/allocate for. A DAO
	// address is caller-supplied (URL path), so a hostile or misconfigured contract can
	// report an enormous memberCount; without a cap that becomes an unauthenticated
	// remote OOM. Defaults to defaultMaxMembers when zero.
	MaxMembers int64
}

// defaultMaxMembers mirrors MembaDAO.MAX_MEMBERS (1000). A legitimate DAO cannot exceed
// it, so a larger reported count means the target is not a real Memba DAO.
const defaultMaxMembers = 1000

// EvmReader implements chainreader.ChainReader for EVM chains.
type EvmReader struct {
	client     *ethclient.Client
	addresses  ContractAddresses
	daoABI     abi.ABI
	erc20ABI   abi.ABI
	maxMembers int64
}

// ── Minimal ABIs (only the functions we need) ────────────────

const daoABIJSON = `[
	{"inputs":[{"internalType":"address","name":"addr","type":"address"}],"name":"isMember","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},
	{"inputs":[],"name":"memberCount","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
	{"inputs":[{"internalType":"uint256","name":"index","type":"uint256"}],"name":"getMemberByIndex","outputs":[{"components":[{"internalType":"address","name":"addr","type":"address"},{"internalType":"uint256","name":"votingPower","type":"uint256"},{"internalType":"string[]","name":"roles","type":"string[]"}],"internalType":"struct MembaDAO.MemberView","name":"","type":"tuple"}],"stateMutability":"view","type":"function"}
]`

const erc20ABIJSON = `[
	{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
	{"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"}
]`

// New creates a new EvmReader connected to the given RPC endpoint.
func New(cfg Config) (*EvmReader, error) {
	client, err := ethclient.Dial(cfg.RPCURL)
	if err != nil {
		return nil, fmt.Errorf("evmreader: dial %s: %w", cfg.RPCURL, err)
	}

	parsedDAO, err := abi.JSON(strings.NewReader(daoABIJSON))
	if err != nil {
		return nil, fmt.Errorf("evmreader: parse DAO ABI: %w", err)
	}

	parsedERC20, err := abi.JSON(strings.NewReader(erc20ABIJSON))
	if err != nil {
		return nil, fmt.Errorf("evmreader: parse ERC20 ABI: %w", err)
	}

	maxMembers := cfg.MaxMembers
	if maxMembers <= 0 {
		maxMembers = defaultMaxMembers
	}

	return &EvmReader{
		client:     client,
		addresses:  cfg.Addresses,
		daoABI:     parsedDAO,
		erc20ABI:   parsedERC20,
		maxMembers: maxMembers,
	}, nil
}

// Family returns FamilyEVM.
func (r *EvmReader) Family() chainreader.ChainFamily {
	return chainreader.FamilyEVM
}

// IsDAOMember checks DAO membership via the isMember(address) view call.
func (r *EvmReader) IsDAOMember(ctx context.Context, daoID string, address string) (bool, error) {
	daoAddr := r.resolveDAO(daoID)
	data, err := r.daoABI.Pack("isMember", common.HexToAddress(address))
	if err != nil {
		return false, fmt.Errorf("evmreader: pack isMember: %w", err)
	}

	result, err := r.call(ctx, daoAddr, data)
	if err != nil {
		return false, fmt.Errorf("evmreader: call isMember: %w", err)
	}

	out, err := r.daoABI.Unpack("isMember", result)
	if err != nil {
		return false, fmt.Errorf("evmreader: unpack isMember: %w", err)
	}
	if len(out) == 0 {
		return false, nil
	}
	return out[0].(bool), nil
}

// GetDAOMembers returns all DAO members by iterating memberCount + getMemberByIndex.
func (r *EvmReader) GetDAOMembers(ctx context.Context, daoID string) ([]chainreader.DAOMember, error) {
	daoAddr := r.resolveDAO(daoID)

	// Get member count
	countData, err := r.daoABI.Pack("memberCount")
	if err != nil {
		return nil, fmt.Errorf("evmreader: pack memberCount: %w", err)
	}
	countResult, err := r.call(ctx, daoAddr, countData)
	if err != nil {
		return nil, fmt.Errorf("evmreader: call memberCount: %w", err)
	}
	countOut, err := r.daoABI.Unpack("memberCount", countResult)
	if err != nil {
		return nil, fmt.Errorf("evmreader: unpack memberCount: %w", err)
	}

	rawCount, ok := countOut[0].(*big.Int)
	if !ok {
		return nil, fmt.Errorf("evmreader: memberCount: unexpected return type")
	}
	count, err := boundedMemberCount(rawCount, r.maxMembers)
	if err != nil {
		return nil, fmt.Errorf("evmreader: memberCount from %s: %w", daoAddr.Hex(), err)
	}

	members := make([]chainreader.DAOMember, 0, count)
	for i := int64(0); i < count; i++ {
		data, err := r.daoABI.Pack("getMemberByIndex", big.NewInt(i))
		if err != nil {
			return nil, fmt.Errorf("evmreader: pack getMemberByIndex(%d): %w", i, err)
		}
		result, err := r.call(ctx, daoAddr, data)
		if err != nil {
			return nil, fmt.Errorf("evmreader: call getMemberByIndex(%d): %w", i, err)
		}

		member, err := decodeMemberView(r.daoABI, result)
		if err != nil {
			return nil, fmt.Errorf("evmreader: getMemberByIndex(%d): %w", i, err)
		}
		members = append(members, member)
	}

	return members, nil
}

// boundedMemberCount converts a contract-reported member count to a trusted int64,
// rejecting negatives, int64 overflow, and any value above max. `max` is the cap that
// prevents an attacker-chosen contract address from triggering a giant allocation.
func boundedMemberCount(raw *big.Int, max int64) (int64, error) {
	if raw.Sign() < 0 {
		return 0, fmt.Errorf("negative count %s", raw.String())
	}
	if !raw.IsInt64() {
		return 0, fmt.Errorf("count %s overflows int64", raw.String())
	}
	n := raw.Int64()
	if n > max {
		return 0, fmt.Errorf("count %d exceeds max %d (not a Memba DAO?)", n, max)
	}
	return n, nil
}

// decodeMemberView decodes a getMemberByIndex tuple return into a DAOMember.
//
// The tuple must be converted with abi.ConvertType, not a direct type assertion: geth
// unpacks a tuple into an anonymous struct whose fields carry `json:"…"` tags, and struct
// tags are part of Go type identity, so a plain `v.(struct{…})` against an untagged literal
// never matches. The previous code did exactly that and swallowed the miss with `continue`,
// so GetDAOMembers always returned an empty slice with a nil error.
func decodeMemberView(daoABI abi.ABI, result []byte) (chainreader.DAOMember, error) {
	out, err := daoABI.Unpack("getMemberByIndex", result)
	if err != nil {
		return chainreader.DAOMember{}, fmt.Errorf("unpack: %w", err)
	}
	if len(out) == 0 {
		return chainreader.DAOMember{}, fmt.Errorf("empty return")
	}

	type memberView struct {
		Addr        common.Address
		VotingPower *big.Int
		Roles       []string
	}
	mv, ok := abi.ConvertType(out[0], new(memberView)).(*memberView)
	if !ok || mv == nil {
		return chainreader.DAOMember{}, fmt.Errorf("unexpected return shape")
	}
	if mv.VotingPower == nil {
		return chainreader.DAOMember{}, fmt.Errorf("nil voting power")
	}
	return chainreader.DAOMember{
		Address:     strings.ToLower(mv.Addr.Hex()),
		Roles:       mv.Roles,
		VotingPower: mv.VotingPower.Int64(),
	}, nil
}

// GetTokenBalance returns the ERC-20 balance for an address.
func (r *EvmReader) GetTokenBalance(ctx context.Context, tokenID string, address string) (*chainreader.TokenBalance, error) {
	tokenAddr := common.HexToAddress(tokenID)

	// balanceOf
	balData, err := r.erc20ABI.Pack("balanceOf", common.HexToAddress(address))
	if err != nil {
		return nil, fmt.Errorf("evmreader: pack balanceOf: %w", err)
	}
	balResult, err := r.call(ctx, tokenAddr, balData)
	if err != nil {
		return nil, fmt.Errorf("evmreader: call balanceOf: %w", err)
	}
	balOut, err := r.erc20ABI.Unpack("balanceOf", balResult)
	if err != nil {
		return nil, fmt.Errorf("evmreader: unpack balanceOf: %w", err)
	}

	// decimals
	decData, err := r.erc20ABI.Pack("decimals")
	if err != nil {
		return nil, fmt.Errorf("evmreader: pack decimals: %w", err)
	}
	decResult, err := r.call(ctx, tokenAddr, decData)
	if err != nil {
		return nil, fmt.Errorf("evmreader: call decimals: %w", err)
	}
	decOut, err := r.erc20ABI.Unpack("decimals", decResult)
	if err != nil {
		return nil, fmt.Errorf("evmreader: unpack decimals: %w", err)
	}

	balance := balOut[0].(*big.Int)
	decimals := int(decOut[0].(uint8))

	return &chainreader.TokenBalance{
		Address:  address,
		Balance:  balance.String(),
		Decimals: decimals,
	}, nil
}

// GetNativeBalance returns the ETH balance in wei.
func (r *EvmReader) GetNativeBalance(ctx context.Context, address string) (string, error) {
	bal, err := r.client.BalanceAt(ctx, common.HexToAddress(address), nil)
	if err != nil {
		return "0", fmt.Errorf("evmreader: BalanceAt: %w", err)
	}
	return bal.String(), nil
}

// ── Internal ─────────────────────────────────────────────────

func (r *EvmReader) call(ctx context.Context, to common.Address, data []byte) ([]byte, error) {
	msg := ethereum.CallMsg{
		To:   &to,
		Data: data,
	}
	return r.client.CallContract(ctx, msg, nil)
}

func (r *EvmReader) resolveDAO(daoID string) common.Address {
	// If daoID is an address, use it directly
	if strings.HasPrefix(daoID, "0x") {
		return common.HexToAddress(daoID)
	}
	// Otherwise use the default DAO address
	return r.addresses.DAO
}

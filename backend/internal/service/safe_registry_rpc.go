package service

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"log/slog"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/address"
	"github.com/samouraiworld/memba/backend/internal/evmauth"
	"github.com/samouraiworld/memba/backend/internal/evmsafe"
	"github.com/samouraiworld/memba/backend/internal/ratelimit"
)

// ─── Safes (EVM multisig): each account's list and names ──────────
//
// Memba stores, per account, the Safes it keeps in its Multisig list and the
// name it gives each one; an owner who gave none sees the first namer's name.
// A Safe enters an account's list only after the server checked on chain that
// the address is a Safe it recognises and that the account is one of its
// owners (internal/evmsafe): never on the word of the browser or of the Safe
// Transaction Service.
//
// Off unless MEMBA_EVM_SAFE_CHAINS names a chain (the Transaction Service
// proxy's switch): both RPCs then answer Unimplemented. Callers sign in with
// Ethereum (authenticateAccount), so nothing is served while SIWE is off.

// publicEVMRPCs are the chains' public endpoints (frontend/src/lib/chain/evm/networks.ts).
var publicEVMRPCs = map[uint64]string{
	8453:  "https://mainnet.base.org",
	84532: "https://sepolia.base.org",
}

const (
	safeRPCTimeout   = 5 * time.Second
	safeCheckBudget  = 8 * time.Second
	safeNameMaxBytes = 256
	safesListLimit   = 100
)

// checkSafeOwner is evmsafe.CheckOwner; a variable so tests can steer the chain's answer.
var checkSafeOwner = evmsafe.CheckOwner

type safeRegistry struct {
	readers map[uint64]evmsafe.Reader
}

func (r safeRegistry) enabled() bool { return len(r.readers) > 0 }

// ConfigureSafeRegistry reads MEMBA_EVM_SAFE_CHAINS and MEMBA_EVM_RPC_URLS
// (evmauth.ParseRPCURLs; a chain without an entry uses its public endpoint) and
// returns what it refused, for the boot log (never an endpoint, which may
// carry a key). A chain whose endpoint is invalid is not served.
func (s *MultisigService) ConfigureSafeRegistry(getenv func(string) string) (chains []uint64, problems []string) {
	cfg, _ := SafeTxProxyConfigFromEnv(getenv)
	urls, problems := evmauth.ParseRPCURLs(getenv(evmauth.RPCURLsEnv))
	readers := map[uint64]evmsafe.Reader{}
	for _, id := range cfg.ChainIDs() {
		if !evmsafe.Chains[id] {
			continue
		}
		// A chain listed twice is refused, not given its public endpoint.
		if urls.Duplicated(id) {
			continue
		}
		raw, ok := urls.For(id)
		if !ok {
			raw = publicEVMRPCs[id]
		}
		c, err := evmauth.NewClient(raw, safeRPCTimeout)
		if err != nil {
			problems = append(problems, evmauth.RPCURLsEnv+": invalid endpoint for chain "+strconv.FormatUint(id, 10))
			continue
		}
		readers[id] = c
		chains = append(chains, id)
	}
	s.safes = safeRegistry{readers: readers}
	return chains, problems
}

// safeCaller authenticates an EVM session for chainID ("eip155:<id>") and
// returns its canonical account and 20 address bytes.
func (s *MultisigService) safeCaller(token *membav1.Token, chainID string) (string, [20]byte, uint64, error) {
	if !s.safes.enabled() {
		return "", [20]byte{}, 0, connect.NewError(connect.CodeUnimplemented, nil)
	}
	id, err := address.ParseCAIP2(chainID)
	if err != nil || s.safes.readers[id] == nil {
		return "", [20]byte{}, 0, connect.NewError(connect.CodeInvalidArgument, errors.New("chain not served for Safes"))
	}
	if token == nil || token.ChainId != chainID {
		return "", [20]byte{}, 0, connect.NewError(connect.CodeUnauthenticated, nil)
	}
	account, err := s.authenticateAccount(token)
	if err != nil {
		return "", [20]byte{}, 0, err
	}
	a, err := address.Parse(account)
	if err != nil {
		return "", [20]byte{}, 0, connect.NewError(connect.CodeUnauthenticated, nil)
	}
	raw, ok := a.EVM()
	if !ok {
		return "", [20]byte{}, 0, connect.NewError(connect.CodeUnauthenticated, nil)
	}
	return account, raw, id, nil
}

// RegisterSafe adds, renames or leaves a Safe in the caller's list.
func (s *MultisigService) RegisterSafe(ctx context.Context, req *connect.Request[membav1.RegisterSafeRequest]) (*connect.Response[membav1.RegisterSafeResponse], error) {
	m := req.Msg
	account, raw, chainID, err := s.safeCaller(m.GetAuthToken(), m.GetChainId())
	if err != nil {
		return nil, err
	}
	safe, err := address.ParseEVM(strings.TrimSpace(m.GetSafeAddress()))
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid Safe address"))
	}
	name := m.GetName()
	if len(name) > safeNameMaxBytes || !utf8.ValidString(name) || strings.ContainsFunc(name, func(r rune) bool { return r < 0x20 || r == 0x7f }) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid name"))
	}
	if err := s.rateLimitUser(account, ratelimit.SafeRegisterEndpoint); err != nil {
		return nil, err
	}
	safeHex := "0x" + hex.EncodeToString(safe[:])
	chain := m.GetChainId()

	var existingJoined bool
	err = s.db.QueryRowContext(ctx, "SELECT joined FROM evm_safe_members WHERE chain_id = ? AND safe_address = ? AND user_address = ?", chain, safeHex, account).Scan(&existingJoined)
	exists := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		slog.Error("RegisterSafe: read membership", "error", err)
		return nil, connect.NewError(connect.CodeInternal, nil)
	}

	// Leaving needs no proof: it only takes the Safe out of the caller's own list.
	if m.GetJoined() || !exists {
		checkCtx, cancel := context.WithTimeout(ctx, safeCheckBudget)
		verdict, err := checkSafeOwner(checkCtx, s.safes.readers[chainID], chainID, safe, raw)
		cancel()
		switch {
		case err != nil:
			slog.Warn("RegisterSafe: chain unavailable", "chain", chain, "error", err)
			return nil, connect.NewError(connect.CodeUnavailable, errors.New("couldn't read the Safe on chain; try again"))
		case verdict == evmsafe.NotASafe:
			return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("not a Safe Memba recognises on this chain"))
		case verdict == evmsafe.NotOwner:
			return nil, connect.NewError(connect.CodePermissionDenied, errors.New("this account is not an owner of the Safe"))
		}
	}

	var nameSetAt any
	if name != "" {
		nameSetAt = time.Now().UTC().Format(nameSetAtLayout)
	}
	if exists {
		_, err = s.db.ExecContext(ctx,
			"UPDATE evm_safe_members SET joined = ?, name = ?, name_set_at = COALESCE(name_set_at, ?) WHERE chain_id = ? AND safe_address = ? AND user_address = ?",
			m.GetJoined(), name, nameSetAt, chain, safeHex, account)
	} else {
		_, err = s.db.ExecContext(ctx,
			"INSERT INTO evm_safe_members (chain_id, safe_address, user_address, name, name_set_at, joined, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			chain, safeHex, account, name, nameSetAt, m.GetJoined(), time.Now().UTC().Format(time.RFC3339))
	}
	if err != nil {
		slog.Error("RegisterSafe: write membership", "error", err)
		return nil, connect.NewError(connect.CodeInternal, nil)
	}
	recs, err := s.safeRecords(ctx, chain, account, safeHex)
	if err != nil || len(recs) != 1 {
		slog.Error("RegisterSafe: read back", "error", err)
		return nil, connect.NewError(connect.CodeInternal, nil)
	}
	return connect.NewResponse(&membav1.RegisterSafeResponse{Safe: recs[0]}), nil
}

// Safes lists the Safes the caller keeps in their list on a chain, newest first.
func (s *MultisigService) Safes(ctx context.Context, req *connect.Request[membav1.SafesRequest]) (*connect.Response[membav1.SafesResponse], error) {
	account, _, _, err := s.safeCaller(req.Msg.GetAuthToken(), req.Msg.GetChainId())
	if err != nil {
		return nil, err
	}
	recs, err := s.safeRecords(ctx, req.Msg.GetChainId(), account, "")
	if err != nil {
		slog.Error("Safes: read", "error", err)
		return nil, connect.NewError(connect.CodeInternal, nil)
	}
	return connect.NewResponse(&membav1.SafesResponse{Safes: recs}), nil
}

// safeSharedNameSQL: for the member row `m` (used only while its own name is
// empty, so every name found is another owner's), the current name of the owner who first named the same Safe, and
// who that is ($col = name or user_address). Same rule as the Gno multisigs.
const safeSharedNameSQL = `(SELECT o.$col FROM evm_safe_members o
	WHERE o.chain_id = m.chain_id AND o.safe_address = m.safe_address
	  AND o.name != ''
	ORDER BY COALESCE(o.name_set_at, o.created_at), o.rowid LIMIT 1)`

var (
	safeSharedName = strings.ReplaceAll(safeSharedNameSQL, "$col", "name")
	safeNamedBy    = strings.ReplaceAll(safeSharedNameSQL, "$col", "user_address")
)

// safeRecords reads the caller's rows: one Safe (any join state) when safeHex
// is set, else the joined ones, newest first.
func (s *MultisigService) safeRecords(ctx context.Context, chain, account, safeHex string) ([]*membav1.SafeRecord, error) {
	q := `SELECT m.chain_id, m.safe_address, m.name, m.joined, m.created_at,
		CASE WHEN m.name = '' THEN ` + safeSharedName + ` END,
		CASE WHEN m.name = '' THEN ` + safeNamedBy + ` END
		FROM evm_safe_members m WHERE m.chain_id = ? AND m.user_address = ?`
	args := []any{chain, account}
	if safeHex != "" {
		q += " AND m.safe_address = ?"
		args = append(args, safeHex)
	} else {
		q += " AND m.joined = TRUE ORDER BY m.created_at DESC, m.rowid DESC LIMIT " + strconv.Itoa(safesListLimit)
	}
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*membav1.SafeRecord
	for rows.Next() {
		r := &membav1.SafeRecord{}
		var shared, by sql.NullString
		if err := rows.Scan(&r.ChainId, &r.Address, &r.Name, &r.Joined, &r.CreatedAt, &shared, &by); err != nil {
			return nil, err
		}
		r.SharedName, r.NamedBy = shared.String, by.String
		out = append(out, r)
	}
	return out, rows.Err()
}

package service

import (
	"context"
	srand "crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"connectrpc.com/connect"

	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/address"
	"github.com/samouraiworld/memba/backend/internal/auth"
	"github.com/samouraiworld/memba/backend/internal/metrics"
	"github.com/samouraiworld/memba/backend/internal/siwe"
)

// ─── Sign-In with Ethereum RPCs ───────────────────────────────────
//
// Off unless MEMBA_ENABLE_SIWE (see siwe_config.go): both RPCs then answer
// Unimplemented, exactly as before this file served them.
//
// Flow: GetSiweChallenge returns a server-signed SiweChallenge bound to the
// chain asked for and to the page origin (the Origin header, which must be an
// allowed domain). The wallet signs an EIP-4361 message; GetSiweToken checks
// the challenge signature and expiry, parses the message strictly, requires it
// to match the challenge field by field, verifies the signature (ecrecover
// for key holders; through EIP-1271 / ERC-6492 for contract accounts when
// MEMBA_SIWE_CONTRACT_SIGNERS is on), consumes the nonce once in
// the database, and issues the ordinary session Token with chain_id
// "eip155:<id>" and user_address the lower-case 0x address (a key holder) or
// "eip155:<id>:0x…" (a contract account). No state is kept
// between the two calls except the used-nonce row.

// siweMaxSignatureHex bounds the signature field before decoding.
const siweMaxSignatureHex = 2 + 2*8192

// GetSiweChallenge issues a challenge for one sign-in.
func (s *MultisigService) GetSiweChallenge(
	_ context.Context, req *connect.Request[membav1.GetSiweChallengeRequest],
) (*connect.Response[membav1.GetSiweChallengeResponse], error) {
	cfg := s.siwe
	if !cfg.enabled {
		return nil, connect.NewError(connect.CodeUnimplemented, nil)
	}
	chainID, ok := cfg.servedChain(req.Msg.GetChainId())
	if !ok {
		siweLogin("chain_mismatch", "", req.Msg.GetChainId())
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New(auth.ChainMismatchCode))
	}
	origin, ok := cfg.matchOrigin(req.Header().Get("Origin"))
	if !ok {
		siweLogin("origin_refused", "", req.Msg.GetChainId())
		return nil, connect.NewError(connect.CodePermissionDenied, nil)
	}
	nonce := make([]byte, 16)
	if _, err := srand.Read(nonce); err != nil {
		return nil, internalError("siwe nonce", err)
	}
	now := cfg.clock().UTC()
	ch := &membav1.SiweChallenge{
		Nonce:      hex.EncodeToString(nonce),
		ChainId:    address.CAIP2(chainID),
		Domain:     origin.domain,
		Uri:        origin.uri,
		IssuedAt:   now.Format(time.RFC3339),
		Expiration: now.Add(siweChallengeTTL).Format(time.RFC3339),
		Statement:  siweStatement,
	}
	if err := auth.SignSiweChallenge(s.privateKey, ch); err != nil {
		return nil, internalError("siwe challenge", err)
	}
	return connect.NewResponse(&membav1.GetSiweChallengeResponse{Challenge: ch}), nil
}

// GetSiweToken verifies a signed sign-in message and issues a session token.
// Every refusal is a message-less PermissionDenied (the reason is logged),
// except a chain this server does not serve, which carries the bare
// ChainMismatchCode like the Gno login.
func (s *MultisigService) GetSiweToken(
	ctx context.Context, req *connect.Request[membav1.GetSiweTokenRequest],
) (*connect.Response[membav1.GetSiweTokenResponse], error) {
	cfg := s.siwe
	if !cfg.enabled {
		return nil, connect.NewError(connect.CodeUnimplemented, nil)
	}
	ch := req.Msg.GetChallenge()
	deny := func(result, why, addr string) error {
		siweLogin(result, addr, ch.GetChainId())
		slog.Warn("siwe: sign-in refused", "reason", why, "address", addr)
		return connect.NewError(connect.CodePermissionDenied, nil)
	}

	if err := auth.VerifySiweChallengeSignature(s.publicKey, ch); err != nil {
		return nil, deny("rejected", "challenge signature", "")
	}
	chainID, ok := cfg.servedChain(ch.GetChainId())
	if !ok {
		siweLogin("chain_mismatch", "", ch.GetChainId())
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New(auth.ChainMismatchCode))
	}
	u, err := url.Parse(ch.GetUri())
	if err != nil || u.Host != ch.GetDomain() || !cfg.allowsDomain(u.Scheme, ch.GetDomain()) {
		return nil, deny("rejected", "challenge domain no longer allowed", "")
	}
	issued, err1 := time.Parse(time.RFC3339, ch.GetIssuedAt())
	expires, err2 := time.Parse(time.RFC3339, ch.GetExpiration())
	now := cfg.clock()
	if err1 != nil || err2 != nil || !now.Before(expires) {
		return nil, deny("rejected", "challenge expired", "")
	}

	m, err := siwe.Parse(req.Msg.GetMessage())
	if err != nil {
		return nil, deny("rejected", err.Error(), "")
	}
	evm := address.EOA(m.Address).String()
	if why := bindSiweMessage(m, ch, u.Scheme, chainID, issued, expires, now); why != "" {
		return nil, deny("rejected", why, evm)
	}

	sigHex := req.Msg.GetSignature()
	if len(sigHex) > siweMaxSignatureHex || !strings.HasPrefix(sigHex, "0x") {
		return nil, deny("rejected", "signature encoding", evm)
	}
	sig, err := hex.DecodeString(sigHex[2:])
	if err != nil {
		return nil, deny("rejected", "signature encoding", evm)
	}
	// A key holder's signature recovers to its address: the session is the
	// chain-agnostic 0x identity. Anything else may be a contract account
	// (Safe, smart wallet), checked through EIP-1271 / ERC-6492 on this chain
	// when the contract path is on for it: the session is then bound to the
	// chain (eip155:<id>:0x…) and short, since its owners can change.
	identity, ttl, result := evm, auth.DefaultTokenDuration, "eoa"
	if err := siwe.VerifyEOA(m, sig); err != nil {
		v := cfg.verifiers[chainID]
		if v == nil {
			return nil, deny("rejected", "signature does not recover to the address", evm)
		}
		vctx, cancel := context.WithTimeout(ctx, siweVerifyBudget)
		valid, verr := v.Verify(vctx, m.Address, siwe.EIP191Hash(siwe.Format(m)), sig)
		cancel()
		if verr != nil {
			// Not a verdict: the chain could not be asked. Nothing is consumed,
			// the user may retry.
			siweLogin("rpc_unavailable", evm, ch.GetChainId())
			slog.Warn("siwe: contract signature could not be checked", "error", verr, "address", evm)
			return nil, connect.NewError(connect.CodeUnavailable, nil)
		}
		if !valid {
			return nil, deny("rejected", "contract signature invalid", evm)
		}
		identity, ttl, result = address.Scoped(chainID, m.Address).String(), siweContractSessionTTL, "contract"
	}

	// Consume the nonce atomically, after every check and before the token:
	// a second use of the same signed message finds the row and is refused,
	// across restarts. The row outlives the challenge, after which the
	// challenge itself is refused, so pruning it then is safe.
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO siwe_used_nonces (nonce, expires_at) VALUES (?, ?) ON CONFLICT(nonce) DO NOTHING`,
		ch.GetNonce(), expires.Add(siweClockSkew).Unix())
	if err != nil {
		return nil, internalError("siwe nonce", err)
	}
	if n, err := res.RowsAffected(); err != nil || n != 1 {
		return nil, deny("replay", "nonce already used", evm)
	}

	token, err := auth.MintToken(s.privateKey, identity, ch.GetChainId(), ttl)
	if err != nil {
		return nil, internalError("siwe token", err)
	}
	siweLogin(result, identity, ch.GetChainId())
	return connect.NewResponse(&membav1.GetSiweTokenResponse{AuthToken: token}), nil
}

// bindSiweMessage requires the signed message to be the one the challenge
// frames. It returns "" when it is, else the reason (for the log only).
func bindSiweMessage(m *siwe.Message, ch *membav1.SiweChallenge, scheme string, chainID uint64, issued, expires, now time.Time) string {
	switch {
	case m.Domain != ch.GetDomain():
		return "domain"
	case m.Scheme != "" && m.Scheme != scheme:
		return "scheme"
	case m.URI != ch.GetUri():
		return "uri"
	case m.ChainID != chainID:
		return "chain id"
	case m.Nonce != ch.GetNonce():
		return "nonce"
	case m.IssuedAt.Before(issued.Add(-siweClockSkew)) || m.IssuedAt.After(now.Add(siweClockSkew)):
		return "issued at"
	case m.ExpirationTime != nil && (m.ExpirationTime.After(expires) || !now.Before(*m.ExpirationTime)):
		return "expiration time"
	case m.NotBefore != nil && m.NotBefore.After(now.Add(siweClockSkew)):
		return "not before"
	case len(m.Resources) > 0:
		return "resources"
	}
	return ""
}

// servedChain parses a CAIP-2 chain id and reports whether SIWE serves it.
func (c siweConfig) servedChain(caip2 string) (uint64, bool) {
	id, err := address.ParseCAIP2(caip2)
	return id, err == nil && c.chains[id]
}

// authenticateAccount is authenticate for handlers that serve EVM identities
// as well as Gno ones. A Gno (or legacy) token goes through authenticate
// unchanged. An EVM token validates only while SIWE is enabled for its chain,
// so turning MEMBA_ENABLE_SIWE off ends every EVM session at once; its address
// must be in canonical form. No handler calls it yet: each opts in explicitly.
func (s *MultisigService) authenticateAccount(token *membav1.Token) (string, error) {
	if token == nil || !auth.IsEVMChainID(token.ChainId) {
		return s.authenticate(token)
	}
	refuse := func(why string) (string, error) {
		slog.Warn("authenticateAccount: EVM token rejected", "reason", why, "chain_id", token.ChainId)
		return "", connect.NewError(connect.CodeUnauthenticated, nil)
	}
	cfg := s.siwe
	chainID, ok := cfg.servedChain(token.ChainId)
	if !cfg.enabled || !ok {
		return refuse("chain not served")
	}
	if err := auth.ValidateToken(s.publicKey, token, token.ChainId); err != nil {
		return refuse(err.Error())
	}
	a, err := address.Parse(token.UserAddress)
	if err != nil || a.String() != token.UserAddress {
		return refuse("address not canonical")
	}
	switch a.Kind() {
	case address.KindEVM:
	case address.KindEVMScoped:
		if a.ChainID() != chainID {
			return refuse("scoped address on another chain")
		}
		// A contract-account session ends when the contract path is turned
		// off for its chain.
		if cfg.verifiers[chainID] == nil {
			return refuse("contract signers off")
		}
	default:
		return refuse("not an EVM address")
	}
	return a.String(), nil
}

// siweLogin records one SIWE login outcome on the auth_login metric (results
// prefixed "siwe_") and as a countable log line.
func siweLogin(result, addr, chainID string) {
	metrics.AuthLoginTotal.WithLabelValues("siwe_" + result).Inc()
	slog.Info("auth_login", "metric", "auth_login", "result", "siwe_"+result, "address", addr, "chain_id", chainID)
}

// PruneSiweNonces deletes used-nonce rows whose challenge can no longer be
// presented. Safe to call at any time; a no-op on an empty table.
func (s *MultisigService) PruneSiweNonces(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM siwe_used_nonces WHERE expires_at < ?`, s.siwe.clock().Unix())
	return err
}

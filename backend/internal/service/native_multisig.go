package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/gnolang/gno/tm2/pkg/amino"
	abci "github.com/gnolang/gno/tm2/pkg/bft/abci/types"
	gnorpc "github.com/gnolang/gno/tm2/pkg/bft/rpc/client"
	ctypes "github.com/gnolang/gno/tm2/pkg/bft/rpc/core/types"
	rpctypes "github.com/gnolang/gno/tm2/pkg/bft/rpc/lib/types"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/gnomultisig"
)

// This separate, default-off gate is not the legacy A3 log-only gate. Native
// creation/signing/proposals require an explicitly configured, matching chain.
func (s *MultisigService) nativeMultisigEnabled(chain string) bool {
	v := os.Getenv("MEMBA_ENABLE_NATIVE_GNO_MULTISIG")
	return (v == "1" || v == "true") && s.chainID != "" && chain == s.chainID
}

// Confirmation is native-specific and fail-closed. Never use the unrelated
// quest RPC fallback, or mark an arbitrary client's hash as an executed tx.
func (s *MultisigService) confirmNative(ctx context.Context, req *connect.Request[membav1.CompleteTransactionRequest]) error {
	r, err := s.GetTransaction(ctx, connect.NewRequest(&membav1.GetTransactionRequest{AuthToken: req.Msg.AuthToken, TransactionId: req.Msg.TransactionId}))
	if err != nil {
		return err
	}
	t := r.Msg.Transaction
	if req.Msg.GetAuthToken().GetChainId() != t.ChainId {
		return connect.NewError(connect.CodePermissionDenied, nil)
	}
	// FailedPrecondition tells the client the transaction is not on chain, so
	// it may broadcast: a server that cannot look says Unavailable instead.
	if !s.nativeMultisigEnabled(t.ChainId) || os.Getenv("MEMBA_NATIVE_GNO_RPC_URL") == "" {
		return connect.NewError(connect.CodeUnavailable, errReceiptCheckUnconfigured)
	}
	pk, err := gnomultisig.Parse(t.MultisigPubkeyJson)
	if err != nil || pk.Address().String() != t.MultisigAddress || uint64(pk.K) != uint64(t.Threshold) || uint64(len(pk.PubKeys)) != uint64(t.MembersCount) {
		return internalError("CompleteTransaction: native identity", gnomultisig.ErrInvalid)
	}
	h, err := normalizeTxHashHex(req.Msg.FinalHash)
	if err != nil {
		return connect.NewError(connect.CodeInvalidArgument, nil)
	}
	hash, err := hex.DecodeString(h)
	if err != nil {
		return connect.NewError(connect.CodeInvalidArgument, nil)
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	receipt, client, err := nativeReceipt(ctx, t.ChainId, hash)
	if err != nil {
		return err
	}
	defer func() { _ = client.Close() }()
	// An answer that is not a committed receipt for the hash asked about is
	// no answer. A receipt of another transaction says this proposal is not
	// at that hash.
	receiptHash := sha256.Sum256(receipt.Tx)
	if receipt.Height <= 0 || !bytes.Equal(receipt.Hash, hash) || !bytes.Equal(receiptHash[:], hash) {
		return connect.NewError(connect.CodeUnavailable, nil)
	}
	if gnomultisig.ValidateSigned(pk, nativeFields(t), receipt.Tx) != nil {
		return connect.NewError(connect.CodeFailedPrecondition, errTxNotThisProposal)
	}
	if receipt.TxResult.Error == nil {
		_, err = s.db.ExecContext(ctx, "UPDATE transactions SET final_hash = ?, verified = TRUE, onchain_error = NULL WHERE id = ? AND final_hash IS NULL", h, t.Id)
		if err != nil {
			return internalError("CompleteTransaction: native receipt", err)
		}
		return nil
	}
	// The chain refused it. A failure while running the messages uses the
	// account's sequence: the proposal can never run and is closed as failed.
	// A refusal before execution (the fee check at block time) leaves the
	// sequence as it was and the signed bytes valid: the reason is kept and
	// the proposal stays open to be broadcast again.
	reason := onchainReason(receipt.TxResult)
	used, err := sequenceUsed(ctx, client, t.MultisigAddress, uint64(t.Sequence), receipt.Height)
	if err != nil {
		return connect.NewError(connect.CodeUnavailable, nil)
	}
	if !used {
		if _, err := s.db.ExecContext(ctx, "UPDATE transactions SET onchain_error = ? WHERE id = ? AND final_hash IS NULL", reason, t.Id); err != nil {
			return internalError("CompleteTransaction: native refusal", err)
		}
		return connect.NewError(connect.CodeFailedPrecondition, errRefusedBeforeExecution)
	}
	// Used at the receipt's block. Already used the block before means this
	// receipt is a refused replay of bytes that ran earlier, not this
	// proposal's failure: no answer rather than a wrong, permanent one.
	usedBefore, err := sequenceUsed(ctx, client, t.MultisigAddress, uint64(t.Sequence), receipt.Height-1)
	if err != nil || usedBefore || receipt.Height < 2 {
		return connect.NewError(connect.CodeUnavailable, nil)
	}
	_, err = s.db.ExecContext(ctx, "UPDATE transactions SET final_hash = ?, verified = FALSE, onchain_error = ? WHERE id = ? AND final_hash IS NULL", h, reason, t.Id)
	if err != nil {
		return internalError("CompleteTransaction: native failure", err)
	}
	return nil
}

// Receipt nodes. The primary (MEMBA_NATIVE_GNO_RPC_URL) must be one node:
// every request reaches the node that was checked, so it alone may answer
// that a transaction is absent. The fallback (MEMBA_NATIVE_GNO_RPC_FALLBACK_URL)
// may be a load-balanced pool, where each request can reach another node: it
// may only confirm a receipt, which is checked against the hash and the
// proposal whichever node sends it.
var (
	// Each node gets this long per request, so one that hangs leaves the
	// fallback time inside the 8 s budget.
	nativeStatusTimeout = 3 * time.Second
	nativeTxTimeout     = 3 * time.Second
	// A node whose newest block is older than this is behind (CatchingUp
	// covers only the initial sync); one dated ahead of this host's clock by
	// more than the skew is not trusted either.
	nativeNodeFreshness = 10 * time.Second
	nativeClockSkew     = 5 * time.Second
)

// nativeReceipt finds the transaction's receipt. FailedPrecondition (absent)
// comes only from the primary, checked as the chain and current; every other
// failure is Unavailable, which must never read as "not on chain".
func nativeReceipt(ctx context.Context, chainID string, hash []byte) (*ctypes.ResultTx, *gnorpc.RPCClient, error) {
	for i, url := range []string{os.Getenv("MEMBA_NATIVE_GNO_RPC_URL"), os.Getenv("MEMBA_NATIVE_GNO_RPC_FALLBACK_URL")} {
		decides := i == 0
		client := nativeNode(ctx, url, chainID, decides)
		if client == nil {
			continue
		}
		txCtx, cancel := context.WithTimeout(ctx, nativeTxTimeout)
		receipt, err := client.Tx(txCtx, hash)
		cancel()
		if err == nil {
			return receipt, client, nil
		}
		_ = client.Close()
		if decides && txAbsent(err, hash) {
			return nil, nil, connect.NewError(connect.CodeFailedPrecondition, errTxNotOnChain)
		}
	}
	return nil, nil, connect.NewError(connect.CodeUnavailable, nil)
}

func current(latestBlock time.Time) bool {
	age := time.Since(latestBlock)
	return age < nativeNodeFreshness && age > -nativeClockSkew
}

// nativeNode is a client for url when it answers as the chain and, for the
// node that decides absence, has a block from the last nativeNodeFreshness.
func nativeNode(ctx context.Context, url, chainID string, decides bool) *gnorpc.RPCClient {
	if url == "" {
		return nil
	}
	client, err := gnorpc.NewHTTPClient(url)
	if err != nil {
		return nil
	}
	statusCtx, cancel := context.WithTimeout(ctx, nativeStatusTimeout)
	status, err := client.Status(statusCtx, nil)
	cancel()
	if err == nil && status != nil && status.NodeInfo.Network == chainID && !status.SyncInfo.CatchingUp &&
		(!decides || current(status.SyncInfo.LatestBlockTime)) {
		return client
	}
	_ = client.Close()
	return nil
}

var (
	errReceiptCheckUnconfigured = errors.New("this server cannot check transactions on chain: native receipt verification is not configured")
	errTxNotOnChain             = errors.New("the node Memba checks has no transaction at this hash yet")
	errTxNotThisProposal        = errors.New("the transaction at this hash is not this proposal")
)

var errRefusedBeforeExecution = errors.New("the network refused this transaction before executing it; the signed transaction is still valid")

// maxOnchainError bounds the stored reason: a node's error text has no limit.
const maxOnchainError = 500

// onchainReason is the chain's error label and its log, bounded. A byte cut
// can split a character, which a protobuf string refuses.
func onchainReason(r abci.ResponseDeliverTx) string {
	reason := r.Error.Error()
	if r.Log != "" {
		reason += ": " + r.Log
	}
	return strings.ToValidUTF8(truncate(reason, maxOnchainError), "")
}

// sequenceUsed reads the account as it was at the receipt's block and reports
// whether its sequence had moved past the proposal's. The same bytes refused
// before execution at that block may have run since: today's account would
// call the old refusal final.
func sequenceUsed(ctx context.Context, client *gnorpc.RPCClient, addr string, sequence uint64, height int64) (bool, error) {
	res, err := client.ABCIQueryWithOptions(ctx, "auth/accounts/"+addr, nil, gnorpc.ABCIQueryOptions{Height: height})
	if err != nil || res.Response.Error != nil {
		return false, errors.New("account unreadable")
	}
	var account struct {
		BaseAccount struct {
			Address  string `json:"address"`
			Sequence string `json:"sequence"`
		} `json:"BaseAccount"`
	}
	if json.Unmarshal(res.Response.Data, &account) != nil || account.BaseAccount.Address != addr {
		return false, errors.New("account unreadable")
	}
	current, err := strconv.ParseUint(account.BaseAccount.Sequence, 10, 64)
	if err != nil {
		return false, errors.New("account unreadable")
	}
	return current > sequence, nil
}

// txAbsent reports whether the node itself answered that it has no result for
// the hash, as opposed to failing to answer.
func txAbsent(err error, hash []byte) bool {
	var rpcErr *rpctypes.RPCError
	return errors.As(err, &rpcErr) && rpcErr.Data == "Could not find tx result for hash #"+fmtHash(hash)
}

func fmtHash(hash []byte) string {
	return strings.ToUpper(hex.EncodeToString(hash))
}

// Take a SQLite write lock before reading peer signatures. Concurrent native
// submissions cannot pick incompatible fee renderings. Completed rows reject
// new submissions; receipt validation also tolerates a late pre-completion one.
func (s *MultisigService) storeNativeSignature(ctx context.Context, id uint32, pubkey string, f gnomultisig.Fields, p gnomultisig.Partial, body []byte) error {
	pk, err := gnomultisig.Parse(pubkey)
	if err != nil {
		return sigVerifyDenied()
	}
	unsigned, err := gnomultisig.Transaction(f, pk.Address().String())
	if err != nil {
		return sigVerifyDenied()
	}
	rendering, _, err := gnomultisig.VerifyPartial(pk, f, unsigned, p)
	if err != nil {
		return sigVerifyDenied()
	}
	dbtx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return internalError("SignTransaction: native begin", err)
	}
	defer func() { _ = dbtx.Rollback() }()
	res, err := dbtx.ExecContext(ctx, "UPDATE transactions SET memo = memo WHERE id = ? AND final_hash IS NULL", id)
	if err != nil {
		return internalError("SignTransaction: native lock", err)
	}
	n, err := res.RowsAffected()
	if err != nil || n != 1 {
		return connect.NewError(connect.CodeFailedPrecondition, nil)
	}
	others := 0
	rows, err := dbtx.QueryContext(ctx, "SELECT user_address, signature FROM signatures WHERE transaction_id = ? AND user_address != ?", id, p.Address)
	if err != nil {
		return internalError("SignTransaction: native signatures", err)
	}
	for rows.Next() {
		var other gnomultisig.Partial
		if rows.Scan(&other.Address, &other.Value) != nil {
			_ = rows.Close()
			return sigVerifyDenied()
		}
		others++
		r, _, e := gnomultisig.VerifyPartial(pk, f, unsigned, other)
		if e != nil || r != rendering {
			_ = rows.Close()
			return connect.NewError(connect.CodeFailedPrecondition, errors.New("all signatures must use the same fee rendering; no signature was changed"))
		}
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return internalError("SignTransaction: native iteration", err)
	}
	// From quorum on, the transaction is assembled from the earliest
	// signatures: none of them may change, or its bytes and hash would.
	var own int
	if err := dbtx.QueryRowContext(ctx, "SELECT COUNT(*) FROM signatures WHERE transaction_id = ? AND user_address = ?", id, p.Address).Scan(&own); err != nil {
		return internalError("SignTransaction: native own signature", err)
	}
	if own > 0 && uint(others+own) >= pk.K {
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("this transaction has its quorum; a signature can no longer be changed"))
	}
	_, err = dbtx.ExecContext(ctx, `INSERT INTO signatures (transaction_id, user_address, signature, body_bytes, verified) VALUES (?, ?, ?, ?, TRUE)
	 ON CONFLICT(transaction_id, user_address) DO UPDATE SET signature = excluded.signature, body_bytes = excluded.body_bytes, verified = TRUE`, id, p.Address, p.Value, body)
	if err != nil {
		return internalError("SignTransaction: native store", err)
	}
	if err := dbtx.Commit(); err != nil {
		return internalError("SignTransaction: native commit", err)
	}
	return nil
}

func nativeFields(t *membav1.Transaction) gnomultisig.Fields {
	return gnomultisig.Fields{ChainID: t.ChainId, AccountNumber: uint64(t.AccountNumber), Sequence: uint64(t.Sequence), MsgsJSON: t.MsgsJson, FeeJSON: t.FeeJson, Memo: t.Memo}
}

func nativeArtifact(t *membav1.Transaction) ([]byte, string, error) {
	pk, err := gnomultisig.Parse(t.MultisigPubkeyJson)
	if err != nil || pk.Address().String() != t.MultisigAddress || uint64(pk.K) != uint64(t.Threshold) || uint64(len(pk.PubKeys)) != uint64(t.MembersCount) {
		return nil, "", gnomultisig.ErrInvalid
	}
	// The earliest K signatures, so the transaction's bytes and hash never
	// change once quorum is reached: a later signature adds nothing to it.
	// ValidateSigned accepts any quorum at confirmation.
	partials := make([]gnomultisig.Partial, 0, pk.K)
	for _, sig := range t.Signatures {
		if uint(len(partials)) == pk.K {
			break
		}
		partials = append(partials, gnomultisig.Partial{Address: sig.UserAddress, Value: sig.Value})
	}
	tx, b, err := gnomultisig.Assemble(pk, nativeFields(t), partials)
	if err != nil {
		return nil, "", err
	}
	j, err := amino.MarshalJSON(tx)
	return b, string(j), err
}

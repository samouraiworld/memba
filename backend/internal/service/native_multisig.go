package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/gnolang/gno/tm2/pkg/amino"
	gnorpc "github.com/gnolang/gno/tm2/pkg/bft/rpc/client"
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
	if !s.nativeMultisigEnabled(t.ChainId) || os.Getenv("MEMBA_NATIVE_GNO_RPC_URL") == "" {
		return connect.NewError(connect.CodeFailedPrecondition, nil)
	}
	pk, err := gnomultisig.Parse(t.MultisigPubkeyJson)
	if err != nil || pk.Address().String() != t.MultisigAddress || uint64(pk.K) != uint64(t.Threshold) || uint64(len(pk.PubKeys)) != uint64(t.MembersCount) {
		return connect.NewError(connect.CodeFailedPrecondition, nil)
	}
	h, err := normalizeTxHashHex(req.Msg.FinalHash)
	if err != nil {
		return connect.NewError(connect.CodeInvalidArgument, nil)
	}
	hash, err := hex.DecodeString(h)
	if err != nil {
		return connect.NewError(connect.CodeInvalidArgument, nil)
	}
	client, err := gnorpc.NewHTTPClient(os.Getenv("MEMBA_NATIVE_GNO_RPC_URL"))
	if err != nil {
		return connect.NewError(connect.CodeUnavailable, nil)
	}
	defer func() { _ = client.Close() }()
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	status, err := client.Status(ctx, nil)
	if err != nil || status == nil || status.NodeInfo.Network != t.ChainId || status.SyncInfo.CatchingUp {
		return connect.NewError(connect.CodeUnavailable, nil)
	}
	receipt, err := client.Tx(ctx, hash)
	if err != nil || receipt == nil || receipt.Height <= 0 || receipt.TxResult.Error != nil || !bytes.Equal(receipt.Hash, hash) {
		return connect.NewError(connect.CodeFailedPrecondition, nil)
	}
	receiptHash := sha256.Sum256(receipt.Tx)
	if !bytes.Equal(receiptHash[:], hash) || gnomultisig.ValidateSigned(pk, nativeFields(t), receipt.Tx) != nil {
		return connect.NewError(connect.CodeFailedPrecondition, nil)
	}
	_, err = s.db.ExecContext(ctx, "UPDATE transactions SET final_hash = ?, verified = TRUE WHERE id = ? AND final_hash IS NULL", h, t.Id)
	if err != nil {
		return internalError("CompleteTransaction: native receipt", err)
	}
	return nil
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
	partials := make([]gnomultisig.Partial, 0, len(t.Signatures))
	for _, sig := range t.Signatures {
		partials = append(partials, gnomultisig.Partial{Address: sig.UserAddress, Value: sig.Value})
	}
	tx, b, err := gnomultisig.Assemble(pk, nativeFields(t), partials)
	if err != nil {
		return nil, "", err
	}
	j, err := amino.MarshalJSON(tx)
	return b, string(j), err
}

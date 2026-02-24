package service

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"strings"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// ─── Transaction RPCs ─────────────────────────────────────────────

func (s *MultisigService) CreateTransaction(
	ctx context.Context,
	req *connect.Request[membav1.CreateTransactionRequest],
) (*connect.Response[membav1.CreateTransactionResponse], error) {
	userAddress, err := s.authenticate(req.Msg.GetAuthToken())
	if err != nil {
		return nil, err
	}

	chainID := req.Msg.GetChainId()
	multisigAddr := req.Msg.GetMultisigAddress()
	msgsJSON := req.Msg.GetMsgsJson()
	feeJSON := req.Msg.GetFeeJson()

	if chainID == "" || multisigAddr == "" || msgsJSON == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	// S6: Input length limits.
	if len(msgsJSON) > 102400 || len(feeJSON) > 4096 || len(req.Msg.GetMemo()) > 256 {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	// Verify user is a member of this multisig.
	var exists int
	err = s.db.QueryRowContext(ctx,
		"SELECT 1 FROM user_multisigs WHERE chain_id = ? AND user_address = ? AND multisig_address = ? AND joined = TRUE",
		chainID, userAddress, multisigAddr,
	).Scan(&exists)
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, nil)
	}

	res, err := s.db.ExecContext(ctx,
		`INSERT INTO transactions (chain_id, multisig_address, msgs_json, fee_json, account_number, sequence, memo, creator_address, type)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		chainID, multisigAddr, msgsJSON, feeJSON,
		req.Msg.GetAccountNumber(), req.Msg.GetSequence(),
		req.Msg.GetMemo(), userAddress, req.Msg.GetType(),
	)
	if err != nil {
		return nil, internalError("internal", err)
	}

	txID, _ := res.LastInsertId()
	slog.Info("CreateTransaction", "id", txID, "creator", userAddress, "multisig", multisigAddr)

	return connect.NewResponse(&membav1.CreateTransactionResponse{
		TransactionId: uint32(txID),
	}), nil
}

func (s *MultisigService) Transactions(
	ctx context.Context,
	req *connect.Request[membav1.TransactionsRequest],
) (*connect.Response[membav1.TransactionsResponse], error) {
	userAddress, err := s.authenticate(req.Msg.GetAuthToken())
	if err != nil {
		return nil, err
	}

	chainID := req.Msg.GetChainId()
	multisigAddr := req.Msg.GetMultisigAddress()
	limit := req.Msg.GetLimit()
	if limit == 0 || limit > 100 {
		limit = 20
	}

	query := `
		SELECT t.id, t.chain_id, t.multisig_address, t.msgs_json, t.fee_json,
		       t.account_number, t.sequence, t.memo, t.creator_address,
		       COALESCE(t.final_hash, ''), t.type, t.created_at,
		       m.threshold, m.members_count, m.pubkey_json
		FROM transactions t
		JOIN multisigs m ON m.chain_id = t.chain_id AND m.address = t.multisig_address
		JOIN user_multisigs um ON um.chain_id = t.chain_id AND um.multisig_address = t.multisig_address AND um.user_address = ?
		WHERE um.joined = TRUE
	`
	args := []interface{}{userAddress}

	if chainID != "" {
		query += " AND t.chain_id = ?"
		args = append(args, chainID)
	}
	if multisigAddr != "" {
		query += " AND t.multisig_address = ?"
		args = append(args, multisigAddr)
	}

	switch req.Msg.GetExecutionState() {
	case membav1.ExecutionState_EXECUTION_STATE_PENDING:
		query += " AND t.final_hash IS NULL"
	case membav1.ExecutionState_EXECUTION_STATE_EXECUTED:
		query += " AND t.final_hash IS NOT NULL"
	}

	query += " ORDER BY t.created_at DESC LIMIT ?"
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, internalError("internal", err)
	}
	defer rows.Close()

	var transactions []*membav1.Transaction
	txByID := make(map[uint32]*membav1.Transaction)
	for rows.Next() {
		var tx membav1.Transaction
		if err := rows.Scan(
			&tx.Id, &tx.ChainId, &tx.MultisigAddress, &tx.MsgsJson, &tx.FeeJson,
			&tx.AccountNumber, &tx.Sequence, &tx.Memo, &tx.CreatorAddress,
			&tx.FinalHash, &tx.Type, &tx.CreatedAt,
			&tx.Threshold, &tx.MembersCount, &tx.MultisigPubkeyJson,
		); err != nil {
			continue
		}
		transactions = append(transactions, &tx)
		txByID[tx.Id] = &tx
	}
	if err := rows.Err(); err != nil {
		return nil, internalError("Transactions: row iteration", err)
	}

	// Batch-load signatures for all transactions (fixes N+1 query).
	if len(txByID) > 0 {
		ids := make([]interface{}, 0, len(txByID))
		placeholders := make([]string, 0, len(txByID))
		for id := range txByID {
			ids = append(ids, id)
			placeholders = append(placeholders, "?")
		}

		sigQuery := fmt.Sprintf(
			"SELECT transaction_id, user_address, signature, body_bytes, created_at FROM signatures WHERE transaction_id IN (%s)",
			strings.Join(placeholders, ","),
		)

		sigRows, err := s.db.QueryContext(ctx, sigQuery, ids...)
		if err != nil {
			return nil, internalError("Transactions: sig batch query", err)
		}
		defer sigRows.Close()

		for sigRows.Next() {
			var txID uint32
			var sig membav1.Signature
			var bodyBytes []byte
			if err := sigRows.Scan(&txID, &sig.UserAddress, &sig.Value, &bodyBytes, &sig.CreatedAt); err != nil {
				continue
			}
			sig.BodyBytes = bodyBytes
			if tx, ok := txByID[txID]; ok {
				tx.Signatures = append(tx.Signatures, &sig)
			}
		}
		if err := sigRows.Err(); err != nil {
			return nil, internalError("Transactions: sig row iteration", err)
		}
	}

	slog.Info("Transactions", "user", userAddress, "count", len(transactions))
	return connect.NewResponse(&membav1.TransactionsResponse{Transactions: transactions}), nil
}

func (s *MultisigService) SignTransaction(
	ctx context.Context,
	req *connect.Request[membav1.SignTransactionRequest],
) (*connect.Response[membav1.SignTransactionResponse], error) {
	userAddress, err := s.authenticate(req.Msg.GetAuthToken())
	if err != nil {
		return nil, err
	}

	txID := req.Msg.GetTransactionId()
	sig := req.Msg.GetSignature()
	bodyBytes := req.Msg.GetBodyBytes()

	if txID == 0 || sig == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	// Verify the transaction exists and the user is a member of its multisig.
	var chainID, multisigAddr string
	err = s.db.QueryRowContext(ctx,
		"SELECT chain_id, multisig_address FROM transactions WHERE id = ? AND final_hash IS NULL",
		txID,
	).Scan(&chainID, &multisigAddr)
	if err == sql.ErrNoRows {
		return nil, connect.NewError(connect.CodeNotFound, nil)
	}
	if err != nil {
		return nil, internalError("internal", err)
	}

	var memberExists int
	err = s.db.QueryRowContext(ctx,
		"SELECT 1 FROM user_multisigs WHERE chain_id = ? AND user_address = ? AND multisig_address = ? AND joined = TRUE",
		chainID, userAddress, multisigAddr,
	).Scan(&memberExists)
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, nil)
	}

	_, err = s.db.ExecContext(ctx,
		"INSERT OR REPLACE INTO signatures (transaction_id, user_address, signature, body_bytes) VALUES (?, ?, ?, ?)",
		txID, userAddress, sig, bodyBytes,
	)
	if err != nil {
		return nil, internalError("internal", err)
	}

	slog.Info("SignTransaction", "tx_id", txID, "signer", userAddress)
	return connect.NewResponse(&membav1.SignTransactionResponse{}), nil
}

func (s *MultisigService) CompleteTransaction(
	ctx context.Context,
	req *connect.Request[membav1.CompleteTransactionRequest],
) (*connect.Response[membav1.CompleteTransactionResponse], error) {
	userAddress, err := s.authenticate(req.Msg.GetAuthToken())
	if err != nil {
		return nil, err
	}

	txID := req.Msg.GetTransactionId()
	finalHash := req.Msg.GetFinalHash()

	if txID == 0 || finalHash == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	// Verify the user is a member and transaction isn't already completed.
	var chainID, multisigAddr string
	err = s.db.QueryRowContext(ctx,
		"SELECT chain_id, multisig_address FROM transactions WHERE id = ? AND final_hash IS NULL",
		txID,
	).Scan(&chainID, &multisigAddr)
	if err == sql.ErrNoRows {
		return nil, connect.NewError(connect.CodeNotFound, nil)
	}
	if err != nil {
		return nil, internalError("internal", err)
	}

	var memberExists int
	err = s.db.QueryRowContext(ctx,
		"SELECT 1 FROM user_multisigs WHERE chain_id = ? AND user_address = ? AND multisig_address = ? AND joined = TRUE",
		chainID, userAddress, multisigAddr,
	).Scan(&memberExists)
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, nil)
	}

	_, err = s.db.ExecContext(ctx, "UPDATE transactions SET final_hash = ? WHERE id = ?", finalHash, txID)
	if err != nil {
		return nil, internalError("internal", err)
	}

	slog.Info("CompleteTransaction", "tx_id", txID, "hash", finalHash, "user", userAddress)
	return connect.NewResponse(&membav1.CompleteTransactionResponse{}), nil
}

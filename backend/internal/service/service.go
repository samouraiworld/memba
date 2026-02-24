package service

import (
	"context"
	"crypto/ed25519"
	srand "crypto/rand"
	"database/sql"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"github.com/cosmos/cosmos-sdk/codec/legacy"
	"github.com/cosmos/cosmos-sdk/crypto/keys/multisig"
	"github.com/cosmos/cosmos-sdk/types/bech32"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/auth"
)

// MultisigService implements the ConnectRPC MultisigService.
type MultisigService struct {
	db         *sql.DB
	publicKey  ed25519.PublicKey
	privateKey ed25519.PrivateKey
}

// NewMultisigService creates a new MultisigService with a fresh ed25519 keypair.
func NewMultisigService(db *sql.DB) (*MultisigService, error) {
	publicKey, privateKey, err := ed25519.GenerateKey(srand.Reader)
	if err != nil {
		return nil, err
	}
	slog.Info("generated server auth keypair", "pubkey_len", len(publicKey))
	return &MultisigService{
		db:         db,
		publicKey:  publicKey,
		privateKey: privateKey,
	}, nil
}

// authenticate validates a token and returns the user address.
func (s *MultisigService) authenticate(token *membav1.Token) (string, error) {
	if err := auth.ValidateToken(s.publicKey, token); err != nil {
		return "", connect.NewError(connect.CodeUnauthenticated, err)
	}
	return token.UserAddress, nil
}

// ─── Auth RPCs ────────────────────────────────────────────────────

func (s *MultisigService) GetChallenge(
	_ context.Context,
	_ *connect.Request[membav1.GetChallengeRequest],
) (*connect.Response[membav1.GetChallengeResponse], error) {
	slog.Info("GetChallenge called")
	challenge, err := auth.MakeChallenge(s.privateKey, auth.DefaultChallengeDuration)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&membav1.GetChallengeResponse{Challenge: challenge}), nil
}

func (s *MultisigService) GetToken(
	_ context.Context,
	req *connect.Request[membav1.GetTokenRequest],
) (*connect.Response[membav1.GetTokenResponse], error) {
	slog.Info("GetToken called")
	token, err := auth.MakeToken(s.privateKey, s.publicKey, auth.DefaultTokenDuration, req.Msg.GetInfoJson(), req.Msg.GetUserSignature())
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, err)
	}
	return connect.NewResponse(&membav1.GetTokenResponse{AuthToken: token}), nil
}

// ─── Multisig RPCs ────────────────────────────────────────────────

func (s *MultisigService) CreateOrJoinMultisig(
	_ context.Context,
	req *connect.Request[membav1.CreateOrJoinMultisigRequest],
) (*connect.Response[membav1.CreateOrJoinMultisigResponse], error) {
	userAddress, err := s.authenticate(req.Msg.GetAuthToken())
	if err != nil {
		return nil, err
	}

	chainID := req.Msg.GetChainId()
	pubkeyJSON := req.Msg.GetMultisigPubkeyJson()
	name := req.Msg.GetName()
	prefix := req.Msg.GetBech32Prefix()

	if chainID == "" || pubkeyJSON == "" || prefix == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	// Parse the multisig pubkey to derive the address and validate members.
	var ms multisig.LegacyAminoPubKey
	if err := legacy.Cdc.UnmarshalJSON([]byte(pubkeyJSON), &ms); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	multisigAddress, err := bech32.ConvertAndEncode(prefix, ms.Address())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	pubKeys := ms.GetPubKeys()
	if int(ms.Threshold) > len(pubKeys) || ms.Threshold == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	// Verify the user is a member of this multisig.
	_, userAddrBytes, err := bech32.DecodeAndConvert(userAddress)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	isMember := false
	for _, pk := range pubKeys {
		if string(pk.Address().Bytes()) == string(userAddrBytes) {
			isMember = true
			break
		}
	}
	if !isMember {
		return nil, connect.NewError(connect.CodePermissionDenied, nil)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	var created, joined bool

	tx, err := s.db.Begin()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	defer tx.Rollback()

	// Upsert multisig.
	var existingAddr string
	err = tx.QueryRow("SELECT address FROM multisigs WHERE chain_id = ? AND address = ?", chainID, multisigAddress).Scan(&existingAddr)
	if err == sql.ErrNoRows {
		_, err = tx.Exec(
			"INSERT INTO multisigs (chain_id, address, pubkey_json, threshold, members_count, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			chainID, multisigAddress, pubkeyJSON, ms.Threshold, len(pubKeys), now,
		)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		// Create user_multisig entries for all members.
		for _, pk := range pubKeys {
			memberAddr, err := bech32.ConvertAndEncode(auth.UniversalBech32Prefix, pk.Address().Bytes())
			if err != nil {
				continue
			}
			_, err = tx.Exec(
				"INSERT OR IGNORE INTO user_multisigs (chain_id, user_address, multisig_address, joined, created_at) VALUES (?, ?, ?, FALSE, ?)",
				chainID, memberAddr, multisigAddress, now,
			)
			if err != nil {
				return nil, connect.NewError(connect.CodeInternal, err)
			}
		}
		created = true
	} else if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Join: upsert the calling user's membership.
	var existingJoined bool
	err = tx.QueryRow(
		"SELECT joined FROM user_multisigs WHERE chain_id = ? AND user_address = ? AND multisig_address = ?",
		chainID, userAddress, multisigAddress,
	).Scan(&existingJoined)
	if err == sql.ErrNoRows {
		_, err = tx.Exec(
			"INSERT INTO user_multisigs (chain_id, user_address, multisig_address, name, joined, created_at) VALUES (?, ?, ?, ?, TRUE, ?)",
			chainID, userAddress, multisigAddress, name, now,
		)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		joined = true
	} else if err == nil && !existingJoined {
		_, err = tx.Exec(
			"UPDATE user_multisigs SET joined = TRUE, name = ? WHERE chain_id = ? AND user_address = ? AND multisig_address = ?",
			name, chainID, userAddress, multisigAddress,
		)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		joined = true
	} else if err == nil && existingJoined && name != "" {
		_, err = tx.Exec(
			"UPDATE user_multisigs SET name = ? WHERE chain_id = ? AND user_address = ? AND multisig_address = ?",
			name, chainID, userAddress, multisigAddress,
		)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	} else if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := tx.Commit(); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	slog.Info("CreateOrJoinMultisig", "address", multisigAddress, "created", created, "joined", joined)

	return connect.NewResponse(&membav1.CreateOrJoinMultisigResponse{
		Created:         created,
		Joined:          joined,
		MultisigAddress: multisigAddress,
	}), nil
}

func (s *MultisigService) MultisigInfo(
	_ context.Context,
	req *connect.Request[membav1.MultisigInfoRequest],
) (*connect.Response[membav1.MultisigInfoResponse], error) {
	if _, err := s.authenticate(req.Msg.GetAuthToken()); err != nil {
		return nil, err
	}

	chainID := req.Msg.GetChainId()
	addr := req.Msg.GetMultisigAddress()

	var ms membav1.Multisig
	err := s.db.QueryRow(
		"SELECT chain_id, address, pubkey_json, threshold, members_count, created_at FROM multisigs WHERE chain_id = ? AND address = ?",
		chainID, addr,
	).Scan(&ms.ChainId, &ms.Address, &ms.PubkeyJson, &ms.Threshold, &ms.MembersCount, &ms.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, connect.NewError(connect.CodeNotFound, nil)
	}
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Get member addresses.
	rows, err := s.db.Query(
		"SELECT user_address FROM user_multisigs WHERE chain_id = ? AND multisig_address = ?",
		chainID, addr,
	)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	defer rows.Close()
	for rows.Next() {
		var memberAddr string
		if err := rows.Scan(&memberAddr); err != nil {
			continue
		}
		ms.UsersAddresses = append(ms.UsersAddresses, memberAddr)
	}

	slog.Info("MultisigInfo", "address", addr, "members", len(ms.UsersAddresses))

	return connect.NewResponse(&membav1.MultisigInfoResponse{Multisig: &ms}), nil
}

func (s *MultisigService) Multisigs(
	_ context.Context,
	req *connect.Request[membav1.MultisigsRequest],
) (*connect.Response[membav1.MultisigsResponse], error) {
	userAddress, err := s.authenticate(req.Msg.GetAuthToken())
	if err != nil {
		return nil, err
	}

	chainID := req.Msg.GetChainId()
	limit := req.Msg.GetLimit()
	if limit == 0 || limit > 100 {
		limit = 20
	}

	query := `
		SELECT m.chain_id, m.address, m.pubkey_json, m.threshold, m.members_count, m.created_at,
		       um.joined, um.name
		FROM multisigs m
		JOIN user_multisigs um ON um.chain_id = m.chain_id AND um.multisig_address = m.address
		WHERE um.user_address = ?
	`
	args := []interface{}{userAddress}

	if chainID != "" {
		query += " AND m.chain_id = ?"
		args = append(args, chainID)
	}

	switch req.Msg.GetJoinState() {
	case membav1.JoinState_JOIN_STATE_IN:
		query += " AND um.joined = TRUE"
	case membav1.JoinState_JOIN_STATE_OUT:
		query += " AND um.joined = FALSE"
	}

	query += " ORDER BY m.created_at DESC LIMIT ?"
	args = append(args, limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	defer rows.Close()

	var multisigs []*membav1.Multisig
	for rows.Next() {
		var ms membav1.Multisig
		if err := rows.Scan(&ms.ChainId, &ms.Address, &ms.PubkeyJson, &ms.Threshold, &ms.MembersCount, &ms.CreatedAt, &ms.Joined, &ms.Name); err != nil {
			continue
		}
		multisigs = append(multisigs, &ms)
	}

	slog.Info("Multisigs", "user", userAddress, "count", len(multisigs))

	return connect.NewResponse(&membav1.MultisigsResponse{Multisigs: multisigs}), nil
}

// ─── Transaction RPCs ─────────────────────────────────────────────

func (s *MultisigService) CreateTransaction(
	_ context.Context,
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

	// Verify user is a member of this multisig.
	var exists int
	err = s.db.QueryRow(
		"SELECT 1 FROM user_multisigs WHERE chain_id = ? AND user_address = ? AND multisig_address = ? AND joined = TRUE",
		chainID, userAddress, multisigAddr,
	).Scan(&exists)
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, nil)
	}

	res, err := s.db.Exec(
		`INSERT INTO transactions (chain_id, multisig_address, msgs_json, fee_json, account_number, sequence, memo, creator_address, type)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		chainID, multisigAddr, msgsJSON, feeJSON,
		req.Msg.GetAccountNumber(), req.Msg.GetSequence(),
		req.Msg.GetMemo(), userAddress, req.Msg.GetType(),
	)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	txID, _ := res.LastInsertId()
	slog.Info("CreateTransaction", "id", txID, "creator", userAddress, "multisig", multisigAddr)

	return connect.NewResponse(&membav1.CreateTransactionResponse{
		TransactionId: uint32(txID),
	}), nil
}

func (s *MultisigService) Transactions(
	_ context.Context,
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

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	defer rows.Close()

	var transactions []*membav1.Transaction
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

		// Load signatures for this transaction.
		sigRows, err := s.db.Query(
			"SELECT user_address, signature, body_bytes, created_at FROM signatures WHERE transaction_id = ?",
			tx.Id,
		)
		if err == nil {
			for sigRows.Next() {
				var sig membav1.Signature
				var bodyBytes []byte
				if err := sigRows.Scan(&sig.UserAddress, &sig.Value, &bodyBytes, &sig.CreatedAt); err == nil {
					sig.BodyBytes = bodyBytes
					tx.Signatures = append(tx.Signatures, &sig)
				}
			}
			sigRows.Close()
		}

		transactions = append(transactions, &tx)
	}

	slog.Info("Transactions", "user", userAddress, "count", len(transactions))
	return connect.NewResponse(&membav1.TransactionsResponse{Transactions: transactions}), nil
}

func (s *MultisigService) SignTransaction(
	_ context.Context,
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
	err = s.db.QueryRow(
		"SELECT chain_id, multisig_address FROM transactions WHERE id = ? AND final_hash IS NULL",
		txID,
	).Scan(&chainID, &multisigAddr)
	if err == sql.ErrNoRows {
		return nil, connect.NewError(connect.CodeNotFound, nil)
	}
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var memberExists int
	err = s.db.QueryRow(
		"SELECT 1 FROM user_multisigs WHERE chain_id = ? AND user_address = ? AND multisig_address = ? AND joined = TRUE",
		chainID, userAddress, multisigAddr,
	).Scan(&memberExists)
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, nil)
	}

	_, err = s.db.Exec(
		"INSERT OR REPLACE INTO signatures (transaction_id, user_address, signature, body_bytes) VALUES (?, ?, ?, ?)",
		txID, userAddress, sig, bodyBytes,
	)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	slog.Info("SignTransaction", "tx_id", txID, "signer", userAddress)
	return connect.NewResponse(&membav1.SignTransactionResponse{}), nil
}

func (s *MultisigService) CompleteTransaction(
	_ context.Context,
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
	err = s.db.QueryRow(
		"SELECT chain_id, multisig_address FROM transactions WHERE id = ? AND final_hash IS NULL",
		txID,
	).Scan(&chainID, &multisigAddr)
	if err == sql.ErrNoRows {
		return nil, connect.NewError(connect.CodeNotFound, nil)
	}
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var memberExists int
	err = s.db.QueryRow(
		"SELECT 1 FROM user_multisigs WHERE chain_id = ? AND user_address = ? AND multisig_address = ? AND joined = TRUE",
		chainID, userAddress, multisigAddr,
	).Scan(&memberExists)
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, nil)
	}

	_, err = s.db.Exec("UPDATE transactions SET final_hash = ? WHERE id = ?", finalHash, txID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	slog.Info("CompleteTransaction", "tx_id", txID, "hash", finalHash, "user", userAddress)
	return connect.NewResponse(&membav1.CompleteTransactionResponse{}), nil
}

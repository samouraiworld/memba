package service

import (
	"context"
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

// ─── Multisig RPCs ────────────────────────────────────────────────

func (s *MultisigService) CreateOrJoinMultisig(
	ctx context.Context,
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

	// S6: Input length limits.
	if len(pubkeyJSON) > 4096 || len(name) > 256 || len(chainID) > 64 || len(prefix) > 16 {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	// Parse the multisig pubkey to derive the address and validate members.
	var ms multisig.LegacyAminoPubKey
	if err := legacy.Cdc.UnmarshalJSON([]byte(pubkeyJSON), &ms); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	multisigAddress, err := bech32.ConvertAndEncode(prefix, ms.Address())
	if err != nil {
		return nil, internalError("internal", err)
	}

	pubKeys := ms.GetPubKeys()
	if int(ms.Threshold) > len(pubKeys) || ms.Threshold == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	// Verify the user is a member of this multisig.
	_, userAddrBytes, err := bech32.DecodeAndConvert(userAddress)
	if err != nil {
		return nil, internalError("internal", err)
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

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, internalError("internal", err)
	}
	defer func() { _ = tx.Rollback() }()

	// Upsert multisig.
	var existingAddr string
	err = tx.QueryRowContext(ctx, "SELECT address FROM multisigs WHERE chain_id = ? AND address = ?", chainID, multisigAddress).Scan(&existingAddr)
	if err == sql.ErrNoRows {
		_, err = tx.ExecContext(ctx,
			"INSERT INTO multisigs (chain_id, address, pubkey_json, threshold, members_count, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			chainID, multisigAddress, pubkeyJSON, ms.Threshold, len(pubKeys), now,
		)
		if err != nil {
			return nil, internalError("internal", err)
		}

		// Create user_multisig entries for all members.
		for _, pk := range pubKeys {
			memberAddr, err := bech32.ConvertAndEncode(auth.UniversalBech32Prefix, pk.Address().Bytes())
			if err != nil {
				continue
			}
			_, err = tx.ExecContext(ctx,
				"INSERT OR IGNORE INTO user_multisigs (chain_id, user_address, multisig_address, joined, created_at) VALUES (?, ?, ?, FALSE, ?)",
				chainID, memberAddr, multisigAddress, now,
			)
			if err != nil {
				return nil, internalError("internal", err)
			}
		}
		created = true
	} else if err != nil {
		return nil, internalError("internal", err)
	}

	// Join: upsert the calling user's membership.
	var existingJoined bool
	err = tx.QueryRowContext(ctx,
		"SELECT joined FROM user_multisigs WHERE chain_id = ? AND user_address = ? AND multisig_address = ?",
		chainID, userAddress, multisigAddress,
	).Scan(&existingJoined)
	if err == sql.ErrNoRows {
		_, err = tx.ExecContext(ctx,
			"INSERT INTO user_multisigs (chain_id, user_address, multisig_address, name, joined, created_at) VALUES (?, ?, ?, ?, TRUE, ?)",
			chainID, userAddress, multisigAddress, name, now,
		)
		if err != nil {
			return nil, internalError("internal", err)
		}
		joined = true
	} else if err == nil && !existingJoined {
		_, err = tx.ExecContext(ctx,
			"UPDATE user_multisigs SET joined = TRUE, name = ? WHERE chain_id = ? AND user_address = ? AND multisig_address = ?",
			name, chainID, userAddress, multisigAddress,
		)
		if err != nil {
			return nil, internalError("internal", err)
		}
		joined = true
	} else if err == nil && existingJoined && name != "" {
		_, err = tx.ExecContext(ctx,
			"UPDATE user_multisigs SET name = ? WHERE chain_id = ? AND user_address = ? AND multisig_address = ?",
			name, chainID, userAddress, multisigAddress,
		)
		if err != nil {
			return nil, internalError("internal", err)
		}
	} else if err != nil {
		return nil, internalError("internal", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, internalError("internal", err)
	}

	slog.Info("CreateOrJoinMultisig", "address", multisigAddress, "created", created, "joined", joined)

	return connect.NewResponse(&membav1.CreateOrJoinMultisigResponse{
		Created:         created,
		Joined:          joined,
		MultisigAddress: multisigAddress,
	}), nil
}

func (s *MultisigService) MultisigInfo(
	ctx context.Context,
	req *connect.Request[membav1.MultisigInfoRequest],
) (*connect.Response[membav1.MultisigInfoResponse], error) {
	if _, err := s.authenticate(req.Msg.GetAuthToken()); err != nil {
		return nil, err
	}

	chainID := req.Msg.GetChainId()
	addr := req.Msg.GetMultisigAddress()

	var ms membav1.Multisig
	err := s.db.QueryRowContext(ctx,
		"SELECT chain_id, address, pubkey_json, threshold, members_count, created_at FROM multisigs WHERE chain_id = ? AND address = ?",
		chainID, addr,
	).Scan(&ms.ChainId, &ms.Address, &ms.PubkeyJson, &ms.Threshold, &ms.MembersCount, &ms.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, connect.NewError(connect.CodeNotFound, nil)
	}
	if err != nil {
		return nil, internalError("MultisigInfo: query", err)
	}

	// Get member addresses.
	rows, err := s.db.QueryContext(ctx,
		"SELECT user_address FROM user_multisigs WHERE chain_id = ? AND multisig_address = ?",
		chainID, addr,
	)
	if err != nil {
		return nil, internalError("MultisigInfo: member query", err)
	}
	defer rows.Close()
	for rows.Next() {
		var memberAddr string
		if err := rows.Scan(&memberAddr); err != nil {
			continue
		}
		ms.UsersAddresses = append(ms.UsersAddresses, memberAddr)
	}
	if err := rows.Err(); err != nil {
		return nil, internalError("MultisigInfo: row iteration", err)
	}

	slog.Info("MultisigInfo", "address", addr, "members", len(ms.UsersAddresses))

	return connect.NewResponse(&membav1.MultisigInfoResponse{Multisig: &ms}), nil
}

func (s *MultisigService) Multisigs(
	ctx context.Context,
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

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, internalError("Multisigs: query", err)
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
	if err := rows.Err(); err != nil {
		return nil, internalError("Multisigs: row iteration", err)
	}

	slog.Info("Multisigs", "user", userAddress, "count", len(multisigs))

	return connect.NewResponse(&membav1.MultisigsResponse{Multisigs: multisigs}), nil
}

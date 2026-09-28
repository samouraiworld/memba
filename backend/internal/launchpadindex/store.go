package launchpadindex

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
)

var (
	ErrInvalidScope  = errors.New("invalid Launchpad publication scope")
	ErrStoreConflict = errors.New("conflicting Launchpad stored evidence")
)

// Scope isolates one executable publication generation of tokens/v1 on one
// chain. PublicationHeight/Hash identify the successful activation block:
// MsgEnablePackage on inert-policy chains, MsgAddPackage otherwise. The
// cursor starts at its verified parent so the activation block is scanned.
// The caller must independently verify the receipt(s), source digest and
// parent hash; this package does not prove activation.
type Scope struct {
	ChainID               string
	RealmPath             string
	PublicationHeight     int64
	PublicationHash       [32]byte
	PublicationParentHash [32]byte
	ActivationTxIndex     int
	ActivationMode        string
	SubmissionTxHash      [32]byte
	ActivationTxHash      [32]byte
	SourceDigest          [32]byte
	PublicationIdentity   string
}

// Cursor is the last durably recorded height and its RPC-reported block hash.
type Cursor struct {
	Height int64
	Hash   [32]byte
}

// Store owns Launchpad-only tables inside the caller's existing SQLite DB.
type Store struct {
	db    *sql.DB
	key   string
	scope Scope
}

func validScope(s Scope) bool {
	if s.RealmPath != TokenRealmPath || s.PublicationHeight <= 1 ||
		s.PublicationHash == ([32]byte{}) || s.PublicationParentHash == ([32]byte{}) ||
		s.SubmissionTxHash == ([32]byte{}) || s.ActivationTxHash == ([32]byte{}) ||
		s.SourceDigest == ([32]byte{}) || s.ActivationTxIndex < 0 ||
		(s.ActivationMode != "enable_package" && s.ActivationMode != "add_package") ||
		(s.ActivationMode == "add_package" && s.SubmissionTxHash != s.ActivationTxHash) ||
		(s.ActivationMode == "enable_package" && s.SubmissionTxHash == s.ActivationTxHash) ||
		!printableKey(s.ChainID, 128) ||
		!printableKey(s.PublicationIdentity, 128) {
		return false
	}
	return true
}

func printableKey(s string, max int) bool {
	if len(s) == 0 || len(s) > max {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] <= 0x20 || s[i] >= 0x7f {
			return false
		}
	}
	return true
}

func scopeKey(s Scope) string {
	encoded, _ := json.Marshal(struct {
		ChainID               string
		RealmPath             string
		PublicationHeight     int64
		PublicationHash       [32]byte
		PublicationParentHash [32]byte
		ActivationTxIndex     int
		ActivationMode        string
		SubmissionTxHash      [32]byte
		ActivationTxHash      [32]byte
		SourceDigest          [32]byte
		PublicationIdentity   string
	}{s.ChainID, s.RealmPath, s.PublicationHeight, s.PublicationHash,
		s.PublicationParentHash, s.ActivationTxIndex, s.ActivationMode,
		s.SubmissionTxHash, s.ActivationTxHash, s.SourceDigest, s.PublicationIdentity})
	hash := sha256.Sum256(append([]byte("memba-launchpad-scope-v1\x00"), encoded...))
	return hex.EncodeToString(hash[:])
}

// OpenStore registers or reopens an immutable scope. Call MigrateStore first.
// It never starts polling or serves the stored data to a user.
func OpenStore(ctx context.Context, db *sql.DB, scope Scope) (*Store, error) {
	if db == nil || !validScope(scope) {
		return nil, ErrInvalidScope
	}
	key := scopeKey(scope)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin launchpad scope: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var chainID, realmPath, publicationIdentity, activationMode string
	var publicationHeight int64
	var activationTxIndex int
	var publicationHash, parentHash, submissionHash, activationHash, sourceDigest []byte
	err = tx.QueryRowContext(ctx, `SELECT chain_id, realm_path, publication_height,
		publication_hash, publication_parent_hash, activation_tx_index, activation_mode,
		submission_tx_hash, activation_tx_hash, source_digest, publication_identity
		FROM launchpad_scopes WHERE scope_key = ?`, key).
		Scan(&chainID, &realmPath, &publicationHeight, &publicationHash, &parentHash,
			&activationTxIndex, &activationMode, &submissionHash, &activationHash,
			&sourceDigest, &publicationIdentity)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		_, err = tx.ExecContext(ctx, `INSERT INTO launchpad_scopes
			(scope_key, chain_id, realm_path, publication_height, publication_hash,
			 publication_parent_hash, activation_tx_index, activation_mode,
			 submission_tx_hash, activation_tx_hash, source_digest,
			 publication_identity, cursor_height, cursor_hash)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, key, scope.ChainID, scope.RealmPath,
			scope.PublicationHeight, scope.PublicationHash[:], scope.PublicationParentHash[:],
			scope.ActivationTxIndex, scope.ActivationMode, scope.SubmissionTxHash[:],
			scope.ActivationTxHash[:], scope.SourceDigest[:], scope.PublicationIdentity,
			scope.PublicationHeight-1, scope.PublicationParentHash[:])
		if err != nil {
			return nil, fmt.Errorf("register launchpad scope: %w", err)
		}
	case err != nil:
		return nil, fmt.Errorf("read launchpad scope: %w", err)
	case chainID != scope.ChainID || realmPath != scope.RealmPath ||
		publicationHeight != scope.PublicationHeight ||
		string(publicationHash) != string(scope.PublicationHash[:]) ||
		string(parentHash) != string(scope.PublicationParentHash[:]) ||
		activationTxIndex != scope.ActivationTxIndex || activationMode != scope.ActivationMode ||
		string(submissionHash) != string(scope.SubmissionTxHash[:]) ||
		string(activationHash) != string(scope.ActivationTxHash[:]) ||
		string(sourceDigest) != string(scope.SourceDigest[:]) ||
		publicationIdentity != scope.PublicationIdentity:
		return nil, ErrStoreConflict
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit launchpad scope: %w", err)
	}
	return &Store{db: db, key: key, scope: scope}, nil
}

func (s *Store) Cursor(ctx context.Context) (Cursor, error) {
	if s == nil || s.db == nil {
		return Cursor{}, ErrInvalidScope
	}
	var height int64
	var rawHash []byte
	if err := s.db.QueryRowContext(ctx,
		`SELECT cursor_height, cursor_hash FROM launchpad_scopes WHERE scope_key = ?`, s.key).
		Scan(&height, &rawHash); err != nil {
		return Cursor{}, fmt.Errorf("read launchpad cursor: %w", err)
	}
	if height < s.scope.PublicationHeight-1 || len(rawHash) != 32 {
		return Cursor{}, ErrStoreConflict
	}
	var hash [32]byte
	copy(hash[:], rawHash)
	return Cursor{Height: height, Hash: hash}, nil
}

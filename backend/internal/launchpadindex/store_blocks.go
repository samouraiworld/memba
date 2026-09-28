package launchpadindex

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

var ErrInvalidBlock = errors.New("invalid Launchpad block evidence")

// HashAt returns the stored hash at height in this scope. The verified parent
// anchor is available even though its block predates this journal.
func (s *Store) HashAt(ctx context.Context, height int64) ([32]byte, error) {
	if s == nil || s.db == nil || height < s.scope.PublicationHeight-1 {
		return [32]byte{}, ErrStoreConflict
	}
	if height == s.scope.PublicationHeight-1 {
		return s.scope.PublicationParentHash, nil
	}
	var raw []byte
	if err := s.db.QueryRowContext(ctx, `SELECT hash FROM launchpad_blocks
		WHERE scope_key = ? AND height = ?`, s.key, height).Scan(&raw); err != nil || len(raw) != 32 {
		return [32]byte{}, ErrStoreConflict
	}
	var hash [32]byte
	copy(hash[:], raw)
	return hash, nil
}

// AppendBlock records one confirmed block and its creation events in one
// transaction. Empty blocks are recorded as well, preserving the hash chain.
// The caller must obtain header and events from the same trusted RPC endpoint
// and enforce confirmation depth before calling this method.
func (s *Store) AppendBlock(ctx context.Context, header BlockHeader, events []ObservedCreation) error {
	if s == nil || s.db == nil || header.ChainID != s.scope.ChainID ||
		header.Height < s.scope.PublicationHeight || header.Hash == ([32]byte{}) ||
		header.ParentHash == ([32]byte{}) || header.Time.Unix() <= 0 || header.NumTxs < 0 {
		return ErrInvalidBlock
	}
	if header.Height == s.scope.PublicationHeight {
		if int64(s.scope.ActivationTxIndex) >= header.NumTxs {
			return ErrInvalidBlock
		}
		if header.Hash != s.scope.PublicationHash || header.ParentHash != s.scope.PublicationParentHash {
			return ErrStoreConflict
		}
		// Earlier transactions belong to the pre-activation generation.
		filtered := make([]ObservedCreation, 0, len(events))
		for _, event := range events {
			if event.TxIndex >= s.scope.ActivationTxIndex {
				filtered = append(filtered, event)
			}
		}
		events = filtered
	}
	raw := make([]string, len(events))
	for i, event := range events {
		parsed, err := ParseTokenCreated(TokenRealmPath, TokenCreatedType, event.RawAttributes)
		if err != nil || parsed != event.TokenCreated || event.BlockHeight != header.Height ||
			event.TxIndex < 0 || int64(event.TxIndex) >= header.NumTxs || event.EventIndex < 0 {
			return ErrInvalidBlock
		}
		encoded, err := json.Marshal(event.RawAttributes)
		if err != nil {
			return ErrInvalidBlock
		}
		raw[i] = string(encoded)
		if i > 0 && (events[i-1].TxIndex > event.TxIndex ||
			(events[i-1].TxIndex == event.TxIndex && events[i-1].EventIndex >= event.EventIndex)) {
			return ErrInvalidBlock
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin launchpad block: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	cursor, err := s.cursorTx(ctx, tx)
	if err != nil {
		return err
	}
	if header.Height <= cursor.Height {
		if err := s.compareBlock(ctx, tx, header, events, raw); err != nil {
			return err
		}
		return tx.Commit()
	}
	if header.Height != cursor.Height+1 || header.ParentHash != cursor.Hash {
		return ErrStoreConflict
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO launchpad_blocks
		(scope_key, height, hash, parent_hash, header_time, num_txs) VALUES (?, ?, ?, ?, ?, ?)`,
		s.key, header.Height, header.Hash[:], header.ParentHash[:], header.Time.UTC().Format(time.RFC3339Nano), header.NumTxs); err != nil {
		return fmt.Errorf("record launchpad block: %w", err)
	}
	for i, event := range events {
		if _, err := tx.ExecContext(ctx, `INSERT INTO launchpad_creation_events
			(scope_key, height, tx_index, event_index, token_id, registry_key, grc20_id,
			 creator, mode, ticker, currency_key, raw_attrs_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			s.key, header.Height, event.TxIndex, event.EventIndex, event.ID,
			event.RegistryKey, event.GRC20ID, event.Creator, event.Mode,
			event.Ticker, event.CurrencyKey, raw[i]); err != nil {
			return fmt.Errorf("record launchpad creation: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE launchpad_scopes SET cursor_height = ?, cursor_hash = ?
		WHERE scope_key = ?`, header.Height, header.Hash[:], s.key); err != nil {
		return fmt.Errorf("advance launchpad cursor: %w", err)
	}
	return tx.Commit()
}

func (s *Store) cursorTx(ctx context.Context, tx *sql.Tx) (Cursor, error) {
	var cursor Cursor
	var raw []byte
	if err := tx.QueryRowContext(ctx, `SELECT cursor_height, cursor_hash FROM launchpad_scopes
		WHERE scope_key = ?`, s.key).Scan(&cursor.Height, &raw); err != nil {
		return Cursor{}, fmt.Errorf("read launchpad cursor: %w", err)
	}
	if cursor.Height < s.scope.PublicationHeight-1 || len(raw) != 32 {
		return Cursor{}, ErrStoreConflict
	}
	copy(cursor.Hash[:], raw)
	return cursor, nil
}

func (s *Store) compareBlock(ctx context.Context, tx *sql.Tx, header BlockHeader, events []ObservedCreation, raw []string) error {
	var hash, parent []byte
	var headerTime string
	var numTxs int64
	if err := tx.QueryRowContext(ctx, `SELECT hash, parent_hash, header_time, num_txs FROM launchpad_blocks
		WHERE scope_key = ? AND height = ?`, s.key, header.Height).Scan(&hash, &parent, &headerTime, &numTxs); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrStoreConflict
		}
		return err
	}
	if string(hash) != string(header.Hash[:]) || string(parent) != string(header.ParentHash[:]) ||
		headerTime != header.Time.UTC().Format(time.RFC3339Nano) || numTxs != header.NumTxs {
		return ErrStoreConflict
	}
	rows, err := tx.QueryContext(ctx, `SELECT tx_index, event_index, token_id, registry_key,
		grc20_id, creator, mode, ticker, currency_key, raw_attrs_json
		FROM launchpad_creation_events WHERE scope_key = ? AND height = ?
		ORDER BY tx_index, event_index`, s.key, header.Height)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	i := 0
	for rows.Next() {
		var event ObservedCreation
		var attrs string
		if err := rows.Scan(&event.TxIndex, &event.EventIndex, &event.ID, &event.RegistryKey,
			&event.GRC20ID, &event.Creator, &event.Mode, &event.Ticker, &event.CurrencyKey, &attrs); err != nil {
			return err
		}
		if i >= len(events) || event.TxIndex != events[i].TxIndex ||
			event.EventIndex != events[i].EventIndex || event.TokenCreated != events[i].TokenCreated ||
			attrs != raw[i] {
			return ErrStoreConflict
		}
		i++
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if i != len(events) {
		return ErrStoreConflict
	}
	return nil
}

// RollbackTo removes divergent blocks above an observed common ancestor.
// The publication anchor is immutable, including its hash. A caller must
// establish the ancestor using the same endpoint before continuing to append.
func (s *Store) RollbackTo(ctx context.Context, ancestor Cursor) error {
	if s == nil || s.db == nil || ancestor.Height < s.scope.PublicationHeight-1 ||
		ancestor.Hash == ([32]byte{}) {
		return ErrStoreConflict
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	current, err := s.cursorTx(ctx, tx)
	if err != nil {
		return err
	}
	if ancestor.Height > current.Height {
		return ErrStoreConflict
	}
	var stored [32]byte
	if ancestor.Height == s.scope.PublicationHeight-1 {
		stored = s.scope.PublicationParentHash
	} else {
		var raw []byte
		if err := tx.QueryRowContext(ctx, `SELECT hash FROM launchpad_blocks WHERE scope_key = ? AND height = ?`,
			s.key, ancestor.Height).Scan(&raw); err != nil || len(raw) != 32 {
			return ErrStoreConflict
		}
		copy(stored[:], raw)
	}
	if ancestor.Hash != stored {
		return ErrStoreConflict
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM launchpad_creation_events WHERE scope_key = ? AND height > ?`,
		s.key, ancestor.Height); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM launchpad_blocks WHERE scope_key = ? AND height > ?`,
		s.key, ancestor.Height); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE launchpad_scopes SET cursor_height = ?, cursor_hash = ?
		WHERE scope_key = ?`, ancestor.Height, ancestor.Hash[:], s.key); err != nil {
		return err
	}
	return tx.Commit()
}

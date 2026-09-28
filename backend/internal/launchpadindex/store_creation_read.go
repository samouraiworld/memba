package launchpadindex

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"time"
)

// JournalCreation is a scoped observation, including the chain header time.
// A public caller must separately establish the approval, endpoint and
// confirmation policy for this store, then reconcile identity with TokenJSON.
// Absence is never evidence that a token does not exist on chain.
type JournalCreation struct {
	Scope     Scope
	Cursor    Cursor
	Event     ObservedCreation
	BlockHash [32]byte
	BlockTime time.Time
}

// FindCreation reads an event and its header from one SQLite snapshot. The
// result disappears if a reorg rolls that block back. It does not query chain
// state, start the tailer or serve a public endpoint.
func (s *Store) FindCreation(ctx context.Context, id string) (JournalCreation, bool, error) {
	if s == nil || s.db == nil {
		return JournalCreation{}, false, ErrInvalidScope
	}
	if len(id) < 2 || len(id) > 11 || id[0] != 'T' {
		return JournalCreation{}, false, ErrInvalidTokenCreated
	}
	number, err := strconv.ParseUint(id[1:], 10, 64)
	if err != nil || number == 0 || number > maxTokenNumber || id != "T"+strconv.FormatUint(number, 10) {
		return JournalCreation{}, false, ErrInvalidTokenCreated
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return JournalCreation{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	cursor, err := s.cursorTx(ctx, tx)
	if err != nil {
		return JournalCreation{}, false, err
	}
	var record JournalCreation
	var rawAttrs, headerTime string
	var rawHash []byte
	var numTxs int64
	err = tx.QueryRowContext(ctx, `SELECT height, tx_index, event_index,
		registry_key, grc20_id, creator, mode, ticker, currency_key, raw_attrs_json
		FROM launchpad_creation_events WHERE scope_key = ? AND token_id = ?`, s.key, id).
		Scan(&record.Event.BlockHeight, &record.Event.TxIndex, &record.Event.EventIndex,
			&record.Event.RegistryKey, &record.Event.GRC20ID, &record.Event.Creator,
			&record.Event.Mode, &record.Event.Ticker, &record.Event.CurrencyKey,
			&rawAttrs)
	if errors.Is(err, sql.ErrNoRows) {
		if err := tx.Commit(); err != nil {
			return JournalCreation{}, false, err
		}
		return JournalCreation{Scope: s.scope, Cursor: cursor}, false, nil
	}
	if err != nil {
		return JournalCreation{}, false, err
	}
	if err := tx.QueryRowContext(ctx, `SELECT hash, header_time, num_txs FROM launchpad_blocks
		WHERE scope_key = ? AND height = ?`, s.key, record.Event.BlockHeight).
		Scan(&rawHash, &headerTime, &numTxs); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return JournalCreation{}, false, ErrStoreConflict
		}
		return JournalCreation{}, false, err
	}
	if len(rawHash) != 32 || record.Event.BlockHeight < s.scope.PublicationHeight ||
		record.Event.BlockHeight > cursor.Height ||
		record.Event.TxIndex < 0 || int64(record.Event.TxIndex) >= numTxs ||
		(record.Event.BlockHeight == s.scope.PublicationHeight &&
			record.Event.TxIndex < s.scope.ActivationTxIndex) ||
		record.Event.EventIndex < 0 || numTxs < 0 ||
		bytes.Equal(rawHash, make([]byte, 32)) ||
		(record.Event.BlockHeight == cursor.Height && !bytes.Equal(rawHash, cursor.Hash[:])) {
		return JournalCreation{}, false, ErrStoreConflict
	}
	if err := json.Unmarshal([]byte(rawAttrs), &record.Event.RawAttributes); err != nil {
		return JournalCreation{}, false, ErrStoreConflict
	}
	created, err := ParseTokenCreated(TokenRealmPath, TokenCreatedType, record.Event.RawAttributes)
	record.Event.ID = id
	if err != nil || created != record.Event.TokenCreated {
		return JournalCreation{}, false, ErrStoreConflict
	}
	record.BlockTime, err = time.Parse(time.RFC3339Nano, headerTime)
	if err != nil || record.BlockTime.Unix() <= 0 ||
		record.BlockTime.UTC().Format(time.RFC3339Nano) != headerTime {
		return JournalCreation{}, false, ErrStoreConflict
	}
	copy(record.BlockHash[:], rawHash)
	record.Scope = s.scope
	record.Cursor = cursor
	if err := tx.Commit(); err != nil {
		return JournalCreation{}, false, err
	}
	return record, true, nil
}

package launchpadindex

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"
)

func TestFindCreationReturnsScopedHeaderAndTracksRollback(t *testing.T) {
	ctx := context.Background()
	store, database := testStore(t)
	if err := store.AppendBlock(ctx, testHeader(101, 2, 1), nil); err != nil {
		t.Fatal(err)
	}
	created := testCreation(t, 102, "T1")
	header := testHeader(102, 3, 2)
	if err := store.AppendBlock(ctx, header, []ObservedCreation{created}); err != nil {
		t.Fatal(err)
	}
	record, found, err := store.FindCreation(ctx, "T1")
	if err != nil || !found || record.Scope != store.scope || record.Cursor.Height != 102 ||
		record.BlockHash != header.Hash || !record.BlockTime.Equal(header.Time) ||
		record.Event.TokenCreated != created.TokenCreated ||
		record.Event.BlockHeight != 102 || record.Event.TxIndex != 0 || record.Event.EventIndex != 0 {
		t.Fatalf("wrong journal evidence: %+v found=%v err=%v", record, found, err)
	}
	if len(record.Event.RawAttributes) != 7 {
		t.Fatalf("raw attributes missing: %+v", record.Event.RawAttributes)
	}
	otherScope := testScope("test-13", "publication-b")
	other, err := OpenStore(ctx, database, otherScope)
	if err != nil {
		t.Fatal(err)
	}
	if isolated, found, err := other.FindCreation(ctx, "T1"); err != nil || found ||
		isolated.Scope != otherScope || isolated.Cursor.Height != 100 {
		t.Fatalf("creation crossed publication scope: %+v found=%v err=%v", isolated, found, err)
	}
	if err := store.RollbackTo(ctx, Cursor{Height: 101, Hash: [32]byte{2}}); err != nil {
		t.Fatal(err)
	}
	if absent, found, err := store.FindCreation(ctx, "T1"); err != nil || found || absent.Cursor.Height != 101 {
		t.Fatalf("rolled-back creation still visible: %+v found=%v err=%v", absent, found, err)
	}
	replacement := header
	replacement.Hash = [32]byte{7}
	replacement.Time = header.Time.Add(time.Minute)
	if err := store.AppendBlock(ctx, replacement, []ObservedCreation{created}); err != nil {
		t.Fatal(err)
	}
	if newRecord, found, err := store.FindCreation(ctx, "T1"); err != nil || !found ||
		newRecord.BlockHash != replacement.Hash || !newRecord.BlockTime.Equal(replacement.Time) {
		t.Fatalf("replacement fork not reflected: %+v found=%v err=%v", newRecord, found, err)
	}
}

func TestFindCreationRejectsCorruptJournalEvidence(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name   string
		mutate func(*testing.T, *sql.DB, *Store)
	}{
		{"before publication", func(t *testing.T, db *sql.DB, store *Store) {
			if _, err := db.ExecContext(ctx, `INSERT INTO launchpad_blocks
				(scope_key, height, hash, parent_hash, header_time, num_txs)
				SELECT scope_key, 99, hash, parent_hash, header_time, num_txs
				FROM launchpad_blocks WHERE scope_key = ? AND height = 102`, store.key); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `UPDATE launchpad_creation_events SET height = 99
				WHERE scope_key = ? AND token_id = 'T1'`, store.key); err != nil {
				t.Fatal(err)
			}
		}},
		{"cursor hash mismatch", func(t *testing.T, db *sql.DB, store *Store) {
			if _, err := db.ExecContext(ctx, `UPDATE launchpad_blocks SET hash = ?
				WHERE scope_key = ? AND height = 102`, make([]byte, 32), store.key); err != nil {
				t.Fatal(err)
			}
		}},
		{"invalid block time", func(t *testing.T, db *sql.DB, store *Store) {
			if _, err := db.ExecContext(ctx, `UPDATE launchpad_blocks SET header_time = 'not-a-time'
				WHERE scope_key = ? AND height = 102`, store.key); err != nil {
				t.Fatal(err)
			}
		}},
		{"denormalized identity mismatch", func(t *testing.T, db *sql.DB, store *Store) {
			if _, err := db.ExecContext(ctx, `UPDATE launchpad_creation_events SET creator = 'wrong'
				WHERE scope_key = ? AND token_id = 'T1'`, store.key); err != nil {
				t.Fatal(err)
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store, database := testStore(t)
			if err := store.AppendBlock(ctx, testHeader(101, 2, 1), nil); err != nil {
				t.Fatal(err)
			}
			if err := store.AppendBlock(ctx, testHeader(102, 3, 2),
				[]ObservedCreation{testCreation(t, 102, "T1")}); err != nil {
				t.Fatal(err)
			}
			tc.mutate(t, database, store)
			if _, _, err := store.FindCreation(ctx, "T1"); !errors.Is(err, ErrStoreConflict) {
				t.Fatalf("corrupt %s accepted: %v", tc.name, err)
			}
		})
	}
}

func TestFindCreationRejectsPreActivationEvent(t *testing.T) {
	ctx := context.Background()
	_, database := testStore(t)
	scope := testScope("test-13", "activation-read")
	scope.ActivationTxIndex = 1
	store, err := OpenStore(ctx, database, scope)
	if err != nil {
		t.Fatal(err)
	}
	creation := testCreation(t, 101, "T1")
	creation.TxIndex = 1
	if err := store.AppendBlock(ctx, testHeader(101, 2, 1), []ObservedCreation{creation}); err != nil {
		t.Fatal(err)
	}
	if _, found, err := store.FindCreation(ctx, "T1"); err != nil || !found {
		t.Fatalf("activation-block creation missing: found=%v err=%v", found, err)
	}
	if _, err := database.ExecContext(ctx, `UPDATE launchpad_creation_events SET tx_index = 0
		WHERE scope_key = ? AND token_id = 'T1'`, store.key); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.FindCreation(ctx, "T1"); !errors.Is(err, ErrStoreConflict) {
		t.Fatalf("pre-activation event accepted: %v", err)
	}
}

func TestFindCreationRejectsMalformedIDAndCorruptRawAttributes(t *testing.T) {
	ctx := context.Background()
	store, database := testStore(t)
	for _, id := range []string{"", "t1", "T0", "T01", "T10000000000"} {
		if _, _, err := store.FindCreation(ctx, id); !errors.Is(err, ErrInvalidTokenCreated) {
			t.Fatalf("invalid id %q accepted: %v", id, err)
		}
	}
	if err := store.AppendBlock(ctx, testHeader(101, 2, 1), nil); err != nil {
		t.Fatal(err)
	}
	if err := store.AppendBlock(ctx, testHeader(102, 3, 2), []ObservedCreation{testCreation(t, 102, "T1")}); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, `UPDATE launchpad_creation_events SET raw_attrs_json = '[]'
		WHERE scope_key = ? AND token_id = 'T1'`, store.key); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.FindCreation(ctx, "T1"); !errors.Is(err, ErrStoreConflict) {
		t.Fatalf("corrupt stored attributes accepted: %v", err)
	}
}

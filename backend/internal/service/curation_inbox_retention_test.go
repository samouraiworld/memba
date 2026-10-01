package service

import (
	"bytes"
	"context"
	"database/sql"
	"log/slog"
	"strings"
	"testing"
	"time"
)

// insertCurationRows stores n messages in collection, all at createdAt (Unix
// seconds), with bodies that are not real ciphertext: the sweep never opens one.
func insertCurationRows(t *testing.T, database *sql.DB, collection string, n int, createdAt int64) {
	t.Helper()
	if _, err := database.Exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
		INSERT INTO curation_inbox_messages (chain_id, collection, seq, sender, client_id, created_at, key_id, nonce, body)
		SELECT ?, ?, i, 'g1sender', 'filler-' || i, ?, 'none', x'00', x'00' FROM n`,
		n, curationTestChain, collection, createdAt); err != nil {
		t.Fatal(err)
	}
}

func curationCollectionCount(t *testing.T, database *sql.DB, collection string) int {
	t.Helper()
	var n int
	if err := database.QueryRow(`SELECT COUNT(*) FROM curation_inbox_messages WHERE collection = ?`, collection).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// A message stored more than 12 months ago is deleted; one stored exactly 12
// months ago, or later, is kept.
func TestSweepCurationInbox_Boundary(t *testing.T) {
	database := newTestService(t).db
	now := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	cutoff := now.AddDate(-1, 0, 0).Unix()
	insertCurationRows(t, database, "C1", 1, cutoff-1)          // one second past 12 months
	insertCurationRows(t, database, "C2", 1, cutoff)            // exactly 12 months
	insertCurationRows(t, database, "C3", 1, now.Unix()-86_400) // yesterday

	n, err := sweepCurationInbox(context.Background(), database, now, curationInboxSweepBatch)
	if err != nil || n != 1 {
		t.Fatalf("sweep: deleted %d, err %v; want 1", n, err)
	}
	for collection, want := range map[string]int{"C1": 0, "C2": 1, "C3": 1} {
		if got := curationCollectionCount(t, database, collection); got != want {
			t.Errorf("%s: %d rows left, want %d", collection, got, want)
		}
	}
}

// Twelve months are calendar months: across a 29 February, a message stored
// more than 365 days ago can still be less than 12 months old, and is kept.
func TestSweepCurationInbox_CalendarYear(t *testing.T) {
	database := newTestService(t).db
	now := time.Date(2028, 3, 1, 12, 0, 0, 0, time.UTC)
	// 365 days and 18 hours before now, yet 6 hours short of 12 months: a
	// 365-day rule would already delete it.
	insertCurationRows(t, database, "C1", 1, time.Date(2027, 3, 1, 18, 0, 0, 0, time.UTC).Unix())
	insertCurationRows(t, database, "C2", 1, time.Date(2027, 3, 1, 11, 0, 0, 0, time.UTC).Unix())
	if n, err := sweepCurationInbox(context.Background(), database, now, curationInboxSweepBatch); err != nil || n != 1 {
		t.Fatalf("sweep: deleted %d, err %v; want 1", n, err)
	}
	if curationCollectionCount(t, database, "C1") != 1 || curationCollectionCount(t, database, "C2") != 0 {
		t.Fatal("12 months were not counted in calendar months")
	}
}

// One statement deletes at most a batch; a sweep runs batches until every
// expired message is gone.
func TestSweepCurationInbox_Batches(t *testing.T) {
	database := newTestService(t).db
	now := time.Now()
	old := now.Add(-400 * 24 * time.Hour).Unix()
	insertCurationRows(t, database, "C1", 5, old)
	insertCurationRows(t, database, "C2", 3, now.Unix())

	res, err := database.Exec(curationInboxExpiredDelete, curationInboxCutoff(now), 2)
	if err != nil {
		t.Fatal(err)
	}
	if n, _ := res.RowsAffected(); n != 2 {
		t.Fatalf("one statement deleted %d rows, want a batch of 2", n)
	}
	n, err := sweepCurationInbox(context.Background(), database, now, 2)
	if err != nil || n != 3 {
		t.Fatalf("sweep in batches of 2: deleted %d, err %v; want the 3 expired rows left", n, err)
	}
	if c1, c2 := curationCollectionCount(t, database, "C1"), curationCollectionCount(t, database, "C2"); c1 != 0 || c2 != 3 {
		t.Fatalf("rows left: C1 %d, C2 %d; want 0 and 3", c1, c2)
	}
}

// The sweep deletes curation inbox messages only, however old other rows are.
func TestSweepCurationInbox_OtherTablesUntouched(t *testing.T) {
	database := newTestService(t).db
	now := time.Now()
	old := now.Add(-400 * 24 * time.Hour)
	insertCurationRows(t, database, "C1", 1, old.Unix())
	if _, err := database.Exec(`INSERT INTO analyst_reports (realm_path, analysis_type, proposal_id, chain_id, input_digest, consensus, expires_at, created_at)
		VALUES ('gno.land/r/x', 'proposal', 1, ?, 'd', '{}', ?, ?)`, curationTestChain, old.UTC(), old.UTC()); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`INSERT INTO analyst_usage (address, day, count) VALUES ('g1sender', ?, 1)`, old.UTC().Format("2006-01-02")); err != nil {
		t.Fatal(err)
	}

	if n, err := sweepCurationInbox(context.Background(), database, now, curationInboxSweepBatch); err != nil || n != 1 {
		t.Fatalf("sweep: deleted %d, err %v; want 1", n, err)
	}
	for _, table := range []string{"analyst_reports", "analyst_usage"} {
		var n int
		if err := database.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Errorf("%s: %d rows, want the 1 inserted", table, n)
		}
	}
}

// Each batch finds its rows through the created_at index, not a table scan.
func TestSweepCurationInbox_UsesCreatedAtIndex(t *testing.T) {
	database := newTestService(t).db
	rows, err := database.Query("EXPLAIN QUERY PLAN "+curationInboxExpiredDelete, 0, curationInboxSweepBatch)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()
	var plan strings.Builder
	for rows.Next() {
		var id, parent, notused int
		var detail string
		if err := rows.Scan(&id, &parent, &notused, &detail); err != nil {
			t.Fatal(err)
		}
		plan.WriteString(detail + "\n")
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(plan.String(), "idx_curation_inbox_created_at (created_at<?)") {
		t.Fatalf("expired rows are not found through idx_curation_inbox_created_at:\n%s", plan.String())
	}
}

// The sweep runs at start, then on its ticker; a run that deleted something
// logs the count and no message content; the loop stops with its context.
func TestStartCurationInboxSweep(t *testing.T) {
	database := newTestService(t).db
	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	old := time.Now().Add(-400 * 24 * time.Hour).Unix()
	insertCurationRows(t, database, "C1", 2, old)

	ctx, cancel := context.WithCancel(context.Background())
	done := StartCurationInboxSweep(ctx, database, 20*time.Millisecond)
	waitForCurationCount := func(what string) {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for curationCollectionCount(t, database, "C1") != 0 {
			if time.Now().After(deadline) {
				t.Fatalf("%s did not delete the expired messages", what)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	waitForCurationCount("the run at start")
	insertCurationRows(t, database, "C1", 1, old)
	waitForCurationCount("a ticker run")

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the sweep loop did not stop after cancel")
	}
	got := logs.String()
	if !strings.Contains(got, "count=2") || !strings.Contains(got, "count=1") ||
		strings.Count(got, "curation inbox retention: deleted messages older than 12 months") != 2 {
		t.Fatalf("want one line per run that deleted, with its count:\n%s", got)
	}
	for _, leak := range []string{"filler-", "g1sender", "C1"} {
		if strings.Contains(got, leak) {
			t.Fatalf("the log names %q:\n%s", leak, got)
		}
	}
}

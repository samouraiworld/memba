package service

import (
	"context"
	"database/sql"
	"log/slog"
	"time"
)

// curationInboxSweepBatch bounds the rows one DELETE removes, so a sweep
// releases the write lock between batches.
const curationInboxSweepBatch = 500

// curationInboxCutoff is the storage time (Unix seconds) before which a
// message is deleted: 12 calendar months before now, so a year that holds
// 29 February keeps its messages as long as any other.
func curationInboxCutoff(now time.Time) int64 { return now.AddDate(-1, 0, 0).Unix() }

// curationInboxExpiredDelete removes up to a batch (second argument) of the
// messages stored before a cutoff (first argument, Unix seconds). The inner
// SELECT is answered by idx_curation_inbox_created_at.
const curationInboxExpiredDelete = `DELETE FROM curation_inbox_messages WHERE rowid IN
	(SELECT rowid FROM curation_inbox_messages WHERE created_at < ? LIMIT ?)`

// sweepCurationInbox deletes every curation inbox message stored more than
// 12 months before now (one exactly 12 months old is kept), on every chain, at
// most batch rows per statement, and returns how many it deleted. Messages
// are the inbox's only rows: a thread whose messages all expired leaves
// nothing behind, and its next message is seq 1 again.
func sweepCurationInbox(ctx context.Context, db *sql.DB, now time.Time, batch int) (int64, error) {
	cutoff := curationInboxCutoff(now)
	var total int64
	for {
		res, err := db.ExecContext(ctx, curationInboxExpiredDelete, cutoff, batch)
		if err != nil {
			return total, err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return total, err
		}
		total += n
		if n < int64(batch) {
			return total, nil
		}
	}
}

// StartCurationInboxSweep runs the curation inbox retention sweep at once,
// then every interval, until ctx is done. A run that deleted messages logs
// their count, nothing else. The returned channel is closed when the loop
// exits.
func StartCurationInboxSweep(ctx context.Context, db *sql.DB, every time.Duration) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		defer close(done)
		sweep := func() {
			n, err := sweepCurationInbox(ctx, db, time.Now(), curationInboxSweepBatch)
			if err != nil && ctx.Err() == nil {
				slog.Warn("curation inbox retention sweep failed", "count", n, "error", err)
			} else if n > 0 {
				slog.Info("curation inbox retention: deleted messages older than 12 months", "count", n)
			}
		}
		sweep()
		ticker := time.NewTicker(every)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				sweep()
			}
		}
	}()
	return done
}

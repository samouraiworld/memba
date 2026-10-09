package activitywatch

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/samouraiworld/memba/backend/internal/metrics"
)

const confirmations int64 = 5
const maxBlocks = 50
const maxDeliveries = 20

var errBacklog = errors.New("activity deliveries pending")

type Watcher struct {
	cfg     Config
	db      *sql.DB
	client  *http.Client
	now     func() time.Time
	pause   func(context.Context, time.Duration) error
	retryAt time.Time
}

func New(db *sql.DB, cfg Config) (*Watcher, error) {
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	if db == nil {
		return nil, errors.New("activity watcher needs persistent storage")
	}
	return &Watcher{cfg: cfg, db: db, client: &http.Client{Timeout: 15 * time.Second,
		// Never follow a redirect carrying a webhook credential or payload.
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}, now: time.Now, pause: pause}, nil
}

// Start is opt-in, independent of the solvency watcher, sharing its destination.
func Start(ctx context.Context, db *sql.DB, getenv func(string) string) bool {
	if getenv("MEMBA_ACTIVITY_WATCH_ENABLED") != "1" {
		return false
	}
	metrics.ActivityWatchEnabled.Set(1)
	w, err := New(db, ConfigFromEnv(getenv))
	if err != nil {
		slog.Error("activity watcher not started", "error", err)
		return false
	}
	go w.Run(ctx)
	return true
}

func pause(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func (w *Watcher) Run(ctx context.Context) {
	slog.Info("activity watcher started", "chain", w.cfg.ChainID, "realms", w.cfg.Realms, "confirmations", confirmations)
	for {
		if err := w.cycle(ctx); err != nil && !errors.Is(err, errBacklog) && ctx.Err() == nil {
			slog.Warn("activity watcher cycle failed", "error", err)
		}
		if w.pause(ctx, 15*time.Second) != nil {
			return
		}
	}
}

func (w *Watcher) cycle(ctx context.Context) (err error) {
	// A malformed external response must not take the API down.
	defer func() {
		if recover() != nil {
			err = errors.New("activity watcher cycle panicked; cursor retained")
		}
	}()
	defer w.queueMetrics(ctx)
	head, err := w.head(ctx)
	if err != nil {
		return err
	}
	end := head - confirmations
	var height, heartbeat int64
	var hash string
	err = w.db.QueryRowContext(ctx, `SELECT height,block_hash,heartbeat_at FROM activity_watch_state WHERE chain_id=?`, w.cfg.ChainID).Scan(&height, &hash, &heartbeat)
	if errors.Is(err, sql.ErrNoRows) {
		// First boot starts at the confirmed tip, avoiding a historical flood.
		b, e := w.block(ctx, end)
		if e != nil {
			return e
		}
		if e = w.initialize(ctx, end, b.BlockMeta.BlockID.Hash); e != nil {
			return e
		}
		height, hash, heartbeat = end, b.BlockMeta.BlockID.Hash, w.now().Unix()
		metrics.ActivityWatchProgress.Set(float64(w.now().Unix()))
	} else if err != nil {
		return err
	}
	if height > end {
		return errors.New("activity node behind saved cursor")
	}
	prev, err := w.block(ctx, height)
	if err != nil {
		return err
	}
	if prev.BlockMeta.BlockID.Hash != hash {
		return errors.New("confirmed activity block changed; halted for operator reconciliation")
	}
	budget := maxDeliveries
	if err = w.drain(ctx, &budget); err != nil {
		return err
	}
	for n := 0; height < end && n < maxBlocks; n++ {
		next := height + 1
		b, e := w.block(ctx, next)
		if e != nil {
			return e
		}
		if b.Block.Header.LastBlockID.Hash != hash {
			return errors.New("activity block continuity mismatch")
		}
		var messages []string
		if len(b.Block.Data.Txs) > 0 {
			var r results
			if e = w.rpc(ctx, "block_results", map[string]string{"height": strconv.FormatInt(next, 10)}, &r); e != nil {
				return e
			}
			if r.Height != strconv.FormatInt(next, 10) || r.Results == nil || len(r.Results.DeliverTx) != len(b.Block.Data.Txs) {
				return errors.New("activity receipt height/count mismatch")
			}
			for i, raw := range b.Block.Data.Txs {
				m, e := w.messages(next, raw, r.Results.DeliverTx[i])
				if e != nil {
					return e
				}
				messages = append(messages, m...)
			}
			// Results do not carry a hash; check that the block did not change.
			again, e := w.block(ctx, next)
			if e != nil {
				return e
			}
			if again.BlockMeta.BlockID.Hash != b.BlockMeta.BlockID.Hash {
				return errors.New("activity block changed while reading results")
			}
		}
		if e = w.saveBlock(ctx, next, b.BlockMeta.BlockID.Hash, messages); e != nil {
			return e
		}
		height, hash = next, b.BlockMeta.BlockID.Hash
		// Use chain time: catching up old blocks must not look current.
		metrics.ActivityWatchProgress.Set(float64(b.Block.Header.Time.Unix()))
		if e = w.drain(ctx, &budget); e != nil {
			return e
		}
	}
	if height == end && w.now().Unix()-heartbeat >= 86400 {
		if err = w.heartbeat(ctx, height, hash); err != nil {
			return err
		}
		return w.drain(ctx, &budget)
	}
	return nil
}

func (w *Watcher) initialize(ctx context.Context, height int64, hash string) error {
	tx, err := w.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	_, err = tx.ExecContext(ctx, `INSERT INTO activity_watch_state(chain_id,height,block_hash,heartbeat_at) VALUES(?,?,?,?)`, w.cfg.ChainID, height, hash, w.now().Unix())
	if err != nil {
		return err
	}
	scope := strings.Join(w.cfg.Realms, ", ")
	if len(scope) > 1000 {
		scope = scope[:1000] + "..."
	}
	content := fmt.Sprintf("**Memba activity watcher enabled**\n%s · starting after confirmed block %d\nWatching: `%s`\nCalls, package changes and emitted events; 5 confirmations. Launchpad financial alerts continue in this channel. Daily heartbeat; no historical replay. Arguments and post contents are omitted.", w.cfg.ChainID, height, scope)
	if err = w.enqueue(ctx, tx, height, hash, content); err != nil {
		return err
	}
	return tx.Commit()
}

func (w *Watcher) enqueue(ctx context.Context, tx *sql.Tx, height int64, hash, content string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO activity_watch_outbox(chain_id,height,block_hash,content,created_at) VALUES(?,?,?,?,?)`, w.cfg.ChainID, height, hash, content, w.now().Unix())
	return err
}

func (w *Watcher) saveBlock(ctx context.Context, height int64, hash string, messages []string) error {
	tx, err := w.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for _, m := range messages {
		if err = w.enqueue(ctx, tx, height, hash, m); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE activity_watch_state SET height=?,block_hash=? WHERE chain_id=?`, height, hash, w.cfg.ChainID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (w *Watcher) heartbeat(ctx context.Context, height int64, hash string) error {
	tx, err := w.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	content := fmt.Sprintf("**Memba watcher heartbeat**\n%s · activity processed through confirmed block %d · delivery queue caught up.\nWatching %d configured realm selector(s). Launchpad solvency alerts remain separate messages in this channel.", w.cfg.ChainID, height, len(w.cfg.Realms))
	if err = w.enqueue(ctx, tx, height, hash, content); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE activity_watch_state SET heartbeat_at=? WHERE chain_id=?`, w.now().Unix(), w.cfg.ChainID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (w *Watcher) drain(ctx context.Context, budget *int) error {
	if w.now().Before(w.retryAt) {
		return errBacklog
	}
	for {
		var id, height int64
		var hash, content string
		err := w.db.QueryRowContext(ctx, `SELECT id,height,block_hash,content FROM activity_watch_outbox WHERE chain_id=? ORDER BY id LIMIT 1`, w.cfg.ChainID).Scan(&id, &height, &hash, &content)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if *budget <= 0 {
			return errBacklog
		}
		b, err := w.block(ctx, height)
		if err != nil {
			return err
		}
		if b.BlockMeta.BlockID.Hash != hash {
			return errors.New("queued activity block changed; delivery halted")
		}
		if err = w.send(ctx, content); err != nil {
			return err
		}
		// At-least-once: a crash after Discord accepts but before this delete can
		// repeat a message. The transaction link/block identifies duplicates.
		if _, err = w.db.ExecContext(ctx, `DELETE FROM activity_watch_outbox WHERE id=? AND chain_id=?`, id, w.cfg.ChainID); err != nil {
			return err
		}
		*budget--
		if err = w.pause(ctx, 500*time.Millisecond); err != nil {
			return err
		}
	}
}

func (w *Watcher) queueMetrics(ctx context.Context) {
	var count int
	var oldest int64
	if w.db.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(MIN(created_at),0) FROM activity_watch_outbox WHERE chain_id=?`, w.cfg.ChainID).Scan(&count, &oldest) == nil {
		metrics.ActivityWatchPending.Set(float64(count))
		metrics.ActivityWatchOldest.Set(float64(oldest))
	}
}

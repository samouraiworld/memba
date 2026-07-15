package indexer

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
)

// dispatchFeedEvent applies one normalized memba_feed_v1 GnoEvent to the feed
// projection. Writes are idempotent: PostCreated INSERT OR IGNOREs on the post
// id (the realm's monotonic key), and every mutating event is an UPDATE that
// re-applying leaves unchanged. Unknown event types are ignored. Returns an
// error only on a real DB failure; a malformed (but well-typed) event is
// logged and skipped so one bad row never stalls the tail.
//
// The raw ledger row is written first (immutable source of truth), then the
// projection — a projection failure is recoverable by rebuild-from-raw.
func dispatchFeedEvent(ctx context.Context, db *sql.DB, ev GnoEvent, blockHash string, blockTime int64) error {
	if err := recordFeedRawEvent(ctx, db, ev, blockHash); err != nil {
		return err
	}

	switch ev.Type {
	case "PostCreated":
		return applyFeedPostCreated(ctx, db, ev, blockTime)
	case "PostEdited":
		return applyFeedPostEdited(ctx, db, ev)
	case "PostDeleted":
		return applyFeedPostDeleted(ctx, db, ev)
	case "PostAutoHidden":
		return applyFeedPostHiddenFlag(ctx, db, ev, true)
	case "PostFlagged":
		return applyFeedPostFlagged(ctx, db, ev)
	case "ModAction":
		return applyFeedModAction(ctx, db, ev)
	case "ReactionAdded":
		return applyFeedReactionAdded(ctx, db, ev)
	case "ReactionRemoved":
		return applyFeedReactionRemoved(ctx, db, ev)
	default:
		// OwnershipTransferred / RealmPaused / TombstonesSwept etc. — no
		// projection impact.
		return nil
	}
}

// recordFeedRawEvent writes the immutable raw-ledger row. Idempotent on the
// event position tuple; the full attr map is stored as JSON so no field is
// lost to a lossy projection column.
func recordFeedRawEvent(ctx context.Context, db *sql.DB, ev GnoEvent, blockHash string) error {
	attrs, err := json.Marshal(ev.Attrs)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `
		INSERT OR IGNORE INTO feed_raw_events
			(event_block, event_tx_index, event_index, pkg_path, event_name,
			 attrs_json, block_hash, ingest_ts)
		VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
		ev.Block, ev.TxIndex, ev.EventIdx, ev.PkgPath, ev.Type,
		string(attrs), blockHash,
	)
	return err
}

// postID parses the required "postId" attribute. ok=false → malformed event.
func postID(ev GnoEvent) (int64, bool) {
	return atoiStrict(ev.Attr("postId"))
}

func applyFeedPostCreated(ctx context.Context, db *sql.DB, ev GnoEvent, blockTime int64) error {
	id, ok := postID(ev)
	author := ev.Attr("author")
	if !ok || author == "" {
		slog.Warn("feed indexer: skipping malformed PostCreated",
			"block", ev.Block, "tx", ev.TxIndex, "idx", ev.EventIdx, "hasAuthor", author != "")
		return nil
	}
	// replyTo is optional (0 = top-level); atoiSafe is fine here.
	replyTo := atoiSafe(ev.Attr("replyTo"))
	_, err := db.ExecContext(ctx, `
		INSERT OR IGNORE INTO feed_posts
			(post_id, author, body, reply_to, block_h, block_ts, created_event_block, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		id, author, ev.Attr("body"), replyTo, ev.Block, blockTime, ev.Block,
	)
	return err
}

func applyFeedPostEdited(ctx context.Context, db *sql.DB, ev GnoEvent) error {
	id, ok := postID(ev)
	if !ok {
		return nil
	}
	// Do not resurrect deleted posts; only edit live ones.
	_, err := db.ExecContext(ctx, `
		UPDATE feed_posts SET body = ?, edited_at = ?, updated_at = CURRENT_TIMESTAMP
		WHERE post_id = ? AND deleted = 0`,
		ev.Attr("body"), ev.Block, id,
	)
	return err
}

func applyFeedPostDeleted(ctx context.Context, db *sql.DB, ev GnoEvent) error {
	id, ok := postID(ev)
	if !ok {
		return nil
	}
	_, err := db.ExecContext(ctx, `
		UPDATE feed_posts SET deleted = 1, body = '', updated_at = CURRENT_TIMESTAMP
		WHERE post_id = ?`, id)
	return err
}

// applyFeedPostHiddenFlag sets/clears the hidden flag (auto-hide or mod hide).
func applyFeedPostHiddenFlag(ctx context.Context, db *sql.DB, ev GnoEvent, hidden bool) error {
	id, ok := postID(ev)
	if !ok {
		return nil
	}
	h := 0
	if hidden {
		h = 1
	}
	_, err := db.ExecContext(ctx, `
		UPDATE feed_posts SET hidden = ?, updated_at = CURRENT_TIMESTAMP
		WHERE post_id = ?`, h, id)
	return err
}

func applyFeedPostFlagged(ctx context.Context, db *sql.DB, ev GnoEvent) error {
	id, ok := postID(ev)
	if !ok {
		return nil
	}
	count := atoiSafe(ev.Attr("flagCount"))
	if _, err := db.ExecContext(ctx, `
		UPDATE feed_posts SET flag_count = ?, updated_at = CURRENT_TIMESTAMP
		WHERE post_id = ?`, count, id); err != nil {
		return err
	}
	// Project the flagger address (C.1). memba_feed_v1 emits it in every
	// PostFlagged ("flagger", caller); a malformed / older event may omit it —
	// skip those (the aggregate count above is still applied). One row per
	// (post, flagger) mirrors the realm's flag tree, so INSERT OR IGNORE makes
	// re-processing the tail idempotent.
	if flagger := ev.Attr("flagger"); flagger != "" {
		if _, err := db.ExecContext(ctx, `
			INSERT OR IGNORE INTO feed_flags (post_id, flagger_addr, event_block)
			VALUES (?, ?, ?)`, id, flagger, ev.Block); err != nil {
			return err
		}
	}
	return nil
}

// applyFeedReactionAdded records one (post, emoji, reactor) reaction. Idempotent
// (INSERT OR IGNORE on the composite key) so re-processing the tail is safe; the
// realm already enforces one-per-emoji, so a duplicate here is only a replay.
func applyFeedReactionAdded(ctx context.Context, db *sql.DB, ev GnoEvent) error {
	id, ok := postID(ev)
	emoji := ev.Attr("emoji")
	by := ev.Attr("by")
	if !ok || emoji == "" || by == "" {
		slog.Warn("feed indexer: skipping malformed ReactionAdded",
			"block", ev.Block, "tx", ev.TxIndex, "idx", ev.EventIdx, "hasEmoji", emoji != "", "hasBy", by != "")
		return nil
	}
	_, err := db.ExecContext(ctx, `
		INSERT OR IGNORE INTO feed_reactions (post_id, emoji, reactor, event_block)
		VALUES (?, ?, ?, ?)`, id, emoji, by, ev.Block)
	return err
}

// applyFeedReactionRemoved deletes the (post, emoji, reactor) reaction (the
// toggle-off). Idempotent: deleting an absent row is a no-op.
func applyFeedReactionRemoved(ctx context.Context, db *sql.DB, ev GnoEvent) error {
	id, ok := postID(ev)
	emoji := ev.Attr("emoji")
	by := ev.Attr("by")
	if !ok || emoji == "" || by == "" {
		return nil
	}
	_, err := db.ExecContext(ctx, `
		DELETE FROM feed_reactions WHERE post_id = ? AND emoji = ? AND reactor = ?`, id, emoji, by)
	return err
}

// applyFeedModAction handles the moderation events: remove (delete+hide) and
// unhide (clear hidden + flag count).
func applyFeedModAction(ctx context.Context, db *sql.DB, ev GnoEvent) error {
	id, ok := postID(ev)
	if !ok {
		return nil
	}
	switch ev.Attr("action") {
	case "remove":
		_, err := db.ExecContext(ctx, `
			UPDATE feed_posts SET deleted = 1, hidden = 1, body = '', updated_at = CURRENT_TIMESTAMP
			WHERE post_id = ?`, id)
		return err
	case "unhide":
		_, err := db.ExecContext(ctx, `
			UPDATE feed_posts SET hidden = 0, flag_count = 0, updated_at = CURRENT_TIMESTAMP
			WHERE post_id = ? AND deleted = 0`, id)
		return err
	default:
		return nil
	}
}

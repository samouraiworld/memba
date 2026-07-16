package service

import (
	"context"
	"encoding/json"
	"strconv"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// GetModerationLog returns the feed's moderation events — flags, auto-hides, and
// moderator removes/unhides — newest-first, as a BODY-FREE audit trail (ids +
// reasons only, never post bodies). Public read: the events are already public
// on-chain, and by carrying no body the log can never re-expose removed content.
// Keyset-paginated on the raw ledger's rowid, a stable monotonic insertion order
// that a rebuild-from-raw reproduces in the same sequence.
func (s *MultisigService) GetModerationLog(ctx context.Context, req *connect.Request[membav1.GetModerationLogRequest]) (*connect.Response[membav1.GetModerationLogResponse], error) {
	limit := feedLimit(req.Msg.Limit)
	cursor := req.Msg.Cursor

	q := `
		SELECT rowid, event_name, attrs_json, event_block
		FROM feed_raw_events
		WHERE event_name IN ('PostFlagged', 'PostAutoHidden', 'ModAction')`
	args := []any{}
	if cursor != 0 {
		q += ` AND rowid < ?`
		args = append(args, cursor)
	}
	q += ` ORDER BY rowid DESC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, internalError("GetModerationLog", err)
	}
	defer func() { _ = rows.Close() }()

	entries := []*membav1.ModerationLogEntry{}
	var lastSeq uint64
	rowCount := 0
	for rows.Next() {
		var seq, block int64
		var name, attrs string
		if err := rows.Scan(&seq, &name, &attrs, &block); err != nil {
			return nil, internalError("GetModerationLog/scan", err)
		}
		rowCount++
		lastSeq = uint64(seq)
		m := map[string]string{}
		_ = json.Unmarshal([]byte(attrs), &m)
		entry := moderationEntryFrom(name, m)
		if entry == nil {
			continue // a non-moderation ModAction variant (e.g. a future action)
		}
		entry.Seq = uint64(seq)
		entry.BlockH = block
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, internalError("GetModerationLog/rows", err)
	}

	// Advance the cursor when the QUERY filled the page — keying on rows scanned,
	// not mapped entries, so a page thinned by skipped non-moderation ModAction
	// variants still pages on (the cursor is the last rowid, so nothing is
	// revisited or skipped). next=0 only once a page comes back short.
	var next uint64
	if rowCount == int(limit) {
		next = lastSeq
	}

	return connect.NewResponse(&membav1.GetModerationLogResponse{
		Entries:    entries,
		NextCursor: next,
	}), nil
}

// moderationEntryFrom builds the body-free log entry for a raw event, or nil for
// a non-moderation ModAction variant. post_id / actor come from the event attrs;
// the post body is deliberately never read.
func moderationEntryFrom(name string, attrs map[string]string) *membav1.ModerationLogEntry {
	postID, _ := strconv.ParseUint(attrs["postId"], 10, 64)
	switch name {
	case "PostFlagged":
		return &membav1.ModerationLogEntry{PostId: postID, Action: "flagged", Actor: attrs["flagger"]}
	case "PostAutoHidden":
		return &membav1.ModerationLogEntry{PostId: postID, Action: "auto_hidden"}
	case "ModAction":
		switch attrs["action"] {
		case "remove":
			return &membav1.ModerationLogEntry{PostId: postID, Action: "mod_removed", Actor: attrs["moderator"]}
		case "unhide":
			return &membav1.ModerationLogEntry{PostId: postID, Action: "mod_unhidden", Actor: attrs["moderator"]}
		}
	}
	return nil
}

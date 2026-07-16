package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// seedRawEvent inserts one raw feed event (the immutable ledger the moderation
// log reads from).
func seedRawEvent(t *testing.T, s *MultisigService, block, tx, idx int64, name string, attrs map[string]string) {
	t.Helper()
	b, _ := json.Marshal(attrs)
	if _, err := s.db.ExecContext(context.Background(), `
		INSERT INTO feed_raw_events (event_block, event_tx_index, event_index, pkg_path, event_name, attrs_json, block_hash, ingest_ts)
		VALUES (?, ?, ?, 'gno.land/r/samcrew/memba_feed_v1', ?, ?, 'h', CURRENT_TIMESTAMP)`,
		block, tx, idx, name, string(b)); err != nil {
		t.Fatal(err)
	}
}

func TestGetModerationLog_MapsEventsBodyFree(t *testing.T) {
	s := newTestService(t)
	// A mix of moderation events + noise; PostCreated carries a body that must
	// NEVER surface in the log, ReactionAdded is not a moderation event.
	seedRawEvent(t, s, 300, 0, 0, "PostCreated", map[string]string{"postId": "1", "author": "g1a", "body": "SECRET-BODY"})
	seedRawEvent(t, s, 301, 0, 0, "PostFlagged", map[string]string{"postId": "1", "flagger": "g1bob", "flagCount": "1"})
	seedRawEvent(t, s, 302, 0, 0, "PostAutoHidden", map[string]string{"postId": "1"})
	seedRawEvent(t, s, 303, 0, 0, "ModAction", map[string]string{"postId": "1", "action": "remove", "moderator": "g1owner"})
	seedRawEvent(t, s, 304, 0, 0, "ModAction", map[string]string{"postId": "1", "action": "unhide", "moderator": "g1owner"})
	seedRawEvent(t, s, 305, 0, 0, "ReactionAdded", map[string]string{"postId": "1", "emoji": "x", "by": "g1x"})
	// An unknown ModAction variant must be skipped (not surfaced as a blank row).
	seedRawEvent(t, s, 306, 0, 0, "ModAction", map[string]string{"postId": "1", "action": "future_thing"})

	resp, err := s.GetModerationLog(context.Background(), connect.NewRequest(&membav1.GetModerationLogRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	entries := resp.Msg.Entries
	if len(entries) != 4 {
		t.Fatalf("want 4 moderation entries (flagged/auto_hidden/mod_removed/mod_unhidden), got %d", len(entries))
	}
	// Newest-first (highest raw rowid first).
	if entries[0].Action != "mod_unhidden" || entries[0].Actor != "g1owner" || entries[0].BlockH != 304 {
		t.Fatalf("newest entry = %+v, want mod_unhidden by g1owner at block 304", entries[0])
	}
	if entries[3].Action != "flagged" || entries[3].Actor != "g1bob" || entries[3].PostId != 1 {
		t.Fatalf("oldest entry = %+v, want flagged by g1bob on post 1", entries[3])
	}
	// P0 leak-safety: no post body appears anywhere in the serialized log.
	blob, _ := json.Marshal(entries)
	if strings.Contains(string(blob), "SECRET-BODY") {
		t.Fatal("moderation log must never carry a post body")
	}
}

func TestGetModerationLog_Paginates(t *testing.T) {
	s := newTestService(t)
	for i := int64(0); i < 5; i++ {
		seedRawEvent(t, s, 300+i, 0, 0, "PostFlagged", map[string]string{"postId": "1", "flagger": "g1a", "flagCount": "1"})
	}
	p1, err := s.GetModerationLog(context.Background(), connect.NewRequest(&membav1.GetModerationLogRequest{Limit: 2}))
	if err != nil {
		t.Fatal(err)
	}
	if len(p1.Msg.Entries) != 2 || p1.Msg.NextCursor == 0 {
		t.Fatalf("page1 got %d entries, cursor %d (want 2 + non-zero cursor)", len(p1.Msg.Entries), p1.Msg.NextCursor)
	}
	p2, err := s.GetModerationLog(context.Background(), connect.NewRequest(&membav1.GetModerationLogRequest{Limit: 2, Cursor: p1.Msg.NextCursor}))
	if err != nil {
		t.Fatal(err)
	}
	if len(p2.Msg.Entries) != 2 {
		t.Fatalf("page2 got %d entries", len(p2.Msg.Entries))
	}
	// Strictly older: page2's newest seq is below page1's oldest seq.
	if p2.Msg.Entries[0].Seq >= p1.Msg.Entries[len(p1.Msg.Entries)-1].Seq {
		t.Fatal("page2 must be strictly older (smaller seq) than page1's last")
	}
}

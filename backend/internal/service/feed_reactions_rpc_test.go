package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

func TestGetPostReactions(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	ins := func(pid int64, emoji, reactor string) {
		if _, err := h.db.Exec(
			`INSERT INTO feed_reactions (post_id, emoji, reactor, event_block) VALUES (?, ?, ?, 1)`,
			pid, emoji, reactor); err != nil {
			t.Fatal(err)
		}
	}
	// post 1: 👍×2 (bob, carol), ❤️×1 (bob). post 2: 🔥×1 (dave). post 3: none.
	ins(1, "👍", "g1bob")
	ins(1, "👍", "g1carol")
	ins(1, "❤️", "g1bob")
	ins(2, "🔥", "g1dave")

	resp, err := h.svc.GetPostReactions(ctx, connect.NewRequest(&membav1.GetPostReactionsRequest{
		PostIds: []uint64{1, 2, 3},
		Viewer:  "g1bob",
	}))
	if err != nil {
		t.Fatal(err)
	}

	byPost := map[uint64]map[string]*membav1.EmojiCount{}
	for _, p := range resp.Msg.Posts {
		m := map[string]*membav1.EmojiCount{}
		for _, e := range p.Reactions {
			m[e.Emoji] = e
		}
		byPost[p.PostId] = m
	}

	// post 1 counts + viewer (bob reacted 👍 and ❤️).
	if got := byPost[1]["👍"]; got == nil || got.Count != 2 || !got.ViewerReacted {
		t.Fatalf("post1 👍: %+v (want count=2, viewerReacted=true)", got)
	}
	if got := byPost[1]["❤️"]; got == nil || got.Count != 1 || !got.ViewerReacted {
		t.Fatalf("post1 ❤️: %+v (want count=1, viewerReacted=true)", got)
	}
	// post 2: bob did NOT react 🔥.
	if got := byPost[2]["🔥"]; got == nil || got.Count != 1 || got.ViewerReacted {
		t.Fatalf("post2 🔥: %+v (want count=1, viewerReacted=false)", got)
	}
	// post 3: no reactions → not present.
	if len(byPost[3]) != 0 {
		t.Fatalf("post3 should have no reactions, got %+v", byPost[3])
	}

	// Within post 1, reactions are count-descending → 👍(2) before ❤️(1).
	for _, p := range resp.Msg.Posts {
		if p.PostId == 1 {
			if len(p.Reactions) != 2 || p.Reactions[0].Emoji != "👍" {
				t.Fatalf("post1 reactions not count-descending: %+v", p.Reactions)
			}
		}
	}
}

func TestGetPostReactions_EmptyRequest(t *testing.T) {
	h := setup(t)
	resp, err := h.svc.GetPostReactions(context.Background(), connect.NewRequest(&membav1.GetPostReactionsRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Msg.Posts) != 0 {
		t.Fatalf("empty request → empty response, got %d", len(resp.Msg.Posts))
	}
}

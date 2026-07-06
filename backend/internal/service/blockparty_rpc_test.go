package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/blockparty"
)

func TestGetDailyChallenge_ServesCached(t *testing.T) {
	h := setup(t)
	// pre-seed an immutable challenge
	c := blockparty.Challenge{Date: "2026-07-06", Height: 10, Hash: "abc", Seed: 42, Modifier: "standard", Par: 1500}
	if err := blockparty.PutChallenge(h.db, c); err != nil {
		t.Fatal(err)
	}
	resp, err := h.svc.GetDailyChallenge(context.Background(),
		connect.NewRequest(&membav1.GetDailyChallengeRequest{Date: "2026-07-06"}))
	if err != nil {
		t.Fatalf("GetDailyChallenge: %v", err)
	}
	m := resp.Msg
	if !m.Ready || m.Seed != 42 || m.Modifier != "standard" || m.BlockHeight != 10 || m.Par != 1500 {
		t.Fatalf("bad response: %+v", m)
	}
}

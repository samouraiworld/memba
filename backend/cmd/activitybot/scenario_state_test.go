package main

import (
	"path/filepath"
	"testing"
	"time"
)

func TestScenarioValidate(t *testing.T) {
	cases := []struct {
		name    string
		s       Scenario
		wantErr bool
	}{
		{"empty", Scenario{}, true},
		{"feed without realm", Scenario{Actions: []Action{{Type: ActionFeedPost, Body: "hi"}}}, true},
		{"feed empty body", Scenario{FeedRealm: "r", Actions: []Action{{Type: ActionFeedPost, Body: "  "}}}, true},
		{"feed over cap", Scenario{FeedRealm: "r", Actions: []Action{{Type: ActionFeedPost, Body: string(make([]byte, 1001))}}}, true},
		{"transfer no dest", Scenario{Actions: []Action{{Type: ActionTransfer, Ugnot: 100}}}, true},
		{"transfer zero", Scenario{Actions: []Action{{Type: ActionTransfer, ToAddress: "g1x", Ugnot: 0}}}, true},
		{"transfer over single-tx cap", Scenario{Actions: []Action{{Type: ActionTransfer, ToAddress: "g1x", Ugnot: MaxTransferUgnot + 1}}}, true},
		{"unknown type", Scenario{Actions: []Action{{Type: "wat"}}}, true},
		{"feed body leading dash", Scenario{FeedRealm: "r", Actions: []Action{{Type: ActionFeedPost, Body: "--home /etc"}}}, true},
		{"transfer to leading dash", Scenario{Actions: []Action{{Type: ActionTransfer, ToAddress: "-x", Ugnot: 100}}}, true},
		{"valid feed", Scenario{FeedRealm: "r", Actions: []Action{{Type: ActionFeedPost, Body: "hi"}}}, false},
		{"valid transfer at cap", Scenario{Actions: []Action{{Type: ActionTransfer, ToAddress: "g1x", Ugnot: MaxTransferUgnot}}}, false},
		{"sweep without realm", Scenario{Actions: []Action{{Type: ActionSweep, Limit: 5}}}, true},
		{"sweep zero limit", Scenario{FeedRealm: "r", Actions: []Action{{Type: ActionSweep, Limit: 0}}}, true},
		{"sweep over reply-fanout cap", Scenario{FeedRealm: "r", Actions: []Action{{Type: ActionSweep, Limit: 11}}}, true},
		{"valid sweep", Scenario{FeedRealm: "r", Actions: []Action{{Type: ActionSweep, Limit: 5}}}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := c.s.validate()
			if (err != nil) != c.wantErr {
				t.Fatalf("validate() err=%v, wantErr=%v", err, c.wantErr)
			}
		})
	}
}

func TestState_RollsOverOnNewDay(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "state.json")

	day1 := time.Date(2026, 7, 4, 12, 0, 0, 0, time.UTC)
	s, err := loadState(path, day1) // missing file → fresh
	if err != nil {
		t.Fatal(err)
	}
	s.TransfersToday = 40
	if err := saveState(path, s); err != nil {
		t.Fatal(err)
	}

	// Same day → counter preserved.
	same, err := loadState(path, day1.Add(6*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if same.TransfersToday != 40 {
		t.Fatalf("same-day counter=%d, want 40", same.TransfersToday)
	}

	// Next day → counter resets.
	next, err := loadState(path, day1.Add(24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if next.TransfersToday != 0 {
		t.Fatalf("new-day counter=%d, want 0", next.TransfersToday)
	}
}

func TestState_TransfersRemaining(t *testing.T) {
	s := &State{TransfersToday: MaxTransfersPerDay - 3}
	if got := s.transfersRemaining(); got != 3 {
		t.Fatalf("remaining=%d, want 3", got)
	}
	over := &State{TransfersToday: MaxTransfersPerDay + 10}
	if got := over.transfersRemaining(); got != 0 {
		t.Fatalf("remaining over cap=%d, want 0 (never negative)", got)
	}
}

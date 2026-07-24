package main

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"
)

func feedScenario(n int) *Scenario {
	s := &Scenario{FeedRealm: "gno.land/r/samcrew/memba_feed_v1"}
	for range n {
		s.Actions = append(s.Actions, Action{Type: ActionFeedPost, Body: "gm from the bot"})
	}
	return s
}

func newRunner(s *Scenario, st *State, broadcast bool, exec execFn) (*Runner, *bytes.Buffer) {
	buf := &bytes.Buffer{}
	return &Runner{
		scenario: s, state: st, key: "activitybot",
		chainID: "test-13", remote: "https://rpc", broadcast: broadcast,
		out: buf, exec: exec,
	}, buf
}

func TestRun_DryRunPrintsCommandsSendsNothing(t *testing.T) {
	st := &State{DayUTC: dayKey(time.Now())}
	called := 0
	r, buf := newRunner(feedScenario(3), st, false, func([]string) (string, error) {
		called++
		return "", nil
	})

	acted, err := r.Run(10)
	if err != nil {
		t.Fatal(err)
	}
	if acted != 3 {
		t.Fatalf("acted=%d, want 3", acted)
	}
	if called != 0 {
		t.Fatal("dry-run must not invoke the broadcaster")
	}
	if strings.Count(buf.String(), "gnokey maketx call") != 3 {
		t.Fatalf("expected 3 printed gnokey calls:\n%s", buf.String())
	}
}

func TestRun_DryRunDoesNotSpendTheDailyBudget(t *testing.T) {
	st := &State{DayUTC: dayKey(time.Now())}
	sc := &Scenario{Actions: []Action{
		{Type: ActionTransfer, ToAddress: "g1dest", Ugnot: 100},
		{Type: ActionTransfer, ToAddress: "g1dest", Ugnot: 100},
	}}
	r, _ := newRunner(sc, st, false /* dry-run */, func([]string) (string, error) { return "", nil })

	if _, err := r.Run(10); err != nil {
		t.Fatal(err)
	}
	if st.TransfersToday != 0 {
		t.Fatalf("dry-run advanced the daily counter to %d — it must stay 0", st.TransfersToday)
	}
}

func TestRun_PerRunLimit(t *testing.T) {
	st := &State{DayUTC: dayKey(time.Now())}
	r, _ := newRunner(feedScenario(10), st, false, func([]string) (string, error) { return "", nil })
	acted, err := r.Run(4)
	if err != nil {
		t.Fatal(err)
	}
	if acted != 4 {
		t.Fatalf("acted=%d, want 4 (per-run limit)", acted)
	}
}

func TestRun_DailyTransferBudgetSkips(t *testing.T) {
	// Already at the day cap → transfers are skipped, not sent.
	st := &State{DayUTC: dayKey(time.Now()), TransfersToday: MaxTransfersPerDay}
	sc := &Scenario{Actions: []Action{
		{Type: ActionTransfer, ToAddress: "g1dest", Ugnot: 100},
		{Type: ActionTransfer, ToAddress: "g1dest", Ugnot: 100},
	}}
	called := 0
	r, buf := newRunner(sc, st, true, func([]string) (string, error) { called++; return "ok", nil })

	acted, err := r.Run(10)
	if err != nil {
		t.Fatal(err)
	}
	if acted != 0 || called != 0 {
		t.Fatalf("over-budget transfers must be skipped (acted=%d called=%d)", acted, called)
	}
	if !strings.Contains(buf.String(), "daily transfer budget reached") {
		t.Fatal("expected a budget-reached skip notice")
	}
}

func TestRun_TransferAdvancesDayCounterOnlyWhenBroadcast(t *testing.T) {
	st := &State{DayUTC: dayKey(time.Now())}
	sc := &Scenario{
		FeedRealm: "gno.land/r/samcrew/memba_feed_v1",
		Actions: []Action{
			{Type: ActionTransfer, ToAddress: "g1dest", Ugnot: 100},
			{Type: ActionFeedPost, Body: "hi"},
		},
	}
	r, _ := newRunner(sc, st, true, func([]string) (string, error) { return "OK\nmore", nil })
	acted, err := r.Run(10)
	if err != nil {
		t.Fatal(err)
	}
	if acted != 2 {
		t.Fatalf("acted=%d, want 2", acted)
	}
	// Only the transfer is value-moving → counter is exactly 1.
	if st.TransfersToday != 1 {
		t.Fatalf("TransfersToday=%d, want 1 (only the transfer counts)", st.TransfersToday)
	}
}

func TestRun_StopsAtFirstBroadcastErrorNoPanic(t *testing.T) {
	st := &State{DayUTC: dayKey(time.Now())}
	sc := feedScenario(3)
	calls := 0
	r, _ := newRunner(sc, st, true, func([]string) (string, error) {
		calls++
		if calls == 2 {
			return "boom", errors.New("rpc rejected")
		}
		return "ok", nil
	})

	acted, err := r.Run(10)
	if err == nil {
		t.Fatal("expected the run to stop on the broadcast error")
	}
	if acted != 1 {
		t.Fatalf("acted=%d, want 1 (stopped at the 2nd action's error)", acted)
	}
	if calls != 2 {
		t.Fatalf("calls=%d, want 2 (no further actions after the error)", calls)
	}
}

// FeedRealmless is a tiny helper to keep the composite literal above readable.
func FeedRealmless() Action { return Action{Type: ActionFeedPost, Body: "placeholder"} }

func TestBuildArgv_GasWithinCeilings(t *testing.T) {
	r, _ := newRunner(feedScenario(1), &State{}, false, nil)
	argv := r.buildArgv(Action{Type: ActionTransfer, ToAddress: "g1x", Ugnot: 500})
	joined := strings.Join(argv, " ")
	if !strings.Contains(joined, "maketx send") || !strings.Contains(joined, "-send 500ugnot") {
		t.Fatalf("transfer argv wrong: %s", joined)
	}
	if !strings.Contains(joined, "-broadcast activitybot") {
		t.Fatalf("argv must broadcast with the key name: %s", joined)
	}
}

func TestBuildArgv_Sweep(t *testing.T) {
	s := &Scenario{FeedRealm: "gno.land/r/samcrew/memba_feed_v2"}
	r, _ := newRunner(s, &State{}, false, nil)
	argv := r.buildArgv(Action{Type: ActionSweep, Limit: 5})
	joined := strings.Join(argv, " ")
	// Exactly one -args (the limit); cur realm is VM-injected, not passed.
	if !strings.Contains(joined, "maketx call") ||
		!strings.Contains(joined, "-func SweepTombstones") ||
		!strings.Contains(joined, "-args 5") {
		t.Fatalf("sweep argv wrong: %s", joined)
	}
	if strings.Count(joined, "-args") != 1 {
		t.Fatalf("sweep must pass exactly one -args (the limit): %s", joined)
	}
	if !strings.Contains(joined, "-pkgpath gno.land/r/samcrew/memba_feed_v2") ||
		!strings.Contains(joined, "-broadcast activitybot") {
		t.Fatalf("sweep argv must target the feed realm + broadcast with the key: %s", joined)
	}
}

// A sweep is state-hygiene, not value-moving: broadcasting it must NOT consume
// the daily transfer budget.
func TestRun_SweepDoesNotSpendTransferBudget(t *testing.T) {
	st := &State{DayUTC: dayKey(time.Now())}
	sc := &Scenario{FeedRealm: "gno.land/r/samcrew/memba_feed_v2", Actions: []Action{{Type: ActionSweep, Limit: 3}}}
	r, _ := newRunner(sc, st, true /* broadcast */, func([]string) (string, error) { return "ok", nil })
	if _, err := r.Run(10); err != nil {
		t.Fatal(err)
	}
	if st.TransfersToday != 0 {
		t.Fatalf("sweep must not spend the transfer budget, got TransfersToday=%d", st.TransfersToday)
	}
}

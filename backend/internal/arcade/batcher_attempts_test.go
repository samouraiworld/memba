package arcade

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

// Unlike fakeBroadcaster's successful-call history, this counts every attempt,
// including calls whose response reports a failed or already-delivered tx.
type attemptBroadcaster struct {
	calls  []Run
	result error
}

func (b *attemptBroadcaster) AttestScore(_ context.Context, run Run) (string, error) {
	b.calls = append(b.calls, run)
	return "tx-" + run.LogHash, b.result
}

func TestRunBatchOnce_AttemptCapIncludesEveryOutcome(t *testing.T) {
	for _, tc := range []struct {
		name         string
		result       error
		wantAttested int
	}{
		{"success", nil, 2},
		{"transient", errors.New("network failure"), 0},
		{"permanent", ErrPermanentReject, 0},
		{"conflicting log", ErrLogBoundElsewhere, 0},
		{"already on chain", ErrAlreadyOnChain, 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := batchStore(t)
			// Two game boards on each of three closed days: a failed board must
			// not leave the full attempt allowance available for the next one.
			for day := 9; day <= 11; day++ {
				for _, game := range []string{"barricade", "invaders"} {
					id := fmt.Sprintf("%s-%d", game, day)
					mustInsertGame(t, s, game, id, "g1"+id, fmt.Sprintf("2026-07-%02d", day), 100)
				}
			}
			b := &attemptBroadcaster{result: tc.result}
			n, err := RunBatchOnce(context.Background(), s, b, 2, atFixedDay)
			if err != nil {
				t.Fatal(err)
			}
			if len(b.calls) != 2 {
				t.Fatalf("cap=2 made %d broadcast attempts", len(b.calls))
			}
			if n != tc.wantAttested {
				t.Fatalf("attested count=%d, want %d", n, tc.wantAttested)
			}
			for _, game := range []string{"barricade", "invaders"} {
				r, _, err := s.GetRunByLogHash(game + "-10")
				if err != nil || r.Status != "verified" {
					t.Fatalf("later board changed: %+v, %v", r, err)
				}
			}
		})
	}
}

func TestRunBatchOnce_AttemptCapIncludesPostBroadcastStorageFailure(t *testing.T) {
	s := batchStore(t)
	for day := 9; day <= 11; day++ {
		id := fmt.Sprintf("run-%d", day)
		mustInsert(t, s, id, fmt.Sprintf("2026-07-%02d", day), 100)
	}
	// A tx may have spent gas even when recording its receipt fails locally.
	_, err := s.db.Exec(`CREATE TRIGGER fail_attested_write BEFORE UPDATE ON arcade_runs
		WHEN NEW.status = 'attested' BEGIN SELECT RAISE(ABORT, 'receipt write failed'); END`)
	if err != nil {
		t.Fatal(err)
	}
	b := &attemptBroadcaster{}
	n, err := RunBatchOnce(context.Background(), s, b, 1, atFixedDay)
	if err != nil {
		t.Fatal(err)
	}
	if len(b.calls) != 1 || n != 0 {
		t.Fatalf("attempts=%d, attested=%d; want 1 and 0", len(b.calls), n)
	}
}

func TestRunBatchOnce_AttemptCapRetainsRetryParkingAndProgress(t *testing.T) {
	s := batchStore(t)
	mustInsert(t, s, "poison", "2026-07-09", 100)
	mustInsert(t, s, "later", "2026-07-10", 100)
	b := &attemptBroadcaster{result: errors.New("temporary failure")}
	failures := map[string]int{}
	for cycle := 0; cycle < maxAttestRetries; cycle++ {
		before := len(b.calls)
		if _, err := runBatchOnce(context.Background(), s, b, 1, atFixedDay, failures); err != nil {
			t.Fatal(err)
		}
		if len(b.calls)-before != 1 {
			t.Fatal("retry cycle exceeded attempt cap")
		}
	}
	r, _, err := s.GetRunByLogHash("poison")
	if err != nil || r.Status != "errored" {
		t.Fatalf("poison was not parked: %+v %v", r, err)
	}
	b.result = nil
	before := len(b.calls)
	n, err := runBatchOnce(context.Background(), s, b, 1, atFixedDay, failures)
	if err != nil || n != 1 || len(b.calls)-before != 1 || b.calls[len(b.calls)-1].LogHash != "later" {
		t.Fatalf("later board failed to progress: n=%d err=%v calls=%+v", n, err, b.calls)
	}
}

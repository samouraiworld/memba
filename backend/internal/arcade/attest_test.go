package arcade

import (
	"context"
	"database/sql"
	"errors"
	"reflect"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"github.com/samouraiworld/memba/backend/internal/db"
)

func openMigrated(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if err := db.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return database
}

func mustInsertAddr(t *testing.T, s *Store, logHash, addr, day string, score int64) {
	t.Helper()
	if err := s.InsertRun(Run{
		LogHash: logHash, Addr: addr, Day: day, Mode: "daily",
		Seed: "barricade-" + day, SimVersion: 2, Score: score, Waves: 5,
		StateHash: "sh" + logHash, Events: "[]", Status: "verified", CreatedAt: 1,
	}); err != nil {
		t.Fatalf("insert %s: %v", logHash, err)
	}
}

// mustInsert defaults each run to its own address (g1<logHash>).
func mustInsert(t *testing.T, s *Store, logHash, day string, score int64) {
	t.Helper()
	mustInsertAddr(t, s, logHash, "g1"+logHash, day, score)
}

// fakeBroadcaster records attestations and can be made to fail or to return a
// classified sentinel per logHash.
type fakeBroadcaster struct {
	calls    []Run
	failFor  map[string]bool  // logHash -> transient error
	errorFor map[string]error // logHash -> specific (sentinel) error
	txN      int
}

func (f *fakeBroadcaster) AttestScore(_ context.Context, run Run) (string, error) {
	if e, ok := f.errorFor[run.LogHash]; ok {
		return "", e
	}
	if f.failFor[run.LogHash] {
		return "", errors.New("broadcast failed")
	}
	f.calls = append(f.calls, run)
	f.txN++
	return "tx" + run.LogHash, nil
}

func batchStore(t *testing.T) *Store {
	t.Helper()
	return NewStore(openMigrated(t))
}

// today = 2026-07-13, so the grace window closes days <= 2026-07-11 (day+2);
// 2026-07-12 (yesterday) and 2026-07-13 (today) stay open.
func atFixedDay() time.Time { return time.Date(2026, 7, 13, 0, 30, 0, 0, time.UTC) }

func TestRunBatchOnce_AttestsBestPerAddressForClosedDays(t *testing.T) {
	s := batchStore(t)
	// Day 10 (closed): alice has two runs; only her BEST is attested. bob has one.
	mustInsertAddr(t, s, "a_lo", "g1alice", "2026-07-10", 300)
	mustInsertAddr(t, s, "a_hi", "g1alice", "2026-07-10", 900) // alice's best
	mustInsertAddr(t, s, "bob", "g1bob", "2026-07-10", 600)
	// Day 11 (closed): carol.
	mustInsertAddr(t, s, "carol", "g1carol", "2026-07-11", 100)
	// Day 12 (yesterday — still in the grace window) and day 13 (today): NOT closed.
	mustInsertAddr(t, s, "dave", "g1dave", "2026-07-12", 500)
	mustInsertAddr(t, s, "eve", "g1eve", "2026-07-13", 999)

	b := &fakeBroadcaster{}
	n, err := RunBatchOnce(context.Background(), s, b, 100, atFixedDay)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	if n != 3 { // alice's best + bob + carol
		t.Fatalf("expected 3 attestations, got %d", n)
	}
	got := map[string]bool{}
	for _, r := range b.calls {
		got[r.LogHash] = true
	}
	if !got["a_hi"] || !got["bob"] || !got["carol"] {
		t.Fatalf("the best-per-address closed runs must attest: %v", got)
	}
	if got["a_lo"] || got["dave"] || got["eve"] {
		t.Fatalf("a superseded run or an open-day run must NOT attest: %v", got)
	}
	// alice's lesser run is retired (skipped), her best is attested.
	if r, _, _ := s.GetRunByLogHash("a_lo"); r.Status != "skipped" {
		t.Fatalf("alice's superseded run must be 'skipped', got %q", r.Status)
	}
	if r, _, _ := s.GetRunByLogHash("a_hi"); r.Status != "attested" {
		t.Fatalf("alice's best must be 'attested', got %q", r.Status)
	}
	// The open-day runs are untouched.
	if r, _, _ := s.GetRunByLogHash("dave"); r.Status != "verified" {
		t.Fatalf("a still-open day must not be attested, dave=%q", r.Status)
	}
	// Fully drained: a second cycle attests nothing.
	if n2, _ := RunBatchOnce(context.Background(), s, b, 100, atFixedDay); n2 != 0 {
		t.Fatalf("second cycle must attest nothing, got %d", n2)
	}
}

func TestRunBatchOnce_MaxPerCycleDrainsAcrossCycles(t *testing.T) {
	s := batchStore(t)
	mustInsert(t, s, "r1", "2026-07-10", 300)
	mustInsert(t, s, "r2", "2026-07-10", 900)
	mustInsert(t, s, "r3", "2026-07-11", 600)
	b := &fakeBroadcaster{}

	total := 0
	for range 5 { // bounded loop; must drain within a few cycles
		n, err := RunBatchOnce(context.Background(), s, b, 1, atFixedDay) // 1 per cycle
		if err != nil {
			t.Fatalf("cycle: %v", err)
		}
		if n > 1 {
			t.Fatalf("maxPerCycle=1 must cap a cycle at 1, got %d", n)
		}
		total += n
		if n == 0 {
			break
		}
	}
	if total != 3 {
		t.Fatalf("all 3 distinct-address runs must eventually attest, got %d", total)
	}
}

func TestRunBatchOnce_BroadcastFailureLeavesRunPending(t *testing.T) {
	s := batchStore(t)
	mustInsert(t, s, "ok", "2026-07-10", 500)
	mustInsert(t, s, "bad", "2026-07-10", 900)
	b := &fakeBroadcaster{failFor: map[string]bool{"bad": true}}

	n, _ := RunBatchOnce(context.Background(), s, b, 10, atFixedDay)
	if n != 1 {
		t.Fatalf("only the good run attests, got %d", n)
	}
	// The failed run stays 'verified' so the next cycle retries it.
	got, _, _ := s.GetRunByLogHash("bad")
	if got.Status != "verified" {
		t.Fatalf("a failed attestation must stay pending, got %q", got.Status)
	}
	// Next cycle, broadcaster recovered → it attests.
	b.failFor = nil
	n2, _ := RunBatchOnce(context.Background(), s, b, 10, atFixedDay)
	if n2 != 1 {
		t.Fatalf("recovered cycle must attest the previously-failed run, got %d", n2)
	}
}

func TestRunBatchOnce_AlreadyOnChainConverges(t *testing.T) {
	// Crash recovery: the run was broadcast on a prior boot but never marked, so
	// the realm now rejects the re-attest as "not improved". The batcher must
	// treat that as done (mark attested) rather than retry the same panicking tx
	// forever and wedge the day.
	s := batchStore(t)
	mustInsert(t, s, "x", "2026-07-10", 500)
	b := &fakeBroadcaster{errorFor: map[string]error{"x": ErrAlreadyOnChain}}

	n, err := RunBatchOnce(context.Background(), s, b, 10, atFixedDay)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	if n != 1 {
		t.Fatalf("an already-on-chain run must resolve, got %d", n)
	}
	if r, _, _ := s.GetRunByLogHash("x"); r.Status != "attested" {
		t.Fatalf("already-on-chain must mark attested, got %q", r.Status)
	}
	// No forever-retry: the day is drained.
	if n2, _ := RunBatchOnce(context.Background(), s, b, 10, atFixedDay); n2 != 0 {
		t.Fatalf("second cycle must attest nothing, got %d", n2)
	}
}

func TestRunBatchOnce_LogBoundElsewhereIsSkipped(t *testing.T) {
	// The log is bound on-chain to another address — it can never be attested for
	// us, so it's retired ('skipped'), not retried forever.
	s := batchStore(t)
	mustInsert(t, s, "stolen", "2026-07-10", 500)
	b := &fakeBroadcaster{errorFor: map[string]error{"stolen": ErrLogBoundElsewhere}}

	n, _ := RunBatchOnce(context.Background(), s, b, 10, atFixedDay)
	if n != 0 {
		t.Fatalf("a permanently-rejected run does not count as attested, got %d", n)
	}
	if r, _, _ := s.GetRunByLogHash("stolen"); r.Status != "skipped" {
		t.Fatalf("a log bound elsewhere must be skipped, got %q", r.Status)
	}
	if n2, _ := RunBatchOnce(context.Background(), s, b, 10, atFixedDay); n2 != 0 {
		t.Fatalf("a skipped run must not be retried, got %d", n2)
	}
}

func TestGnokeyBroadcaster_ClassifiesRealmPanics(t *testing.T) {
	// The outputs are the realm's ACTUAL panic literals (leaderboard.gno) so this
	// doubles as a drift guard against the classifier's substrings.
	cases := map[string]error{
		"panic: existing entry is not improved":                                  ErrAlreadyOnChain,
		"panic: duplicate input log: already bound to another address":           ErrLogBoundElsewhere,
		"panic: duplicate input log: already attested for another address today": ErrLogBoundElsewhere,
		"panic: score out of range":                                              ErrPermanentReject,
		"panic: day must be YYYY-MM-DD":                                          ErrPermanentReject,
		"panic: simVersion must be positive":                                     ErrPermanentReject,
		"panic: stateHash and inputLogSha256 must be non-empty":                  ErrPermanentReject,
	}
	for out, want := range cases {
		b := &gnokeyBroadcaster{
			cfg:  AttesterConfig{KeyName: "k"},
			exec: func(_ context.Context, _ []string) (string, error) { return out, errors.New("exit 1") },
		}
		_, err := b.AttestScore(context.Background(), Run{LogHash: "x"})
		if !errors.Is(err, want) {
			t.Errorf("output %q: expected %v, got %v", out, want, err)
		}
	}
	// An unclassified failure stays a generic (retryable) error.
	b := &gnokeyBroadcaster{
		cfg:  AttesterConfig{KeyName: "k"},
		exec: func(_ context.Context, _ []string) (string, error) { return "connection refused", errors.New("exit 1") },
	}
	_, err := b.AttestScore(context.Background(), Run{LogHash: "x"})
	if err == nil || errors.Is(err, ErrAlreadyOnChain) || errors.Is(err, ErrLogBoundElsewhere) {
		t.Fatalf("a transient failure must be a generic error, got %v", err)
	}
}

func TestRunBatchOnce_PermanentRejectIsSkipped(t *testing.T) {
	// A deterministic shape rejection can never succeed — retire it, don't retry.
	s := batchStore(t)
	mustInsert(t, s, "bad", "2026-07-10", 500)
	b := &fakeBroadcaster{errorFor: map[string]error{"bad": ErrPermanentReject}}

	if n, _ := RunBatchOnce(context.Background(), s, b, 10, atFixedDay); n != 0 {
		t.Fatalf("a permanent reject does not count as attested, got %d", n)
	}
	if r, _, _ := s.GetRunByLogHash("bad"); r.Status != "skipped" {
		t.Fatalf("a permanent reject must be skipped, got %q", r.Status)
	}
}

func TestBatcher_TransientFailureIsParkedAfterMaxRetries(t *testing.T) {
	// A run that fails transiently every cycle must be parked ('errored') after
	// maxAttestRetries so it can't retry (and drip gas) forever. Uses the internal
	// runBatchOnce with a persistent failure counter (as the loop does).
	s := batchStore(t)
	mustInsert(t, s, "flaky", "2026-07-10", 500)
	b := &fakeBroadcaster{failFor: map[string]bool{"flaky": true}} // generic (retryable) error
	failures := map[string]int{}

	for i := range maxAttestRetries {
		if r, _, _ := s.GetRunByLogHash("flaky"); r.Status != "verified" {
			t.Fatalf("cycle %d: run must still be pending, got %q", i, r.Status)
		}
		if _, err := runBatchOnce(context.Background(), s, b, 10, atFixedDay, failures); err != nil {
			t.Fatalf("cycle %d: %v", i, err)
		}
	}
	if r, _, _ := s.GetRunByLogHash("flaky"); r.Status != "errored" {
		t.Fatalf("after %d transient failures the run must be parked 'errored', got %q", maxAttestRetries, r.Status)
	}
	// A transient failure that later SUCCEEDS resets the counter (no premature park).
	s2 := batchStore(t)
	mustInsert(t, s2, "recover", "2026-07-10", 500)
	b2 := &fakeBroadcaster{failFor: map[string]bool{"recover": true}}
	f2 := map[string]int{}
	_, _ = runBatchOnce(context.Background(), s2, b2, 10, atFixedDay, f2) // fail once
	b2.failFor = nil
	_, _ = runBatchOnce(context.Background(), s2, b2, 10, atFixedDay, f2) // then succeed
	if r, _, _ := s2.GetRunByLogHash("recover"); r.Status != "attested" {
		t.Fatalf("a recovered run must attest, got %q", r.Status)
	}
	if f2["recover"] != 0 {
		t.Fatalf("the failure counter must reset on success, got %d", f2["recover"])
	}
}

func TestGnokeyBroadcaster_Argv(t *testing.T) {
	b := &gnokeyBroadcaster{cfg: AttesterConfig{
		Realm: "gno.land/r/samcrew/memba_arcade_leaderboard_v1", ChainID: "test-13",
		Remote: "https://rpc.example:443", KeyName: "arcade-attester", GasWanted: 3000000, GasFeeUgnot: 1000000,
	}}
	// Every numeric field is DISTINCT (score/waves and overtimeRound/simVersion
	// are adjacent same-type args) so an exact-slice compare catches a transposition
	// that a substring check would miss.
	run := Run{
		Addr: "g1abc", Day: "2026-07-10", Seed: "barricade-2026-07-10", Score: 27150, Waves: 7,
		Won: true, OvertimeRound: 3, SimVersion: 2, StateHash: "e8532dc207e3cb24", LogHash: "deadbeef",
	}
	want := []string{
		"maketx", "call",
		"-pkgpath", "gno.land/r/samcrew/memba_arcade_leaderboard_v1",
		"-func", "AttestScore",
		"-args", "g1abc", // addr
		"-args", "2026-07-10", // day
		"-args", "barricade-2026-07-10", // seed
		"-args", "27150", // score
		"-args", "7", // waves
		"-args", "true", // won
		"-args", "3", // overtimeRound
		"-args", "2", // simVersion
		"-args", "e8532dc207e3cb24", // stateHash
		"-args", "deadbeef", // logHash
		"-gas-fee", "1000000ugnot",
		"-gas-wanted", "3000000",
		"-chainid", "test-13",
		"-remote", "https://rpc.example:443",
		"-broadcast",
		"arcade-attester",
	}
	if !reflect.DeepEqual(b.attestScoreArgv(run), want) {
		t.Fatalf("argv mismatch\n got: %v\nwant: %v", b.attestScoreArgv(run), want)
	}
}

func TestGnokeyBroadcaster_ParsesTxHash(t *testing.T) {
	b := &gnokeyBroadcaster{
		cfg: AttesterConfig{KeyName: "k"},
		exec: func(_ context.Context, _ []string) (string, error) {
			return "OK!\nTX HASH:   abc123==\nGAS USED: 42\n", nil
		},
	}
	tx, err := b.AttestScore(context.Background(), Run{LogHash: "x"})
	if err != nil {
		t.Fatalf("attest: %v", err)
	}
	if tx != "abc123==" {
		t.Fatalf("expected parsed tx hash, got %q", tx)
	}
}

func TestGnokeyBroadcaster_SurfacesExecError(t *testing.T) {
	b := &gnokeyBroadcaster{
		cfg:  AttesterConfig{KeyName: "k"},
		exec: func(_ context.Context, _ []string) (string, error) { return "boom", errors.New("exit 1") },
	}
	if _, err := b.AttestScore(context.Background(), Run{LogHash: "x"}); err == nil {
		t.Fatal("a gnokey failure must be an error")
	}
}

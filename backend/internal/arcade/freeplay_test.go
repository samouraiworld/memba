package arcade

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/samouraiworld/memba/backend/internal/db"
	_ "modernc.org/sqlite"
)

type freeVector struct {
	Name                                      string
	Target                                    FreePlayTarget
	Player                                    string
	Input                                     FreePlayInput
	RunID, ReplayHash, StateHash, PayloadHash string
	Score                                     int64
}

func freeVectors(t *testing.T) ([]freeVector, []struct {
	Fields []string
	SHA256 string
}) {
	t.Helper()
	raw, err := os.ReadFile("testdata/freeplay/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Runs []freeVector
		LP   []struct {
			Fields []string
			SHA256 string
		}
	}
	if err = json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v.Runs, v.LP
}
func freeFixture(t *testing.T) FreePlayRun {
	t.Helper()
	v, _ := freeVectors(t)
	run, err := VerifyFreePlayRun(context.Background(), v[0].Target, v[0].Player, v[0].Input)
	if err != nil {
		t.Fatal(err)
	}
	return run
}
func freeStore(t *testing.T) *FreePlayStore {
	t.Helper()
	database, err := db.Open(t.TempDir() + "/runs.sqlite")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if err = db.Migrate(database); err != nil {
		t.Fatal(err)
	}
	s, err := NewFreePlayStore(database, FreePlayTarget{"gnoland-1", FreePlayRealm})
	if err != nil {
		t.Fatal(err)
	}
	return s
}
func freeQuote(run FreePlayRun) FreePlayQuote {
	return FreePlayQuote{ID: strings.Repeat("a", 64), RunID: run.Entry.RunID, PayloadHash: run.PayloadHash, Nonce: strings.Repeat("b", 64), ExpiresAt: 1000, Payer: "studio", MaxFeeUgnot: 100000, MaxDepositUgnot: 2000000}
}

func TestFreePlayVectors(t *testing.T) {
	runs, lp := freeVectors(t)
	for _, v := range lp {
		if got := HashFreePlayFields(v.Fields...); got != v.SHA256 {
			t.Fatalf("LP %q: %s != %s", v.Fields, got, v.SHA256)
		}
	}
	for _, v := range runs {
		t.Run(v.Name, func(t *testing.T) {
			run, err := VerifyFreePlayRun(context.Background(), v.Target, v.Player, v.Input)
			if err != nil {
				t.Fatal(err)
			}
			if run.Entry.RunID != v.RunID || run.Entry.ReplayHash != v.ReplayHash || run.Entry.StateHash != v.StateHash || run.Entry.Score != v.Score || run.PayloadHash != v.PayloadHash {
				t.Fatalf("TS/Go vector mismatch: %+v", run)
			}
		})
	}
}
func TestFreePlayIdentityAndPayloadBinding(t *testing.T) {
	run := freeFixture(t)
	changed := run.Target
	changed.ChainID = "onyx-1"
	other, err := FreePlayRunID(changed, run.Entry.Player, run.Entry.Game, run.ClientRunID)
	if err != nil {
		t.Fatal(err)
	}
	if other == run.Entry.RunID {
		t.Fatal("cross-chain identity collision")
	}
	entry := run.Entry
	entry.Score++
	if entry.PayloadHash(run.Target) == run.PayloadHash {
		t.Fatal("score not bound")
	}
	if entry.RunID != run.Entry.RunID {
		t.Fatal("payload must not mutate run identity")
	}
	if _, err := FreePlayRunID(run.Target, run.Entry.Player, "connect4", run.ClientRunID); err == nil {
		t.Fatal("external game accepted")
	}
	if HashFreePlayFields("ab", "c") == HashFreePlayFields("a", "bc") {
		t.Fatal("ambiguous fields")
	}
}
func TestFreePlayRejectsInvalidReplayAndRules(t *testing.T) {
	v, _ := freeVectors(t)
	base := v[0]
	for name, change := range map[string]func(*FreePlayInput){
		"wrong version":       func(i *FreePlayInput) { i.SimVersion = 2 },
		"daily rules":         func(i *FreePlayInput) { i.Rules = "daily" },
		"legacy game":         func(i *FreePlayInput) { i.Game = "invaders" },
		"wrong codec":         func(i *FreePlayInput) { i.ReplayCodec = "json" },
		"bad seed":            func(i *FreePlayInput) { i.Seed = "bp1:FFFFFFFF" },
		"incomplete":          func(i *FreePlayInput) { i.Replay = "L" },
		"terminal padding":    func(i *FreePlayInput) { i.Replay += "L" },
		"undo empty":          func(i *FreePlayInput) { i.Replay = "Z" + i.Replay },
		"invalid action":      func(i *FreePlayInput) { i.Replay = "x" + i.Replay },
		"wrong claimed score": func(i *FreePlayInput) { n := int64(1); i.ClaimedScore = &n },
	} {
		t.Run(name, func(t *testing.T) {
			input := base.Input
			change(&input)
			if _, err := VerifyFreePlayRun(context.Background(), base.Target, base.Player, input); err == nil {
				t.Fatal("accepted invalid request")
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := VerifyFreePlayRun(ctx, base.Target, base.Player, base.Input); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel=%v", err)
	}
}

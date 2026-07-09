package indexer

import (
	"log/slog"
	"testing"
)

// A panic inside a cycle must be swallowed (the process shares the RPC
// server), and a normal cycle must still run.
func TestRunRecovered_SwallowsPanic(t *testing.T) {
	log := slog.Default()

	ran := false
	runRecovered(log, "test", func() { ran = true })
	if !ran {
		t.Fatal("fn did not run")
	}

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("panic escaped runRecovered: %v", r)
		}
	}()
	runRecovered(log, "test", func() { panic("boom") })
}

// After a panicked cycle, subsequent cycles still execute — the guard must not
// leave any sticky state behind.
func TestRunRecovered_ContinuesAfterPanic(t *testing.T) {
	log := slog.Default()
	runRecovered(log, "test", func() { panic("first cycle bad block") })

	ran := false
	runRecovered(log, "test", func() { ran = true })
	if !ran {
		t.Fatal("cycle after a recovered panic did not run")
	}
}

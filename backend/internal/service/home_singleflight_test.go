package service

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// Concurrent cache misses for the same chain must collapse to a SINGLE assemble.
// The snapshot assembly is 8 network/DB reads; without deduplication every
// request that arrives during the ~sub-second assembly (and every 30s on cache
// expiry) re-runs all of them — a thundering herd against the pinned RPC node.
func TestCachedHomeSnapshot_SingleflightDedupesConcurrentMisses(t *testing.T) {
	s := newTestService(t)

	var calls int32
	assemble := func(_ context.Context, _ string) *membav1.HomeSnapshot {
		atomic.AddInt32(&calls, 1)
		// Widen the overlap window so all goroutines are in-flight together.
		time.Sleep(60 * time.Millisecond)
		return &membav1.HomeSnapshot{GeneratedAt: "x"}
	}

	const n = 24
	var wg sync.WaitGroup
	wg.Add(n)
	for range n {
		go func() {
			defer wg.Done()
			_ = s.cachedHomeSnapshot(context.Background(), "test-13", assemble)
		}()
	}
	wg.Wait()

	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("expected assemble to run once under singleflight, ran %d times", got)
	}
}

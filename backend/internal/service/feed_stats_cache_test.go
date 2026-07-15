package service

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

func feedStatsFixture() *membav1.GetFeedStatsResponse {
	return &membav1.GetFeedStatsResponse{LivePosts: 7, TotalReplies: 3, TotalAuthors: 4}
}

// Concurrent cache misses must collapse to a SINGLE assemble. GetFeedStats runs
// 3 COUNT(*) scans + a most-replied query; without deduplication every request
// arriving during the assembly (and every TTL expiry) re-runs all of them — a
// thundering herd of table scans against the DB during a traffic spike (the
// exact shape of the Jul-20 ICO wave hitting the live feed header/rail).
func TestCachedFeedStats_SingleflightDedupesConcurrentMisses(t *testing.T) {
	s := newTestService(t)

	var calls int32
	assemble := func(_ context.Context) (*membav1.GetFeedStatsResponse, error) {
		atomic.AddInt32(&calls, 1)
		time.Sleep(60 * time.Millisecond) // widen the overlap window
		return feedStatsFixture(), nil
	}

	const n = 24
	var wg sync.WaitGroup
	wg.Add(n)
	for range n {
		go func() {
			defer wg.Done()
			if _, err := s.cachedFeedStats(context.Background(), assemble); err != nil {
				t.Errorf("cachedFeedStats: %v", err)
			}
		}()
	}
	wg.Wait()

	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("expected assemble to run once under singleflight, ran %d times", got)
	}
}

// A second call within the TTL is served from cache without re-assembling.
func TestCachedFeedStats_ServesFreshWithinTTL(t *testing.T) {
	s := newTestService(t)

	var calls int32
	assemble := func(_ context.Context) (*membav1.GetFeedStatsResponse, error) {
		atomic.AddInt32(&calls, 1)
		return feedStatsFixture(), nil
	}

	if _, err := s.cachedFeedStats(context.Background(), assemble); err != nil {
		t.Fatal(err)
	}
	got, err := s.cachedFeedStats(context.Background(), assemble)
	if err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("expected 1 assemble within TTL, got %d", calls)
	}
	if got.LivePosts != 7 {
		t.Fatalf("cached stats: got live_posts=%d want 7", got.LivePosts)
	}
}

// A cold-cache assemble error propagates (no last-good value to fall back on) —
// preserves the pre-cache error contract for the very first request.
func TestCachedFeedStats_ColdErrorPropagates(t *testing.T) {
	s := newTestService(t)
	sentinel := errors.New("db down")
	got, err := s.cachedFeedStats(context.Background(), func(_ context.Context) (*membav1.GetFeedStatsResponse, error) {
		return nil, sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("cold error: got %v want %v", err, sentinel)
	}
	if got != nil {
		t.Fatalf("cold error: expected nil response, got %+v", got)
	}
}

// After a warm cache, a later assemble error serves the last-good value (stale)
// instead of failing — resilience during a transient DB blip under load.
func TestCachedFeedStats_ServesStaleOnError(t *testing.T) {
	s := newTestService(t)

	// Warm the cache.
	if _, err := s.cachedFeedStats(context.Background(), func(_ context.Context) (*membav1.GetFeedStatsResponse, error) {
		return feedStatsFixture(), nil
	}); err != nil {
		t.Fatal(err)
	}

	// Expire it, then error on the next assemble.
	s.feedStatsMu.Lock()
	s.feedStatsCachedAt = time.Now().Add(-time.Hour)
	s.feedStatsMu.Unlock()

	got, err := s.cachedFeedStats(context.Background(), func(_ context.Context) (*membav1.GetFeedStatsResponse, error) {
		return nil, errors.New("transient db error")
	})
	if err != nil {
		t.Fatalf("expected stale served, got error %v", err)
	}
	if got == nil || got.LivePosts != 7 {
		t.Fatalf("expected last-good stats, got %+v", got)
	}
}

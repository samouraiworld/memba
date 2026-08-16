package indexer

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/samouraiworld/memba/backend/internal/metrics"
)

// The feed tailer is the LIVE production indexer post-cutover; the gauges used
// to be owned solely by the (disabled) NFT tailer, which made a feed stall
// invisible on /metrics — the outage class that went silent twice. These tests
// pin the feed path's emission of all three gauges.
func TestFeedTailOnce_EmitsFeedGauges(t *testing.T) {
	metrics.IndexerLastBlock.Reset()
	metrics.IndexerChainHead.Reset()
	metrics.IndexerLag.Reset()

	db := openTestDB(t)
	ctx := context.Background()

	const pkg = "gno.land/r/samcrew/memba_feed_v1"
	watched := map[string]struct{}{pkg: {}}
	cfg := FeedTailerConfig{
		WatchedRealms: []string{pkg},
		StartBlock:    1,
		Confirmations: 0, // process to the tip; confirmation depth is not under test
		Logger:        slog.Default(),
	}
	src := &fakeBlockSource{
		latest: 3,
		hashes: map[int64]string{1: "h1", 2: "h2", 3: "h3"},
	}
	prog := &feedProgress{lastLog: time.Now()} // heartbeat not due this test

	feedTailOnce(ctx, db, cfg, watched, src, prog)

	if got := testutil.ToFloat64(metrics.IndexerChainHead.WithLabelValues("feed")); got != 3 {
		t.Fatalf("chain_head{feed} = %v, want 3", got)
	}
	// First cycle starts from cursor 0 (StartBlock-1), so the pre-processing
	// lag snapshot is the full distance to the tip.
	if got := testutil.ToFloat64(metrics.IndexerLag.WithLabelValues("feed")); got != 3 {
		t.Fatalf("lag_blocks{feed} = %v, want 3 on first cycle", got)
	}
	if got := testutil.ToFloat64(metrics.IndexerLastBlock.WithLabelValues("feed")); got != 3 {
		t.Fatalf("last_block{feed} = %v, want 3", got)
	}
	if prog.blocksSince != 3 {
		t.Fatalf("blocksSince = %d, want 3", prog.blocksSince)
	}

	// Second cycle is caught up: lag re-snapshots to 0, cursor stays put.
	feedTailOnce(ctx, db, cfg, watched, src, prog)
	if got := testutil.ToFloat64(metrics.IndexerLag.WithLabelValues("feed")); got != 0 {
		t.Fatalf("lag_blocks{feed} = %v, want 0 when caught up", got)
	}
	if got := testutil.ToFloat64(metrics.IndexerLastBlock.WithLabelValues("feed")); got != 3 {
		t.Fatalf("last_block{feed} = %v, want 3 after caught-up cycle", got)
	}
	if prog.blocksSince != 3 {
		t.Fatalf("blocksSince = %d, want 3 (caught-up cycle adds none)", prog.blocksSince)
	}
}

// The heartbeat must fire on a CAUGHT-UP cycle (no new blocks) — that is the
// exact state a silent stall imitates — and must report then reset the
// blocks-processed accumulator.
func TestFeedTailOnce_HeartbeatFiresAndResets(t *testing.T) {
	metrics.IndexerLastBlock.Reset()
	metrics.IndexerChainHead.Reset()
	metrics.IndexerLag.Reset()

	db := openTestDB(t)
	ctx := context.Background()

	const pkg = "gno.land/r/samcrew/memba_feed_v1"
	watched := map[string]struct{}{pkg: {}}

	var buf bytes.Buffer
	cfg := FeedTailerConfig{
		WatchedRealms: []string{pkg},
		StartBlock:    1,
		Confirmations: 0,
		Logger:        slog.New(slog.NewTextHandler(&buf, nil)),
	}
	src := &fakeBlockSource{
		latest: 3,
		hashes: map[int64]string{1: "h1", 2: "h2", 3: "h3"},
	}

	// Cycle 1: not due — processes 3 blocks silently (no progress line).
	prog := &feedProgress{lastLog: time.Now()}
	feedTailOnce(ctx, db, cfg, watched, src, prog)
	if strings.Contains(buf.String(), "feed tailer: progress") {
		t.Fatal("heartbeat fired before its interval elapsed")
	}

	// Cycle 2: force the interval to have elapsed; the chain has NOT advanced
	// (latest=3, cursor=3) so this is a fully caught-up cycle — the heartbeat
	// must still fire, reporting the 3 blocks from cycle 1, then reset.
	prog.lastLog = time.Now().Add(-2 * feedProgressLogInterval)
	feedTailOnce(ctx, db, cfg, watched, src, prog)

	out := buf.String()
	if !strings.Contains(out, "feed tailer: progress") {
		t.Fatalf("expected heartbeat line, logs were:\n%s", out)
	}
	if !strings.Contains(out, "blocks_processed=3") {
		t.Fatalf("heartbeat did not report accumulated blocks, logs were:\n%s", out)
	}
	if !strings.Contains(out, "cursor=3") || !strings.Contains(out, "chain_head=3") {
		t.Fatalf("heartbeat missing cursor/chain_head, logs were:\n%s", out)
	}
	if prog.blocksSince != 0 {
		t.Fatalf("blocksSince = %d after heartbeat, want 0 (reset)", prog.blocksSince)
	}
	if time.Since(prog.lastLog) > time.Minute {
		t.Fatal("lastLog was not advanced by the heartbeat")
	}

	// A nil progress tracker disables the heartbeat without panicking.
	feedTailOnce(ctx, db, cfg, watched, src, nil)
}

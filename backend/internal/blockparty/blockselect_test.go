package blockparty

import (
	"context"
	"testing"
	"time"
)

type fakeChain struct{ blocks []BlockInfo } // index+1 = height, ascending time

func (f *fakeChain) LatestHeight(_ context.Context) (int64, error) {
	return int64(len(f.blocks)), nil
}
func (f *fakeChain) BlockAt(_ context.Context, h int64) (BlockInfo, error) {
	return f.blocks[h-1], nil
}

func mkChain(times []string) *fakeChain {
	f := &fakeChain{}
	for i, ts := range times {
		tt, _ := time.Parse(time.RFC3339, ts)
		f.blocks = append(f.blocks, BlockInfo{Height: int64(i + 1), Hash: "h" + ts, Time: tt})
	}
	return f
}

func TestSelectDailyBlock_FirstAtOrAfterMidnight(t *testing.T) {
	// blocks straddle the 2026-07-06 midnight boundary
	f := mkChain([]string{
		"2026-07-05T23:59:50Z", // h1
		"2026-07-06T00:00:03Z", // h2 <- first >= midnight of 07-06
		"2026-07-06T00:00:10Z", // h3
	})
	b, err := SelectDailyBlock(context.Background(), f, "2026-07-06")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if b.Height != 2 {
		t.Fatalf("height=%d want 2", b.Height)
	}
}

func TestSelectDailyBlock_NotYetMined(t *testing.T) {
	f := mkChain([]string{"2026-07-05T10:00:00Z", "2026-07-05T23:00:00Z"})
	_, err := SelectDailyBlock(context.Background(), f, "2026-07-06")
	if err == nil {
		t.Fatal("expected not-ready error (no block >= 07-06 midnight yet)")
	}
}

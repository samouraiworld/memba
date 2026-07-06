package blockparty

import (
	"context"
	"errors"
	"time"
)

type BlockInfo struct {
	Height int64
	Hash   string
	Time   time.Time
}

type BlockFetcher interface {
	LatestHeight(ctx context.Context) (int64, error)
	BlockAt(ctx context.Context, height int64) (BlockInfo, error)
}

// ErrNotReady means the day's qualifying block does not exist yet.
var ErrNotReady = errors.New("blockparty: daily block not yet mined")

// SelectDailyBlock returns the first block whose header time is >= 00:00:00Z of
// `date` (YYYY-MM-DD). Pure function of the chain: binary search by block time.
func SelectDailyBlock(ctx context.Context, f BlockFetcher, date string) (BlockInfo, error) {
	midnight, err := time.Parse("2006-01-02", date)
	if err != nil {
		return BlockInfo{}, err
	}
	latest, err := f.LatestHeight(ctx)
	if err != nil {
		return BlockInfo{}, err
	}
	if latest < 1 {
		return BlockInfo{}, ErrNotReady
	}
	top, err := f.BlockAt(ctx, latest)
	if err != nil {
		return BlockInfo{}, err
	}
	if top.Time.Before(midnight) {
		return BlockInfo{}, ErrNotReady // even the tip is before midnight
	}
	// binary search for the lowest height with Time >= midnight
	lo, hi := int64(1), latest
	var ans BlockInfo
	found := false
	for lo <= hi {
		mid := lo + (hi-lo)/2
		b, err := f.BlockAt(ctx, mid)
		if err != nil {
			return BlockInfo{}, err
		}
		if !b.Time.Before(midnight) { // b.Time >= midnight
			ans = b
			found = true
			hi = mid - 1
		} else {
			lo = mid + 1
		}
	}
	if !found {
		return BlockInfo{}, ErrNotReady
	}
	return ans, nil
}

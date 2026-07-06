package service

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/samouraiworld/memba/backend/internal/blockparty"
)

// httpBlockFetcher implements blockparty.BlockFetcher against a live Gno RPC
// node via the existing resilient HTTP GET helper (httpGetJSONResilient),
// mirroring the chain-RPC patterns already used in home_rpc.go and
// token_launches.go (fetchBlockTime).
type httpBlockFetcher struct{ rpcURL string }

var _ blockparty.BlockFetcher = httpBlockFetcher{}

// LatestHeight returns the chain tip via /status.
func (f httpBlockFetcher) LatestHeight(ctx context.Context) (int64, error) {
	var s struct {
		Result struct {
			SyncInfo struct {
				LatestBlockHeight string `json:"latest_block_height"`
			} `json:"sync_info"`
		} `json:"result"`
	}
	if err := httpGetJSONResilient(ctx, f.rpcURL, "/status", &s); err != nil {
		return 0, err
	}
	return strconv.ParseInt(s.Result.SyncInfo.LatestBlockHeight, 10, 64)
}

// BlockAt returns the hash and header time of the block at height via
// /block?height=N.
func (f httpBlockFetcher) BlockAt(ctx context.Context, height int64) (blockparty.BlockInfo, error) {
	var b struct {
		Result struct {
			// The live Gno RPC nests block_id + header under `block_meta`;
			// some nodes may also expose a top-level `block_id`. Read both and
			// prefer block_meta (verified against rpc.test13.testnets.gno.land).
			BlockMeta struct {
				BlockID struct {
					Hash string `json:"hash"`
				} `json:"block_id"`
				Header struct {
					Time string `json:"time"`
				} `json:"header"`
			} `json:"block_meta"`
			BlockID struct {
				Hash string `json:"hash"`
			} `json:"block_id"`
			Block struct {
				Header struct {
					Time string `json:"time"`
				} `json:"header"`
			} `json:"block"`
		} `json:"result"`
	}
	if err := httpGetJSONResilient(ctx, f.rpcURL, "/block?height="+strconv.FormatInt(height, 10), &b); err != nil {
		return blockparty.BlockInfo{}, err
	}
	hash := b.Result.BlockMeta.BlockID.Hash
	if hash == "" {
		hash = b.Result.BlockID.Hash
	}
	if hash == "" {
		// Fail loud: never derive the daily seed from an empty block hash.
		return blockparty.BlockInfo{}, fmt.Errorf("blockparty: block %d has no block_id.hash in RPC response", height)
	}
	timeStr := b.Result.Block.Header.Time
	if timeStr == "" {
		timeStr = b.Result.BlockMeta.Header.Time
	}
	t, err := time.Parse(time.RFC3339, timeStr)
	if err != nil {
		return blockparty.BlockInfo{}, err
	}
	return blockparty.BlockInfo{Height: height, Hash: hash, Time: t}, nil
}

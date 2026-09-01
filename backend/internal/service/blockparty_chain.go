package service

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/samouraiworld/memba/backend/internal/blockparty"
)

// httpBlockFetcher implements blockparty.BlockFetcher against a live Gno RPC
// node.
//
// SEEDING IS DELIBERATELY SINGLE-NODE AND CHAIN-VERIFIED — the opposite of the
// httpGetJSONResilient pattern the rest of the service uses. The daily seed is
// cached immutably on first derivation (PutChallenge is INSERT OR IGNORE), so
// a seed fetched from the wrong chain is *permanent* for that date and
// publicly falsifies the "provably un-rigged" claim (the verify script would
// derive a different board). Multi-node failover is exactly how that happens:
// the fallback list is chain-heterogeneous by construction and hides which
// node answered. For seeding, unavailability (today's board arrives late,
// surfaced as an error) strictly beats availability-via-substitution — so
// every request goes to THE configured node and must prove it is the expected
// chain (node_info.network on /status, header chain_id on /block), or fail
// loud. DNS resolution and HTTP 200 are both false positives for chain
// identity; only the reported network id counts.
type httpBlockFetcher struct {
	rpcURL string
	// expectChainID is the chain the seed MUST come from (e.g. "pearl-1").
	// Empty is a misconfiguration and fails closed on use — never construct
	// this fetcher without it (blockPartyFetcher always sets it).
	expectChainID string
}

var _ blockparty.BlockFetcher = httpBlockFetcher{}

// LatestHeight returns the chain tip via /status, verifying the node's
// reported network id first.
func (f httpBlockFetcher) LatestHeight(ctx context.Context) (int64, error) {
	if f.expectChainID == "" {
		return 0, fmt.Errorf("blockparty: seed fetcher has no expected chain id (fail-closed)")
	}
	var s struct {
		Result struct {
			NodeInfo struct {
				Network string `json:"network"`
			} `json:"node_info"`
			SyncInfo struct {
				LatestBlockHeight string `json:"latest_block_height"`
			} `json:"sync_info"`
		} `json:"result"`
	}
	if err := httpGetJSON(ctx, f.rpcURL+"/status", &s); err != nil {
		return 0, err
	}
	if s.Result.NodeInfo.Network != f.expectChainID {
		return 0, fmt.Errorf("blockparty: seed RPC %q reports chain %q, want %q",
			f.rpcURL, s.Result.NodeInfo.Network, f.expectChainID)
	}
	return strconv.ParseInt(s.Result.SyncInfo.LatestBlockHeight, 10, 64)
}

// BlockAt returns the hash and header time of the block at height via
// /block?height=N, verifying the block header names the expected chain. The
// per-block check closes the residual hole where /status passes but a later
// /block is served by a different backend behind the same load balancer.
func (f httpBlockFetcher) BlockAt(ctx context.Context, height int64) (blockparty.BlockInfo, error) {
	if f.expectChainID == "" {
		return blockparty.BlockInfo{}, fmt.Errorf("blockparty: seed fetcher has no expected chain id (fail-closed)")
	}
	var b struct {
		Result struct {
			// The live Gno RPC nests block_id + header under `block_meta`;
			// some nodes may also expose a top-level `block_id`. Read both and
			// prefer block_meta (chain_id + hash shapes re-verified against
			// rpc.pearl.testnets.gno.land 2026-09-01).
			BlockMeta struct {
				BlockID struct {
					Hash string `json:"hash"`
				} `json:"block_id"`
				Header struct {
					ChainID string `json:"chain_id"`
					Time    string `json:"time"`
				} `json:"header"`
			} `json:"block_meta"`
			BlockID struct {
				Hash string `json:"hash"`
			} `json:"block_id"`
			Block struct {
				Header struct {
					ChainID string `json:"chain_id"`
					Time    string `json:"time"`
				} `json:"header"`
			} `json:"block"`
		} `json:"result"`
	}
	if err := httpGetJSON(ctx, f.rpcURL+"/block?height="+strconv.FormatInt(height, 10), &b); err != nil {
		return blockparty.BlockInfo{}, err
	}
	chainID := b.Result.BlockMeta.Header.ChainID
	if chainID == "" {
		chainID = b.Result.Block.Header.ChainID
	}
	if chainID != f.expectChainID {
		return blockparty.BlockInfo{}, fmt.Errorf("blockparty: block %d header reports chain %q, want %q",
			height, chainID, f.expectChainID)
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

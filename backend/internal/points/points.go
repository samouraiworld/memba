// Package points recomputes trading-reward points as a pure, deterministic
// function of the raw event ledger + a frozen formula version. See
// docs/planning/NFT_POINTS_FORMULA_INVARIANTS.md. Coefficients here are the
// public, non-binding v1 weights; they may be tuned, the INVARIANTS may not.
package points

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
)

type SaleEvent struct {
	Via, Collection, TokenID, Seller, Buyer string
	Price, Royalty                          int64
	Block                                   int64
}

// roles returns (maker, taker) per the frozen via→role mapping (invariant #2).
func roles(s SaleEvent) (maker, taker string) {
	switch s.Via {
	case "offer":
		return s.Buyer, s.Seller // offerer makes, accepter takes
	default: // "buy" (and future "auction"/"sweep" until defined)
		return s.Seller, s.Buyer // lister makes, buyer takes
	}
}

// Recompute is the deterministic points function. Volume is royalty-weighted
// (invariant #1): a sale contributes its royalty amount as the points base, so
// zero-royalty sales contribute zero. buyer==seller self-deals are excluded
// (invariant #5). Iteration order does not affect the result (pure summation).
func Recompute(sales []SaleEvent, formulaVersion string) map[string]int64 {
	out := map[string]int64{}
	for _, s := range sales {
		if s.Buyer == s.Seller {
			continue // self-deal excluded
		}
		base := s.Royalty // royalty-weighted: zero royalty → zero points
		if base <= 0 {
			continue
		}
		maker, taker := roles(s)
		out[maker] += base
		out[taker] += base
	}
	return out
}

// LoadConfirmedSales reads Sale events from the raw ledger up to the confirmed
// watermark, deterministically ordered, for the recompute harness.
func LoadConfirmedSales(ctx context.Context, db *sql.DB, indexedThrough int64) ([]SaleEvent, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT attrs_json, event_block FROM nft_raw_events
		WHERE event_name = 'Sale' AND event_block <= ?
		ORDER BY event_block, event_tx_index, event_index`, indexedThrough)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []SaleEvent
	for rows.Next() {
		var attrs string
		var block int64
		if err := rows.Scan(&attrs, &block); err != nil {
			return nil, err
		}
		var m map[string]string
		if err := json.Unmarshal([]byte(attrs), &m); err != nil {
			return nil, err
		}
		out = append(out, SaleEvent{
			Via: m["via"], Collection: m["collection"], TokenID: m["tokenId"],
			Seller: m["seller"], Buyer: m["buyer"],
			Price: atoi64(m["price"]), Royalty: atoi64(m["royalty"]), Block: block,
		})
	}
	return out, rows.Err()
}

func atoi64(s string) int64 {
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0
	}
	return v
}

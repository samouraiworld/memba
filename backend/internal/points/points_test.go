package points

import "testing"

func TestRecompute_RoyaltyWeighted_DeterministicAndExcludesWash(t *testing.T) {
	sales := []SaleEvent{
		// via=buy: maker=seller, taker=buyer; royalty 50000 → counts.
		{Via: "buy", Collection: "c", TokenID: "1", Seller: "g1s", Buyer: "g1b", Price: 1000000, Royalty: 50000, Block: 100},
		// zero-royalty sale → contributes ~0 points (anti-wash invariant #1).
		{Via: "buy", Collection: "c", TokenID: "2", Seller: "g1s", Buyer: "g1b2", Price: 1000000, Royalty: 0, Block: 101},
		// self-deal (buyer == seller) → excluded entirely (invariant #5).
		{Via: "buy", Collection: "c", TokenID: "3", Seller: "g1w", Buyer: "g1w", Price: 1000000, Royalty: 50000, Block: 102},
	}
	a := Recompute(sales, "1")
	b := Recompute(sales, "1")
	if len(a) != len(b) {
		t.Fatalf("non-deterministic size: %d vs %d", len(a), len(b))
	}
	for k, v := range a {
		if b[k] != v {
			t.Fatalf("non-deterministic value for %q: %d vs %d", k, v, b[k])
		}
	}
	if _, ok := a["g1w"]; ok {
		t.Errorf("self-dealer g1w earned points; must be excluded")
	}
	// Zero-royalty sale earns ~0: g1b2's taker points come only from sale #2 (royalty 0).
	if a["g1b2"] != 0 {
		t.Errorf("zero-royalty taker earned %d, want 0 (royalty-weighted)", a["g1b2"])
	}
	// Royalty-bearing sale credited both maker and taker.
	if a["g1s"] == 0 || a["g1b"] == 0 {
		t.Errorf("royalty-bearing maker/taker earned 0: g1s=%d g1b=%d", a["g1s"], a["g1b"])
	}
}

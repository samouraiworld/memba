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

// ECO-1: royalty routed back to the buyer or seller is not a real wash-tax and
// must not earn points, even though it's a nonzero royalty.
func TestRecompute_ExcludesSelfRoyalty(t *testing.T) {
	sales := []SaleEvent{
		// Genuine: royalty to an independent third party → counts.
		{Via: "buy", Seller: "g1s", Buyer: "g1b", Royalty: 50000, RoyaltyRecipient: "g1third", Block: 1},
		// Creator-farm: seller routes the royalty to themselves → excluded.
		{Via: "buy", Seller: "g1farm", Buyer: "g1alt", Royalty: 50000, RoyaltyRecipient: "g1farm", Block: 2},
		// Royalty routed to the buyer → excluded.
		{Via: "buy", Seller: "g1x", Buyer: "g1y", Royalty: 50000, RoyaltyRecipient: "g1y", Block: 3},
	}
	out := Recompute(sales, "1")

	if out["g1s"] != 50000 || out["g1b"] != 50000 {
		t.Errorf("third-party-royalty sale should earn points: g1s=%d g1b=%d, want 50000 each", out["g1s"], out["g1b"])
	}
	for _, addr := range []string{"g1farm", "g1alt", "g1y", "g1x"} {
		if _, ok := out[addr]; ok {
			t.Errorf("self-royalty participant %q earned points; must be excluded", addr)
		}
	}
}

package memba_escrow_v1

import (
	"chain"
	"testing"
)

func TestEscrowLifecycle(t *testing.T) {
	buyer := address("g1buyer000000000000000000000000000000000")
	seller := address("g1seller00000000000000000000000000000000")

	// Mock banker setup
	testing.SetOriginCaller(buyer)
	testing.SetOriginSend(chain.Coins{{Denom: "ugnot", Amount: 10000}})

	// Create contract
	id := CreateContract(seller, "Test Service", "Description", "milestones")

	if len(contracts) != 1 {
		t.Fatalf("expected 1 contract, got %d", len(contracts))
	}

	c := contracts[id]
	if c.Status != "funded" {
		t.Fatalf("expected funded status, got %s", c.Status)
	}
	if c.Amount != 10000 {
		t.Fatalf("expected amount 10000, got %d", c.Amount)
	}

	// Release funds
	testing.SetOriginCaller(buyer)
	testing.SetOriginSend(nil) // clear origin send
	testing.IssueCoins(buyer, chain.Coins{{Denom: "ugnot", Amount: 10000}})
	ReleaseFunds(id)

	if contracts[id].Status != "released" {
		t.Fatalf("expected released status, got %s", contracts[id].Status)
	}

	// Double release should panic
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic on double release")
		}
	}()
	ReleaseFunds(id)
}

func TestEscrowRefund(t *testing.T) {
	buyer := address("g1buyer000000000000000000000000000000000")
	seller := address("g1seller00000000000000000000000000000000")

	testing.SetOriginCaller(buyer)
	testing.SetOriginSend(chain.Coins{{Denom: "ugnot", Amount: 20000}})

	id := CreateContract(seller, "Test Service 2", "Desc", "miles")

	// Refund
	testing.SetOriginCaller(buyer)
	testing.SetOriginSend(nil) // clear origin send
	testing.IssueCoins(buyer, chain.Coins{{Denom: "ugnot", Amount: 20000}})
	Refund(id)

	if contracts[id].Status != "refunded" {
		t.Fatalf("expected refunded status, got %s", contracts[id].Status)
	}

	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic on double refund")
		}
	}()
	Refund(id)
}

package memba_escrow_v1

import (
	"std"
	"testing"
)

func TestEscrowLifecycle(t *testing.T) {
	buyer := std.Address("g1buyer000000000000000000000000000000000")
	seller := std.Address("g1seller00000000000000000000000000000000")

	// Mock banker setup
	std.TestSetOrigCaller(buyer)
	std.TestSetOrigSend(std.Coins{{Denom: "ugnot", Amount: 10000}}, nil)

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
	std.TestSetOrigCaller(buyer)
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
	buyer := std.Address("g1buyer000000000000000000000000000000000")
	seller := std.Address("g1seller00000000000000000000000000000000")

	std.TestSetOrigCaller(buyer)
	std.TestSetOrigSend(std.Coins{{Denom: "ugnot", Amount: 20000}}, nil)

	id := CreateContract(seller, "Test Service 2", "Desc", "miles")

	std.TestSetOrigCaller(buyer)
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

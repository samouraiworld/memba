package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

func TestCreateServiceListing_Success(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1freelancer")
	ctx := context.Background()

	resp, err := h.svc.CreateServiceListing(ctx, connect.NewRequest(&membav1.CreateServiceListingRequest{
		AuthToken:    token,
		Title:        "Custom Gno Realm Development",
		Description:  "Build a custom realm for your project.",
		Category:     "development",
		Price:        5000000,
		DeliveryDays: 7,
		Tags:         "gno,realm,smart-contract",
	}))
	if err != nil {
		t.Fatal("CreateServiceListing:", err)
	}
	if resp.Msg.Listing.Title != "Custom Gno Realm Development" {
		t.Fatal("wrong title")
	}
	if resp.Msg.Listing.Address != "g1freelancer" {
		t.Fatal("wrong address")
	}
	if resp.Msg.Listing.Price != 5000000 {
		t.Fatal("wrong price")
	}
	if !resp.Msg.Listing.Active {
		t.Fatal("should be active")
	}
}

func TestCreateServiceListing_EmptyTitle(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1freelancer")
	ctx := context.Background()

	_, err := h.svc.CreateServiceListing(ctx, connect.NewRequest(&membav1.CreateServiceListingRequest{
		AuthToken: token,
		Title:     "",
		Price:     1000000,
	}))
	if err == nil {
		t.Fatal("expected error for empty title")
	}
}

func TestCreateServiceListing_ZeroPrice(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1freelancer")
	ctx := context.Background()

	_, err := h.svc.CreateServiceListing(ctx, connect.NewRequest(&membav1.CreateServiceListingRequest{
		AuthToken: token,
		Title:     "Free service",
		Price:     0,
	}))
	if err == nil {
		t.Fatal("expected error for zero price")
	}
}

func TestCreateServiceListing_Unauthenticated(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	_, err := h.svc.CreateServiceListing(ctx, connect.NewRequest(&membav1.CreateServiceListingRequest{
		Title: "Test",
		Price: 1000000,
	}))
	if err == nil {
		t.Fatal("expected error without auth")
	}
}

func TestGetServiceListings_Empty(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	resp, err := h.svc.GetServiceListings(ctx, connect.NewRequest(&membav1.GetServiceListingsRequest{}))
	if err != nil {
		t.Fatal("GetServiceListings:", err)
	}
	if len(resp.Msg.Listings) != 0 {
		t.Fatalf("expected 0 listings, got %d", len(resp.Msg.Listings))
	}
}

func TestGetServiceListings_WithListings(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1freelancer")
	ctx := context.Background()

	// Create 2 listings
	_, _ = h.svc.CreateServiceListing(ctx, connect.NewRequest(&membav1.CreateServiceListingRequest{
		AuthToken: token, Title: "Service A", Category: "development", Price: 1000000,
	}))
	_, _ = h.svc.CreateServiceListing(ctx, connect.NewRequest(&membav1.CreateServiceListingRequest{
		AuthToken: token, Title: "Service B", Category: "design", Price: 2000000,
	}))

	resp, err := h.svc.GetServiceListings(ctx, connect.NewRequest(&membav1.GetServiceListingsRequest{}))
	if err != nil {
		t.Fatal("GetServiceListings:", err)
	}
	if len(resp.Msg.Listings) != 2 {
		t.Fatalf("expected 2 listings, got %d", len(resp.Msg.Listings))
	}
}

func TestGetServiceListings_FilterByCategory(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1freelancer")
	ctx := context.Background()

	_, _ = h.svc.CreateServiceListing(ctx, connect.NewRequest(&membav1.CreateServiceListingRequest{
		AuthToken: token, Title: "Dev Work", Category: "development", Price: 1000000,
	}))
	_, _ = h.svc.CreateServiceListing(ctx, connect.NewRequest(&membav1.CreateServiceListingRequest{
		AuthToken: token, Title: "Design Work", Category: "design", Price: 2000000,
	}))

	resp, err := h.svc.GetServiceListings(ctx, connect.NewRequest(&membav1.GetServiceListingsRequest{
		Category: "development",
	}))
	if err != nil {
		t.Fatal("GetServiceListings:", err)
	}
	if len(resp.Msg.Listings) != 1 {
		t.Fatalf("expected 1 development listing, got %d", len(resp.Msg.Listings))
	}
	if resp.Msg.Listings[0].Title != "Dev Work" {
		t.Fatal("wrong listing returned")
	}
}

func TestUpdateServiceListing_Success(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1freelancer")
	ctx := context.Background()

	created, _ := h.svc.CreateServiceListing(ctx, connect.NewRequest(&membav1.CreateServiceListingRequest{
		AuthToken: token, Title: "Original", Category: "development", Price: 1000000,
	}))

	resp, err := h.svc.UpdateServiceListing(ctx, connect.NewRequest(&membav1.UpdateServiceListingRequest{
		AuthToken: token,
		ListingId: created.Msg.Listing.Id,
		Title:     "Updated Title",
		Price:     2000000,
		Active:    true,
	}))
	if err != nil {
		t.Fatal("UpdateServiceListing:", err)
	}
	if resp.Msg.Listing.Title != "Updated Title" {
		t.Fatal("title not updated")
	}
	if resp.Msg.Listing.Price != 2000000 {
		t.Fatal("price not updated")
	}
}

func TestUpdateServiceListing_WrongOwner(t *testing.T) {
	h := setup(t)
	tokenA := h.makeToken(t, "g1alice")
	tokenB := h.makeToken(t, "g1bob")
	ctx := context.Background()

	created, _ := h.svc.CreateServiceListing(ctx, connect.NewRequest(&membav1.CreateServiceListingRequest{
		AuthToken: tokenA, Title: "Alice's Service", Category: "other", Price: 1000000,
	}))

	_, err := h.svc.UpdateServiceListing(ctx, connect.NewRequest(&membav1.UpdateServiceListingRequest{
		AuthToken: tokenB,
		ListingId: created.Msg.Listing.Id,
		Title:     "Hijacked",
		Active:    true,
	}))
	if err == nil {
		t.Fatal("expected error for wrong owner")
	}
}

func TestUpdateServiceListing_Pause(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1freelancer")
	ctx := context.Background()

	created, _ := h.svc.CreateServiceListing(ctx, connect.NewRequest(&membav1.CreateServiceListingRequest{
		AuthToken: token, Title: "Pausable", Category: "other", Price: 1000000,
	}))

	// Pause the listing
	_, err := h.svc.UpdateServiceListing(ctx, connect.NewRequest(&membav1.UpdateServiceListingRequest{
		AuthToken: token,
		ListingId: created.Msg.Listing.Id,
		Active:    false,
	}))
	if err != nil {
		t.Fatal("UpdateServiceListing (pause):", err)
	}

	// Should not appear in active listings
	resp, _ := h.svc.GetServiceListings(ctx, connect.NewRequest(&membav1.GetServiceListingsRequest{}))
	if len(resp.Msg.Listings) != 0 {
		t.Fatal("paused listing should not appear in active listings")
	}
}

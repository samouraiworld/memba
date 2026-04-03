package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

func TestFavoriteAgent_Toggle(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	// Add favorite
	resp, err := h.svc.FavoriteAgent(ctx, connect.NewRequest(&membav1.FavoriteAgentRequest{
		AuthToken: token,
		AgentId:   "memba-mcp",
	}))
	if err != nil {
		t.Fatal("FavoriteAgent (add):", err)
	}
	if !resp.Msg.Favorited {
		t.Fatal("expected favorited=true on first call")
	}

	// Remove favorite (toggle)
	resp, err = h.svc.FavoriteAgent(ctx, connect.NewRequest(&membav1.FavoriteAgentRequest{
		AuthToken: token,
		AgentId:   "memba-mcp",
	}))
	if err != nil {
		t.Fatal("FavoriteAgent (remove):", err)
	}
	if resp.Msg.Favorited {
		t.Fatal("expected favorited=false on second call (toggle)")
	}

	// Add again
	resp, err = h.svc.FavoriteAgent(ctx, connect.NewRequest(&membav1.FavoriteAgentRequest{
		AuthToken: token,
		AgentId:   "memba-mcp",
	}))
	if err != nil {
		t.Fatal("FavoriteAgent (re-add):", err)
	}
	if !resp.Msg.Favorited {
		t.Fatal("expected favorited=true on third call")
	}
}

func TestFavoriteAgent_EmptyID(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	_, err := h.svc.FavoriteAgent(ctx, connect.NewRequest(&membav1.FavoriteAgentRequest{
		AuthToken: token,
		AgentId:   "",
	}))
	if err == nil {
		t.Fatal("expected error for empty agent_id")
	}
}

func TestFavoriteAgent_Unauthenticated(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	_, err := h.svc.FavoriteAgent(ctx, connect.NewRequest(&membav1.FavoriteAgentRequest{
		AgentId: "memba-mcp",
	}))
	if err == nil {
		t.Fatal("expected error without auth token")
	}
}

func TestGetFavorites_Empty(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	resp, err := h.svc.GetFavorites(ctx, connect.NewRequest(&membav1.GetFavoritesRequest{
		AuthToken: token,
	}))
	if err != nil {
		t.Fatal("GetFavorites:", err)
	}
	if len(resp.Msg.AgentIds) != 0 {
		t.Fatalf("expected 0 favorites, got %d", len(resp.Msg.AgentIds))
	}
}

func TestGetFavorites_WithFavorites(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	// Add two favorites
	_, _ = h.svc.FavoriteAgent(ctx, connect.NewRequest(&membav1.FavoriteAgentRequest{
		AuthToken: token, AgentId: "memba-mcp",
	}))
	_, _ = h.svc.FavoriteAgent(ctx, connect.NewRequest(&membav1.FavoriteAgentRequest{
		AuthToken: token, AgentId: "other-agent",
	}))

	resp, err := h.svc.GetFavorites(ctx, connect.NewRequest(&membav1.GetFavoritesRequest{
		AuthToken: token,
	}))
	if err != nil {
		t.Fatal("GetFavorites:", err)
	}
	if len(resp.Msg.AgentIds) != 2 {
		t.Fatalf("expected 2 favorites, got %d", len(resp.Msg.AgentIds))
	}
}

func TestGetFavorites_PerUser(t *testing.T) {
	h := setup(t)
	tokenAlice := h.makeToken(t, "g1alice")
	tokenBob := h.makeToken(t, "g1bob")
	ctx := context.Background()

	// Alice favorites an agent
	_, _ = h.svc.FavoriteAgent(ctx, connect.NewRequest(&membav1.FavoriteAgentRequest{
		AuthToken: tokenAlice, AgentId: "memba-mcp",
	}))

	// Bob should have no favorites
	resp, err := h.svc.GetFavorites(ctx, connect.NewRequest(&membav1.GetFavoritesRequest{
		AuthToken: tokenBob,
	}))
	if err != nil {
		t.Fatal("GetFavorites (Bob):", err)
	}
	if len(resp.Msg.AgentIds) != 0 {
		t.Fatalf("Bob should have 0 favorites, got %d", len(resp.Msg.AgentIds))
	}
}

func TestGetAgentStats_NewAgent(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	resp, err := h.svc.GetAgentStats(ctx, connect.NewRequest(&membav1.GetAgentStatsRequest{
		AgentId: "memba-mcp",
	}))
	if err != nil {
		t.Fatal("GetAgentStats:", err)
	}
	if resp.Msg.Stats.ViewCount != 1 {
		t.Fatalf("expected 1 view (first call), got %d", resp.Msg.Stats.ViewCount)
	}
	if resp.Msg.Stats.FavoriteCount != 0 {
		t.Fatalf("expected 0 favorites, got %d", resp.Msg.Stats.FavoriteCount)
	}
}

func TestGetAgentStats_IncrementViews(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	// Call 3 times
	_, _ = h.svc.GetAgentStats(ctx, connect.NewRequest(&membav1.GetAgentStatsRequest{AgentId: "test-agent"}))
	_, _ = h.svc.GetAgentStats(ctx, connect.NewRequest(&membav1.GetAgentStatsRequest{AgentId: "test-agent"}))
	resp, err := h.svc.GetAgentStats(ctx, connect.NewRequest(&membav1.GetAgentStatsRequest{AgentId: "test-agent"}))
	if err != nil {
		t.Fatal("GetAgentStats:", err)
	}
	if resp.Msg.Stats.ViewCount != 3 {
		t.Fatalf("expected 3 views, got %d", resp.Msg.Stats.ViewCount)
	}
}

func TestGetAgentStats_WithFavorites(t *testing.T) {
	h := setup(t)
	tokenAlice := h.makeToken(t, "g1alice")
	tokenBob := h.makeToken(t, "g1bob")
	ctx := context.Background()

	// Two users favorite the same agent
	_, _ = h.svc.FavoriteAgent(ctx, connect.NewRequest(&membav1.FavoriteAgentRequest{
		AuthToken: tokenAlice, AgentId: "popular-agent",
	}))
	_, _ = h.svc.FavoriteAgent(ctx, connect.NewRequest(&membav1.FavoriteAgentRequest{
		AuthToken: tokenBob, AgentId: "popular-agent",
	}))

	resp, err := h.svc.GetAgentStats(ctx, connect.NewRequest(&membav1.GetAgentStatsRequest{
		AgentId: "popular-agent",
	}))
	if err != nil {
		t.Fatal("GetAgentStats:", err)
	}
	if resp.Msg.Stats.FavoriteCount != 2 {
		t.Fatalf("expected 2 favorites, got %d", resp.Msg.Stats.FavoriteCount)
	}
}

func TestGetAgentStats_EmptyID(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	_, err := h.svc.GetAgentStats(ctx, connect.NewRequest(&membav1.GetAgentStatsRequest{
		AgentId: "",
	}))
	if err == nil {
		t.Fatal("expected error for empty agent_id")
	}
}

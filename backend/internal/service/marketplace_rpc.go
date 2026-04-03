package service

import (
	"context"
	"strings"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// FavoriteAgent toggles a favorite for the authenticated user.
// If already favorited, removes it. If not, adds it.
func (s *MultisigService) FavoriteAgent(ctx context.Context, req *connect.Request[membav1.FavoriteAgentRequest]) (*connect.Response[membav1.FavoriteAgentResponse], error) {
	userAddr, err := s.authenticate(req.Msg.AuthToken)
	if err != nil {
		return nil, err
	}

	agentID := strings.TrimSpace(req.Msg.AgentId)
	if agentID == "" || len(agentID) > 50 {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	// Check if already favorited
	var count int
	err = s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM agent_favorites WHERE address = ? AND agent_id = ?`,
		userAddr, agentID,
	).Scan(&count)
	if err != nil {
		return nil, internalError("FavoriteAgent/check", err)
	}

	if count > 0 {
		// Remove favorite
		_, err = s.db.ExecContext(ctx,
			`DELETE FROM agent_favorites WHERE address = ? AND agent_id = ?`,
			userAddr, agentID,
		)
		if err != nil {
			return nil, internalError("FavoriteAgent/delete", err)
		}
		return connect.NewResponse(&membav1.FavoriteAgentResponse{Favorited: false}), nil
	}

	// Add favorite
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO agent_favorites (address, agent_id) VALUES (?, ?)`,
		userAddr, agentID,
	)
	if err != nil {
		return nil, internalError("FavoriteAgent/insert", err)
	}

	return connect.NewResponse(&membav1.FavoriteAgentResponse{Favorited: true}), nil
}

// GetFavorites returns all agent IDs favorited by the authenticated user.
func (s *MultisigService) GetFavorites(ctx context.Context, req *connect.Request[membav1.GetFavoritesRequest]) (*connect.Response[membav1.GetFavoritesResponse], error) {
	userAddr, err := s.authenticate(req.Msg.AuthToken)
	if err != nil {
		return nil, err
	}

	rows, err := s.db.QueryContext(ctx,
		`SELECT agent_id FROM agent_favorites WHERE address = ? ORDER BY created_at DESC`,
		userAddr,
	)
	if err != nil {
		return nil, internalError("GetFavorites", err)
	}
	defer func() { _ = rows.Close() }()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, internalError("GetFavorites/scan", err)
		}
		ids = append(ids, id)
	}

	return connect.NewResponse(&membav1.GetFavoritesResponse{AgentIds: ids}), nil
}

// GetAgentStats returns public view and favorite counts for an agent.
func (s *MultisigService) GetAgentStats(ctx context.Context, req *connect.Request[membav1.GetAgentStatsRequest]) (*connect.Response[membav1.GetAgentStatsResponse], error) {
	agentID := strings.TrimSpace(req.Msg.AgentId)
	if agentID == "" || len(agentID) > 50 {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	// Increment view count (upsert)
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO agent_views (agent_id, view_count, updated_at)
		 VALUES (?, 1, CURRENT_TIMESTAMP)
		 ON CONFLICT(agent_id) DO UPDATE SET
		   view_count = view_count + 1,
		   updated_at = CURRENT_TIMESTAMP`,
		agentID,
	)
	if err != nil {
		return nil, internalError("GetAgentStats/upsert", err)
	}

	// Read current counts
	var viewCount uint32
	err = s.db.QueryRowContext(ctx,
		`SELECT view_count FROM agent_views WHERE agent_id = ?`,
		agentID,
	).Scan(&viewCount)
	if err != nil {
		return nil, internalError("GetAgentStats/views", err)
	}

	var favCount uint32
	err = s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM agent_favorites WHERE agent_id = ?`,
		agentID,
	).Scan(&favCount)
	if err != nil {
		return nil, internalError("GetAgentStats/favs", err)
	}

	return connect.NewResponse(&membav1.GetAgentStatsResponse{
		Stats: &membav1.AgentStats{
			AgentId:       agentID,
			ViewCount:     viewCount,
			FavoriteCount: favCount,
		},
	}), nil
}

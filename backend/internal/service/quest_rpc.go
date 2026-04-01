package service

import (
	"context"
	"strings"
	"time"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// validQuests maps quest IDs to their XP values.
// Must match frontend/src/lib/quests.ts QUESTS array.
var validQuests = map[string]uint32{
	"connect-wallet":  10,
	"visit-5-pages":   10,
	"browse-proposals": 15,
	"view-profile":    10,
	"use-cmdk":        10,
	"switch-network":  15,
	"directory-tabs":  15,
	"submit-feedback": 20,
	"view-validator":  10,
	"share-link":      10,
}

// CompleteQuest marks a quest as completed for the authenticated user.
// XP is calculated server-side from validQuests — client cannot set arbitrary XP.
func (s *MultisigService) CompleteQuest(ctx context.Context, req *connect.Request[membav1.CompleteQuestRequest]) (*connect.Response[membav1.CompleteQuestResponse], error) {
	userAddr, err := s.authenticate(req.Msg.AuthToken)
	if err != nil {
		return nil, err
	}

	questID := strings.TrimSpace(req.Msg.QuestId)
	if _, ok := validQuests[questID]; !ok {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	now := time.Now().UTC().Format(time.RFC3339)

	// INSERT OR IGNORE — idempotent, completing twice is a no-op.
	_, err = s.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO quest_completions (address, quest_id, completed_at) VALUES (?, ?, ?)`,
		userAddr, questID, now,
	)
	if err != nil {
		return nil, internalError("CompleteQuest", err)
	}

	state, err := s.loadUserQuestState(ctx, userAddr)
	if err != nil {
		return nil, internalError("CompleteQuest.load", err)
	}

	return connect.NewResponse(&membav1.CompleteQuestResponse{State: state}), nil
}

// GetUserQuests returns quest progress for any user. No auth required (public).
func (s *MultisigService) GetUserQuests(ctx context.Context, req *connect.Request[membav1.GetUserQuestsRequest]) (*connect.Response[membav1.GetUserQuestsResponse], error) {
	addr := strings.TrimSpace(req.Msg.Address)
	if addr == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	state, err := s.loadUserQuestState(ctx, addr)
	if err != nil {
		return nil, internalError("GetUserQuests", err)
	}

	return connect.NewResponse(&membav1.GetUserQuestsResponse{State: state}), nil
}

// SyncQuests imports localStorage quest completions to backend.
// Each quest_id is validated; duplicates are ignored; completed_at is preserved.
func (s *MultisigService) SyncQuests(ctx context.Context, req *connect.Request[membav1.SyncQuestsRequest]) (*connect.Response[membav1.SyncQuestsResponse], error) {
	userAddr, err := s.authenticate(req.Msg.AuthToken)
	if err != nil {
		return nil, err
	}

	for _, c := range req.Msg.Completions {
		questID := strings.TrimSpace(c.QuestId)
		if _, ok := validQuests[questID]; !ok {
			continue // skip unknown quests
		}

		completedAt := strings.TrimSpace(c.CompletedAt)
		if completedAt == "" {
			completedAt = time.Now().UTC().Format(time.RFC3339)
		}

		_, err := s.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO quest_completions (address, quest_id, completed_at) VALUES (?, ?, ?)`,
			userAddr, questID, completedAt,
		)
		if err != nil {
			return nil, internalError("SyncQuests", err)
		}
	}

	state, err := s.loadUserQuestState(ctx, userAddr)
	if err != nil {
		return nil, internalError("SyncQuests.load", err)
	}

	return connect.NewResponse(&membav1.SyncQuestsResponse{State: state}), nil
}

// loadUserQuestState reads all completions for a user and calculates XP server-side.
func (s *MultisigService) loadUserQuestState(ctx context.Context, address string) (*membav1.UserQuestState, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT quest_id, completed_at FROM quest_completions WHERE address = ? ORDER BY completed_at`,
		address,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	state := &membav1.UserQuestState{}
	for rows.Next() {
		var qc membav1.QuestCompletion
		if err := rows.Scan(&qc.QuestId, &qc.CompletedAt); err != nil {
			return nil, err
		}
		state.Completed = append(state.Completed, &qc)
		if xp, ok := validQuests[qc.QuestId]; ok {
			state.TotalXp += xp
		}
	}
	return state, rows.Err()
}

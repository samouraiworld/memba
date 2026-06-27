package service

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/ratelimit"
)

// validQuests maps quest IDs to their XP values.
// Must match frontend/src/lib/gnobuilders.ts ALL_QUESTS array.
// GnoBuilders v2: 85 quests across 4 categories (developer, everyone, champion, hidden).
var validQuests = map[string]uint32{
	// ── Developer: Package Deployment (10) ───────────────
	"deploy-hello-pkg":      20,
	"deploy-counter-pkg":    25,
	"deploy-avl-pkg":        30,
	"deploy-interface-pkg":  30,
	"deploy-test-pkg":       35,
	"deploy-import-pkg":     35,
	"deploy-event-pkg":      40,
	"deploy-ownable-pkg":    40,
	"deploy-upgradable-pkg": 50,
	"deploy-governance-pkg": 60,

	// ── Developer: Realm Deployment (10) ─────────────────
	"deploy-hello-realm":       20,
	"deploy-grc20-realm":       30,
	"deploy-grc721-realm":      35,
	"deploy-board-realm":       30,
	"deploy-dao-realm":         40,
	"deploy-crossing-realm":    45,
	"deploy-escrow-realm":      50,
	"deploy-marketplace-realm": 50,
	"deploy-multisig-realm":    55,
	"deploy-full-dapp":         75,

	// ── Developer: Advanced (10) ─────────────────────────
	"write-10-tests":      30,
	"fix-upstream-bug":    100,
	"audit-realm":         40,
	"deploy-3-chains":     45,
	"build-mcp-tool":      50,
	"gas-optimization":    40,
	"render-masterclass":  30,
	"gnodaokit-extension": 60,
	"deploy-ibc-realm":    75,
	"mentor-developer":    50,

	// ── Everyone: Getting Started (10) ───────────────────
	"connect-wallet":    10,
	"setup-profile":     15,
	"register-username": 20,
	"first-transaction": 15,
	"visit-5-pages":     10,
	"use-cmdk":          10,
	"switch-network":    15,
	"view-validator":    10,
	"faucet-claim":      10,
	"read-docs":         10,

	// ── Everyone: DAO Participation (10) ─────────────────
	"join-dao":           25,
	"create-dao":         30,
	"vote-proposal":      20,
	"create-proposal":    25,
	"vote-5-proposals":   30,
	"execute-proposal":   25,
	"post-board":         15,
	"reply-board":        10,
	"browse-proposals":   15,
	"submit-candidature": 20,

	// ── Everyone: Token & NFT (5) ────────────────────────
	"create-token":  25,
	"send-tokens":   15,
	"mint-nft":      20,
	"list-nft":      20,
	"hold-5-tokens": 25,

	// ── Everyone: Social & Community (5) ─────────────────
	"follow-twitter":  10,
	"join-discord":    10,
	"share-link":      10,
	"submit-feedback": 20,
	"invite-member":   15,

	// ── Champion (15) ────────────────────────────────────
	"complete-all-everyone": 50,
	"top-10-leaderboard":    50,
	"earn-500-xp":           25,
	"earn-1000-xp":          50,
	"3-dao-member":          35,
	"create-team":           30,
	"10-board-posts":        30,
	"treasury-contributor":  25,
	"gnolove-top-20":        40,
	"ai-report-reader":      20,
	"multisig-signer":       30,
	"channel-active":        25,
	"weekly-login":          20,
	"help-newcomer":         15,
	"validator-delegator":   30,

	// ── Hidden & Seasonal (10) ───────────────────────────
	"easter-egg-konami":   15,
	"night-owl":           10,
	"speed-runner":        25,
	"first-100-users":     50,
	"perfect-week":        30,
	"directory-deep-dive": 20,
	"all-networks":        25,
	"genesis-dao-voter":   35,
	"bug-hunter":          40,
	"season-1-complete":   100,

	// ── Legacy v1 IDs (backward compat, mapped to v2 equivalents) ──
	// These are kept so existing completions still count toward XP.
	// "view-profile" was removed in v2 (replaced by "setup-profile")
	// "directory-tabs" was removed in v2 (replaced by "directory-deep-dive")
	// Keep accepting them so existing completions don't break.
	"view-profile":   10,
	"directory-tabs": 15,
}

// selfReportQuests is the set of quest IDs that require manual proof submission.
// Only these quests can be submitted via SubmitQuestClaim.
var selfReportQuests = map[string]bool{
	"deploy-test-pkg":     true,
	"deploy-full-dapp":    true,
	"write-10-tests":      true,
	"fix-upstream-bug":    true,
	"audit-realm":         true,
	"build-mcp-tool":      true,
	"gas-optimization":    true,
	"gnodaokit-extension": true,
	"mentor-developer":    true,
	"bug-hunter":          true,
}

// rankThresholds maps tier numbers to XP thresholds.
// Must match frontend/src/lib/gnobuilders.ts RANK_TIERS.
var rankThresholds = []struct {
	Tier int
	Name string
	XP   uint32
}{
	{0, "Newcomer", 0},
	{1, "Bronze Explorer", 50},
	{2, "Silver Builder", 150},
	{3, "Gold Architect", 350},
	{4, "Platinum Master", 600},
	{5, "Diamond Sage", 1000},
	{6, "Obsidian Legend", 1500},
	{7, "Gno Guardian", 2000},
}

// calculateRankTier returns the rank tier and name for a given XP value.
func calculateRankTier(xp uint32) (int, string) {
	tier, name := 0, "Newcomer"
	for _, r := range rankThresholds {
		if xp >= r.XP {
			tier, name = r.Tier, r.Name
		} else {
			break
		}
	}
	return tier, name
}

// CompleteQuest marks a quest as completed for the authenticated user.
// XP is calculated server-side from validQuests — client cannot set arbitrary XP.
//
// NOTE: Prerequisites are NOT validated server-side. The frontend enforces prerequisite
// chains via questVerifier.ts. A malicious client could skip prerequisites, but since
// XP values per quest are fixed and the backend is the XP authority, the worst case is
// a user completing a quest out of order — which is a UX issue, not a security issue.
func (s *MultisigService) CompleteQuest(ctx context.Context, req *connect.Request[membav1.CompleteQuestRequest]) (*connect.Response[membav1.CompleteQuestResponse], error) {
	userAddr, err := s.authenticate(req.Msg.AuthToken)
	if err != nil {
		return nil, err
	}

	// Q-03: per-address quota, checked before the expensive on-chain verify so a
	// sybil/farming wallet can't fan out the verification load (Q-04) or grind XP.
	if err := s.rateLimitUser(userAddr, ratelimit.QuestWriteEndpoint); err != nil {
		return nil, err
	}

	questID := strings.TrimSpace(req.Msg.QuestId)
	if _, ok := validQuests[questID]; !ok {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	proof := strings.TrimSpace(req.Msg.Proof)
	if len(proof) > maxProofURLLen {
		proof = proof[:maxProofURLLen]
	}
	// Store deploy proofs in canonical package-root form so the distinct-path key
	// (which verifyDeployQuest compares against) matches regardless of aliasing.
	// A non-canonicalizable proof is left as-is and rejected by verification.
	if strings.HasPrefix(questID, "deploy-") {
		if canon, ok := canonicalizeProof(proof); ok {
			proof = canon
		}
	}

	// P0-1: server-side verification. The client's claim that it passed the
	// frontend verifier is never trusted — self_report/social quests require
	// the SubmitQuestClaim review flow, and on_chain quests are re-verified
	// on-chain at grant time (deploy quests verify the proof realm path is under
	// the user's namespace). This closes direct-RPC leaderboard fabrication.
	if err := s.verifyQuestCompletable(ctx, userAddr, questID, proof); err != nil {
		return nil, err
	}

	now := time.Now().UTC().Format(time.RFC3339)

	// INSERT OR IGNORE — idempotent, completing twice is a no-op. proof is the
	// deploy realm path (empty for non-deploy quests).
	_, err = s.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO quest_completions (address, quest_id, completed_at, proof) VALUES (?, ?, ?, ?)`,
		userAddr, questID, now, proof,
	)
	if err != nil {
		return nil, internalError("CompleteQuest", err)
	}

	state, err := s.loadUserQuestState(ctx, userAddr)
	if err != nil {
		return nil, internalError("CompleteQuest.load", err)
	}

	// Auto-grant server-derived XP-milestone meta-quests, then reload so the response
	// reflects them. (The client-claim path for meta-quests is rejected.)
	if s.grantDerivedMetaQuests(ctx, userAddr, state) {
		if state, err = s.loadUserQuestState(ctx, userAddr); err != nil {
			return nil, internalError("CompleteQuest.reload", err)
		}
	}

	// Update rank cache
	s.updateUserRankCache(ctx, userAddr, state)

	// Queue badge mint for this quest (processed when chain is available)
	s.queueBadgeMint(ctx, userAddr, questID)

	// Check if user reached a new rank tier — queue rank badge mint
	s.checkAndQueueRankBadge(ctx, userAddr, state.TotalXp)

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

	// Q-03: per-address quota — SyncQuests re-verifies a whole batch on-chain, so
	// it shares the same write bucket as CompleteQuest.
	if err := s.rateLimitUser(userAddr, ratelimit.QuestWriteEndpoint); err != nil {
		return nil, err
	}

	completions := req.Msg.Completions
	if len(completions) > maxSyncBatch {
		completions = completions[:maxSyncBatch]
	}

	for _, c := range completions {
		questID := strings.TrimSpace(c.QuestId)
		if _, ok := validQuests[questID]; !ok {
			continue // skip unknown quests
		}

		// P0-1: apply the same server-side gate as CompleteQuest — skip
		// self_report/social entries and on_chain entries whose condition
		// isn't met. Prevents SyncQuests being a bulk forgery amplifier.
		// Sync carries no proof, so deploy quests can't sync-complete (they
		// must go through CompleteQuest with the realm path).
		if err := s.verifyQuestCompletable(ctx, userAddr, questID, ""); err != nil {
			continue
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

	// Auto-grant server-derived meta-quests from the synced totals, then reload.
	if s.grantDerivedMetaQuests(ctx, userAddr, state) {
		if state, err = s.loadUserQuestState(ctx, userAddr); err != nil {
			return nil, internalError("SyncQuests.reload", err)
		}
	}

	// Update rank cache after sync
	s.updateUserRankCache(ctx, userAddr, state)

	return connect.NewResponse(&membav1.SyncQuestsResponse{State: state}), nil
}

// grantDerivedMetaQuests grants the server-derived XP-milestone meta-quests
// (earn-500-xp / earn-1000-xp) from authoritative state — they are never client-
// claimable (verifyQuestCompletable rejects them). Returns true if it inserted any,
// so the caller reloads state. (complete-all-everyone / top-10-leaderboard derivation
// — category set / leaderboard position — is deferred; they stay non-claimable.)
func (s *MultisigService) grantDerivedMetaQuests(ctx context.Context, addr string, state *membav1.UserQuestState) bool {
	completed := make(map[string]bool, len(state.Completed))
	for _, c := range state.Completed {
		completed[c.QuestId] = true
	}
	now := time.Now().UTC().Format(time.RFC3339)
	granted := false
	grant := func(id string) {
		if completed[id] {
			return
		}
		if _, err := s.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO quest_completions (address, quest_id, completed_at, proof) VALUES (?, ?, ?, '')`,
			addr, id, now); err == nil {
			granted = true
		}
	}
	if state.TotalXp >= 500 {
		grant("earn-500-xp")
	}
	if state.TotalXp >= 1000 {
		grant("earn-1000-xp")
	}
	return granted
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

// ── GnoBuilders: Rank & Leaderboard RPCs ────────────────────

// GetUserRank returns the rank info for a given user address (public, no auth).
func (s *MultisigService) GetUserRank(ctx context.Context, req *connect.Request[membav1.GetUserRankRequest]) (*connect.Response[membav1.GetUserRankResponse], error) {
	addr := strings.TrimSpace(req.Msg.Address)
	if addr == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	state, err := s.loadUserQuestState(ctx, addr)
	if err != nil {
		return nil, internalError("GetUserRank", err)
	}

	tier, name := calculateRankTier(state.TotalXp)

	// Calculate XP to next rank
	var nextRankXP uint32
	if tier+1 < len(rankThresholds) {
		nextRankXP = rankThresholds[tier+1].XP - state.TotalXp
	}

	rank := &membav1.RankInfo{
		Tier:            uint32(tier), // #nosec G115 -- tier is 0-7
		Name:            name,
		TotalXp:         state.TotalXp,
		QuestsCompleted: uint32(len(state.Completed)), // #nosec G115 -- max 85 quests
		NextRankXp:      nextRankXP,
	}

	return connect.NewResponse(&membav1.GetUserRankResponse{Rank: rank}), nil
}

// GetLeaderboard returns the top users ranked by XP (public, no auth).
// Uses user_ranks cache table for efficient pagination.
// Falls back to computing from quest_completions if cache is empty.
func (s *MultisigService) GetLeaderboard(ctx context.Context, req *connect.Request[membav1.GetLeaderboardRequest]) (*connect.Response[membav1.GetLeaderboardResponse], error) {
	limit := req.Msg.Limit
	if limit == 0 || limit > 100 {
		limit = 50
	}
	offset := req.Msg.Offset

	// Count total users
	var totalCount uint32
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(DISTINCT address) FROM quest_completions`,
	).Scan(&totalCount)
	if err != nil {
		return nil, internalError("GetLeaderboard.count", err)
	}

	// A7: Bound offset — return empty if offset >= totalCount (avoids slow-path DoS)
	if offset >= totalCount {
		return connect.NewResponse(&membav1.GetLeaderboardResponse{
			Entries:    nil,
			TotalCount: totalCount,
		}), nil
	}

	// Staleness check: if the cache holds fewer users than exist in
	// quest_completions, it's incomplete/stale — rebuild from source rather than
	// serving a short or wrong page. (Previously the recompute only fired when
	// the cache was entirely empty, so a partially-populated cache could
	// silently diverge from quest_completions.)
	var cachedCount uint32
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_ranks`).Scan(&cachedCount); err != nil {
		return nil, internalError("GetLeaderboard.cacheCount", err)
	}
	if cachedCount < totalCount {
		entries, err := s.computeLeaderboard(ctx, limit, offset)
		if err != nil {
			return nil, err
		}
		return connect.NewResponse(&membav1.GetLeaderboardResponse{
			Entries:    entries,
			TotalCount: totalCount,
		}), nil
	}

	// Fast path: read from the (fresh) cache with deterministic ordering so
	// pagination is stable across requests (ties broken by quests then address).
	rows, err := s.db.QueryContext(ctx,
		`SELECT ur.address, ur.rank_tier, ur.rank_name, ur.total_xp, ur.quests_completed,
		        COALESCE(p.title, '') as username, COALESCE(p.avatar_url, '') as avatar_url
		 FROM user_ranks ur
		 LEFT JOIN profiles p ON ur.address = p.address
		 ORDER BY ur.total_xp DESC, ur.quests_completed DESC, ur.address ASC
		 LIMIT ? OFFSET ?`,
		limit, offset,
	)
	if err != nil {
		return nil, internalError("GetLeaderboard.cache", err)
	}
	defer func() { _ = rows.Close() }()

	var entries []*membav1.LeaderboardEntry
	for rows.Next() {
		var e membav1.LeaderboardEntry
		if err := rows.Scan(&e.Address, &e.RankTier, &e.RankName, &e.TotalXp, &e.QuestsCompleted, &e.Username, &e.AvatarUrl); err != nil {
			return nil, internalError("GetLeaderboard.cacheScan", err)
		}
		entries = append(entries, &e)
	}
	if err := rows.Err(); err != nil {
		return nil, internalError("GetLeaderboard.cacheRows", err)
	}

	return connect.NewResponse(&membav1.GetLeaderboardResponse{
		Entries:    entries,
		TotalCount: totalCount,
	}), nil
}

// computeLeaderboard computes the leaderboard from quest_completions using
// a single aggregation query (no N+1). Also populates the user_ranks cache.
//
// A7: Fixed self-deadlock — rows are collected and the cursor is closed BEFORE
// writing to user_ranks. On MaxOpenConns(1) SQLite, the old code deadlocked
// because ExecContext tried to acquire the only connection while the query
// cursor was still open.
func (s *MultisigService) computeLeaderboard(ctx context.Context, limit, offset uint32) ([]*membav1.LeaderboardEntry, error) {
	// Get all users with their quest IDs in a single query
	rows, err := s.db.QueryContext(ctx,
		`SELECT address, GROUP_CONCAT(quest_id) as quest_ids, COUNT(*) as quest_count
		 FROM quest_completions
		 GROUP BY address`,
	)
	if err != nil {
		return nil, internalError("computeLeaderboard", err)
	}

	type userXP struct {
		addr           string
		totalXP        uint32
		questsComplete uint32
	}
	var users []userXP

	// A7: Collect ALL rows first — do NOT write to DB inside the cursor loop
	for rows.Next() {
		var addr, questIDs string
		var questCount uint32
		if err := rows.Scan(&addr, &questIDs, &questCount); err != nil {
			_ = rows.Close()
			return nil, internalError("computeLeaderboard.scan", err)
		}

		// Calculate XP from quest IDs in Go (avoids needing XP in DB)
		var totalXP uint32
		for _, qid := range strings.Split(questIDs, ",") {
			if xp, ok := validQuests[qid]; ok {
				totalXP += xp
			}
		}

		users = append(users, userXP{addr, totalXP, questCount})
	}
	// Close cursor BEFORE any writes — prevents MaxOpenConns(1) self-deadlock
	if err := rows.Close(); err != nil {
		return nil, internalError("computeLeaderboard.close", err)
	}
	if err := rows.Err(); err != nil {
		return nil, internalError("computeLeaderboard.rows", err)
	}

	// Now populate the user_ranks cache (cursor is closed, connection is free)
	for _, u := range users {
		tier, name := calculateRankTier(u.totalXP)
		_, _ = s.db.ExecContext(ctx,
			`INSERT OR REPLACE INTO user_ranks (address, rank_tier, rank_name, total_xp, quests_completed, updated_at)
			 VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
			u.addr, tier, name, u.totalXP, u.questsComplete,
		)
	}

	// Sort by XP desc, with a deterministic tiebreak (quests desc, address asc)
	// so pagination is stable and matches the cache fast-path ordering.
	sort.Slice(users, func(i, j int) bool {
		if users[i].totalXP != users[j].totalXP {
			return users[i].totalXP > users[j].totalXP
		}
		if users[i].questsComplete != users[j].questsComplete {
			return users[i].questsComplete > users[j].questsComplete
		}
		return users[i].addr < users[j].addr
	})

	// Apply pagination
	start := int(offset)
	if start >= len(users) {
		return nil, nil
	}
	end := start + int(limit)
	if end > len(users) {
		end = len(users)
	}

	var entries []*membav1.LeaderboardEntry
	for _, u := range users[start:end] {
		tier, rankName := calculateRankTier(u.totalXP)
		entries = append(entries, &membav1.LeaderboardEntry{
			Address:         u.addr,
			RankTier:        uint32(tier), // #nosec G115 -- tier is 0-7
			RankName:        rankName,
			TotalXp:         u.totalXP,
			QuestsCompleted: u.questsComplete,
		})
	}
	return entries, nil
}

// updateUserRankCache updates the user_ranks cache after a quest completion.
func (s *MultisigService) updateUserRankCache(ctx context.Context, address string, state *membav1.UserQuestState) {
	tier, name := calculateRankTier(state.TotalXp)
	_, _ = s.db.ExecContext(ctx,
		`INSERT OR REPLACE INTO user_ranks (address, rank_tier, rank_name, total_xp, quests_completed, updated_at)
		 VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
		address, tier, name, state.TotalXp, len(state.Completed),
	)
}

// ── GnoBuilders: Quest Claim RPCs ───────────────────────────

const (
	maxProofURLLen  = 2048
	maxProofTextLen = 5000
	maxSyncBatch    = 200
)

// SubmitQuestClaim allows a user to submit proof for a self-report quest.
func (s *MultisigService) SubmitQuestClaim(ctx context.Context, req *connect.Request[membav1.SubmitQuestClaimRequest]) (*connect.Response[membav1.SubmitQuestClaimResponse], error) {
	userAddr, err := s.authenticate(req.Msg.AuthToken)
	if err != nil {
		return nil, err
	}

	// Q-03: stricter per-address quota on self-report submissions (spammable proof).
	if err := s.rateLimitUser(userAddr, ratelimit.QuestClaimEndpoint); err != nil {
		return nil, err
	}

	questID := strings.TrimSpace(req.Msg.QuestId)
	if _, ok := validQuests[questID]; !ok {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	// Only allow claims for self_report quests. Other verification types
	// are handled automatically by the frontend or on-chain verifiers.
	if _, isSelfReport := selfReportQuests[questID]; !isSelfReport {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	proofURL := strings.TrimSpace(req.Msg.ProofUrl)
	proofText := strings.TrimSpace(req.Msg.ProofText)
	if proofURL == "" && proofText == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}
	if len(proofURL) > maxProofURLLen {
		proofURL = proofURL[:maxProofURLLen]
	}
	if len(proofText) > maxProofTextLen {
		proofText = proofText[:maxProofTextLen]
	}

	_, err = s.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO quest_claims (address, quest_id, proof_url, proof_text) VALUES (?, ?, ?, ?)`,
		userAddr, questID, proofURL, proofText,
	)
	if err != nil {
		return nil, internalError("SubmitQuestClaim", err)
	}

	return connect.NewResponse(&membav1.SubmitQuestClaimResponse{Status: "pending"}), nil
}

// ── Badge Minting Queue ─────────────────────────────────────

// queueBadgeMint queues an NFT badge mint for a quest completion.
// The actual on-chain mint happens when a background worker processes the queue
// (or an admin triggers it). INSERT OR IGNORE prevents duplicates.
func (s *MultisigService) queueBadgeMint(ctx context.Context, address, questID string) {
	_, _ = s.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO badge_mints (address, quest_id, mint_status, created_at)
		 VALUES (?, ?, 'pending', CURRENT_TIMESTAMP)`,
		address, questID,
	)
}

// checkAndQueueRankBadge checks if the user reached a new rank tier and queues a mint.
func (s *MultisigService) checkAndQueueRankBadge(ctx context.Context, address string, totalXP uint32) {
	tier, _ := calculateRankTier(totalXP)
	if tier == 0 {
		return // Newcomer gets no badge
	}

	rankQuestID := "rank:" + strings.TrimSpace(fmt.Sprintf("%d", tier))

	// Check if already queued
	var count int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM badge_mints WHERE address = ? AND quest_id = ?`,
		address, rankQuestID,
	).Scan(&count)
	if err != nil || count > 0 {
		return // Already queued or error
	}

	_, _ = s.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO badge_mints (address, quest_id, mint_status, created_at)
		 VALUES (?, ?, 'pending', CURRENT_TIMESTAMP)`,
		address, rankQuestID,
	)
}

// ── Admin: Quest Claim Review ───────────────────────────────

// defaultQuestAdmins is the built-in set of addresses authorized to review quest
// claims, used when QUEST_ADMIN_ADDRESSES is unset (the samcrew-core-test1
// multisig + deployer address).
var defaultQuestAdmins = map[string]bool{
	"g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0": true, // samcrew-core-test1
}

// questAdminAddresses returns the addresses allowed to review quest claims.
// QUEST_ADMIN_ADDRESSES (comma-separated) REPLACES the built-in default — so
// admins can be added/rotated via env without a code change/redeploy, and the
// privileged set isn't hard-pinned in source. Unset/empty keeps the default.
func questAdminAddresses() map[string]bool {
	if v := strings.TrimSpace(os.Getenv("QUEST_ADMIN_ADDRESSES")); v != "" {
		out := make(map[string]bool)
		for _, a := range strings.Split(v, ",") {
			if t := strings.TrimSpace(a); t != "" {
				out[t] = true
			}
		}
		return out
	}
	return defaultQuestAdmins
}

// ReviewQuestClaim approves or rejects a self-report quest claim.
// Only admin addresses can review claims. If approved, the quest is completed.
func (s *MultisigService) ReviewQuestClaim(ctx context.Context, req *connect.Request[membav1.ReviewQuestClaimRequest]) (*connect.Response[membav1.ReviewQuestClaimResponse], error) {
	reviewerAddr, err := s.authenticate(req.Msg.AuthToken)
	if err != nil {
		return nil, err
	}

	if !questAdminAddresses()[reviewerAddr] {
		return nil, connect.NewError(connect.CodePermissionDenied, nil)
	}

	claimID := req.Msg.ClaimId
	approved := req.Msg.Approved

	// Fetch the claim
	var claimAddr, questID, status string
	err = s.db.QueryRowContext(ctx,
		`SELECT address, quest_id, status FROM quest_claims WHERE id = ?`,
		claimID,
	).Scan(&claimAddr, &questID, &status)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, nil)
	}
	if status != "pending" {
		return nil, connect.NewError(connect.CodeFailedPrecondition, nil)
	}

	// Update claim status
	newStatus := "rejected"
	if approved {
		newStatus = "approved"
	}

	_, err = s.db.ExecContext(ctx,
		`UPDATE quest_claims SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`,
		newStatus, reviewerAddr, claimID,
	)
	if err != nil {
		return nil, internalError("ReviewQuestClaim.update", err)
	}

	// If approved, complete the quest for the user
	if approved {
		now := time.Now().UTC().Format(time.RFC3339)
		_, _ = s.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO quest_completions (address, quest_id, completed_at) VALUES (?, ?, ?)`,
			claimAddr, questID, now,
		)

		// Update rank cache
		state, err := s.loadUserQuestState(ctx, claimAddr)
		if err == nil {
			s.updateUserRankCache(ctx, claimAddr, state)
			s.queueBadgeMint(ctx, claimAddr, questID)
			s.checkAndQueueRankBadge(ctx, claimAddr, state.TotalXp)
		}
	}

	return connect.NewResponse(&membav1.ReviewQuestClaimResponse{Status: newStatus}), nil
}

// ListPendingClaims returns all pending quest claims for admin review.
// Only admin addresses can list claims.
func (s *MultisigService) ListPendingClaims(ctx context.Context, req *connect.Request[membav1.ListPendingClaimsRequest]) (*connect.Response[membav1.ListPendingClaimsResponse], error) {
	callerAddr, err := s.authenticate(req.Msg.AuthToken)
	if err != nil {
		return nil, err
	}

	if !questAdminAddresses()[callerAddr] {
		return nil, connect.NewError(connect.CodePermissionDenied, nil)
	}

	rows, err := s.db.QueryContext(ctx,
		`SELECT id, address, quest_id, proof_url, proof_text, status, created_at
		 FROM quest_claims
		 WHERE status = 'pending'
		 ORDER BY created_at ASC
		 LIMIT 100`,
	)
	if err != nil {
		return nil, internalError("ListPendingClaims", err)
	}
	defer func() { _ = rows.Close() }()

	var claims []*membav1.QuestClaim
	for rows.Next() {
		var c membav1.QuestClaim
		if err := rows.Scan(&c.Id, &c.Address, &c.QuestId, &c.ProofUrl, &c.ProofText, &c.Status, &c.CreatedAt); err != nil {
			return nil, internalError("ListPendingClaims.scan", err)
		}
		claims = append(claims, &c)
	}

	return connect.NewResponse(&membav1.ListPendingClaimsResponse{Claims: claims}), nil
}

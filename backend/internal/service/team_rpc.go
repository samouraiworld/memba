package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

const (
	maxTeamNameLen   = 64
	maxTeamDescLen   = 500
	inviteCodeLen    = 8
	maxTeamsPerUser  = 20
)

// generateID returns a 16-byte hex string (UUID-like).
func generateID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// generateInviteCode returns an 8-char alphanumeric string.
func generateInviteCode() (string, error) {
	const charset = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, inviteCodeLen)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = charset[b[i]%byte(len(charset))]
	}
	return string(b), nil
}

// CreateTeam creates a new team. The creator becomes an admin member.
func (s *MultisigService) CreateTeam(ctx context.Context, req *connect.Request[membav1.CreateTeamRequest]) (*connect.Response[membav1.CreateTeamResponse], error) {
	userAddr, err := s.authenticate(req.Msg.AuthToken)
	if err != nil {
		return nil, err
	}

	name := strings.TrimSpace(req.Msg.Name)
	if name == "" || len(name) > maxTeamNameLen {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("name must be 1-%d chars", maxTeamNameLen))
	}

	description := strings.TrimSpace(req.Msg.Description)
	if len(description) > maxTeamDescLen {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("description must be ≤%d chars", maxTeamDescLen))
	}

	// Check team limit per user
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM team_members WHERE address = ?`, userAddr).Scan(&count); err != nil {
		return nil, internalError("CreateTeam.count", err)
	}
	if count >= maxTeamsPerUser {
		return nil, connect.NewError(connect.CodeResourceExhausted, fmt.Errorf("max %d teams per user", maxTeamsPerUser))
	}

	teamID, err := generateID()
	if err != nil {
		return nil, internalError("CreateTeam.id", err)
	}
	inviteCode, err := generateInviteCode()
	if err != nil {
		return nil, internalError("CreateTeam.invite", err)
	}

	now := time.Now().UTC().Format(time.RFC3339)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, internalError("CreateTeam.tx", err)
	}
	defer func() { _ = tx.Rollback() }()

	_, err = tx.ExecContext(ctx,
		`INSERT INTO teams (id, name, description, invite_code, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		teamID, name, description, inviteCode, userAddr, now,
	)
	if err != nil {
		return nil, internalError("CreateTeam.insert", err)
	}

	_, err = tx.ExecContext(ctx,
		`INSERT INTO team_members (team_id, address, role, joined_at) VALUES (?, ?, 'admin', ?)`,
		teamID, userAddr, now,
	)
	if err != nil {
		return nil, internalError("CreateTeam.member", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, internalError("CreateTeam.commit", err)
	}

	team, err := s.loadTeam(ctx, teamID)
	if err != nil {
		return nil, internalError("CreateTeam.load", err)
	}

	return connect.NewResponse(&membav1.CreateTeamResponse{Team: team}), nil
}

// GetTeam returns a team by ID. Caller must be a member.
func (s *MultisigService) GetTeam(ctx context.Context, req *connect.Request[membav1.GetTeamRequest]) (*connect.Response[membav1.GetTeamResponse], error) {
	userAddr, err := s.authenticate(req.Msg.AuthToken)
	if err != nil {
		return nil, err
	}

	teamID := strings.TrimSpace(req.Msg.TeamId)
	if teamID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	if !s.isTeamMember(ctx, teamID, userAddr) {
		return nil, connect.NewError(connect.CodePermissionDenied, fmt.Errorf("not a team member"))
	}

	team, err := s.loadTeam(ctx, teamID)
	if err != nil {
		return nil, internalError("GetTeam", err)
	}

	return connect.NewResponse(&membav1.GetTeamResponse{Team: team}), nil
}

// GetMyTeams returns all teams the authenticated user belongs to.
func (s *MultisigService) GetMyTeams(ctx context.Context, req *connect.Request[membav1.GetMyTeamsRequest]) (*connect.Response[membav1.GetMyTeamsResponse], error) {
	userAddr, err := s.authenticate(req.Msg.AuthToken)
	if err != nil {
		return nil, err
	}

	// Collect team IDs first, then close rows before calling loadTeam
	// (SQLite MaxOpenConns=1 — nested queries on the same conn deadlock).
	rows, err := s.db.QueryContext(ctx,
		`SELECT t.id FROM teams t
		 JOIN team_members tm ON tm.team_id = t.id
		 WHERE tm.address = ?
		 ORDER BY t.created_at DESC`,
		userAddr,
	)
	if err != nil {
		return nil, internalError("GetMyTeams.query", err)
	}

	var teamIDs []string
	for rows.Next() {
		var teamID string
		if err := rows.Scan(&teamID); err != nil {
			_ = rows.Close()
			return nil, internalError("GetMyTeams.scan", err)
		}
		teamIDs = append(teamIDs, teamID)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, internalError("GetMyTeams.rows", err)
	}
	_ = rows.Close()

	var teams []*membav1.Team
	for _, id := range teamIDs {
		team, err := s.loadTeam(ctx, id)
		if err != nil {
			return nil, internalError("GetMyTeams.load", err)
		}
		teams = append(teams, team)
	}

	return connect.NewResponse(&membav1.GetMyTeamsResponse{Teams: teams}), nil
}

// JoinTeam adds the authenticated user to a team via invite code.
func (s *MultisigService) JoinTeam(ctx context.Context, req *connect.Request[membav1.JoinTeamRequest]) (*connect.Response[membav1.JoinTeamResponse], error) {
	userAddr, err := s.authenticate(req.Msg.AuthToken)
	if err != nil {
		return nil, err
	}

	code := strings.TrimSpace(req.Msg.InviteCode)
	if code == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invite_code required"))
	}

	// Lookup team by invite code
	var teamID string
	err = s.db.QueryRowContext(ctx,
		`SELECT id FROM teams WHERE invite_code = ?`, code,
	).Scan(&teamID)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("invalid invite code"))
	}

	// Check if already a member
	if s.isTeamMember(ctx, teamID, userAddr) {
		// Idempotent: return team without error
		team, err := s.loadTeam(ctx, teamID)
		if err != nil {
			return nil, internalError("JoinTeam.load", err)
		}
		return connect.NewResponse(&membav1.JoinTeamResponse{Team: team}), nil
	}

	// Check team limit
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM team_members WHERE address = ?`, userAddr).Scan(&count); err != nil {
		return nil, internalError("JoinTeam.count", err)
	}
	if count >= maxTeamsPerUser {
		return nil, connect.NewError(connect.CodeResourceExhausted, fmt.Errorf("max %d teams per user", maxTeamsPerUser))
	}

	now := time.Now().UTC().Format(time.RFC3339)
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO team_members (team_id, address, role, joined_at) VALUES (?, ?, 'member', ?)`,
		teamID, userAddr, now,
	)
	if err != nil {
		return nil, internalError("JoinTeam.insert", err)
	}

	team, err := s.loadTeam(ctx, teamID)
	if err != nil {
		return nil, internalError("JoinTeam.load", err)
	}

	return connect.NewResponse(&membav1.JoinTeamResponse{Team: team}), nil
}

// LeaveTeam removes the authenticated user from a team.
// The last admin cannot leave — they must transfer admin role first.
func (s *MultisigService) LeaveTeam(ctx context.Context, req *connect.Request[membav1.LeaveTeamRequest]) (*connect.Response[membav1.LeaveTeamResponse], error) {
	userAddr, err := s.authenticate(req.Msg.AuthToken)
	if err != nil {
		return nil, err
	}

	teamID := strings.TrimSpace(req.Msg.TeamId)
	if teamID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	if !s.isTeamMember(ctx, teamID, userAddr) {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("not a member of this team"))
	}

	// Prevent last admin from leaving
	var role string
	_ = s.db.QueryRowContext(ctx,
		`SELECT role FROM team_members WHERE team_id = ? AND address = ?`,
		teamID, userAddr,
	).Scan(&role)

	if role == "admin" {
		var adminCount int
		_ = s.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM team_members WHERE team_id = ? AND role = 'admin'`,
			teamID,
		).Scan(&adminCount)
		if adminCount <= 1 {
			// Check if there are other members
			var totalMembers int
			_ = s.db.QueryRowContext(ctx,
				`SELECT COUNT(*) FROM team_members WHERE team_id = ?`,
				teamID,
			).Scan(&totalMembers)
			if totalMembers > 1 {
				return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("last admin cannot leave — transfer admin role first"))
			}
			// Last member leaving: delete the whole team
			_, _ = s.db.ExecContext(ctx, `DELETE FROM team_members WHERE team_id = ?`, teamID)
			_, _ = s.db.ExecContext(ctx, `DELETE FROM teams WHERE id = ?`, teamID)
			return connect.NewResponse(&membav1.LeaveTeamResponse{}), nil
		}
	}

	_, err = s.db.ExecContext(ctx,
		`DELETE FROM team_members WHERE team_id = ? AND address = ?`,
		teamID, userAddr,
	)
	if err != nil {
		return nil, internalError("LeaveTeam.delete", err)
	}

	return connect.NewResponse(&membav1.LeaveTeamResponse{}), nil
}

// UpdateTeamMemberRole changes a member's role. Only admins can do this.
func (s *MultisigService) UpdateTeamMemberRole(ctx context.Context, req *connect.Request[membav1.UpdateTeamMemberRoleRequest]) (*connect.Response[membav1.UpdateTeamMemberRoleResponse], error) {
	userAddr, err := s.authenticate(req.Msg.AuthToken)
	if err != nil {
		return nil, err
	}

	teamID := strings.TrimSpace(req.Msg.TeamId)
	targetAddr := strings.TrimSpace(req.Msg.MemberAddress)
	if teamID == "" || targetAddr == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	// Caller must be admin
	if !s.isTeamAdmin(ctx, teamID, userAddr) {
		return nil, connect.NewError(connect.CodePermissionDenied, fmt.Errorf("admin role required"))
	}

	// Target must be a member
	if !s.isTeamMember(ctx, teamID, targetAddr) {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("target is not a team member"))
	}

	var roleStr string
	switch req.Msg.Role {
	case membav1.TeamRole_TEAM_ROLE_ADMIN:
		roleStr = "admin"
	case membav1.TeamRole_TEAM_ROLE_MEMBER:
		roleStr = "member"
	default:
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid role"))
	}

	// Prevent demoting the last admin
	if roleStr == "member" && targetAddr == userAddr {
		var adminCount int
		_ = s.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM team_members WHERE team_id = ? AND role = 'admin'`,
			teamID,
		).Scan(&adminCount)
		if adminCount <= 1 {
			return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("cannot demote the last admin"))
		}
	}

	_, err = s.db.ExecContext(ctx,
		`UPDATE team_members SET role = ? WHERE team_id = ? AND address = ?`,
		roleStr, teamID, targetAddr,
	)
	if err != nil {
		return nil, internalError("UpdateTeamMemberRole.update", err)
	}

	team, err := s.loadTeam(ctx, teamID)
	if err != nil {
		return nil, internalError("UpdateTeamMemberRole.load", err)
	}

	return connect.NewResponse(&membav1.UpdateTeamMemberRoleResponse{Team: team}), nil
}

// ── Helpers ─────────────────────────────────────────────────

func (s *MultisigService) loadTeam(ctx context.Context, teamID string) (*membav1.Team, error) {
	// Single query with LEFT JOIN to avoid nested queries on SQLite's single connection.
	rows, err := s.db.QueryContext(ctx,
		`SELECT t.name, t.description, t.invite_code, t.created_by, t.created_at,
		        tm.address, tm.role, tm.joined_at
		 FROM teams t
		 LEFT JOIN team_members tm ON tm.team_id = t.id
		 WHERE t.id = ?
		 ORDER BY tm.joined_at`,
		teamID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	team := &membav1.Team{Id: teamID}
	first := true
	for rows.Next() {
		var name, description, inviteCode, createdBy, createdAt string
		var addr, roleStr, joinedAt *string
		if err := rows.Scan(&name, &description, &inviteCode, &createdBy, &createdAt, &addr, &roleStr, &joinedAt); err != nil {
			return nil, err
		}
		if first {
			team.Name = name
			team.Description = description
			team.InviteCode = inviteCode
			team.CreatedBy = createdBy
			team.CreatedAt = createdAt
			first = false
		}
		if addr != nil {
			m := &membav1.TeamMember{
				Address:  *addr,
				Role:     membav1.TeamRole_TEAM_ROLE_MEMBER,
				JoinedAt: "",
			}
			if joinedAt != nil {
				m.JoinedAt = *joinedAt
			}
			if roleStr != nil && *roleStr == "admin" {
				m.Role = membav1.TeamRole_TEAM_ROLE_ADMIN
			}
			team.Members = append(team.Members, m)
		}
	}
	if first {
		return nil, fmt.Errorf("team not found: %s", teamID)
	}

	return team, rows.Err()
}

func (s *MultisigService) isTeamMember(ctx context.Context, teamID, address string) bool {
	var count int
	_ = s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM team_members WHERE team_id = ? AND address = ?`,
		teamID, address,
	).Scan(&count)
	return count > 0
}

func (s *MultisigService) isTeamAdmin(ctx context.Context, teamID, address string) bool {
	var role string
	err := s.db.QueryRowContext(ctx,
		`SELECT role FROM team_members WHERE team_id = ? AND address = ?`,
		teamID, address,
	).Scan(&role)
	return err == nil && role == "admin"
}

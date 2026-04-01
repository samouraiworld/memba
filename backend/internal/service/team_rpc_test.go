package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

func TestCreateTeam_Success(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	resp, err := h.svc.CreateTeam(ctx, connect.NewRequest(&membav1.CreateTeamRequest{
		AuthToken: token,
		Name:      "Samourai Crew",
	}))
	if err != nil {
		t.Fatal("CreateTeam:", err)
	}
	team := resp.Msg.Team
	if team.Name != "Samourai Crew" {
		t.Fatalf("expected name 'Samourai Crew', got %q", team.Name)
	}
	if team.Id == "" {
		t.Fatal("expected non-empty team ID")
	}
	if team.InviteCode == "" || len(team.InviteCode) != 8 {
		t.Fatalf("expected 8-char invite code, got %q", team.InviteCode)
	}
	if team.CreatedBy != "g1alice" {
		t.Fatalf("expected created_by g1alice, got %s", team.CreatedBy)
	}
	if len(team.Members) != 1 {
		t.Fatalf("expected 1 member, got %d", len(team.Members))
	}
	if team.Members[0].Address != "g1alice" {
		t.Fatalf("expected member g1alice, got %s", team.Members[0].Address)
	}
	if team.Members[0].Role != membav1.TeamRole_TEAM_ROLE_ADMIN {
		t.Fatalf("expected admin role, got %v", team.Members[0].Role)
	}
}

func TestCreateTeam_InvalidName(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	// Empty name
	_, err := h.svc.CreateTeam(ctx, connect.NewRequest(&membav1.CreateTeamRequest{
		AuthToken: token,
		Name:      "",
	}))
	if err == nil {
		t.Fatal("expected error for empty name")
	}

	// Too long
	longName := make([]byte, 65)
	for i := range longName {
		longName[i] = 'A'
	}
	_, err = h.svc.CreateTeam(ctx, connect.NewRequest(&membav1.CreateTeamRequest{
		AuthToken: token,
		Name:      string(longName),
	}))
	if err == nil {
		t.Fatal("expected error for name >64 chars")
	}
}

func TestCreateTeam_Unauthenticated(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	_, err := h.svc.CreateTeam(ctx, connect.NewRequest(&membav1.CreateTeamRequest{
		AuthToken: nil,
		Name:      "Test",
	}))
	if err == nil {
		t.Fatal("expected error for nil token")
	}
}

func TestJoinTeam_Success(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	// Alice creates a team
	aliceToken := h.makeToken(t, "g1alice")
	createResp, err := h.svc.CreateTeam(ctx, connect.NewRequest(&membav1.CreateTeamRequest{
		AuthToken: aliceToken, Name: "Test Team",
	}))
	if err != nil {
		t.Fatal("CreateTeam:", err)
	}
	inviteCode := createResp.Msg.Team.InviteCode

	// Bob joins via invite code
	bobToken := h.makeToken(t, "g1bob")
	joinResp, err := h.svc.JoinTeam(ctx, connect.NewRequest(&membav1.JoinTeamRequest{
		AuthToken: bobToken, InviteCode: inviteCode,
	}))
	if err != nil {
		t.Fatal("JoinTeam:", err)
	}
	if len(joinResp.Msg.Team.Members) != 2 {
		t.Fatalf("expected 2 members, got %d", len(joinResp.Msg.Team.Members))
	}

	// Verify bob is a member, not admin
	var bobMember *membav1.TeamMember
	for _, m := range joinResp.Msg.Team.Members {
		if m.Address == "g1bob" {
			bobMember = m
		}
	}
	if bobMember == nil {
		t.Fatal("bob not found in members")
	}
	if bobMember.Role != membav1.TeamRole_TEAM_ROLE_MEMBER {
		t.Fatalf("expected member role, got %v", bobMember.Role)
	}
}

func TestJoinTeam_Idempotent(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	aliceToken := h.makeToken(t, "g1alice")
	createResp, _ := h.svc.CreateTeam(ctx, connect.NewRequest(&membav1.CreateTeamRequest{
		AuthToken: aliceToken, Name: "Test",
	}))
	inviteCode := createResp.Msg.Team.InviteCode

	// Alice joins again (already a member) — should succeed without error
	_, err := h.svc.JoinTeam(ctx, connect.NewRequest(&membav1.JoinTeamRequest{
		AuthToken: aliceToken, InviteCode: inviteCode,
	}))
	if err != nil {
		t.Fatal("JoinTeam (idempotent):", err)
	}
}

func TestJoinTeam_InvalidCode(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	_, err := h.svc.JoinTeam(ctx, connect.NewRequest(&membav1.JoinTeamRequest{
		AuthToken: token, InviteCode: "badcode1",
	}))
	if err == nil {
		t.Fatal("expected error for invalid invite code")
	}
}

func TestGetTeam_MemberAccess(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	aliceToken := h.makeToken(t, "g1alice")
	createResp, _ := h.svc.CreateTeam(ctx, connect.NewRequest(&membav1.CreateTeamRequest{
		AuthToken: aliceToken, Name: "Test",
	}))
	teamID := createResp.Msg.Team.Id

	// Alice can get her own team
	resp, err := h.svc.GetTeam(ctx, connect.NewRequest(&membav1.GetTeamRequest{
		AuthToken: aliceToken, TeamId: teamID,
	}))
	if err != nil {
		t.Fatal("GetTeam:", err)
	}
	if resp.Msg.Team.Name != "Test" {
		t.Fatalf("expected name 'Test', got %q", resp.Msg.Team.Name)
	}

	// Bob (non-member) cannot
	bobToken := h.makeToken(t, "g1bob")
	_, err = h.svc.GetTeam(ctx, connect.NewRequest(&membav1.GetTeamRequest{
		AuthToken: bobToken, TeamId: teamID,
	}))
	if err == nil {
		t.Fatal("expected error for non-member GetTeam")
	}
}

func TestGetMyTeams_MultipleTeams(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	aliceToken := h.makeToken(t, "g1alice")

	// Create 2 teams
	_, _ = h.svc.CreateTeam(ctx, connect.NewRequest(&membav1.CreateTeamRequest{
		AuthToken: aliceToken, Name: "Team A",
	}))
	_, _ = h.svc.CreateTeam(ctx, connect.NewRequest(&membav1.CreateTeamRequest{
		AuthToken: aliceToken, Name: "Team B",
	}))

	resp, err := h.svc.GetMyTeams(ctx, connect.NewRequest(&membav1.GetMyTeamsRequest{
		AuthToken: aliceToken,
	}))
	if err != nil {
		t.Fatal("GetMyTeams:", err)
	}
	if len(resp.Msg.Teams) != 2 {
		t.Fatalf("expected 2 teams, got %d", len(resp.Msg.Teams))
	}
}

func TestGetMyTeams_Empty(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	token := h.makeToken(t, "g1nobody")

	resp, err := h.svc.GetMyTeams(ctx, connect.NewRequest(&membav1.GetMyTeamsRequest{
		AuthToken: token,
	}))
	if err != nil {
		t.Fatal("GetMyTeams:", err)
	}
	if len(resp.Msg.Teams) != 0 {
		t.Fatalf("expected 0 teams, got %d", len(resp.Msg.Teams))
	}
}

func TestLeaveTeam_MemberLeaves(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	aliceToken := h.makeToken(t, "g1alice")
	createResp, _ := h.svc.CreateTeam(ctx, connect.NewRequest(&membav1.CreateTeamRequest{
		AuthToken: aliceToken, Name: "Test",
	}))
	teamID := createResp.Msg.Team.Id

	// Bob joins
	bobToken := h.makeToken(t, "g1bob")
	_, _ = h.svc.JoinTeam(ctx, connect.NewRequest(&membav1.JoinTeamRequest{
		AuthToken: bobToken, InviteCode: createResp.Msg.Team.InviteCode,
	}))

	// Bob leaves
	_, err := h.svc.LeaveTeam(ctx, connect.NewRequest(&membav1.LeaveTeamRequest{
		AuthToken: bobToken, TeamId: teamID,
	}))
	if err != nil {
		t.Fatal("LeaveTeam:", err)
	}

	// Verify team has 1 member
	team, _ := h.svc.GetTeam(ctx, connect.NewRequest(&membav1.GetTeamRequest{
		AuthToken: aliceToken, TeamId: teamID,
	}))
	if len(team.Msg.Team.Members) != 1 {
		t.Fatalf("expected 1 member after leave, got %d", len(team.Msg.Team.Members))
	}
}

func TestLeaveTeam_LastAdminBlocked(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	aliceToken := h.makeToken(t, "g1alice")
	createResp, _ := h.svc.CreateTeam(ctx, connect.NewRequest(&membav1.CreateTeamRequest{
		AuthToken: aliceToken, Name: "Test",
	}))
	teamID := createResp.Msg.Team.Id

	// Bob joins (as member)
	bobToken := h.makeToken(t, "g1bob")
	_, _ = h.svc.JoinTeam(ctx, connect.NewRequest(&membav1.JoinTeamRequest{
		AuthToken: bobToken, InviteCode: createResp.Msg.Team.InviteCode,
	}))

	// Alice (last admin) cannot leave when other members exist
	_, err := h.svc.LeaveTeam(ctx, connect.NewRequest(&membav1.LeaveTeamRequest{
		AuthToken: aliceToken, TeamId: teamID,
	}))
	if err == nil {
		t.Fatal("expected error: last admin cannot leave with other members")
	}
}

func TestLeaveTeam_LastMemberDeletesTeam(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	aliceToken := h.makeToken(t, "g1alice")
	createResp, _ := h.svc.CreateTeam(ctx, connect.NewRequest(&membav1.CreateTeamRequest{
		AuthToken: aliceToken, Name: "Ephemeral",
	}))
	teamID := createResp.Msg.Team.Id

	// Alice (sole member) leaves — team should be deleted
	_, err := h.svc.LeaveTeam(ctx, connect.NewRequest(&membav1.LeaveTeamRequest{
		AuthToken: aliceToken, TeamId: teamID,
	}))
	if err != nil {
		t.Fatal("LeaveTeam (last member):", err)
	}

	// Team should not exist anymore
	_, err = h.svc.GetTeam(ctx, connect.NewRequest(&membav1.GetTeamRequest{
		AuthToken: aliceToken, TeamId: teamID,
	}))
	if err == nil {
		t.Fatal("expected error: team should be deleted")
	}
}

func TestUpdateTeamMemberRole_PromoteToAdmin(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	aliceToken := h.makeToken(t, "g1alice")
	createResp, _ := h.svc.CreateTeam(ctx, connect.NewRequest(&membav1.CreateTeamRequest{
		AuthToken: aliceToken, Name: "Test",
	}))
	teamID := createResp.Msg.Team.Id

	// Bob joins
	bobToken := h.makeToken(t, "g1bob")
	_, _ = h.svc.JoinTeam(ctx, connect.NewRequest(&membav1.JoinTeamRequest{
		AuthToken: bobToken, InviteCode: createResp.Msg.Team.InviteCode,
	}))

	// Alice promotes bob to admin
	resp, err := h.svc.UpdateTeamMemberRole(ctx, connect.NewRequest(&membav1.UpdateTeamMemberRoleRequest{
		AuthToken:     aliceToken,
		TeamId:        teamID,
		MemberAddress: "g1bob",
		Role:          membav1.TeamRole_TEAM_ROLE_ADMIN,
	}))
	if err != nil {
		t.Fatal("UpdateTeamMemberRole:", err)
	}

	var bobMember *membav1.TeamMember
	for _, m := range resp.Msg.Team.Members {
		if m.Address == "g1bob" {
			bobMember = m
		}
	}
	if bobMember == nil || bobMember.Role != membav1.TeamRole_TEAM_ROLE_ADMIN {
		t.Fatal("bob should be admin after promotion")
	}
}

func TestUpdateTeamMemberRole_NonAdminBlocked(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	aliceToken := h.makeToken(t, "g1alice")
	createResp, _ := h.svc.CreateTeam(ctx, connect.NewRequest(&membav1.CreateTeamRequest{
		AuthToken: aliceToken, Name: "Test",
	}))

	bobToken := h.makeToken(t, "g1bob")
	_, _ = h.svc.JoinTeam(ctx, connect.NewRequest(&membav1.JoinTeamRequest{
		AuthToken: bobToken, InviteCode: createResp.Msg.Team.InviteCode,
	}))

	// Bob (member) tries to promote himself — should fail
	_, err := h.svc.UpdateTeamMemberRole(ctx, connect.NewRequest(&membav1.UpdateTeamMemberRoleRequest{
		AuthToken:     bobToken,
		TeamId:        createResp.Msg.Team.Id,
		MemberAddress: "g1bob",
		Role:          membav1.TeamRole_TEAM_ROLE_ADMIN,
	}))
	if err == nil {
		t.Fatal("expected error: non-admin cannot change roles")
	}
}

func TestUpdateTeamMemberRole_LastAdminCannotDemoteSelf(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	aliceToken := h.makeToken(t, "g1alice")
	createResp, _ := h.svc.CreateTeam(ctx, connect.NewRequest(&membav1.CreateTeamRequest{
		AuthToken: aliceToken, Name: "Test",
	}))

	// Alice tries to demote herself (only admin)
	_, err := h.svc.UpdateTeamMemberRole(ctx, connect.NewRequest(&membav1.UpdateTeamMemberRoleRequest{
		AuthToken:     aliceToken,
		TeamId:        createResp.Msg.Team.Id,
		MemberAddress: "g1alice",
		Role:          membav1.TeamRole_TEAM_ROLE_MEMBER,
	}))
	if err == nil {
		t.Fatal("expected error: cannot demote the last admin")
	}
}

func TestTeamIsolation(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	// Alice creates Team A
	aliceToken := h.makeToken(t, "g1alice")
	teamA, _ := h.svc.CreateTeam(ctx, connect.NewRequest(&membav1.CreateTeamRequest{
		AuthToken: aliceToken, Name: "Team A",
	}))

	// Bob creates Team B
	bobToken := h.makeToken(t, "g1bob")
	_, _ = h.svc.CreateTeam(ctx, connect.NewRequest(&membav1.CreateTeamRequest{
		AuthToken: bobToken, Name: "Team B",
	}))

	// Bob cannot access Team A
	_, err := h.svc.GetTeam(ctx, connect.NewRequest(&membav1.GetTeamRequest{
		AuthToken: bobToken, TeamId: teamA.Msg.Team.Id,
	}))
	if err == nil {
		t.Fatal("expected error: bob should not access alice's team")
	}

	// Alice sees only Team A
	aliceTeams, _ := h.svc.GetMyTeams(ctx, connect.NewRequest(&membav1.GetMyTeamsRequest{
		AuthToken: aliceToken,
	}))
	if len(aliceTeams.Msg.Teams) != 1 {
		t.Fatalf("alice should see 1 team, got %d", len(aliceTeams.Msg.Teams))
	}
	if aliceTeams.Msg.Teams[0].Name != "Team A" {
		t.Fatalf("alice should see Team A, got %q", aliceTeams.Msg.Teams[0].Name)
	}
}

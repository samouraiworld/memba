# Teams (Organizations) — Activation Plan

> **Status:** Gated behind `VITE_ENABLE_TEAMS=true`
> **Current code:** `frontend/src/pages/OrganizationsPage.tsx` + `components/org/OrgContent.tsx`
> **On-chain realm:** No dedicated realm — uses backend + localStorage

## Overview

Team workspaces for collaborative DAO management. Teams share DAOs, alerts,
and configurations across members. This is a Memba-layer feature (not on-chain)
that groups multiple wallets under a shared organizational context.

## Prerequisites

1. **Backend team model** — Need a `teams` table and CRUD RPCs (similar to profiles).
   Teams are identified by a name + invite code, members join via invite.
2. **Shared state** — Team members need to see the same saved DAOs, alert configs,
   and dashboard layouts. Currently these are per-user in localStorage.
3. **Role-based access** — Admin vs member roles for team settings management.

## Implementation Steps

### Phase 1 — Basic Teams (enable the flag)
1. Proto: Add `TeamService` RPCs (CreateTeam, JoinTeam, GetTeam, LeaveTeam)
2. Migration: `004_teams.sql` with `teams` and `team_members` tables
3. Backend: team_rpc.go implementation
4. Frontend: Team creation, invite link, member list
5. Set `VITE_ENABLE_TEAMS=true` in production

### Phase 2 — Shared Resources
1. Migrate saved DAOs from localStorage to team-scoped backend storage
2. Shared alert configurations (team-level alert subscriptions)
3. Team-level dashboard with aggregated DAO stats

### Phase 3 — Advanced
1. Role-based permissions (admin can manage team settings, members can view)
2. Team activity feed (who did what, when)
3. Cross-team DAO discovery (DAOs shared by multiple teams)

## Test Plan

- [ ] Unit tests for team CRUD RPCs
- [ ] Integration test: create team, invite member, join, verify shared state
- [ ] E2E test: teams page renders member list
- [ ] Test invite code expiry and reuse prevention
- [ ] Verify team isolation (Team A cannot see Team B's resources)

## Rollout Criteria

- [ ] Team backend RPCs implemented and tested
- [ ] Team creation + invite flow working end-to-end
- [ ] Shared DAO list synced across team members
- [ ] All existing E2E tests pass with flag enabled

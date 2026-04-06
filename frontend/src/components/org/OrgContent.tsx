/**
 * OrgContent — Memba-native team management UI.
 *
 * Uses Memba backend Team RPCs (CreateTeam, GetMyTeams, JoinTeam,
 * LeaveTeam, UpdateTeamMemberRole) instead of Clerk Organizations.
 *
 * Sections:
 * 1. Current workspace indicator with switch action
 * 2. Team list with member counts and roles
 * 3. Create team form / Join team via invite code
 *
 * @module components/org/OrgContent
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { useOutletContext } from "react-router-dom"
import { api } from "../../lib/api"
import { create } from "@bufbuild/protobuf"
import {
    CreateTeamRequestSchema,
    GetMyTeamsRequestSchema,
    GetTeamRequestSchema,
    JoinTeamRequestSchema,
    LeaveTeamRequestSchema,
    UpdateTeamMemberRoleRequestSchema,
    TeamRole,
} from "../../gen/memba/v1/memba_pb"
import type { Team, TeamMember } from "../../gen/memba/v1/memba_pb"
import { useOrg } from "../../contexts/OrgContext"
import { ConfirmDialog } from "../ui/ConfirmDialog"
import { resolveUsernames } from "../../lib/dao/shared"
import type { DAOMember } from "../../lib/dao/shared"
import { GNO_RPC_URL } from "../../lib/config"
import type { LayoutContext } from "../../types/layout"

function roleLabel(role: TeamRole): string {
    return role === TeamRole.ADMIN ? "Admin" : "Member"
}

export default function OrgContent() {
    const { auth } = useOutletContext<LayoutContext>()
    const { setActiveOrg, activeOrgId } = useOrg()

    const [teams, setTeams] = useState<Team[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Create team
    const [showCreate, setShowCreate] = useState(false)
    const [newName, setNewName] = useState("")
    const [creating, setCreating] = useState(false)

    // Join team
    const [showJoin, setShowJoin] = useState(false)
    const [inviteCode, setInviteCode] = useState("")
    const [joining, setJoining] = useState(false)

    // Selected team detail
    const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)

    // Copy invite code
    const [copied, setCopied] = useState(false)
    const copyTimeout = useRef<ReturnType<typeof setTimeout>>()

    // Confirm dialog
    const [confirmAction, setConfirmAction] = useState<{
        title: string; message: string; confirmLabel: string
        variant: "danger" | "default"; onConfirm: () => void
    } | null>(null)

    // Resolved usernames for team members
    const [resolvedNames, setResolvedNames] = useState<Record<string, string>>({})

    const loadTeams = useCallback(async () => {
        if (!auth.token) return
        setLoading(true)
        setError(null)
        try {
            const resp = await api.getMyTeams(create(GetMyTeamsRequestSchema, {
                authToken: auth.token,
            }))
            setTeams(resp.teams)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load teams")
        } finally {
            setLoading(false)
        }
    }, [auth.token])

    useEffect(() => { loadTeams() }, [loadTeams])

    // Resolve usernames when a team is selected
    useEffect(() => {
        if (!selectedTeam) return
        const members: DAOMember[] = selectedTeam.members.map(m => ({
            address: m.address, roles: [], tier: "", votingPower: 0, username: "",
        }))
        resolveUsernames(GNO_RPC_URL, members).then(() => {
            const map: Record<string, string> = {}
            for (const m of members) {
                if (m.username) map[m.address] = m.username
            }
            setResolvedNames(map)
        })
    }, [selectedTeam])

    const copyInviteCode = (code: string) => {
        navigator.clipboard.writeText(code)
        setCopied(true)
        if (copyTimeout.current) clearTimeout(copyTimeout.current)
        copyTimeout.current = setTimeout(() => setCopied(false), 2000)
    }

    const handleCreate = async () => {
        if (!auth.token || !newName.trim()) return
        setCreating(true)
        setError(null)
        try {
            await api.createTeam(create(CreateTeamRequestSchema, {
                authToken: auth.token,
                name: newName.trim(),
            }))
            setNewName("")
            setShowCreate(false)
            loadTeams()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create team")
        } finally {
            setCreating(false)
        }
    }

    const handleJoin = async () => {
        if (!auth.token || !inviteCode.trim()) return
        setJoining(true)
        setError(null)
        try {
            await api.joinTeam(create(JoinTeamRequestSchema, {
                authToken: auth.token,
                inviteCode: inviteCode.trim(),
            }))
            setInviteCode("")
            setShowJoin(false)
            loadTeams()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Invalid invite code")
        } finally {
            setJoining(false)
        }
    }

    const handleLeave = async (teamId: string) => {
        if (!auth.token) return
        setError(null)
        try {
            await api.leaveTeam(create(LeaveTeamRequestSchema, {
                authToken: auth.token,
                teamId,
            }))
            if (activeOrgId === teamId) setActiveOrg(null)
            setSelectedTeam(null)
            loadTeams()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to leave team")
        }
    }

    const handleRoleChange = async (teamId: string, memberAddress: string, role: TeamRole) => {
        if (!auth.token) return
        setError(null)
        try {
            const resp = await api.updateTeamMemberRole(create(UpdateTeamMemberRoleRequestSchema, {
                authToken: auth.token,
                teamId,
                memberAddress,
                role,
            }))
            if (resp.team) setSelectedTeam(resp.team)
            loadTeams()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update role")
        }
    }

    const viewTeam = async (teamId: string) => {
        if (!auth.token) return
        try {
            const resp = await api.getTeam(create(GetTeamRequestSchema, {
                authToken: auth.token,
                teamId,
            }))
            if (resp.team) setSelectedTeam(resp.team)
        } catch {
            // ignore
        }
    }

    if (!auth.isAuthenticated || !auth.token) {
        return (
            <div className="org-empty-card">
                <h2 className="org-empty-title">Connect your wallet to manage teams</h2>
                <p className="org-empty-desc">
                    Teams let you share DAOs, alerts, and configurations with your collaborators.
                </p>
            </div>
        )
    }

    if (loading) {
        return <div className="org-loading">Loading teams...</div>
    }

    // ── Team detail view ──
    if (selectedTeam) {
        const isAdmin = selectedTeam.members.some(
            m => m.address === auth.address && m.role === TeamRole.ADMIN
        )
        return (
            <div className="org-content">
                <button className="org-btn-secondary" onClick={() => setSelectedTeam(null)}>
                    ← Back to teams
                </button>

                <div className="org-section">
                    <h2 className="org-section-title">{selectedTeam.name}</h2>
                    <div className="org-team-meta">
                        <span className="org-team-meta-item org-invite-row">
                            Invite code: <code className="org-invite-code">{selectedTeam.inviteCode}</code>
                            <button
                                className="org-copy-btn"
                                onClick={() => copyInviteCode(selectedTeam.inviteCode)}
                            >
                                {copied ? "Copied!" : "Copy"}
                            </button>
                        </span>
                        <span className="org-team-meta-item">
                            {selectedTeam.members.length} member{selectedTeam.members.length !== 1 ? "s" : ""}
                        </span>
                    </div>
                </div>

                <div className="org-section">
                    <h2 className="org-section-title">Members</h2>
                    <div className="org-team-list">
                        {selectedTeam.members.map((m: TeamMember) => {
                            const displayName = resolvedNames[m.address]
                                || `${m.address.slice(0, 10)}...${m.address.slice(-4)}`
                            return (
                                <div key={m.address} className="org-team-row">
                                    <div className="org-team-row-icon">
                                        {resolvedNames[m.address]
                                            ? resolvedNames[m.address].slice(1, 3).toUpperCase()
                                            : m.address.slice(2, 4).toUpperCase()}
                                    </div>
                                    <div className="org-team-row-info">
                                        <span className="org-team-row-name">{displayName}</span>
                                        <span className="org-team-row-role">{roleLabel(m.role)}</span>
                                    </div>
                                    {m.role === TeamRole.ADMIN && (
                                        <span className="org-team-row-badge">Admin</span>
                                    )}
                                    {isAdmin && m.address !== auth.address && (
                                        <button
                                            className="org-btn-secondary"
                                            onClick={() => {
                                                const newRole = m.role === TeamRole.ADMIN ? TeamRole.MEMBER : TeamRole.ADMIN
                                                const action = newRole === TeamRole.ADMIN ? "Promote" : "Demote"
                                                setConfirmAction({
                                                    title: `${action} ${displayName}?`,
                                                    message: newRole === TeamRole.ADMIN
                                                        ? `Grant admin rights to ${displayName}?`
                                                        : `Remove admin rights from ${displayName}?`,
                                                    confirmLabel: action,
                                                    variant: newRole === TeamRole.ADMIN ? "default" : "danger",
                                                    onConfirm: () => {
                                                        handleRoleChange(selectedTeam.id, m.address, newRole)
                                                        setConfirmAction(null)
                                                    },
                                                })
                                            }}
                                        >
                                            {m.role === TeamRole.ADMIN ? "Demote" : "Promote"}
                                        </button>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>

                <button
                    className="org-btn-danger"
                    onClick={() => setConfirmAction({
                        title: `Leave "${selectedTeam.name}"?`,
                        message: "You'll need a new invite code to rejoin. Your team data won't be deleted.",
                        confirmLabel: "Leave Team",
                        variant: "danger",
                        onConfirm: () => { handleLeave(selectedTeam.id); setConfirmAction(null) },
                    })}
                >
                    Leave Team
                </button>

                <ConfirmDialog
                    isOpen={!!confirmAction}
                    title={confirmAction?.title ?? ""}
                    message={confirmAction?.message ?? ""}
                    confirmLabel={confirmAction?.confirmLabel}
                    variant={confirmAction?.variant}
                    onConfirm={() => confirmAction?.onConfirm()}
                    onCancel={() => setConfirmAction(null)}
                />

                {error && <div className="org-error">{error}</div>}
            </div>
        )
    }

    // ── Main teams view ──
    return (
        <div className="org-content">
            {error && <div className="org-error">{error}</div>}

            {/* Current Workspace */}
            <div className="org-section">
                <h2 className="org-section-title">Current Workspace</h2>
                <div className="org-workspace-cards">
                    <button
                        className={`org-workspace-card${!activeOrgId ? " org-workspace-card--active" : ""}`}
                        onClick={() => setActiveOrg(null)}
                    >
                        <div className="org-workspace-icon">
                            <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor">
                                <path d="M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8C55.71,194.2,89.55,176,128,176s72.29,18.2,89.07,44a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z" />
                            </svg>
                        </div>
                        <div className="org-workspace-info">
                            <span className="org-workspace-name">Personal</span>
                            <span className="org-workspace-desc">Your individual workspace</span>
                        </div>
                        {!activeOrgId && <span className="org-workspace-active-badge">Active</span>}
                    </button>

                    {teams.map(team => (
                        <button
                            key={team.id}
                            className={`org-workspace-card${activeOrgId === team.id ? " org-workspace-card--active" : ""}`}
                            onClick={() => setActiveOrg(team.id, team.name)}
                        >
                            <div className="org-workspace-icon org-workspace-icon--team">
                                {team.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="org-workspace-info">
                                <span className="org-workspace-name">{team.name}</span>
                                <span className="org-workspace-desc">
                                    {team.members.length} member{team.members.length !== 1 ? "s" : ""}
                                </span>
                            </div>
                            {activeOrgId === team.id && (
                                <span className="org-workspace-active-badge">Active</span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Actions */}
            <div className="org-section">
                <div className="org-section-header">
                    <h2 className="org-section-title">Actions</h2>
                </div>

                {showCreate ? (
                    <div className="org-create-wrapper">
                        <input
                            type="text"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            placeholder="Team name (1-64 chars)"
                            maxLength={64}
                            className="org-input"
                            onKeyDown={e => e.key === "Enter" && handleCreate()}
                            disabled={creating}
                        />
                        <div className="org-action-row">
                            <button
                                className="org-btn-primary"
                                onClick={handleCreate}
                                disabled={creating || !newName.trim()}
                            >
                                {creating ? "Creating..." : "Create Team"}
                            </button>
                            <button className="org-btn-secondary" onClick={() => setShowCreate(false)}>
                                Cancel
                            </button>
                        </div>
                    </div>
                ) : showJoin ? (
                    <div className="org-create-wrapper">
                        <input
                            type="text"
                            value={inviteCode}
                            onChange={e => setInviteCode(e.target.value)}
                            placeholder="Enter 8-character invite code"
                            maxLength={8}
                            className="org-input"
                            onKeyDown={e => e.key === "Enter" && handleJoin()}
                            disabled={joining}
                        />
                        <div className="org-action-row">
                            <button
                                className="org-btn-primary"
                                onClick={handleJoin}
                                disabled={joining || !inviteCode.trim()}
                            >
                                {joining ? "Joining..." : "Join Team"}
                            </button>
                            <button className="org-btn-secondary" onClick={() => setShowJoin(false)}>
                                Cancel
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="org-action-row">
                        <button className="org-btn-primary" onClick={() => setShowCreate(true)}>
                            + New Team
                        </button>
                        <button className="org-btn-secondary" onClick={() => setShowJoin(true)}>
                            Join with Invite Code
                        </button>
                    </div>
                )}
            </div>

            {/* Teams Overview */}
            {teams.length > 0 && (
                <div className="org-section">
                    <h2 className="org-section-title">Your Teams ({teams.length})</h2>
                    <div className="org-team-list">
                        {teams.map(team => {
                            const myRole = team.members.find(m => m.address === auth.address)?.role
                            return (
                                <button
                                    key={team.id}
                                    className="org-team-row org-team-row--clickable"
                                    onClick={() => viewTeam(team.id)}
                                >
                                    <div className="org-team-row-icon">
                                        {team.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="org-team-row-info">
                                        <span className="org-team-row-name">{team.name}</span>
                                        <span className="org-team-row-role">
                                            {roleLabel(myRole ?? TeamRole.MEMBER)} · {team.members.length} member{team.members.length !== 1 ? "s" : ""}
                                        </span>
                                    </div>
                                    {myRole === TeamRole.ADMIN && (
                                        <span className="org-team-row-badge">Admin</span>
                                    )}
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}

            {teams.length === 0 && !loading && (
                <div className="org-empty-card">
                    <div className="org-empty-icon">
                        <svg width="48" height="48" viewBox="0 0 256 256" fill="currentColor" opacity="0.3">
                            <path d="M244.8,150.4a8,8,0,0,1-11.2-1.6A51.6,51.6,0,0,0,192,128a8,8,0,0,1-7.37-4.89,8,8,0,0,1,0-6.22A8,8,0,0,1,192,112a24,24,0,1,0-23.24-30,8,8,0,1,1-15.5-4A40,40,0,1,1,219,117.51a67.94,67.94,0,0,1,27.43,21.68A8,8,0,0,1,244.8,150.4ZM190.92,212a8,8,0,1,1-13.84,8,57,57,0,0,0-98.16,0,8,8,0,1,1-13.84-8,72.06,72.06,0,0,1,33.74-29.92,48,48,0,1,1,58.36,0A72.06,72.06,0,0,1,190.92,212ZM128,176a32,32,0,1,0-32-32A32,32,0,0,0,128,176ZM64,112a24,24,0,1,0-23.24-30A8,8,0,1,1,25.26,78,40,40,0,1,1,91,117.51a67.94,67.94,0,0,1,27.43,21.68,8,8,0,0,1-1.6,11.2,8,8,0,0,1-11.2-1.6A51.6,51.6,0,0,0,64,128a8,8,0,0,1,0-16Z" />
                        </svg>
                    </div>
                    <h2 className="org-empty-title">No teams yet</h2>
                    <p className="org-empty-desc">
                        Create a team or join one with an invite code to start collaborating.
                    </p>
                </div>
            )}
        </div>
    )
}

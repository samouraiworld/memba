/**
 * DAO message builders — MsgCall builders for Vote, Execute, Propose, Archive,
 * and Member Management (AssignRole, RemoveRole).
 *
 * All DAO functions use MsgCall. Functions MUST have crossing() to be callable.
 * - GovDAO v3: uses its own function names (MustVoteOnProposalSimple, etc.)
 * - Memba DAOs (v5.2.1+): have crossing() in template → MsgCall works
 * - Old Memba DAOs (pre-crossing): MUST be re-deployed with updated template
 *
 * NOTE: MsgRun cannot modify external realm state, so it's NOT a viable fallback.
 */

import type { AminoMsg } from "./shared"

// ── GovDAO Function Names (configurable for upstream migration) ──

/**
 * GovDAO vote function name — configurable for upstream migration.
 *
 * Current (test12, gnoland1): "MustVoteOnProposalSimple"
 * If gno#5222 (govdao T1 multisig) renames this function, update here.
 * All GovDAO voting calls flow through this constant.
 *
 * Tracking: https://github.com/gnolang/gno/pull/5222
 */
export const GOVDAO_VOTE_FUNC = "MustVoteOnProposalSimple"

/**
 * GovDAO execute function name.
 *
 * gno#5261 added ExecuteOrRejectProposal which gracefully rejects
 * proposals when execution errors occur (instead of leaving them stuck).
 * Falls back to ExecuteProposal on older chains where the new function
 * doesn't exist yet.
 *
 * Tracking: https://github.com/gnolang/gno/pull/5261
 */
export const GOVDAO_EXECUTE_FUNC = "ExecuteOrRejectProposal"

/**
 * GovDAO propose function name.
 * Separate from Memba DAO propose (which includes category).
 */
export const GOVDAO_PROPOSE_FUNC = "Propose"

/** Known GovDAO paths that use different function names. */
export function isGovDAO(realmPath: string): boolean {
    return realmPath.includes("/gov/dao")
}

/** Build vote message. */
export function buildVoteMsg(
    caller: string,
    realmPath: string,
    proposalId: number,
    vote: "YES" | "NO" | "ABSTAIN",
): AminoMsg {
    if (isGovDAO(realmPath)) {
        return buildDAOMsgCall(realmPath, GOVDAO_VOTE_FUNC, [String(proposalId), vote], caller)
    }
    return buildDAOMsgCall(realmPath, "VoteOnProposal", [String(proposalId), vote], caller)
}

/** Build execute message. Uses ExecuteOrRejectProposal for GovDAO (gno#5261). */
export function buildExecuteMsg(
    caller: string,
    realmPath: string,
    proposalId: number,
): AminoMsg {
    if (isGovDAO(realmPath)) {
        return buildDAOMsgCall(realmPath, GOVDAO_EXECUTE_FUNC, [String(proposalId)], caller)
    }
    return buildDAOMsgCall(realmPath, "ExecuteProposal", [String(proposalId)], caller)
}

/** Build propose message — v5.2.1+ Memba DAOs accept (title, desc, category). */
export function buildProposeMsg(
    caller: string,
    realmPath: string,
    title: string,
    description: string,
    category: string = "governance",
): AminoMsg {
    if (isGovDAO(realmPath)) {
        return buildDAOMsgCall(realmPath, "Propose", [title, description], caller)
    }
    return buildDAOMsgCall(realmPath, "Propose", [title, description, category], caller)
}

/** Build archive message — admin-only, Memba DAOs only. */
export function buildArchiveMsg(
    caller: string,
    realmPath: string,
): AminoMsg {
    return buildDAOMsgCall(realmPath, "Archive", [], caller)
}

// ── Member Management (admin-only) ───────────────────────────

/** Build AssignRole MsgCall — admin-only, adds a role to an existing member. */
export function buildAssignRoleMsg(
    caller: string,
    realmPath: string,
    targetAddress: string,
    role: string,
): AminoMsg {
    return buildDAOMsgCall(realmPath, "AssignRole", [targetAddress, role], caller)
}

/** Build RemoveRole MsgCall — admin-only, removes a role from a member. */
export function buildRemoveRoleMsg(
    caller: string,
    realmPath: string,
    targetAddress: string,
    role: string,
): AminoMsg {
    return buildDAOMsgCall(realmPath, "RemoveRole", [targetAddress, role], caller)
}

// ── Member Proposals (governance-gated) ──────────────────────

/** Build MsgCall for ProposeAddMember — creates a governance proposal to add a member. */
export function buildProposeAddMemberMsg(
    caller: string,
    realmPath: string,
    targetAddress: string,
    power: number,
    roles: string,
): AminoMsg {
    return buildDAOMsgCall(realmPath, "ProposeAddMember", [targetAddress, String(power), roles], caller)
}

/** Build MsgCall for ProposeRemoveMember — creates a governance proposal to remove a member. */
export function buildProposeRemoveMemberMsg(
    caller: string,
    realmPath: string,
    targetAddress: string,
): AminoMsg {
    return buildDAOMsgCall(realmPath, "ProposeRemoveMember", [targetAddress], caller)
}

/** Build MsgCall for ProposeAssignRole — creates a governance proposal to assign a role. */
export function buildProposeAssignRoleMsg(
    caller: string,
    realmPath: string,
    targetAddress: string,
    role: string,
): AminoMsg {
    return buildDAOMsgCall(realmPath, "ProposeAssignRole", [targetAddress, role], caller)
}

// ── Internal Helpers ──────────────────────────────────────────

/** Build Amino MsgCall for a DAO realm function (crossing-compatible only). */
function buildDAOMsgCall(realmPath: string, func: string, args: string[], caller: string): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: realmPath,
            func,
            args,
        },
    }
}

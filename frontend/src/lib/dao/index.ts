/**
 * DAO module barrel — re-exports all public API from sub-modules.
 *
 * Import from here for the full DAO API:
 *   import { getDAOConfig, buildVoteMsg, type DAOMember } from "../lib/dao"
 *
 * Sub-modules:
 * - shared.ts    → types, ABCI helpers, username resolution
 * - config.ts    → getDAOConfig, getMemberstoreTiers
 * - members.ts   → getDAOMembers
 * - proposals.ts → getDAOProposals, getProposalDetail, getProposalVotes
 * - builders.ts  → buildVoteMsg, buildExecuteMsg, buildProposeMsg, buildArchiveMsg, buildAssignRoleMsg, buildRemoveRoleMsg, buildProposeAddMemberMsg, buildProposeRemoveMemberMsg, buildProposeAssignRoleMsg
 */

// ── Types ─────────────────────────────────────────────────────
export type {
    DAOMember,
    DAOProposal,
    DAOConfig,
    TierInfo,
    VoteRecord,
    VoterEntry,
} from "./shared"

// ── Constants ─────────────────────────────────────────────────
export { PROPOSAL_STATUS_COLORS } from "./shared"

// ── Config ────────────────────────────────────────────────────
export { getDAOConfig, getMemberstoreTiers, parseMemberstoreTiers } from "./config"

// ── Members ───────────────────────────────────────────────────
export { getDAOMembers, parseMembersFromRender } from "./members"

// ── Proposals ─────────────────────────────────────────────────
export {
    getDAOProposals,
    getProposalDetail,
    getProposalVotes,
    parseProposalList,
    invalidateProposalCache,
} from "./proposals"

// ── Builders ──────────────────────────────────────────────────
export {
    buildVoteMsg,
    buildExecuteMsg,
    buildProposeMsg,
    buildArchiveMsg,
    buildAssignRoleMsg,
    buildRemoveRoleMsg,
    buildProposeAddMemberMsg,
    buildProposeRemoveMemberMsg,
    buildProposeAssignRoleMsg,
    isGovDAO,
} from "./builders"

// ── Test Exports ──────────────────────────────────────────────
// Internal pure functions exported with _ prefix for unit testing.
export { normalizeStatus as _normalizeStatus, sanitize as _sanitize } from "./shared"
export { parseProposalList as _parseProposalList } from "./proposals"
export { parseMemberstoreTiers as _parseMemberstoreTiers } from "./config"
export { parseMembersFromRender as _parseMembersFromRender } from "./members"

/**
 * DAO module barrel — re-exports all public API from sub-modules.
 *
 * Import from here for the full DAO API:
 *   import { getDAOConfig, buildDaoMsg, type DAOMember } from "../lib/dao"
 *
 * Sub-modules:
 * - shared.ts    → types, ABCI helpers, username resolution
 * - config.ts    → getDAOConfig, getMemberstoreTiers
 * - members.ts   → getDAOMembers
 * - proposals.ts → getDAOProposals, getProposalDetail, getProposalVotes
 * - kind.ts      → resolveDaoKind, capabilitiesFor
 * - builders.ts  → buildDaoMsg (kind-checked MsgCall builder)
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
export { getDAOConfig, getMemberstoreTiers, parseMemberstoreTiers, parseDaoThreshold } from "./config"

// ── Members ───────────────────────────────────────────────────
export { getDAOMembers, getMemberRole, deriveRoleLabel, parseMembersFromRender } from "./members"

// ── Proposals ─────────────────────────────────────────────────
export {
    getDAOProposals,
    getProposalDetail,
    getProposalVotes,
    parseProposalList,
    invalidateProposalCache,
    fallbackProposalTitle,
} from "./proposals"

// ── Builders ──────────────────────────────────────────────────
export {
    buildDaoMsg,
    isGovDAOPath,
    GOVDAO_VOTE_FUNC,
    GOVDAO_EXECUTE_FUNC,
    type DaoAction,
    type VoteChoice,
} from "./builders"

// ── Kind ──────────────────────────────────────────────────────
export { resolveDaoKind, capabilitiesFor, type DaoKind, type DaoCapabilities } from "./kind"

// ── Test Exports ──────────────────────────────────────────────
// Internal pure functions exported with _ prefix for unit testing.
export { normalizeStatus as _normalizeStatus, sanitize as _sanitize, unescapeMarkdown as _unescapeMarkdown } from "./shared"
export { parseProposalList as _parseProposalList, parseProposalAuthor as _parseProposalAuthor, parseVoters as _parseVoters, parseProposalDescription as _parseProposalDescription } from "./proposals"
export { parseMemberstoreTiers as _parseMemberstoreTiers } from "./config"
export { parseMembersFromRender as _parseMembersFromRender, parseMemberstoreRows as _parseMemberstoreRows } from "./members"

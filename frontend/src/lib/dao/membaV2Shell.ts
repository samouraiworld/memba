/**
 * Version-2 DAOs (template `memba-dao/2`) inside the generic DAO readers.
 *
 * getDAOConfig, getDAOMembers, getDAOProposals, getProposalDetail,
 * getProposalVotes and getMemberRole ask `membaV2Route` first. For a version-2
 * realm they read only the realm's paginated JSON exports (membaV2.ts): its
 * Render output is never parsed, and the read cost stays bounded per page.
 */
import { GNO_CHAIN_ID } from "../config"
import { resolveDaoKind } from "./kind"
import {
    MEMBA_V2_MAX_PAGE,
    hasVotedV2,
    readV2Config,
    readV2Members,
    readV2Proposal,
    readV2Proposals,
    readV2Votes,
    type MembaV2Config,
    type MembaV2Context,
    type MembaV2ProposalSummary,
} from "./membaV2"
import { resolveUsernames, type DAOConfig, type DAOMember, type DAOProposal, type VoteRecord } from "./shared"

/** Proposal list pages read for one list (50 per page): the newest 500 proposals. */
export const V2_MAX_PROPOSAL_PAGES = 10

/** Members are at most 100, so two pages always hold the whole roster. */
const V2_MAX_MEMBER_PAGES = 2

export function v2Context(rpcUrl: string, realmPath: string): MembaV2Context {
    return { rpcUrl, chainId: GNO_CHAIN_ID, realmPath }
}

export type V2Route = "v2" | "other" | "unresolved"

/**
 * Whether `realmPath` is a version-2 DAO on the active chain. A strict caller
 * gets the resolution error; a non-strict caller gets "unresolved" and must not
 * fall back to reading the realm another way.
 */
export async function membaV2Route(rpcUrl: string, realmPath: string, strict = false): Promise<V2Route> {
    try {
        const kind = await resolveDaoKind({ rpcUrl, chainId: GNO_CHAIN_ID, realmPath })
        return kind === "memba-v2" ? "v2" : "other"
    } catch (err) {
        if (strict) throw err
        return "unresolved"
    }
}

const STATUS: Record<MembaV2ProposalSummary["status"], DAOProposal["status"]> = {
    ACTIVE: "open",
    ACCEPTED: "passed",
    REJECTED: "rejected",
    EXECUTED: "executed",
    EXPIRED: "expired",
    LAPSED: "expired",
    INVALIDATED: "invalidated",
    ARCHIVED: "expired",
}

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10_000) / 100 : 0)

export function v2ConfigToDAOConfig(config: MembaV2Config): DAOConfig {
    return {
        name: config.name,
        description: config.description,
        threshold: `${config.threshold}%`,
        memberCount: config.member_count,
        memberstorePath: "",
        tierDistribution: [],
        isArchived: config.archived,
        v2: config,
    }
}

export function v2ProposalToDAOProposal(p: MembaV2ProposalSummary & { description?: string }): DAOProposal {
    const { description, ...summary } = p
    return {
        id: p.id,
        title: p.title,
        description: description ?? "",
        category: p.category,
        status: STATUS[p.status],
        author: p.author,
        authorProfile: "",
        tiers: [],
        yesPercent: percent(p.yes, p.electorate_power),
        noPercent: percent(p.no, p.electorate_power),
        // Version-2 tallies are voting power, not head counts.
        yesVotes: p.yes,
        noVotes: p.no,
        abstainVotes: p.abstain,
        totalVoters: 0,
        proposer: p.author,
        actionType: p.action.kind,
        createdAt: new Date(p.created_at * 1000).toISOString(),
        v2: summary,
    }
}

export async function readV2DAOConfig(rpcUrl: string, realmPath: string): Promise<DAOConfig> {
    return v2ConfigToDAOConfig(await readV2Config(v2Context(rpcUrl, realmPath)))
}

/** Every member, page by page, without usernames. */
export async function readAllV2Members(rpcUrl: string, realmPath: string): Promise<DAOMember[]> {
    const ctx = v2Context(rpcUrl, realmPath)
    const members: DAOMember[] = []
    for (let page = 0; page < V2_MAX_MEMBER_PAGES; page++) {
        const result = await readV2Members(ctx, { offset: page * MEMBA_V2_MAX_PAGE, limit: MEMBA_V2_MAX_PAGE })
        for (const m of result.members) {
            members.push({ address: m.address, roles: [...m.roles], tier: "", votingPower: m.power, username: "" })
        }
        if (members.length >= result.total) break
    }
    if (new Set(members.map((m) => m.address)).size !== members.length) throw new Error("Duplicate member in the DAO's member pages")
    return members
}

export async function readV2DAOMembers(rpcUrl: string, realmPath: string): Promise<DAOMember[]> {
    const members = await readAllV2Members(rpcUrl, realmPath)
    await resolveUsernames(rpcUrl, members)
    return members
}

/** The newest proposals, newest first, up to {@link V2_MAX_PROPOSAL_PAGES} pages. */
export async function readV2DAOProposals(rpcUrl: string, realmPath: string): Promise<DAOProposal[]> {
    const ctx = v2Context(rpcUrl, realmPath)
    const proposals: DAOProposal[] = []
    let before = 0
    for (let page = 0; page < V2_MAX_PROPOSAL_PAGES; page++) {
        const result = await readV2Proposals(ctx, before, MEMBA_V2_MAX_PAGE)
        proposals.push(...result.proposals.map(v2ProposalToDAOProposal))
        if (result.next_before === 0) break
        before = result.next_before
    }
    return proposals
}

export async function readV2DAOProposal(rpcUrl: string, realmPath: string, id: number): Promise<DAOProposal> {
    return v2ProposalToDAOProposal(await readV2Proposal(v2Context(rpcUrl, realmPath), id))
}

/**
 * All votes of a proposal as one record. Voters are addresses (the realm keeps
 * no names), so wallet matching is exact.
 */
export async function readV2VoteRecords(rpcUrl: string, realmPath: string, id: number): Promise<VoteRecord[]> {
    const ctx = v2Context(rpcUrl, realmPath)
    const record: VoteRecord = { tier: "Members", vppm: 0, yesVoters: [], noVoters: [], abstainVoters: [] }
    let offset = 0
    for (let page = 0; page < V2_MAX_MEMBER_PAGES; page++) {
        const result = await readV2Votes(ctx, id, { offset, limit: MEMBA_V2_MAX_PAGE })
        for (const v of result.votes) {
            const entry = { username: v.voter, profileUrl: "" }
            if (v.choice === "YES") record.yesVoters.push(entry)
            else if (v.choice === "NO") record.noVoters.push(entry)
            else record.abstainVoters.push(entry)
        }
        offset += result.votes.length
        if (offset >= result.total || result.votes.length === 0) break
    }
    return offset > 0 ? [record] : []
}

export function hasVotedOnV2(rpcUrl: string, realmPath: string, id: number, voter: string): Promise<boolean> {
    return hasVotedV2(v2Context(rpcUrl, realmPath), id, voter)
}

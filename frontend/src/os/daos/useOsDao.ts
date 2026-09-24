/**
 * DAO data for Memba OS windows, on the same loaders and react-query keys as
 * the classic DAO pages (so both share one cache). Version-2 DAOs read their
 * JSON API; GovDAO and version-1 DAOs read their Render output.
 *
 * @module os/daos/useOsDao
 */
import { useQuery } from "@tanstack/react-query"
import { GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"
import { getDAOConfig, getDAOMembers, getDAOProposals, getProposalDetail, getProposalVotes, type DAOProposal, type VoteRecord } from "../../lib/dao"
import { readV2Proposal, readV2Votes, type MembaV2Proposal } from "../../lib/dao/membaV2"
import { hasVotedOnV2, v2Context } from "../../lib/dao/membaV2Shell"
import { canVoteNow, V2_STATUS_LABELS } from "../../lib/dao/v2Lifecycle"
import { useDaoKind } from "../../hooks/useDaoKind"

export function useDaoConfig(realmPath: string) {
    return useQuery({ queryKey: ["dao", "config", realmPath], queryFn: () => getDAOConfig(GNO_RPC_URL, realmPath, true), staleTime: 30_000 })
}

export function useDaoMembers(realmPath: string, memberstorePath: string | undefined, enabled = true) {
    return useQuery({
        queryKey: ["dao", "members-list", realmPath, memberstorePath ?? ""],
        queryFn: () => getDAOMembers(GNO_RPC_URL, realmPath, memberstorePath || undefined, true),
        enabled,
        staleTime: 30_000,
    })
}

export function useDaoProposals(realmPath: string, enabled = true) {
    return useQuery({ queryKey: ["dao", "proposals", realmPath], queryFn: () => getDAOProposals(GNO_RPC_URL, realmPath, true), enabled, staleTime: 15_000 })
}

/** One proposal, whatever the DAO kind, in the shape the proposal window shows. */
export interface ProposalView {
    id: number
    title: string
    description: string
    statusLabel: string
    /** True while members can still vote. */
    open: boolean
    yes: number
    no: number
    abstain: number
    /** The whole of the electorate ("power"), or the members who voted for older DAOs. */
    whole: number
    unit: "power" | "voters"
    /** False when the votes couldn't be read: show no tally rather than zeros. */
    tallyKnown: boolean
    author: string
    endsAt: number | null
    /** Version-2 only: the electorate the vote runs against. */
    electorateVersion: number | null
    v2: MembaV2Proposal | null
}

const LEGACY_STATUS: Record<DAOProposal["status"], string> = {
    open: "Open for votes", passed: "Passed", rejected: "Rejected", executed: "Executed", expired: "Expired", invalidated: "Invalidated",
}

export function fromV2(p: MembaV2Proposal, nowSeconds: number): ProposalView {
    return {
        id: p.id, title: p.title, description: p.description, statusLabel: V2_STATUS_LABELS[p.status], open: canVoteNow(p, nowSeconds),
        yes: p.yes, no: p.no, abstain: p.abstain, whole: p.electorate_power, unit: "power", tallyKnown: true, author: p.author,
        endsAt: p.voting_ends_at, electorateVersion: p.electorate_version, v2: p,
    }
}

/** Older DAOs: the render's counts, or the per-tier voter lists when they could be read (GovDAO's summary has none). */
export function fromLegacy(p: DAOProposal, records: VoteRecord[] | null): ProposalView {
    const count = (pick: (r: VoteRecord) => number) => (records ?? []).reduce((n, r) => n + pick(r), 0)
    const fromRecords = records !== null && records.length > 0
    const yes = fromRecords ? count((r) => r.yesVoters.length) : p.yesVotes
    const no = fromRecords ? count((r) => r.noVoters.length) : p.noVotes
    const abstain = fromRecords ? count((r) => r.abstainVoters.length) : p.abstainVotes
    return {
        id: p.id, title: p.title, description: p.description, statusLabel: LEGACY_STATUS[p.status] ?? p.status, open: p.status === "open",
        yes, no, abstain, whole: yes + no + abstain, unit: "voters", tallyKnown: records !== null,
        author: p.author || p.proposer, endsAt: null, electorateVersion: null, v2: null,
    }
}

export function useProposal(realmPath: string, id: number) {
    const kind = useDaoKind(realmPath)
    const v2 = kind.kind === "memba-v2"
    const q = useQuery({
        // Its own key: this caches the window's view model, not the raw proposal the classic page caches.
        queryKey: ["dao", "os-proposal", GNO_CHAIN_ID, realmPath, id, v2 ? "v2" : "legacy"],
        enabled: !kind.loading && !kind.error,
        queryFn: async ({ signal }) => {
            if (v2) return fromV2(await readV2Proposal(v2Context(GNO_RPC_URL, realmPath), id, signal), Math.floor(Date.now() / 1000))
            const p = await getProposalDetail(GNO_RPC_URL, realmPath, id)
            if (!p) throw new Error(`Proposal #${id} wasn't found in this DAO.`)
            const records = await getProposalVotes(GNO_RPC_URL, realmPath, id).catch(() => null)
            return fromLegacy(p, records)
        },
        staleTime: 10_000,
    })
    return { kind, ...q }
}

/** Has this address voted, and how (version-2 DAOs; older DAOs don't expose it per voter). */
export function useMyVote(realmPath: string, id: number, address: string, v2: boolean) {
    return useQuery({
        queryKey: ["dao", "v2", "myVote", GNO_CHAIN_ID, realmPath, id, address],
        enabled: v2 && !!address,
        queryFn: async ({ signal }) => {
            const voted = await hasVotedOnV2(GNO_RPC_URL, realmPath, id, address)
            if (!voted) return { voted: false as const, choice: null }
            const votes = await readV2Votes(v2Context(GNO_RPC_URL, realmPath), id, { offset: 0, limit: 50 }, signal)
            return { voted: true as const, choice: votes.votes.find((v) => v.voter === address)?.choice ?? null }
        },
        staleTime: 10_000,
    })
}

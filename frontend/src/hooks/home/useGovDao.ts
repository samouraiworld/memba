/**
 * useGovDao — home spotlight hook for the chain-level Layer-1 governance DAO
 * (gno.land/r/gov/dao). Reuses the standard DAO readers (getDAOConfig +
 * getDAOProposals), exactly like the directory's GovDAOTab.
 *
 * GovDAO always exists on-chain, so the spotlight always renders:
 *   - ready: name + live open-proposal count + members + threshold + latest
 *     proposal (each metric omitted when absent/0 — honesty)
 *   - error: name + href + retry on RPC failure, so the spotlight never looks broken
 *
 * All extra fields are derived from the SAME config/proposals already fetched for
 * the counts — no additional RPC calls.
 *
 * @module hooks/home/useGovDao
 */
import { useQuery } from "@tanstack/react-query"
import type { DoorState } from "../../components/home/Door"
import { getDAOConfig, getDAOProposals, type DAOProposal } from "../../lib/dao"
import { GNO_RPC_URL } from "../../lib/config"
import { useChainOptional } from "../../lib/chain/context"
import type { ChainProvider } from "../../lib/chain/provider"

/** Chain-level governance DAO realm path (same as GovDAOTab / DAORouter). */
export const GOVDAO_REALM_PATH = "gno.land/r/gov/dao"

/** Minimal latest-proposal summary for the spotlight (title + status only). */
export interface GovDaoLatestProposal {
    title: string
    status: DAOProposal["status"]
}

/** A richer preview row for the GovDAO card's "latest governance" rail.
 *  Optional fields are omitted (undefined) when absent — honesty contract. */
export interface GovDaoProposalPreview {
    id: number
    title: string
    status: DAOProposal["status"]
    /** @handle or address — omitted when the realm render carries no proposer. */
    author?: string
    /** Vote tallies — surfaced only when non-zero (the list render often has 0s). */
    yesPercent?: number
    noPercent?: number
    /** ISO timestamp — only present when the realm render emits it. */
    createdAt?: string
    /** Deep link to this specific proposal. */
    href: string
}

/** How many proposals the "latest governance" rail shows. */
const PREVIEW_COUNT = 4

// ── B-5 Phase 3 wave 1: the reader seam ──────────────────────────────────
// The card's projection logic below is single-sourced and consumes ONE shape.
// Two readers produce it: the direct lib path (flag-off, unchanged) and the CAL
// path. This mirrors the Phase-2 `fetchV3Tokens(readToken)` seam — inject the
// reader, never duplicate the logic.

/** One proposal, already normalised to what the rail renders. */
interface GovDaoSourceProposal {
    id: number
    title: string
    status: DAOProposal["status"]
    author?: string
    yesPercent?: number
    noPercent?: number
    createdAt?: string
}

/** The card's whole read, in the one shape the projection consumes. */
interface GovDaoSource {
    name: string
    memberCount: number
    /** The realm's own threshold wording; "" when unreported. */
    thresholdLabel: string
    /** Newest-first, as both readers return it. */
    proposals: GovDaoSourceProposal[]
}

/** Percent is surfaced only when non-zero — a 0 in a list render means
 *  "not carried here", not "nobody voted for it". Shared by both readers so
 *  they cannot drift. */
const pct = (v: number | undefined): number | undefined => (v !== undefined && v > 0 ? v : undefined)

/** Direct-lib reader — the flag-off path. Behaviour identical to pre-migration. */
async function readViaLib(rpcUrl: string): Promise<GovDaoSource> {
    const [config, proposals] = await Promise.all([
        getDAOConfig(rpcUrl, GOVDAO_REALM_PATH),
        getDAOProposals(rpcUrl, GOVDAO_REALM_PATH),
    ])
    return {
        name: config?.name || "GovDAO",
        memberCount: config?.memberCount ?? 0,
        thresholdLabel: config?.threshold?.trim() || "",
        proposals: proposals.map((p) => ({
            id: p.id,
            title: p.title,
            status: p.status,
            author: p.author?.trim() || undefined,
            yesPercent: pct(p.yesPercent),
            noPercent: pct(p.noPercent),
            createdAt: p.createdAt?.trim() || undefined,
        })),
    }
}

/** CAL reader — reads through the provider for the network actually being viewed.
 *  `yesPercent`/`noPercent`/`author` are relayed by the provider exactly as the
 *  chain reported them (B-7); a chain that reports none leaves them undefined and
 *  the rail omits the figure rather than showing a derived one. */
async function readViaCal(provider: ChainProvider): Promise<GovDaoSource> {
    const dao = { id: GOVDAO_REALM_PATH, family: provider.family }
    const [config, proposals] = await Promise.all([
        provider.getDAOConfig(dao),
        provider.getDAOProposals(dao),
    ])
    return {
        name: config.name || "GovDAO",
        memberCount: config.memberCount ?? 0,
        thresholdLabel: config.thresholdLabel?.trim() || "",
        proposals: proposals.map((p) => ({
            id: p.id,
            title: p.title,
            status: p.status,
            author: p.author?.trim() || undefined,
            // Suppress the figures entirely when the provider flagged the vote
            // read as failed, so "unknown" never renders as a real tally.
            yesPercent: p.votesUnavailable ? undefined : pct(p.yesPercent),
            noPercent: p.votesUnavailable ? undefined : pct(p.noPercent),
            createdAt: p.createdAt?.trim() || undefined,
        })),
    }
}

export interface GovDaoResult {
    state: DoorState
    name: string
    openCount?: number
    members?: number
    /** Governance threshold from getDAOConfig (e.g. "66%"); omitted when absent. */
    threshold?: string
    /** Most recent proposal (newest by id) — title + status; omitted when none. */
    latestProposal?: GovDaoLatestProposal
    /** Up to PREVIEW_COUNT newest proposals for the "latest governance" rail.
     *  Empty array (not undefined) when there are none. */
    latestProposals?: GovDaoProposalPreview[]
    href: string
    refetch: () => void
}

export function useGovDao(networkKey: string): GovDaoResult {
    // B-4 made the endpoint argument real. networkKey follows the /:network URL
    // param and can transiently diverge from the frozen active network before
    // NetworkSync reconciles-and-reloads; pin reads to GNO_RPC_URL so this hook
    // keeps its pre-B-4 behavior (active network, resilient chain). Honoring
    // the *viewed* network properly is CAL/B-5 territory.
    // B-5 Phase 3 wave 1. Flag-off this is null and the direct-lib reader runs,
    // behaviour unchanged. Flag-on the provider reads the network actually being
    // VIEWED, which is what the B-4 pin below was a placeholder for.
    const cal = useChainOptional()
    const rpcUrl: string = GNO_RPC_URL
    const href = `/${networkKey}/dao/${GOVDAO_REALM_PATH}`

    const query = useQuery({
        // The CAL's chain id joins the key: with the CAL mounted, two networks can
        // be read in one session, and an un-scoped key would serve one network's
        // governance from another's cache.
        queryKey: ["useGovDao", networkKey, cal?.network.chainId ?? "direct"],
        queryFn: async () => {
            const src = cal ? await readViaCal(cal.provider) : await readViaLib(rpcUrl)
            const openCount = src.proposals.filter((p) => p.status === "open").length
            const members = src.memberCount
            // Readers return newest-first (sorted by id desc), so [0] is the most
            // recent proposal. Omit when there are none (honesty).
            const newest = src.proposals[0]
            const threshold = src.thresholdLabel
            // Top-N newest proposals for the card's "latest governance" rail.
            // Every richer field is already omitted-when-absent by the readers,
            // so the rail never shows fabricated data.
            const latestProposals: GovDaoProposalPreview[] = src.proposals
                .slice(0, PREVIEW_COUNT)
                .map((p) => ({
                    id: p.id,
                    title: p.title,
                    status: p.status,
                    author: p.author,
                    yesPercent: p.yesPercent,
                    noPercent: p.noPercent,
                    createdAt: p.createdAt,
                    href: `${href}/proposal/${p.id}`,
                }))
            return {
                name: src.name,
                openCount: openCount > 0 ? openCount : undefined,
                members: members > 0 ? members : undefined,
                threshold: threshold || undefined,
                latestProposal: newest
                    ? { title: newest.title, status: newest.status }
                    : undefined,
                latestProposals,
            }
        },
        staleTime: 60_000,
        retry: false,
    })

    if (query.isPending) {
        return { state: "loading", name: "GovDAO", href, refetch: query.refetch }
    }
    if (query.isError || !query.data) {
        // Transient RPC failure — keep the spotlight present but honest: name +
        // link + retry, never a blank panel or a fabricated metric.
        return { state: "error", name: "GovDAO", href, refetch: query.refetch }
    }
    const { name, openCount, members, threshold, latestProposal, latestProposals } = query.data
    return { state: "ready", name, openCount, members, threshold, latestProposal, latestProposals, href, refetch: query.refetch }
}

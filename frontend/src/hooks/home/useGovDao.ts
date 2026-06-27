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
import { NETWORKS } from "../../lib/config"

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
    const rpcUrl: string = NETWORKS[networkKey]?.rpcUrl ?? ""
    const href = `/${networkKey}/dao/${GOVDAO_REALM_PATH}`

    const query = useQuery({
        queryKey: ["useGovDao", networkKey],
        queryFn: async () => {
            const [config, proposals] = await Promise.all([
                getDAOConfig(rpcUrl, GOVDAO_REALM_PATH),
                getDAOProposals(rpcUrl, GOVDAO_REALM_PATH),
            ])
            const openCount = proposals.filter((p) => p.status === "open").length
            const members = config?.memberCount ?? 0
            // getDAOProposals returns newest-first (sorted by id desc), so [0] is
            // the most recent proposal. Omit when there are none (honesty).
            const newest = proposals[0]
            const threshold = config?.threshold?.trim() || ""
            // Top-N newest proposals for the card's "latest governance" rail.
            // Every richer field is omitted when absent (empty author, 0 vote%,
            // missing date) so the rail never shows fabricated data.
            const latestProposals: GovDaoProposalPreview[] = proposals
                .slice(0, PREVIEW_COUNT)
                .map((p) => ({
                    id: p.id,
                    title: p.title,
                    status: p.status,
                    author: p.author?.trim() || undefined,
                    yesPercent: p.yesPercent > 0 ? p.yesPercent : undefined,
                    noPercent: p.noPercent > 0 ? p.noPercent : undefined,
                    createdAt: p.createdAt?.trim() || undefined,
                    href: `${href}/proposal/${p.id}`,
                }))
            return {
                name: config?.name || "GovDAO",
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

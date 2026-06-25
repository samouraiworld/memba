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

export interface GovDaoResult {
    state: DoorState
    name: string
    openCount?: number
    members?: number
    /** Governance threshold from getDAOConfig (e.g. "66%"); omitted when absent. */
    threshold?: string
    /** Most recent proposal (newest by id) — title + status; omitted when none. */
    latestProposal?: GovDaoLatestProposal
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
            return {
                name: config?.name || "GovDAO",
                openCount: openCount > 0 ? openCount : undefined,
                members: members > 0 ? members : undefined,
                threshold: threshold || undefined,
                latestProposal: newest
                    ? { title: newest.title, status: newest.status }
                    : undefined,
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
    const { name, openCount, members, threshold, latestProposal } = query.data
    return { state: "ready", name, openCount, members, threshold, latestProposal, href, refetch: query.refetch }
}

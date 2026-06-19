/**
 * FeaturedDaoPanel — live state snapshot for the featured DAO on the active
 * network, shown to everyone (members + visitors) in the StateBoard.
 *
 * Per-panel graceful-degradation contract (same as NetworkPulsePanel):
 *   - SELF-HIDES (returns null) when no featured DAO is configured or the
 *     realm is invalid on the current network — never an error state
 *   - NEVER throws during render — falls back to "—" on partial failures
 *   - Loading: shows skeleton ActionCards
 *
 * Data fetching uses the existing DAO read helpers (getDAOConfig + getDAOProposals
 * from lib/dao) via a single React Query fetch — headline only, no vote expansion.
 *
 * Links:
 *   - "verify on-chain" → gnoweb URL for the realm (getExplorerBaseUrl)
 *   - "read it without connecting" → open proposal deep-link within the app
 *
 * @module components/home/panels/FeaturedDaoPanel
 */

import { useQuery } from "@tanstack/react-query"
import { useNetwork } from "../../../hooks/useNetwork"
import { getFeaturedDaoRealm, getExplorerBaseUrl } from "../../../lib/config"
import { getDAOConfig, getDAOProposals } from "../../../lib/dao"
import { useHomeSnapshot } from "../../../hooks/home/useHomeSnapshot"
import { ActionCard } from "../ActionCard"
import "../home.css"

/** Build the gnoweb verify-on-chain URL for a realm path. */
function gnowebRealmUrl(realmPath: string): string {
    const base = getExplorerBaseUrl()
    // realmPath is e.g. "gno.land/r/samcrew/memba_dao"
    const suffix = realmPath.replace("gno.land/", "")
    return `${base}/${suffix}`
}

/** Format a number for display — undefined/null/0 -> "—". */
function fmt(n: number | undefined | null): string {
    if (n === undefined || n === null || n === 0) return "—"
    return String(n)
}

/**
 * Internal hook — fetches featured DAO headline data (config + first open
 * proposal). Returns null when the realm is absent on this network.
 *
 * Snapshot-first: when useHomeSnapshot is usable, returns data mapped from
 * the snapshot and skips the on-chain getDAOConfig/getDAOProposals calls.
 */
function useFeaturedDao(networkKey: string, rpcUrl: string) {
    const realmPath = getFeaturedDaoRealm(networkKey)
    const { snapshot, usable } = useHomeSnapshot()

    const query = useQuery({
        queryKey: ["featured-dao", networkKey, realmPath],
        queryFn: async () => {
            if (!realmPath) return null
            // Fetch config and proposals in parallel — one DAO, headline only
            const [config, proposals] = await Promise.all([
                getDAOConfig(rpcUrl, realmPath),
                getDAOProposals(rpcUrl, realmPath),
            ])
            if (!config) return null
            const openProposals = proposals.filter(p => p.status === "open")
            return {
                realmPath,
                name: config.name,
                memberCount: config.memberCount,
                openCount: openProposals.length,
                latestOpenProposal: openProposals[0] ?? null,
            }
        },
        // Skip on-chain fetch when the snapshot is usable
        enabled: !!realmPath && !usable,
        staleTime: 60_000,
        retry: 1,
    })

    if (usable) {
        const fd = snapshot?.featuredDao
        // Self-hide when featuredDao is missing or has no realm
        if (!fd?.realmPath || !fd?.name) {
            return { data: null, isLoading: false }
        }
        return {
            data: {
                realmPath: fd.realmPath,
                name: fd.name,
                // members is 0 in v1 snapshot — panel shows "—" which is acceptable
                memberCount: Number(fd.members ?? 0),
                openCount: Number(fd.openProposals ?? 0),
                // Snapshot v1 carries no proposal id — suppress the per-proposal
                // deep-link to avoid rendering /proposal/undefined; open-proposal
                // COUNT is still shown via openCount above.
                latestOpenProposal: null,
            },
            isLoading: false,
        }
    }

    return query
}

/**
 * FeaturedDaoPanel — state-board panel for everyone (member + visitor).
 * Self-hides (renders null) when the featured DAO is not configured or not
 * valid on the active network.
 */
export function FeaturedDaoPanel() {
    const { networkKey, rpcUrl } = useNetwork()
    const realmPath = getFeaturedDaoRealm(networkKey)

    // Self-hide: no featured DAO on this network
    if (!realmPath) return null

    return <FeaturedDaoPanelInner networkKey={networkKey} rpcUrl={rpcUrl} realmPath={realmPath} />
}

interface FeaturedDaoPanelInnerProps {
    networkKey: string
    rpcUrl: string
    realmPath: string
}

function FeaturedDaoPanelInner({ networkKey, rpcUrl, realmPath }: FeaturedDaoPanelInnerProps) {
    const { data, isLoading } = useFeaturedDao(networkKey, rpcUrl)

    // Self-hide if query resolved with null (realm invalid or config missing)
    if (!isLoading && !data) return null

    const verifyHref = gnowebRealmUrl(realmPath)
    const proposal = data?.latestOpenProposal ?? null
    const proposalTitle = proposal?.title ?? "—"
    const proposalHref = proposal
        ? `/${networkKey}/dao/${realmPath}/proposal/${proposal.id}`
        : undefined

    return (
        <div className="featured-dao-panel" data-testid="featured-dao-panel">
            {/* DAO name + verify-on-chain link */}
            <ActionCard
                accent="teal"
                icon="building-community"
                eyebrow="featured DAO"
                title={isLoading ? "…" : (data?.name ?? "—")}
                href={verifyHref}
                actionLabel="verify on-chain ->"
                loading={isLoading}
            />
            {/* Member count */}
            <ActionCard
                accent="neutral"
                icon="users"
                eyebrow="members"
                title={isLoading ? "…" : fmt(data?.memberCount)}
                loading={isLoading}
            />
            {/* Open proposals count + latest headline */}
            <ActionCard
                accent="neutral"
                icon="file-description"
                eyebrow="open proposals"
                title={isLoading ? "…" : fmt(data?.openCount)}
                meta={isLoading ? undefined : (proposal ? proposalTitle : undefined)}
                href={proposalHref}
                actionLabel={proposal ? "read it without connecting ->" : undefined}
                loading={isLoading}
            />
        </div>
    )
}

/**
 * useYourWorlds — TanStack Query hook for the member "your worlds" panel.
 *
 * Reads saved DAOs from localStorage (via getSavedDAOsForOrg) and fetches
 * per-DAO signal:
 *   - config + open-proposal count (getDAOConfig + getDAOProposals) — drives
 *     card content (name, members, open) and the board's loading/ready state.
 *   - role badge (getMemberRole + deriveRoleLabel) — the CONNECTED wallet's
 *     role in each DAO, fetched in a SEPARATE, lazy query so cards render
 *     members/open immediately and the badge fills in when it resolves. The
 *     light getMemberRole lookup avoids pulling the full member list per DAO.
 *
 * Honesty contract:
 *   - members/openCount omitted (undefined) when the value is 0 or absent
 *   - role omitted when the wallet is disconnected or not a member
 *   - name/href always present (from localStorage as fallback when RPC fails)
 *
 * State contract:
 *   - "empty"   → no saved DAOs (UI shows only the "Add a world" invitation)
 *   - "loading" → ≥1 saved DAO, config fetches in flight (role never blocks)
 *   - "ready"   → ≥1 config query settled (success or error); individual errors
 *                 degrade that card but do NOT propagate to board state
 *   - "error"   → reserved for future total failures; individual errors use
 *                 "ready" with degraded card data
 *
 * @module hooks/home/useYourWorlds
 */

import { useQueries } from "@tanstack/react-query"
import type { DoorState } from "../../components/home/Door"
import { getSavedDAOsForOrg } from "../../lib/daoSlug"
import { getDAOConfig, getDAOProposals, getMemberRole, deriveRoleLabel } from "../../lib/dao"
import { NETWORKS } from "../../lib/config"
import { useAuth } from "../useAuth"

export interface YourWorld {
    name: string
    role?: string
    members?: number
    openCount?: number
    health?: number
    href: string
    /** true when the per-world RPC fetch failed */
    degraded?: boolean
}

export interface YourWorldsResult {
    state: DoorState
    worlds: YourWorld[]
    refetch: () => void
}

/**
 * Resolve the member's saved worlds for the given network.
 *
 * @param networkKey  - active network identifier (e.g. "test13")
 * @param orgId       - active org id from OrgContext (null = personal)
 */
export function useYourWorlds(networkKey: string, orgId: string | null): YourWorldsResult {
    const savedDAOs = getSavedDAOsForOrg(orgId)
    const rpcUrl: string = NETWORKS[networkKey]?.rpcUrl ?? ""
    const { address, isAuthenticated } = useAuth()
    const connectedAddress = isAuthenticated ? (address || null) : null

    // Config + open count — one query per saved DAO; drives card content and
    // board state. rules-of-hooks safe (count may be 0).
    const configQueries = useQueries({
        queries: savedDAOs.map((dao) => ({
            queryKey: ["useYourWorlds", networkKey, dao.realmPath],
            queryFn: async () => {
                const [config, proposals] = await Promise.all([
                    getDAOConfig(rpcUrl, dao.realmPath),
                    getDAOProposals(rpcUrl, dao.realmPath),
                ])
                const openCount = proposals.filter((p) => p.status === "open").length
                const memberCount = config?.memberCount ?? 0
                return {
                    name: config?.name ?? dao.name,
                    members: memberCount > 0 ? memberCount : undefined,
                    openCount: openCount > 0 ? openCount : undefined,
                    memberstorePath: config?.memberstorePath || "",
                }
            },
            staleTime: 60_000,
        })),
    })

    // Role badge — connected wallet only, fetched lazily and separately so it
    // never blocks card content or board state. Enabled once the matching
    // config query has resolved (its memberstorePath routes the lookup).
    const roleQueries = useQueries({
        queries: savedDAOs.map((dao, i) => ({
            queryKey: ["useYourWorldsRole", networkKey, dao.realmPath, connectedAddress],
            queryFn: async () => {
                const member = await getMemberRole(
                    rpcUrl,
                    dao.realmPath,
                    connectedAddress as string,
                    configQueries[i]?.data?.memberstorePath || undefined,
                )
                return deriveRoleLabel(member) ?? null
            },
            enabled: !!connectedAddress && !!configQueries[i]?.isSuccess,
            staleTime: 300_000,
        })),
    })

    /** Refetch all per-world queries (wires the error-state retry button). */
    const refetch = () => {
        configQueries.forEach((q) => { void q.refetch() })
        roleQueries.forEach((q) => { void q.refetch() })
    }

    // ── Empty: no saved DAOs ─────────────────────────────────
    if (savedDAOs.length === 0) {
        return { state: "empty", worlds: [], refetch }
    }

    // ── Loading: any config query still pending (none settled yet) ──
    const anyPending = configQueries.some((q) => q.isPending)
    const anySettled = configQueries.some((q) => q.isSuccess || q.isError)

    if (anyPending && !anySettled) {
        return { state: "loading", worlds: [], refetch }
    }

    // ── Ready: at least one config query settled ────────────────────
    // Individual errors degrade the card (use saved name/href as fallback)
    // but do not elevate board state to "error". Role is supplementary —
    // an unresolved/disabled role query simply omits the badge.
    const worlds: YourWorld[] = savedDAOs.map((dao, i) => {
        const q = configQueries[i]
        const href = `/${networkKey}/dao/${dao.realmPath}`

        if (q?.isError || !q?.data) {
            // Degraded card — name/href from localStorage, no metrics
            return { name: dao.name, href, degraded: true }
        }

        const { name, members, openCount } = q.data
        const role = roleQueries[i]?.data || undefined
        return { name, href, members, openCount, role }
    })

    return { state: "ready", worlds, refetch }
}

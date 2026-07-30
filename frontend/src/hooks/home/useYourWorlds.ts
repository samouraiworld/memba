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
 *   - degraded cards self-recover: an unverified config query (transport
 *     outage — never answered) re-polls on an interval until the chain
 *     answers; answered queries never poll (B-9)
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
import { AbciQueryError } from "../../lib/rpcFallback"
import { useAuth } from "../useAuth"

/** Re-poll cadence for UNVERIFIED config queries only (transport error, no
 *  answer yet). The app pins refetchOnWindowFocus:false and its global retry
 *  ignores plain transport errors, so without this a degraded card would
 *  recover only on a full component remount. Answered queries (resolved or
 *  chain-declared-dead) never poll, and refetchIntervalInBackground stays
 *  false app-wide, so a hidden tab never drains the network. */
const DEGRADED_REPOLL_MS = 30_000

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
                    // Strict read (B-9): an all-RPCs-down outage THROWS instead of
                    // returning null. Non-strict null conflated "not deployed on
                    // this network" with "no RPC answered", and the E-F9 dropping
                    // below silently removed saved DAOs during transient outages.
                    getDAOConfig(rpcUrl, dao.realmPath, true).catch((err: unknown) => {
                        // The chain answered: realm not deployed here → the E-F9
                        // "saved on another testnet" signal. Anything else is
                        // transport — rethrow so the card degrades instead.
                        if (err instanceof AbciQueryError) return null
                        throw err
                    }),
                    getDAOProposals(rpcUrl, dao.realmPath),
                ])
                const openCount = proposals.filter((p) => p.status === "open").length
                const memberCount = config?.memberCount ?? 0
                return {
                    // resolved=false means the chain ANSWERED and the realm did not
                    // render on this network (null render or AbciQueryError). Used
                    // to drop untagged legacy entries saved on another testnet
                    // (E-F9). A transport outage never reaches here — it rejects
                    // the query and the card degrades instead.
                    resolved: config != null,
                    name: config?.name ?? dao.name,
                    members: memberCount > 0 ? memberCount : undefined,
                    openCount: openCount > 0 ? openCount : undefined,
                    memberstorePath: config?.memberstorePath || "",
                }
            },
            staleTime: 60_000,
            // B-9 self-recovery: only unverified queries (never answered AND
            // currently errored) re-poll; the chain's answers — a resolved
            // config or "not deployed here" — close the gate for good.
            refetchInterval: (query: { state: { data: unknown; status: string } }) =>
                query.state.data === undefined && query.state.status === "error"
                    ? DEGRADED_REPOLL_MS
                    : false,
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
    // Network-scope (MH2): a saved DAO is shown only when it belongs to the active
    // network. Entries tagged for this network always show (degraded on RPC error);
    // entries tagged for another network are excluded; legacy (untagged) entries
    // drop only when the chain ANSWERS that their realm does not render here — so
    // DAOs saved on a different testnet (e.g. retired test11) drop off instead of
    // rendering as dead "degraded" cards, while a transport outage (nothing
    // answered) degrades them instead of silently deleting the user's board (B-9).
    const worlds: YourWorld[] = savedDAOs.flatMap((dao, i): YourWorld[] => {
        const q = configQueries[i]
        const href = `/${networkKey}/dao/${dao.realmPath}`
        const onThisNetwork = dao.network === networkKey

        // Tagged for a different network → not ours.
        if (dao.network && !onThisNetwork) return []

        // Decide on retained DATA first, not the error flag: React Query keeps
        // the previous data when a background refetch fails, and that answer —
        // the chain's own verdict — outranks a transient error.
        const data = q?.data

        if (!data) {
            // Never got an answer (transport outage or still pending): we could
            // not ask the chain, so a foreign-network entry is indistinguishable
            // from a local one. Keep the card degraded rather than silently
            // dropping saved DAOs (B-9) — entries tagged for another network
            // were already excluded above, and untagged foreign relics still
            // drop once the chain answers (resolved=false below).
            return [{ name: dao.name, href, degraded: true }]
        }

        // Untagged legacy entry whose realm did NOT render on the active network →
        // saved on another testnet (e.g. retired test11/test12). Drop it instead of
        // rendering a dead card (E-F9). This must win over a later refetch error:
        // once the chain has said "not here", an RPC blip may not resurrect the
        // dead card. Tagged-this-network entries fall through.
        if (!dao.network && !data.resolved) return []

        const { name, members, openCount } = data
        const role = roleQueries[i]?.data || undefined
        return [{ name, href, members, openCount, role }]
    })

    return { state: "ready", worlds, refetch }
}

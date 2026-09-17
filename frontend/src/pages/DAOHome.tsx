import { useState, useEffect } from "react"
import { useQuery, useQueries } from "@tanstack/react-query"
import { useLocation, useOutletContext } from "react-router-dom"
import { isProGovernanceRoute } from "../lib/proGovernance"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { ErrorToast } from "../components/ui/ErrorToast"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { GNO_RPC_URL } from "../lib/config"

import {
    getDAOConfig,
    getDAOMembers,
    getDAOProposals,
    getProposalDetail,
    getProposalVotes,
    fallbackProposalTitle,
    type DAOProposal,
} from "../lib/dao"
import { useDaoRoute } from "../hooks/useDaoRoute"
import { useDaoKind } from "../hooks/useDaoKind"
import { resolveOnChainUsername } from "../lib/profile"
import { voterMatchesUser } from "../lib/dao/voteScanner"
import { DAOOverviewCard } from "../components/dao/DAOOverviewCard"
import { ProDAOProposals } from "../components/dao/ProDAOProposals"
import { DAOProposalsSection } from "../components/dao/DAOProposalsSection"
import { DAOMembersPreview } from "../components/dao/DAOMembersPreview"
import { completeQuest, trackPageVisit } from "../lib/quests"
import type { LayoutContext } from "../types/layout"
import "./daohome.css"

/** `view="proposals"` shows only the proposal list (the shell's Proposals section). */
export function DAOHome({ view = "overview" }: { view?: "overview" | "proposals" } = {}) {
    const professional = isProGovernanceRoute(useLocation().pathname)
    const navigate = useNetworkNav()
    const { realmPath, encodedSlug } = useDaoRoute()
    const { auth, adena } = useOutletContext<LayoutContext>()
    const { capabilities } = useDaoKind(realmPath)

    // ── Server state, in React Query ──────────────────────────────
    // The old page hand-rolled a config → (members ∥ proposals) chain plus a
    // progressive vote-enrichment effect that patched the proposals array in
    // place. Same shape here, as queries + pure derivation.

    // Full config (the 3-arg variant — includes tierDistribution), keyed apart
    // from the lighter shared ["dao","config",…] cache other pages use.
    const configQuery = useQuery({
        queryKey: ["dao", "config", realmPath ?? "", "full"],
        enabled: !!realmPath,
        queryFn: () => getDAOConfig(GNO_RPC_URL, realmPath, true),
    })
    const config = configQuery.data ?? null
    const configLoading = configQuery.isPending

    // Members wait for the config (memberstorePath routes tier-based DAOs).
    const membersQuery = useQuery({
        queryKey: ["dao", "members-list", realmPath ?? "", config?.memberstorePath ?? ""],
        enabled: !!realmPath && configQuery.isFetched,
        queryFn: () => getDAOMembers(GNO_RPC_URL, realmPath, config?.memberstorePath, true),
    })
    const members = membersQuery.data ?? []
    const membersLoading = membersQuery.isPending

    const proposalsQuery = useQuery({
        queryKey: ["dao", "proposals", realmPath ?? ""],
        enabled: !!realmPath,
        queryFn: () => getDAOProposals(GNO_RPC_URL, realmPath, true),
    })
    const baseProposals = proposalsQuery.data ?? []
    const proposalsLoading = proposalsQuery.isPending

    // The connected user's @username for the voted-check (was a lazy ref; as a
    // query the voted derivation recomputes when it lands, instead of racing).
    const usernameQuery = useQuery({
        queryKey: ["profile", "username", adena.address ?? ""],
        enabled: !!adena.address,
        queryFn: async () => {
            try {
                return (await resolveOnChainUsername(adena.address)) || null
            } catch {
                return null
            }
        },
    })
    const myUsername = usernameQuery.data ?? null

    // ── Vote enrichment: one query per open/passed proposal (top 10) ──
    // Each needs 2 ABCI calls; allSettled keeps the old partial-tolerance —
    // only a TOTAL failure marks the card degraded (P1-8: never render fake
    // zero-vote data as if it were a genuine no-votes proposal).
    // daokit rows also enrich regardless of status: their list titles are
    // resource-name stand-ins (titleIsPlaceholder) that only the detail page
    // can replace. Same top-10 cap either way.
    const enrichable = baseProposals.filter(p => p.status === "open" || p.status === "passed" || p.titleIsPlaceholder).slice(0, 10)
    const enrichQueries = useQueries({
        queries: enrichable.map((p) => ({
            queryKey: ["dao", "proposal-enrich", realmPath ?? "", p.id],
            queryFn: async () => {
                // Version-2 list rows already carry the realm's tallies; only the
                // vote list is read (to mark proposals the wallet voted on).
                const [detailRes, votesRes] = await Promise.allSettled([
                    p.v2 ? Promise.resolve(null) : getProposalDetail(GNO_RPC_URL, realmPath, p.id),
                    getProposalVotes(GNO_RPC_URL, realmPath, p.id),
                ])
                if (detailRes.status === "rejected" && votesRes.status === "rejected") {
                    return { failed: true as const, detail: null, votes: [] as Awaited<ReturnType<typeof getProposalVotes>> }
                }
                return {
                    failed: false as const,
                    detail: detailRes.status === "fulfilled" ? detailRes.value : null,
                    votes: votesRes.status === "fulfilled" ? votesRes.value : [],
                }
            },
        })),
    })
    const enrichById = new Map(enrichable.map((p, i) => [p.id, enrichQueries[i]?.data]))
    // Ids whose enrichment has RESOLVED (success or degraded) — the cards use
    // this to stop showing the vote-bar placeholder shimmer.
    const enrichedIds = new Set(enrichable.filter((p) => enrichById.get(p.id) !== undefined).map((p) => p.id))

    // Merged proposals + votedIds, derived (the old code accumulated both into
    // state from the enrichment callbacks).
    const votedIds = new Set<number>()
    const proposals: DAOProposal[] = baseProposals.map((p) => {
        const e = enrichById.get(p.id)
        if (!e) return p
        if (e.failed) return { ...p, enrichFailed: true }
        const { detail, votes } = e
        const yesCount = votes.reduce((s, v) => s + v.yesVoters.length, 0)
        const noCount = votes.reduce((s, v) => s + v.noVoters.length, 0)
        const totalCount = yesCount + noCount
        if (adena.address && votes.length > 0) {
            const allVoters = votes.flatMap(v => [...v.yesVoters, ...v.noVoters, ...v.abstainVoters])
            const voted = allVoters.some(v => voterMatchesUser(v.username, adena.address, myUsername))
            if (voted) votedIds.add(p.id)
        }
        // Version-2 tallies are voting power from the realm; voter head counts never replace them.
        if (p.v2) return p
        return {
            ...p,
            // ONLY daokit list rows (titleIsPlaceholder — resource name, not a
            // title) adopt the detail title; other realms' list titles stay
            // authoritative, since getProposalDetail's loose fallbacks can grab
            // a page banner as the "title".
            title: p.titleIsPlaceholder && detail?.title && detail.title !== fallbackProposalTitle(p.id)
                ? detail.title
                : p.title,
            // Percentages are voting-power shares from the proposal detail; a
            // head count of voters is never substituted for them.
            yesPercent: detail ? detail.yesPercent : p.yesPercent,
            noPercent: detail ? detail.noPercent : p.noPercent,
            yesVotes: detail?.yesVotes || yesCount,
            noVotes: detail?.noVotes || noCount,
            abstainVotes: detail?.abstainVotes || 0,
            totalVoters: totalCount || detail?.totalVoters || 0,
        }
    })

    // Fetch errors keep the old per-source messages; first one wins the toast.
    const [fetchErrorDismissed, setFetchErrorDismissed] = useState(false)
    const error = fetchErrorDismissed ? null
        : configQuery.isError
            ? (configQuery.error instanceof Error ? configQuery.error.message : "Failed to load DAO data")
            : membersQuery.isError
                ? (membersQuery.error instanceof Error ? membersQuery.error.message : "Failed to load members")
                : proposalsQuery.isError
                    ? (proposalsQuery.error instanceof Error ? proposalsQuery.error.message : "Failed to load proposals")
                    : null

    // Quest triggers: browse-proposals + page visit
    useEffect(() => {
        if (realmPath) {
            completeQuest("browse-proposals", auth.token ?? undefined)
            trackPageVisit("dao-home", auth.token ?? undefined)
        }
    }, [realmPath, auth.token])

    // Persist last visited DAO slug for plugin sidebar routing
    useEffect(() => {
        if (encodedSlug) {
            localStorage.setItem("memba_last_dao_slug", encodedSlug)
            window.dispatchEvent(new Event("memba:daoVisited"))
        }
    }, [encodedSlug])

    // ── Derived data ──────────────────────────────────────────────
    const activeProposals = proposals.filter((p) => p.status === "open" || p.status === "passed")
    const awaitingExecution = proposals.filter((p) => p.status === "passed")
    const completedProposals = proposals.filter((p) => p.status !== "open" && p.status !== "passed")
    const proposalsWithVotes = proposals.filter(p => (p.yesVotes + p.noVotes + p.abstainVotes) > 0)
    const memberCount = config?.memberCount || members.length
    const maxVoterParticipation = proposalsWithVotes.length > 0
        ? Math.max(...proposalsWithVotes.map(p => p.yesVotes + p.noVotes + p.abstainVotes))
        : 0
    const nonVoterCount = memberCount > 0 ? Math.max(0, memberCount - maxVoterParticipation) : 0
    const nonVoterPercent = memberCount > 0 ? Math.round((nonVoterCount / memberCount) * 100) : 0
    const currentMember = members.find((m) => m.address === adena.address)
    // New proposals: only where the contract accepts them, and only for members.
    const canPropose = capabilities.propose.length > 0 && auth.isAuthenticated && !!currentMember && !config?.isArchived
    const totalPower = config?.tierDistribution?.reduce((sum, t) => sum + t.power, 0) || config?.v2?.total_power || 0

    useEffect(() => {
        if (!realmPath) navigate("/dao")
    }, [realmPath, navigate])

    // ── Loading / empty states ────────────────────────────────────
    if (!realmPath) {
        return <div className="animate-fade-in dao-skeleton-col"><SkeletonCard /></div>
    }
    if (configLoading) {
        return <div className="animate-fade-in dao-skeleton-col"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
    }

    // ── Render ────────────────────────────────────────────────────
    return (
        <div className="animate-fade-in dao-container" aria-label="DAO dashboard">
            {professional && (!config || configQuery.isError || membersQuery.isError || proposalsQuery.isError) && (
                <div className="gov-read-notice" role="status">
                    <div><strong>Some DAO data is unavailable</strong><p>Check the network and retry. Previously loaded data may be out of date; a dash means the count is unavailable.</p></div>
                    <button className="k-btn-secondary" onClick={() => { void configQuery.refetch(); void membersQuery.refetch(); void proposalsQuery.refetch() }}>Retry DAO data</button>
                </div>
            )}
            {view === "overview" && <DAOOverviewCard
                professional={professional}
                proposalsKnown={proposalsQuery.isSuccess}
                membersKnown={!!config && membersQuery.isSuccess}
                config={config}
                realmPath={realmPath}
                encodedSlug={encodedSlug}
                currentMember={currentMember}
                isAuthenticated={auth.isAuthenticated}
                memberCount={memberCount}
                activeProposals={activeProposals.length}
                awaitingExecution={awaitingExecution.length}
                totalProposals={proposals.length}
                nonVoterPercent={nonVoterPercent}
                nonVoterCount={nonVoterCount}
                maxVoterParticipation={maxVoterParticipation}
                proposalsWithVotesCount={proposalsWithVotes.length}
                totalPower={totalPower}
                channels={capabilities.channels}
            />}

            <div aria-live="polite">
            {professional ? <ProDAOProposals
                key={realmPath}
                encodedSlug={encodedSlug}
                proposals={[...activeProposals, ...completedProposals]}
                loading={proposalsLoading}
                failed={proposalsQuery.isError}
                retry={() => { void proposalsQuery.refetch() }}
                canPropose={canPropose}
                votedIds={votedIds}
            /> : <DAOProposalsSection
                encodedSlug={encodedSlug}
                realmPath={realmPath}
                isAuthenticated={auth.isAuthenticated}
                canPropose={canPropose}
                isArchived={config?.isArchived || false}
                isMember={!!currentMember}
                memberCount={memberCount}
                activeProposals={activeProposals}
                completedProposals={completedProposals}
                votedIds={votedIds}
                enrichedIds={enrichedIds}
                proposalsLoading={proposalsLoading}
            />}
            </div>

            {view === "overview" && (professional && membersQuery.isError ? <p className="gov-read-notice">Member details are unavailable. Use Retry DAO data above to try again.</p> : <DAOMembersPreview
                professional={professional}
                encodedSlug={encodedSlug}
                members={members}
                memberCount={memberCount}
                membersLoading={membersLoading}
                currentUserAddress={adena.address}
            />)}


            <ErrorToast message={error} onDismiss={() => setFetchErrorDismissed(true)} onRetry={() => { setFetchErrorDismissed(false); void configQuery.refetch(); void membersQuery.refetch(); void proposalsQuery.refetch() }} />
        </div>
    )
}

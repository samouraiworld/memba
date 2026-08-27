import { useState, useEffect, useMemo } from "react"
import { useQuery, useQueries } from "@tanstack/react-query"
import { useOutletContext } from "react-router-dom"
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
import { resolveOnChainUsername } from "../lib/profile"
import { useJitsiContext } from "../contexts/JitsiContext"
import { DeployPluginModal } from "../components/dao/DeployPluginModal"
import { DAOOverviewCard } from "../components/dao/DAOOverviewCard"
import { DAOProposalsSection } from "../components/dao/DAOProposalsSection"
import { DAOMembersPreview } from "../components/dao/DAOMembersPreview"
import { DAOTreasuryCard, DAOPluginsGrid } from "../components/dao/DAOPluginsGrid"
import { completeQuest, trackPageVisit } from "../lib/quests"
import type { LayoutContext } from "../types/layout"
import "./daohome.css"

export function DAOHome() {
    const navigate = useNetworkNav()
    const { realmPath, encodedSlug } = useDaoRoute()
    const { auth, adena } = useOutletContext<LayoutContext>()
    const { session, joinRoom } = useJitsiContext()

    const [showDeployModal, setShowDeployModal] = useState(false)

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
                const [detailRes, votesRes] = await Promise.allSettled([
                    getProposalDetail(GNO_RPC_URL, realmPath, p.id),
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
            const addr = adena.address.toLowerCase()
            const uname = myUsername?.toLowerCase() || ""
            const allVoters = votes.flatMap(v => [
                ...v.yesVoters.map(ve => ve.username.toLowerCase()),
                ...v.noVoters.map(ve => ve.username.toLowerCase()),
                ...v.abstainVoters.map(ve => ve.username.toLowerCase()),
            ])
            const voted = allVoters.some(v =>
                v === uname || v === `@${uname.replace(/^@/, "")}` || v.includes(addr.slice(0, 10))
            )
            if (voted) votedIds.add(p.id)
        }
        return {
            ...p,
            // ONLY daokit list rows (titleIsPlaceholder — resource name, not a
            // title) adopt the detail title; other realms' list titles stay
            // authoritative, since getProposalDetail's loose fallbacks can grab
            // a page banner as the "title".
            title: p.titleIsPlaceholder && detail?.title && detail.title !== fallbackProposalTitle(p.id)
                ? detail.title
                : p.title,
            yesPercent: detail?.yesPercent || (totalCount > 0 ? Math.round((yesCount / totalCount) * 100) : 0),
            noPercent: detail?.noPercent || (totalCount > 0 ? Math.round((noCount / totalCount) * 100) : 0),
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
    const totalPower = config?.tierDistribution?.reduce((sum, t) => sum + t.power, 0) || 0

    const healthScore = useMemo(() => {
        if (!config || proposals.length === 0) return null
        const participationPts = proposalsWithVotes.length > 0
            ? Math.round((1 - nonVoterPercent / 100) * 40) : 0
        const execBacklog = awaitingExecution.length
        const execPts = execBacklog === 0 ? 30 : execBacklog <= 2 ? 20 : execBacklog <= 5 ? 10 : 0
        const activityPts = proposals.length >= 10 ? 30 : proposals.length >= 5 ? 20 : proposals.length >= 2 ? 10 : 5
        const total = participationPts + execPts + activityPts
        const grade = total >= 80 ? "A" : total >= 60 ? "B" : total >= 40 ? "C" : "D"
        const color = grade === "A" ? "var(--color-brand)" : grade === "B" ? "var(--color-accent-blue-sky)" : grade === "C" ? "var(--color-accent-gold-warm)" : "var(--color-status-error-deep)"
        return { grade, total, color, participationPts, execPts, activityPts }
    }, [proposals.length, proposalsWithVotes.length, nonVoterPercent, awaitingExecution.length, config])

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
            <DAOOverviewCard
                config={config}
                realmPath={realmPath}
                encodedSlug={encodedSlug}
                currentMember={currentMember}
                isAuthenticated={auth.isAuthenticated}
                walletAddress={adena.address}
                memberCount={memberCount}
                activeProposals={activeProposals.length}
                awaitingExecution={awaitingExecution.length}
                totalProposals={proposals.length}
                nonVoterPercent={nonVoterPercent}
                nonVoterCount={nonVoterCount}
                maxVoterParticipation={maxVoterParticipation}
                proposalsWithVotesCount={proposalsWithVotes.length}
                totalPower={totalPower}
                healthScore={healthScore}
                session={session}
                joinRoom={joinRoom}
            />

            <div aria-live="polite">
            <DAOProposalsSection
                encodedSlug={encodedSlug}
                realmPath={realmPath}
                isAuthenticated={auth.isAuthenticated}
                isArchived={config?.isArchived || false}
                isMember={!!currentMember}
                memberCount={memberCount}
                activeProposals={activeProposals}
                completedProposals={completedProposals}
                votedIds={votedIds}
                enrichedIds={enrichedIds}
                proposalsLoading={proposalsLoading}
            />
            </div>

            <DAOMembersPreview
                encodedSlug={encodedSlug}
                members={members}
                memberCount={memberCount}
                membersLoading={membersLoading}
                currentUserAddress={adena.address}
            />

            <DAOTreasuryCard encodedSlug={encodedSlug} />
            <DAOPluginsGrid encodedSlug={encodedSlug} />

            {showDeployModal && (
                <DeployPluginModal
                    daoRealmPath={realmPath}
                    daoName={config?.name || realmPath.split("/").pop() || "DAO"}
                    callerAddress={adena.address || ""}
                    onClose={() => setShowDeployModal(false)}
                    onDeployed={() => { setShowDeployModal(false); void configQuery.refetch(); void membersQuery.refetch(); void proposalsQuery.refetch() }}
                />
            )}

            <ErrorToast message={error} onDismiss={() => setFetchErrorDismissed(true)} onRetry={() => { setFetchErrorDismissed(false); void configQuery.refetch(); void membersQuery.refetch(); void proposalsQuery.refetch() }} />
        </div>
    )
}

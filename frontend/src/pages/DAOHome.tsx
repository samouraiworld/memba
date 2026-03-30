import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useNavigate, useParams, useOutletContext } from "react-router-dom"
import { ErrorToast } from "../components/ui/ErrorToast"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { GNO_RPC_URL } from "../lib/config"

import {
    getDAOConfig,
    getDAOMembers,
    getDAOProposals,
    getProposalDetail,
    getProposalVotes,
    type DAOConfig,
    type DAOMember,
    type DAOProposal,
} from "../lib/dao"
import { decodeSlug, encodeSlug } from "../lib/daoSlug"
import { resolveOnChainUsername } from "../lib/profile"
import { useJitsiContext } from "../contexts/JitsiContext"
import { DeployPluginModal } from "../components/dao/DeployPluginModal"
import { DAOOverviewCard } from "../components/dao/DAOOverviewCard"
import { DAOProposalsSection } from "../components/dao/DAOProposalsSection"
import { DAOMembersPreview } from "../components/dao/DAOMembersPreview"
import { DAOTreasuryCard, DAOPluginsGrid } from "../components/dao/DAOPluginsGrid"
import type { LayoutContext } from "../types/layout"
import "./daohome.css"

export function DAOHome() {
    const navigate = useNavigate()
    const { slug } = useParams<{ slug: string }>()
    const { auth, adena } = useOutletContext<LayoutContext>()
    const { session, joinRoom } = useJitsiContext()

    const realmPath = slug ? decodeSlug(slug) : ""
    const encodedSlug = realmPath ? encodeSlug(realmPath) : (slug || "")

    const [config, setConfig] = useState<DAOConfig | null>(null)
    const [members, setMembers] = useState<DAOMember[]>([])
    const [proposals, setProposals] = useState<DAOProposal[]>([])
    const [configLoading, setConfigLoading] = useState(true)
    const [membersLoading, setMembersLoading] = useState(true)
    const [proposalsLoading, setProposalsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [votedIds, setVotedIds] = useState<Set<number>>(new Set())
    const [enrichedIds, setEnrichedIds] = useState<Set<number>>(new Set())
    const [showDeployModal, setShowDeployModal] = useState(false)
    const usernameRef = useRef<string | null>(null)

    // ── Data loading ──────────────────────────────────────────────
    const loadData = useCallback(async () => {
        if (!realmPath) return
        setEnrichedIds(new Set())
        setVotedIds(new Set())
        setConfigLoading(true)
        setMembersLoading(true)
        setProposalsLoading(true)
        setError(null)
        try {
            const cfg = await getDAOConfig(GNO_RPC_URL, realmPath)
            setConfig(cfg)
            setConfigLoading(false)

            getDAOMembers(GNO_RPC_URL, realmPath, cfg?.memberstorePath)
                .then(setMembers)
                .catch((err) => setError(err instanceof Error ? err.message : "Failed to load members"))
                .finally(() => setMembersLoading(false))

            getDAOProposals(GNO_RPC_URL, realmPath)
                .then(setProposals)
                .catch((err) => setError(err instanceof Error ? err.message : "Failed to load proposals"))
                .finally(() => setProposalsLoading(false))
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load DAO data")
            setConfigLoading(false)
            setMembersLoading(false)
            setProposalsLoading(false)
        }
    }, [realmPath])

    useEffect(() => { loadData() }, [loadData])

    // Persist last visited DAO slug for plugin sidebar routing
    useEffect(() => {
        if (encodedSlug) {
            localStorage.setItem("memba_last_dao_slug", encodedSlug)
            window.dispatchEvent(new Event("memba:daoVisited"))
        }
    }, [encodedSlug])

    // ── Vote enrichment ───────────────────────────────────────────
    useEffect(() => {
        if (proposalsLoading || proposals.length === 0) return
        if (adena.address && !usernameRef.current) {
            resolveOnChainUsername(adena.address)
                .then(u => { usernameRef.current = u || null })
                .catch(() => { })
        }
        const enrichable = proposals.filter(p => p.status === "open" || p.status === "passed")
        enrichable.slice(0, 10).forEach(p => {
            if (enrichedIds.has(p.id)) return
            setEnrichedIds(prev => new Set([...prev, p.id]))
            Promise.all([
                getProposalDetail(GNO_RPC_URL, realmPath, p.id).catch(() => null),
                getProposalVotes(GNO_RPC_URL, realmPath, p.id).catch(() => []),
            ]).then(([detail, votes]) => {
                const yesCount = votes.reduce((s, v) => s + v.yesVoters.length, 0)
                const noCount = votes.reduce((s, v) => s + v.noVoters.length, 0)
                const totalCount = yesCount + noCount
                const yesPercent = detail?.yesPercent || (totalCount > 0 ? Math.round((yesCount / totalCount) * 100) : 0)
                const noPercent = detail?.noPercent || (totalCount > 0 ? Math.round((noCount / totalCount) * 100) : 0)
                const yesVotes = detail?.yesVotes || yesCount
                const noVotes = detail?.noVotes || noCount

                setProposals(prev => prev.map(pp => pp.id === p.id ? {
                    ...pp, yesPercent, noPercent, yesVotes, noVotes,
                    abstainVotes: detail?.abstainVotes || 0,
                    totalVoters: totalCount || detail?.totalVoters || 0,
                } : pp))

                if (adena.address && votes.length > 0) {
                    const addr = adena.address.toLowerCase()
                    const uname = usernameRef.current?.toLowerCase() || ""
                    const allVoters = votes.flatMap(v => [
                        ...v.yesVoters.map(ve => ve.username.toLowerCase()),
                        ...v.noVoters.map(ve => ve.username.toLowerCase()),
                        ...v.abstainVoters.map(ve => ve.username.toLowerCase()),
                    ])
                    const voted = allVoters.some(v =>
                        v === uname || v === `@${uname.replace(/^@/, "")}` || v.includes(addr.slice(0, 10))
                    )
                    if (voted) setVotedIds(prev => new Set([...prev, p.id]))
                }
            })
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [proposalsLoading, proposals.length, adena.address, realmPath])

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
        const color = grade === "A" ? "#00d4aa" : grade === "B" ? "#4dc9f6" : grade === "C" ? "#f7b731" : "#e74c3c"
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
        <div className="animate-fade-in dao-container">
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

            <DAOProposalsSection
                encodedSlug={encodedSlug}
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
                    onDeployed={() => { setShowDeployModal(false); loadData() }}
                />
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

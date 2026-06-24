/**
 * useHomeActions — aggregates the member's immediate action items
 * for the Control Room Action Inbox.
 *
 * Sources:
 *   - VOTES: useUnvotedProposals (on-chain scan of saved DAOs)
 *   - SIGNATURES: api.transactions PENDING, filtered to unsigned by this user
 *   - CANDIDATURE: canApplyForMembership() (quest XP gate)
 *
 * Returns actions sorted votes/signatures first, candidature last.
 */

import { useQuery } from "@tanstack/react-query"
import { useUnvotedProposals } from "../useUnvotedProposals"
import type { UnvotedProposal } from "../../lib/dao/voteScanner"
import { api } from "../../lib/api"
import { ExecutionState } from "../../gen/memba/v1/memba_pb"
import { canApplyForMembership } from "../../lib/quests"
import type { LayoutContext } from "../../types/layout"
import type { ActionAccent } from "../../components/home/ActionCard"

export type { UnvotedProposal }

// ── Public types ──────────────────────────────────────────────

export interface HomeAction {
    id: string
    kind: "vote" | "sign" | "claim" | "candidature"
    accent: ActionAccent
    eyebrow: string
    title: string
    meta?: string
    href: string
}

// ── Hook ──────────────────────────────────────────────────────

export function useHomeActions(auth: LayoutContext["auth"]): {
    actions: HomeAction[]
    loading: boolean
    allCaughtUp: boolean
    unvotedProposals: UnvotedProposal[]
} {
    const address = auth.isAuthenticated ? (auth.address || null) : null
    const token = auth.isAuthenticated ? auth.token : null

    // ── VOTES ─────────────────────────────────────────────────
    const { proposals: unvotedProposals, loading: votesLoading } = useUnvotedProposals(address)

    // ── SIGNATURES ────────────────────────────────────────────
    const { data: pendingTxData, isLoading: txLoading } = useQuery({
        queryKey: ["home", "pending-tx", address],
        queryFn: async () => {
            if (!token) return { transactions: [] }
            return api.transactions({
                authToken: token,
                executionState: ExecutionState.PENDING,
                limit: 20,
            })
        },
        enabled: !!token,
        retry: false,
        staleTime: 60_000,
    })

    const pendingTxs = pendingTxData?.transactions ?? []

    // Filter to txs this user has not signed yet (mirrors Dashboard.tsx line 191-193)
    const unsignedTxs = pendingTxs.filter(
        tx => !tx.signatures.some(s => s.userAddress === address)
    )

    // ── BUILD ACTIONS ─────────────────────────────────────────

    const voteActions: HomeAction[] = unvotedProposals.map(p => ({
        id: `vote:${p.realmPath}:${p.proposalId}`,
        kind: "vote" as const,
        accent: "teal" as const,
        eyebrow: `vote · ${p.daoName}`,
        title: p.proposalTitle,
        meta: p.proposalStatus,
        href: `/dao/${p.daoSlug}/proposal/${p.proposalId}`,
    }))

    const signActions: HomeAction[] = unsignedTxs.map(tx => ({
        id: `sign:${tx.id}`,
        kind: "sign" as const,
        accent: "amber" as const,
        eyebrow: "sign · multisig",
        title: tx.memo || tx.type || `Transaction #${tx.id}`,
        meta: tx.multisigAddress ? `${tx.multisigAddress.slice(0, 12)}…` : undefined,
        href: `/tx/${tx.id}`,
    }))

    const candidatureActions: HomeAction[] = auth.isAuthenticated && canApplyForMembership()
        ? [{
            id: "candidature",
            kind: "candidature" as const,
            accent: "teal" as const,
            eyebrow: "membership",
            title: "You're eligible for Memba DAO",
            href: "/candidature",
        }]
        : []

    // Sort: votes + signatures first, then candidature
    const actions: HomeAction[] = [
        ...voteActions,
        ...signActions,
        ...candidatureActions,
    ]

    const loading = votesLoading || (!!token && txLoading)
    const allCaughtUp = !loading && actions.length === 0

    return { actions, loading, allCaughtUp, unvotedProposals }
}

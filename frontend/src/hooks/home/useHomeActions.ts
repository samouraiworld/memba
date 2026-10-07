/**
 * useHomeActions — aggregates the member's immediate action items
 * for the Control Room Action Inbox.
 *
 * Sources:
 *   - VOTES: useUnvotedProposals (on-chain scan of saved DAOs)
 *   - SIGNATURES: api.transactions PENDING waiting for this user (lib/multisigAwaiting);
 *     a multisig they have not joined shows only a count, never the proposer's memo
 *   - CANDIDATURE: backend verified quest XP gate
 *
 * Returns actions sorted votes/signatures first, candidature last.
 */

import { useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useUnvotedProposals } from "../useUnvotedProposals"
import type { UnvotedProposal } from "../../lib/dao/voteScanner"
import { api } from "../../lib/api"
import { ExecutionState } from "../../gen/memba/v1/memba_pb"
import { resolveCandidatureEligibility } from "../../lib/quests"
import { isQuestAvailableOnNetwork } from "../../lib/questNetwork"
import { useNetworkKey } from "../useNetworkNav"
import { ENABLE_NATIVE_GNO_MULTISIG, GNO_CHAIN_ID } from "../../lib/config"
import { countAwaiting, sharedAwaitingText, waitsForSignature } from "../../lib/multisigAwaiting"
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
    const nk = useNetworkKey()
    const candidatureAvailable = isQuestAvailableOnNetwork("submit-candidature", nk)
    const queryClient = useQueryClient()

    // ── VOTES ─────────────────────────────────────────────────
    const { proposals: unvotedProposals, loading: votesLoading } = useUnvotedProposals(address)

    // ── SIGNATURES ────────────────────────────────────────────
    const { data: pendingTxData, isLoading: txLoading } = useQuery({
        queryKey: ["home", "pending-tx", address],
        queryFn: async () => {
            if (!token) return { transactions: [] }
            return api.transactions({
                authToken: token,
                chainId: GNO_CHAIN_ID,
                executionState: ExecutionState.PENDING,
                limit: 20,
            })
        },
        enabled: !!token && ENABLE_NATIVE_GNO_MULTISIG,
        retry: false,
        staleTime: 60_000,
    })

    const pendingTxs = pendingTxData?.transactions ?? []

    // Which accounts the member joined; until known, every account counts as shared (memo hidden).
    const { data: joinedMultisigs, isLoading: joinedLoading } = useQuery({
        queryKey: ["home", "joined-multisigs", address],
        queryFn: async () => new Set((await api.multisigs({ authToken: token!, chainId: GNO_CHAIN_ID, limit: 50 })).multisigs.filter((m) => m.joined).map((m) => m.address)),
        enabled: !!token && ENABLE_NATIVE_GNO_MULTISIG,
        retry: false,
        staleTime: 60_000,
    })

    const { data: candidatureEligibility } = useQuery({
        queryKey: ["home", "candidature-eligibility", address],
        queryFn: () => resolveCandidatureEligibility(address),
        enabled: !!address && candidatureAvailable,
        retry: false,
        staleTime: 60_000,
    })

    useEffect(() => {
        if (!address || !candidatureAvailable) return
        const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["home", "candidature-eligibility", address] }) }
        window.addEventListener("quest-completed", refresh)
        window.addEventListener("focus", refresh)
        return () => {
            window.removeEventListener("quest-completed", refresh)
            window.removeEventListener("focus", refresh)
        }
    }, [address, candidatureAvailable, queryClient])

    const waiting = pendingTxs.filter(tx => waitsForSignature(tx, address ?? ""))
    const isJoined = (multisig: string) => joinedMultisigs?.has(multisig) ?? false

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

    const signActions: HomeAction[] = [
        ...waiting.filter(tx => isJoined(tx.multisigAddress)).map(tx => ({
            id: `sign:${tx.id}`,
            kind: "sign" as const,
            accent: "amber" as const,
            eyebrow: "sign · multisig",
            title: tx.memo || tx.type || `Transaction #${tx.id}`,
            meta: tx.multisigAddress ? `${tx.multisigAddress.slice(0, 12)}…` : undefined,
            href: `/tx/${tx.id}`,
        })),
        ...[...countAwaiting(waiting.filter(tx => !isJoined(tx.multisigAddress)), address ?? "")].map(([multisig, n]) => ({
            id: `sign-shared:${multisig}`,
            kind: "sign" as const,
            accent: "amber" as const,
            eyebrow: "sign · multisig",
            title: sharedAwaitingText(n),
            meta: `${multisig.slice(0, 12)}…`,
            href: `/multisig/${multisig}`,
        })),
    ]

    const candidatureActions: HomeAction[] = auth.isAuthenticated && candidatureAvailable && candidatureEligibility?.eligible
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

    const loading = votesLoading || (!!token && (txLoading || joinedLoading))
    const allCaughtUp = !loading && actions.length === 0

    return { actions, loading, allCaughtUp, unvotedProposals }
}

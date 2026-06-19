/**
 * useHomeActions.test.ts — unit tests for the useHomeActions hook.
 *
 * Mocks:
 *   - useUnvotedProposals (on-chain vote scanner)
 *   - api.transactions (multisig backend)
 *   - canApplyForMembership (quest XP gate)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, type ReactNode } from "react"

// ── Module mocks (hoisted before imports) ────────────────────

vi.mock("../useUnvotedProposals", () => ({
    useUnvotedProposals: vi.fn(() => ({ proposals: [], loading: false })),
}))

vi.mock("../../lib/api", () => ({
    api: {
        transactions: vi.fn().mockResolvedValue({ transactions: [] }),
    },
}))

vi.mock("../../gen/memba/v1/memba_pb", () => ({
    ExecutionState: { PENDING: 1 },
}))

vi.mock("../../lib/quests", () => ({
    canApplyForMembership: vi.fn(() => false),
}))

// ── Resolve mocked modules for per-test control ───────────────

const unvotedMod = await import("../useUnvotedProposals")
const apiMod = await import("../../lib/api")
const questsMod = await import("../../lib/quests")

// ── Test subjects ─────────────────────────────────────────────

import { useHomeActions } from "./useHomeActions"
import type { LayoutContext } from "../../types/layout"

// ── Helpers ───────────────────────────────────────────────────

function makeAuth(overrides?: Partial<LayoutContext["auth"]>): LayoutContext["auth"] {
    return {
        token: { raw: "tok" } as LayoutContext["auth"]["token"],
        isAuthenticated: true,
        address: "g1testaddress",
        loading: false,
        error: null,
        ...overrides,
    }
}

function makeWrapper() {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    })
    return function Wrapper({ children }: { children: ReactNode }) {
        return createElement(QueryClientProvider, { client }, children)
    }
}

// ── Tests ─────────────────────────────────────────────────────

describe("useHomeActions — with actions", () => {
    beforeEach(() => {
        vi.mocked(unvotedMod.useUnvotedProposals).mockReturnValue({
            proposals: [
                {
                    daoName: "Memba DAO",
                    daoSlug: "memba",
                    realmPath: "gno.land/r/memba/dao",
                    proposalId: 1,
                    proposalTitle: "Proposal Alpha",
                    proposalStatus: "open",
                },
                {
                    daoName: "Memba DAO",
                    daoSlug: "memba",
                    realmPath: "gno.land/r/memba/dao",
                    proposalId: 2,
                    proposalTitle: "Proposal Beta",
                    proposalStatus: "open",
                },
            ],
            loading: false,
            refresh: vi.fn(),
        })

        vi.mocked(apiMod.api.transactions).mockResolvedValue({
            transactions: [
                {
                    id: 99,
                    multisigAddress: "g1multisigaddr",
                    memo: "Pay the team",
                    type: "send",
                    createdAt: new Date().toISOString(),
                    finalHash: "",
                    threshold: 2,
                    signatures: [
                        // one signature from a different address — NOT signed by test user
                        { userAddress: "g1other" },
                    ],
                    msgsJson: "",
                    chainId: "test-13",
                    feeJson: "",
                    accountNumber: 0,
                    sequence: 0,
                    creatorAddress: "g1other",
                    membersCount: 2,
                    multisigPubkeyJson: "",
                },
            ],
        })

        vi.mocked(questsMod.canApplyForMembership).mockReturnValue(false)
    })

    it("returns a vote action (accent teal) for each unvoted proposal", async () => {
        const { result } = renderHook(
            () => useHomeActions(makeAuth()),
            { wrapper: makeWrapper() },
        )

        await waitFor(() => expect(result.current.loading).toBe(false))

        const voteActions = result.current.actions.filter(a => a.kind === "vote")
        expect(voteActions).toHaveLength(2)
        expect(voteActions[0].accent).toBe("teal")
        expect(voteActions[0].eyebrow).toContain("vote")
        expect(voteActions[1].accent).toBe("teal")
    })

    it("returns a sign action (accent amber) for the unsigned pending tx", async () => {
        const { result } = renderHook(
            () => useHomeActions(makeAuth()),
            { wrapper: makeWrapper() },
        )

        await waitFor(() => expect(result.current.loading).toBe(false))

        const signActions = result.current.actions.filter(a => a.kind === "sign")
        expect(signActions).toHaveLength(1)
        expect(signActions[0].accent).toBe("amber")
        expect(signActions[0].href).toContain("tx/99")
    })

    it("sets allCaughtUp to false when there are actions", async () => {
        const { result } = renderHook(
            () => useHomeActions(makeAuth()),
            { wrapper: makeWrapper() },
        )

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.allCaughtUp).toBe(false)
    })

    it("puts vote/sign actions before candidature", async () => {
        vi.mocked(questsMod.canApplyForMembership).mockReturnValue(true)

        const { result } = renderHook(
            () => useHomeActions(makeAuth()),
            { wrapper: makeWrapper() },
        )

        await waitFor(() => expect(result.current.loading).toBe(false))

        const kinds = result.current.actions.map(a => a.kind)
        const lastKind = kinds[kinds.length - 1]
        expect(lastKind).toBe("candidature")
        // All vote/sign actions appear before candidature
        const candidatureIdx = kinds.indexOf("candidature")
        const afterCandidature = kinds.slice(candidatureIdx + 1)
        expect(afterCandidature.every(k => k === "candidature")).toBe(true)
    })
})

describe("useHomeActions — empty / all caught up", () => {
    beforeEach(() => {
        vi.mocked(unvotedMod.useUnvotedProposals).mockReturnValue({
            proposals: [],
            loading: false,
            refresh: vi.fn(),
        })

        vi.mocked(apiMod.api.transactions).mockResolvedValue({
            transactions: [],
        })

        vi.mocked(questsMod.canApplyForMembership).mockReturnValue(false)
    })

    it("returns allCaughtUp === true when no proposals, no txs, no candidature", async () => {
        const { result } = renderHook(
            () => useHomeActions(makeAuth()),
            { wrapper: makeWrapper() },
        )

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.allCaughtUp).toBe(true)
        expect(result.current.actions).toHaveLength(0)
    })
})

describe("useHomeActions — signed tx excluded", () => {
    it("does not include a tx the user already signed", async () => {
        vi.mocked(unvotedMod.useUnvotedProposals).mockReturnValue({
            proposals: [],
            loading: false,
            refresh: vi.fn(),
        })

        vi.mocked(apiMod.api.transactions).mockResolvedValue({
            transactions: [
                {
                    id: 42,
                    multisigAddress: "g1ms",
                    memo: "Already signed by test user",
                    type: "send",
                    createdAt: new Date().toISOString(),
                    finalHash: "",
                    threshold: 2,
                    signatures: [
                        // test user already signed
                        { userAddress: "g1testaddress" },
                    ],
                    msgsJson: "",
                    chainId: "test-13",
                    feeJson: "",
                    accountNumber: 0,
                    sequence: 0,
                    creatorAddress: "g1testaddress",
                    membersCount: 2,
                    multisigPubkeyJson: "",
                },
            ],
        })

        vi.mocked(questsMod.canApplyForMembership).mockReturnValue(false)

        const { result } = renderHook(
            () => useHomeActions(makeAuth()),
            { wrapper: makeWrapper() },
        )

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.actions.filter(a => a.kind === "sign")).toHaveLength(0)
        expect(result.current.allCaughtUp).toBe(true)
    })
})

describe("useHomeActions — candidature", () => {
    it("includes a candidature action when canApplyForMembership returns true", async () => {
        vi.mocked(unvotedMod.useUnvotedProposals).mockReturnValue({
            proposals: [],
            loading: false,
            refresh: vi.fn(),
        })
        vi.mocked(apiMod.api.transactions).mockResolvedValue({ transactions: [] })
        vi.mocked(questsMod.canApplyForMembership).mockReturnValue(true)

        const { result } = renderHook(
            () => useHomeActions(makeAuth()),
            { wrapper: makeWrapper() },
        )

        await waitFor(() => expect(result.current.loading).toBe(false))

        const candidature = result.current.actions.filter(a => a.kind === "candidature")
        expect(candidature).toHaveLength(1)
        expect(candidature[0].href).toContain("candidature")
        expect(result.current.allCaughtUp).toBe(false)
    })
})

describe("useHomeActions — unauthenticated", () => {
    it("returns empty actions when not authenticated", async () => {
        vi.mocked(unvotedMod.useUnvotedProposals).mockReturnValue({
            proposals: [],
            loading: false,
            refresh: vi.fn(),
        })
        vi.mocked(questsMod.canApplyForMembership).mockReturnValue(false)

        const { result } = renderHook(
            () => useHomeActions(makeAuth({ isAuthenticated: false, token: null, address: "" })),
            { wrapper: makeWrapper() },
        )

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.actions).toHaveLength(0)
    })
})

describe("useHomeActions — exposes unvotedProposals for consumers", () => {
    it("returns unvotedProposals so callers need not call useUnvotedProposals separately", async () => {
        const proposals = [
            {
                daoName: "Memba DAO",
                daoSlug: "memba",
                realmPath: "gno.land/r/memba/dao",
                proposalId: 7,
                proposalTitle: "Singleton scan check",
                proposalStatus: "open",
            },
        ]

        vi.mocked(unvotedMod.useUnvotedProposals).mockReturnValue({
            proposals,
            loading: false,
            refresh: vi.fn(),
        })
        vi.mocked(apiMod.api.transactions).mockResolvedValue({ transactions: [] })
        vi.mocked(questsMod.canApplyForMembership).mockReturnValue(false)

        const { result } = renderHook(
            () => useHomeActions(makeAuth()),
            { wrapper: makeWrapper() },
        )

        await waitFor(() => expect(result.current.loading).toBe(false))

        // unvotedProposals surfaces the raw scan result for consumers (e.g. ActionInbox)
        // so they don't need a second useUnvotedProposals call
        expect(result.current.unvotedProposals).toEqual(proposals)
    })
})

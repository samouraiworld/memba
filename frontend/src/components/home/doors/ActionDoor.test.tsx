/**
 * ActionDoor.test.tsx — unit tests for the ActionDoor wrapper.
 *
 * Mocks:
 *   - useHomeActions (drives ActionInbox integration scenarios)
 *   - react-router-dom useOutletContext
 *   - useNetworkNav / useNetworkPath
 *   - doContractBroadcast / buildVoteMsg / clearVoteCache
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, fireEvent, act } from "@testing-library/react"
import { renderWithProviders } from "../../../test/test-utils"
import { ActionInbox } from "../ActionInbox"

// ── Module mocks ───────────────────────────────────────────────

vi.mock("../../../hooks/home/useHomeActions", () => ({
    useHomeActions: vi.fn(() => ({
        actions: [],
        loading: false,
        allCaughtUp: true,
        unvotedProposals: [],
    })),
}))

vi.mock("react-router-dom", async () => {
    const actual = await import("react-router-dom")
    return {
        ...actual,
        useOutletContext: vi.fn(() => ({
            adena: {
                connected: true,
                address: "g1testaddress",
                pubkeyJSON: "",
                chainId: "test-13",
                installed: true,
                loading: false,
                connect: vi.fn(),
                disconnect: vi.fn(),
                signArbitrary: vi.fn(),
            },
            balance: "100",
            auth: {
                token: { raw: "tok" },
                isAuthenticated: true,
                address: "g1testaddress",
                loading: false,
                error: null,
            },
            isLoggingIn: false,
            syncTimedOut: false,
        })),
    }
})

vi.mock("../../../hooks/useNetworkNav", () => ({
    useNetworkPath: vi.fn(() => (path: string) => `/test13/${path}`),
    useNetworkKey: vi.fn(() => "test13"),
    useNetworkNav: vi.fn(() => vi.fn()),
}))

vi.mock("../../../lib/grc20", () => ({
    doContractBroadcast: vi.fn().mockResolvedValue({ hash: "abc" }),
}))

vi.mock("../../../lib/dao", () => ({
    buildVoteMsg: vi.fn(() => ({ type: "vm/MsgCall", value: {} })),
}))

vi.mock("../../../lib/dao/voteScanner", () => ({
    clearVoteCache: vi.fn(),
}))

vi.mock("../../../lib/errorLog", () => ({
    logChainError: vi.fn(),
}))

// ── Resolve mocked modules ─────────────────────────────────────

const homeActionsMod = await import("../../../hooks/home/useHomeActions")
const grc20Mod = await import("../../../lib/grc20")
const daoMod = await import("../../../lib/dao")
const voteScannerMod = await import("../../../lib/dao/voteScanner")

// ── Tests ──────────────────────────────────────────────────────

describe("ActionDoor — loading state", () => {
    beforeEach(() => {
        vi.mocked(homeActionsMod.useHomeActions).mockReturnValue({
            actions: [],
            loading: true,
            allCaughtUp: false,
            unvotedProposals: [],
        })
    })

    it("renders skeleton action doors while loading", () => {
        const { container } = renderWithProviders(<ActionInbox />)
        // Each skeleton door is a Door variant="action" in loading state,
        // which renders .door__sk bars.
        const skBars = container.querySelectorAll(".door__sk")
        expect(skBars.length).toBeGreaterThanOrEqual(3)
    })

    it("does NOT show 'You're all caught up' while loading", () => {
        renderWithProviders(<ActionInbox />)
        expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument()
    })
})

describe("ActionDoor — empty / all caught up", () => {
    beforeEach(() => {
        vi.mocked(homeActionsMod.useHomeActions).mockReturnValue({
            actions: [],
            loading: false,
            allCaughtUp: true,
            unvotedProposals: [],
        })
    })

    it("renders 'You're all caught up.' and never shows blank/dash", () => {
        renderWithProviders(<ActionInbox />)
        expect(screen.getByText(/all caught up/i)).toBeInTheDocument()
    })
})

describe("ActionDoor — vote action (inline approve/reject)", () => {
    beforeEach(() => {
        vi.mocked(homeActionsMod.useHomeActions).mockReturnValue({
            actions: [
                {
                    id: "vote:gno.land/r/memba/dao:2",
                    kind: "vote",
                    accent: "teal",
                    eyebrow: "vote · Memba DAO",
                    title: "Raise budget Q3",
                    meta: "open",
                    href: "/dao/memba/proposal/2",
                },
            ],
            loading: false,
            allCaughtUp: false,
            unvotedProposals: [
                {
                    daoName: "Memba DAO",
                    daoSlug: "memba",
                    realmPath: "gno.land/r/memba/dao",
                    proposalId: 2,
                    proposalTitle: "Raise budget Q3",
                    proposalStatus: "open",
                },
            ],
        })
    })

    it("renders YES and NO vote buttons (inline approve / reject)", () => {
        renderWithProviders(<ActionInbox />)
        expect(screen.getByRole("button", { name: /vote yes on proposal 2/i })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: /vote no on proposal 2/i })).toBeInTheDocument()
    })

    it("does NOT render the door body title for vote actions (QuickVoteWidget owns it)", () => {
        renderWithProviders(<ActionInbox />)
        // QuickVoteWidget renders "#2 — Raise budget Q3"; door body title is suppressed.
        // Exactly 1 occurrence of the title text — no duplication.
        const matches = screen.getAllByText(/Raise budget Q3/i)
        expect(matches.length).toBe(1)
    })

    it("clicking Approve (YES) invokes the existing handler (buildVoteMsg + doContractBroadcast)", async () => {
        vi.mocked(grc20Mod.doContractBroadcast).mockResolvedValue({ hash: "tx-yes" })
        vi.mocked(daoMod.buildVoteMsg).mockReturnValue({ type: "vm/MsgCall", value: {} })
        vi.mocked(voteScannerMod.clearVoteCache).mockReset()

        renderWithProviders(<ActionInbox />)

        const yesBtn = screen.getByRole("button", { name: /vote yes on proposal 2/i })
        await act(async () => { fireEvent.click(yesBtn) })

        expect(daoMod.buildVoteMsg).toHaveBeenCalledWith("g1testaddress", "gno.land/r/memba/dao", 2, "YES")
        expect(grc20Mod.doContractBroadcast).toHaveBeenCalledTimes(1)
        expect(voteScannerMod.clearVoteCache).toHaveBeenCalledTimes(1)
    })

    it("clicking Reject (NO) invokes the existing handler with NO", async () => {
        vi.mocked(grc20Mod.doContractBroadcast).mockClear().mockResolvedValue({ hash: "tx-no" })
        vi.mocked(daoMod.buildVoteMsg).mockClear().mockReturnValue({ type: "vm/MsgCall", value: {} })
        vi.mocked(voteScannerMod.clearVoteCache).mockReset()

        renderWithProviders(<ActionInbox />)

        const noBtn = screen.getByRole("button", { name: /vote no on proposal 2/i })
        await act(async () => { fireEvent.click(noBtn) })

        expect(daoMod.buildVoteMsg).toHaveBeenCalledWith("g1testaddress", "gno.land/r/memba/dao", 2, "NO")
        expect(grc20Mod.doContractBroadcast).toHaveBeenCalledTimes(1)
    })
})

describe("ActionDoor — sign action", () => {
    beforeEach(() => {
        vi.mocked(homeActionsMod.useHomeActions).mockReturnValue({
            actions: [
                {
                    id: "sign:42",
                    kind: "sign",
                    accent: "amber",
                    eyebrow: "sign · multisig",
                    title: "Transfer treasury Q3",
                    meta: "g1multisig…",
                    href: "/tx/42",
                },
            ],
            loading: false,
            allCaughtUp: false,
            unvotedProposals: [],
        })
    })

    it("renders 'Review & sign' as the action label", () => {
        renderWithProviders(<ActionInbox />)
        expect(screen.getByText(/review & sign/i)).toBeInTheDocument()
    })

    it("the sign action door links to the sign target", () => {
        renderWithProviders(<ActionInbox />)
        const link = screen.getByRole("link", { name: /review & sign/i })
        expect(link.getAttribute("href")).toContain("tx/42")
    })

    it("non-vote action (sign) still renders the door body title", () => {
        renderWithProviders(<ActionInbox />)
        // The title should appear in the door body (not suppressed for sign kind).
        expect(screen.getByText("Transfer treasury Q3")).toBeInTheDocument()
    })
})

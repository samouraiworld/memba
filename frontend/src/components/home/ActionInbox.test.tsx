/**
 * ActionInbox.test.tsx — component tests for the ActionInbox member spine.
 *
 * Mocks:
 *   - useHomeActions (the single aggregator hook — drives both actions and
 *     unvotedProposals fed to QuickVoteWidget; useUnvotedProposals is NOT
 *     called directly by ActionInbox any more)
 *   - react-router-dom useOutletContext (layout context)
 *   - useNetworkNav / useNetworkPath (route prefix)
 *   - doContractBroadcast / buildVoteMsg / clearVoteCache (chain calls)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, fireEvent, act } from "@testing-library/react"
import { renderWithProviders } from "../../test/test-utils"
import { ActionInbox } from "./ActionInbox"

// ── Module mocks ──────────────────────────────────────────────

vi.mock("../../hooks/home/useHomeActions", () => ({
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

vi.mock("../../hooks/useNetworkNav", () => ({
    useNetworkPath: vi.fn(() => (path: string) => `/test13/${path}`),
    useNetworkKey: vi.fn(() => "test13"),
    useNetworkNav: vi.fn(() => vi.fn()),
}))

vi.mock("../../lib/grc20", () => ({
    doContractBroadcast: vi.fn().mockResolvedValue({ hash: "abc" }),
}))

vi.mock("../../lib/dao", () => ({
    buildVoteMsg: vi.fn(() => ({ type: "vm/MsgCall", value: {} })),
}))

vi.mock("../../lib/dao/voteScanner", () => ({
    clearVoteCache: vi.fn(),
}))

vi.mock("../../lib/errorLog", () => ({
    logChainError: vi.fn(),
}))

// ── Resolve mocked modules for per-test control ───────────────

const homeActionsMod = await import("../../hooks/home/useHomeActions")
const grc20Mod = await import("../../lib/grc20")
const daoMod = await import("../../lib/dao")
const voteScannerMod = await import("../../lib/dao/voteScanner")

// ── Tests ─────────────────────────────────────────────────────

describe("ActionInbox — loading", () => {
    beforeEach(() => {
        vi.mocked(homeActionsMod.useHomeActions).mockReturnValue({
            actions: [],
            loading: true,
            allCaughtUp: false,
            unvotedProposals: [],
        })
    })

    it("renders 3 skeleton action cards while loading", () => {
        renderWithProviders(<ActionInbox />)
        const skeletons = screen.getAllByTestId("action-card-skeleton")
        expect(skeletons).toHaveLength(3)
    })
})

describe("ActionInbox — all caught up", () => {
    beforeEach(() => {
        vi.mocked(homeActionsMod.useHomeActions).mockReturnValue({
            actions: [],
            loading: false,
            allCaughtUp: true,
            unvotedProposals: [],
        })
    })

    it("renders the 'all caught up' card (never blank)", () => {
        renderWithProviders(<ActionInbox />)
        expect(screen.getByText(/all caught up/i)).toBeInTheDocument()
    })

    it("shows a Browse DAOs link", () => {
        renderWithProviders(<ActionInbox />)
        expect(screen.getByText(/browse daos/i)).toBeInTheDocument()
    })

    it("does NOT render skeleton cards when all caught up", () => {
        renderWithProviders(<ActionInbox />)
        expect(screen.queryByTestId("action-card-skeleton")).not.toBeInTheDocument()
    })
})

describe("ActionInbox — with vote actions", () => {
    beforeEach(() => {
        vi.mocked(homeActionsMod.useHomeActions).mockReturnValue({
            actions: [
                {
                    id: "vote:gno.land/r/memba/dao:1",
                    kind: "vote",
                    accent: "teal",
                    eyebrow: "vote · Memba DAO",
                    title: "Proposal Alpha",
                    meta: "open",
                    href: "/dao/memba/proposal/1",
                },
            ],
            loading: false,
            allCaughtUp: false,
            unvotedProposals: [
                {
                    daoName: "Memba DAO",
                    daoSlug: "memba",
                    realmPath: "gno.land/r/memba/dao",
                    proposalId: 1,
                    proposalTitle: "Proposal Alpha",
                    proposalStatus: "open",
                },
            ],
        })
    })

    it("renders the QuickVoteWidget with the proposal title", () => {
        renderWithProviders(<ActionInbox />)
        expect(screen.getByText(/Proposal Alpha/i)).toBeInTheDocument()
    })

    it("shows YES and NO vote buttons", () => {
        renderWithProviders(<ActionInbox />)
        expect(screen.getByRole("button", { name: /vote yes on proposal 1/i })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: /vote no on proposal 1/i })).toBeInTheDocument()
    })

    it("shows the header 'Act now'", () => {
        renderWithProviders(<ActionInbox />)
        expect(screen.getByText("Act now")).toBeInTheDocument()
    })

    it("shows the count badge", () => {
        renderWithProviders(<ActionInbox />)
        expect(screen.getByText(/1 awaits/i)).toBeInTheDocument()
    })
})

describe("ActionInbox — inline vote fires broadcast", () => {
    beforeEach(() => {
        vi.mocked(homeActionsMod.useHomeActions).mockReturnValue({
            actions: [
                {
                    id: "vote:gno.land/r/memba/dao:1",
                    kind: "vote",
                    accent: "teal",
                    eyebrow: "vote · Memba DAO",
                    title: "Proposal Alpha",
                    meta: "open",
                    href: "/dao/memba/proposal/1",
                },
            ],
            loading: false,
            allCaughtUp: false,
            unvotedProposals: [
                {
                    daoName: "Memba DAO",
                    daoSlug: "memba",
                    realmPath: "gno.land/r/memba/dao",
                    proposalId: 1,
                    proposalTitle: "Proposal Alpha",
                    proposalStatus: "open",
                },
            ],
        })
        vi.mocked(grc20Mod.doContractBroadcast).mockResolvedValue({ hash: "tx123" })
        vi.mocked(daoMod.buildVoteMsg).mockReturnValue({ type: "vm/MsgCall", value: {} })
        vi.mocked(voteScannerMod.clearVoteCache).mockReset()
    })

    it("clicking YES calls doContractBroadcast and buildVoteMsg with the proposal id", async () => {
        renderWithProviders(<ActionInbox />)

        const yesButton = screen.getByRole("button", { name: /vote yes on proposal 1/i })
        await act(async () => {
            fireEvent.click(yesButton)
        })

        expect(daoMod.buildVoteMsg).toHaveBeenCalledWith(
            "g1testaddress",
            "gno.land/r/memba/dao",
            1,
            "YES",
        )
        expect(grc20Mod.doContractBroadcast).toHaveBeenCalledTimes(1)
        expect(voteScannerMod.clearVoteCache).toHaveBeenCalledTimes(1)
    })
})

describe("ActionInbox — with sign action", () => {
    beforeEach(() => {
        vi.mocked(homeActionsMod.useHomeActions).mockReturnValue({
            actions: [
                {
                    id: "sign:99",
                    kind: "sign",
                    accent: "amber",
                    eyebrow: "sign · multisig",
                    title: "Pay the team",
                    meta: "g1multisigadd…",
                    href: "/tx/99",
                },
            ],
            loading: false,
            allCaughtUp: false,
            unvotedProposals: [],
        })
    })

    it("renders an ActionCard for the sign action", () => {
        renderWithProviders(<ActionInbox />)
        expect(screen.getByText("Pay the team")).toBeInTheDocument()
    })

    it("renders a Sign label on the card", () => {
        renderWithProviders(<ActionInbox />)
        expect(screen.getByText("Sign")).toBeInTheDocument()
    })

    it("card links to the tx page", () => {
        renderWithProviders(<ActionInbox />)
        const link = screen.getByRole("link", { name: /sign/i })
        expect(link.getAttribute("href")).toContain("tx/99")
    })
})

describe("ActionInbox — mixed actions (vote + sign)", () => {
    beforeEach(() => {
        vi.mocked(homeActionsMod.useHomeActions).mockReturnValue({
            actions: [
                {
                    id: "vote:gno.land/r/memba/dao:1",
                    kind: "vote",
                    accent: "teal",
                    eyebrow: "vote · Memba DAO",
                    title: "Proposal Alpha",
                    meta: "open",
                    href: "/dao/memba/proposal/1",
                },
                {
                    id: "sign:99",
                    kind: "sign",
                    accent: "amber",
                    eyebrow: "sign · multisig",
                    title: "Pay the team",
                    meta: "g1ms…",
                    href: "/tx/99",
                },
            ],
            loading: false,
            allCaughtUp: false,
            unvotedProposals: [
                {
                    daoName: "Memba DAO",
                    daoSlug: "memba",
                    realmPath: "gno.land/r/memba/dao",
                    proposalId: 1,
                    proposalTitle: "Proposal Alpha",
                    proposalStatus: "open",
                },
            ],
        })
    })

    it("renders both the QuickVoteWidget and the sign ActionCard", () => {
        renderWithProviders(<ActionInbox />)
        // Vote widget
        expect(screen.getByText(/Proposal Alpha/i)).toBeInTheDocument()
        // Sign card
        expect(screen.getByText("Pay the team")).toBeInTheDocument()
    })

    it("shows count of 2", () => {
        renderWithProviders(<ActionInbox />)
        expect(screen.getByText(/2 await/i)).toBeInTheDocument()
    })
})

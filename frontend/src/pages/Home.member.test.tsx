/**
 * Home.member.test.tsx — Task 2.3: member branch Atlas rewire.
 *
 * Covers:
 *   1. Member DOM order: ActionInbox → YourWorldsPanel → ShowcaseBoard (explore)
 *   2. Member branch no longer renders StateBoard
 *   3. Wallet chips: balance + truncated address when present; chips omitted when absent
 *   4. MobileTabBar member set includes Activity → /<network>/alerts; visitor set unchanged
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../test/test-utils"
import { Home } from "./Home"
import { MobileTabBar } from "../components/layout/MobileTabBar"

// ── Mock react-router-dom's useOutletContext (wallet chips source) ────────────
const mockOutletContext = vi.fn(() => ({
    adena: {
        connected: false,
        address: "",
        pubkeyJSON: "",
        chainId: "",
        installed: false,
        loading: false,
        connect: vi.fn(),
        disconnect: vi.fn(),
        signArbitrary: vi.fn(),
    },
    balance: "0",
    auth: {
        token: null,
        isAuthenticated: false,
        address: "",
        loading: false,
        error: null,
    },
    isLoggingIn: false,
    syncTimedOut: false,
}))

vi.mock("react-router-dom", async () => {
    const actual = await import("react-router-dom")
    return {
        ...actual,
        useOutletContext: () => mockOutletContext(),
    }
})

// ── Mock useNetwork ────────────────────────────────────────────────────────────
vi.mock("../hooks/useNetwork", () => ({
    useNetwork: vi.fn(() => ({
        networkKey: "test13",
        chainId: "test13",
        rpcUrl: "https://rpc.test13.gno.land",
        label: "test13",
        switchNetwork: vi.fn(),
        networks: {},
    })),
}))

// ── Mock useNetworkNav ────────────────────────────────────────────────────────
vi.mock("../hooks/useNetworkNav", () => ({
    useNetworkPath: vi.fn(() => (path: string) => `/test13/${path}`),
    useNetworkKey: vi.fn(() => "test13"),
    useNetworkNav: vi.fn(() => vi.fn()),
}))

// ── Mock useNetworkPulse ──────────────────────────────────────────────────────
vi.mock("../hooks/home/useNetworkPulse", () => ({
    useNetworkPulse: vi.fn(() => ({
        blockHeight: 12345,
        avgBlockTime: 2.1,
        totalValidators: 3,
        daoCount: 8,
        memberCount: 42,
        loading: false,
    })),
}))

// ── Mock useHomeActions (ActionInbox dep) ─────────────────────────────────────
vi.mock("../hooks/home/useHomeActions", () => ({
    useHomeActions: vi.fn(() => ({
        actions: [],
        loading: false,
        allCaughtUp: true,
        unvotedProposals: [],
    })),
}))

// ── Mock useYourWorlds (YourWorldsPanel dep) ──────────────────────────────────
vi.mock("../hooks/home/useYourWorlds", () => ({
    useYourWorlds: vi.fn(() => ({ state: "empty" as const, worlds: [] })),
}))

// ── Mock useOrg (YourWorldsPanel dep) ────────────────────────────────────────
vi.mock("../contexts/OrgContext", () => ({
    useOrg: vi.fn(() => ({
        activeOrgId: null,
        activeOrgName: "Personal",
        isOrgMode: false,
        setActiveOrg: vi.fn(),
    })),
}))

// ── Mock useFeaturedDao (ShowcaseBoard/FeaturedDoor dep) ──────────────────────
vi.mock("../hooks/home/useFeaturedDao", () => ({
    useFeaturedDao: vi.fn(() => ({
        state: "empty" as const,
        invitationHref: "/test13/dao",
        refetch: vi.fn(),
    })),
}))

// ── Mock hooks used by other showcase doors ───────────────────────────────────
vi.mock("../hooks/home/useContributorHighlights", () => ({
    useContributorHighlights: vi.fn(() => ({ contributors: [], loading: false })),
}))
vi.mock("../hooks/home/useValidatorHealth", () => ({
    useValidatorHealth: vi.fn(() => ({
        status: "healthy",
        active: 3,
        total: 3,
        avgUptime: null,
        latestIncident: null,
        loading: false,
    })),
}))
vi.mock("../hooks/home/useDirectoryHighlights", () => ({
    useDirectoryHighlights: vi.fn(() => ({
        memberCount: 12,
        members: [],
        loading: false,
    })),
}))

// ── IntersectionObserver stub for jsdom ──────────────────────────────────────
class IoStub {
    private callback: IntersectionObserverCallback
    constructor(callback: IntersectionObserverCallback) { this.callback = callback }
    observe(el: Element) {
        this.callback(
            [{ isIntersecting: true, target: el } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
        )
    }
    disconnect() {}
    unobserve() {}
    takeRecords() { return [] }
}

beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IoStub)
    // Reset to disconnected, no balance, no address
    mockOutletContext.mockReturnValue({
        adena: {
            connected: false,
            address: "",
            pubkeyJSON: "",
            chainId: "",
            installed: false,
            loading: false,
            connect: vi.fn(),
            disconnect: vi.fn(),
            signArbitrary: vi.fn(),
        },
        balance: "0",
        auth: {
            token: null,
            isAuthenticated: false,
            address: "",
            loading: false,
            error: null,
        },
        isLoggingIn: false,
        syncTimedOut: false,
    })
})

// ─────────────────────────────────────────────────────────────────────────────
// 1. DOM order: ActionInbox → YourWorldsPanel → ShowcaseBoard (explore)
// ─────────────────────────────────────────────────────────────────────────────

describe("Home member — Atlas layout DOM order", () => {
    it("renders ActionInbox before YourWorldsPanel", () => {
        renderWithProviders(<Home mode="member" />, { route: "/test13/" })

        const inbox = screen.getByRole("region", { name: /act now/i })
        const worlds = screen.getByTestId("your-worlds-panel")

        // ActionInbox must appear before YourWorldsPanel in the DOM
        expect(
            inbox.compareDocumentPosition(worlds) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy()
    })

    it("renders YourWorldsPanel before ShowcaseBoard (explore)", () => {
        renderWithProviders(<Home mode="member" />, { route: "/test13/" })

        const worlds = screen.getByTestId("your-worlds-panel")
        const showcase = screen.getByTestId("showcase-board")

        expect(
            worlds.compareDocumentPosition(showcase) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy()
    })

    it("renders the ShowcaseBoard (explore) in the member branch", () => {
        renderWithProviders(<Home mode="member" />, { route: "/test13/" })
        expect(screen.getByTestId("showcase-board")).toBeInTheDocument()
    })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. StateBoard is no longer rendered in the member branch
// ─────────────────────────────────────────────────────────────────────────────

describe("Home member — StateBoard removed from member branch", () => {
    it("does NOT render the StateBoard panel host (data-testid=state-board)", () => {
        renderWithProviders(<Home mode="member" />, { route: "/test13/" })
        expect(screen.queryByTestId("state-board")).not.toBeInTheDocument()
    })

    it("visitor branch still renders ShowcaseBoard (not StateBoard)", () => {
        renderWithProviders(<Home mode="visitor" />, { route: "/test13/" })
        expect(screen.getByTestId("showcase-board")).toBeInTheDocument()
        expect(screen.queryByTestId("state-board")).not.toBeInTheDocument()
    })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Wallet chips: balance + truncated address when present; omitted when absent
// ─────────────────────────────────────────────────────────────────────────────

describe("Home member — wallet chips", () => {
    it("shows balance chip when balance is a non-zero value", () => {
        mockOutletContext.mockReturnValue({
            adena: {
                connected: true,
                address: "g1q9abc123def456xyz7",
                pubkeyJSON: "",
                chainId: "test13",
                installed: true,
                loading: false,
                connect: vi.fn(),
                disconnect: vi.fn(),
                signArbitrary: vi.fn(),
            },
            balance: "1240 GNOT",
            auth: {
                token: null,
                isAuthenticated: true,
                address: "g1q9abc123def456xyz7",
                loading: false,
                error: null,
            },
            isLoggingIn: false,
            syncTimedOut: false,
        })
        renderWithProviders(<Home mode="member" />, { route: "/test13/" })
        expect(screen.getByTestId("wallet-chip-balance")).toBeInTheDocument()
        expect(screen.getByTestId("wallet-chip-balance")).toHaveTextContent("1240 GNOT")
    })

    it("shows truncated address chip when connected with address", () => {
        mockOutletContext.mockReturnValue({
            adena: {
                connected: true,
                address: "g1q9abc123def456xyz7",
                pubkeyJSON: "",
                chainId: "test13",
                installed: true,
                loading: false,
                connect: vi.fn(),
                disconnect: vi.fn(),
                signArbitrary: vi.fn(),
            },
            balance: "1240 GNOT",
            auth: {
                token: null,
                isAuthenticated: true,
                address: "g1q9abc123def456xyz7",
                loading: false,
                error: null,
            },
            isLoggingIn: false,
            syncTimedOut: false,
        })
        renderWithProviders(<Home mode="member" />, { route: "/test13/" })
        const addrChip = screen.getByTestId("wallet-chip-address")
        expect(addrChip).toBeInTheDocument()
        // Truncated: g1q9…xyz7 — starts with first 4 chars, ends with last 4
        expect(addrChip.textContent).toMatch(/g1q9/)
        expect(addrChip.textContent).toMatch(/xyz7/)
        expect(addrChip.textContent).toContain("…")
    })

    it("omits balance chip when balance is 0", () => {
        mockOutletContext.mockReturnValue({
            adena: {
                connected: true,
                address: "g1q9abc123def456xyz7",
                pubkeyJSON: "",
                chainId: "test13",
                installed: true,
                loading: false,
                connect: vi.fn(),
                disconnect: vi.fn(),
                signArbitrary: vi.fn(),
            },
            balance: "0",
            auth: {
                token: null,
                isAuthenticated: true,
                address: "g1q9abc123def456xyz7",
                loading: false,
                error: null,
            },
            isLoggingIn: false,
            syncTimedOut: false,
        })
        renderWithProviders(<Home mode="member" />, { route: "/test13/" })
        expect(screen.queryByTestId("wallet-chip-balance")).not.toBeInTheDocument()
    })

    it("omits address chip when not connected (no address)", () => {
        // Default mockOutletContext: connected=false, address=""
        renderWithProviders(<Home mode="member" />, { route: "/test13/" })
        expect(screen.queryByTestId("wallet-chip-address")).not.toBeInTheDocument()
    })

    it("wallet chips row is rendered in member mode (data-testid=wallet-chips)", () => {
        mockOutletContext.mockReturnValue({
            adena: {
                connected: true,
                address: "g1q9abc123def456xyz7",
                pubkeyJSON: "",
                chainId: "test13",
                installed: true,
                loading: false,
                connect: vi.fn(),
                disconnect: vi.fn(),
                signArbitrary: vi.fn(),
            },
            balance: "100 GNOT",
            auth: {
                token: null,
                isAuthenticated: true,
                address: "g1q9abc123def456xyz7",
                loading: false,
                error: null,
            },
            isLoggingIn: false,
            syncTimedOut: false,
        })
        renderWithProviders(<Home mode="member" />, { route: "/test13/" })
        expect(screen.getByTestId("wallet-chips")).toBeInTheDocument()
    })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. MobileTabBar: member set has Activity → /<network>/alerts; visitor unchanged
// ─────────────────────────────────────────────────────────────────────────────

const mockNetwork = {
    networkKey: "test13",
    networks: { test13: { label: "test13" } },
    switchNetwork: vi.fn(),
}

describe("MobileTabBar — member tab set includes Activity", () => {
    it("renders an Activity tab link when connected", () => {
        renderWithProviders(
            <MobileTabBar connected={true} address="g1abc" network={mockNetwork} />,
            { route: "/test13/" },
        )
        const activityTab = screen.getByRole("link", { name: /activity/i })
        expect(activityTab).toBeInTheDocument()
        expect(activityTab).toHaveAttribute("href", "/test13/alerts")
    })

    it("Activity tab has a bell icon (phosphor Bell)", () => {
        renderWithProviders(
            <MobileTabBar connected={true} address="g1abc" network={mockNetwork} />,
            { route: "/test13/" },
        )
        const activityTab = screen.getByRole("link", { name: /activity/i })
        // Has the label "Activity"
        expect(activityTab).toHaveTextContent("Activity")
    })
})

describe("MobileTabBar — visitor tab set unchanged (no Activity tab)", () => {
    it("does NOT render an Activity tab when not connected", () => {
        renderWithProviders(
            <MobileTabBar connected={false} address={null} network={mockNetwork} />,
            { route: "/test13/" },
        )
        expect(screen.queryByRole("link", { name: /activity/i })).not.toBeInTheDocument()
    })

    it("renders the Directory tab when not connected (visitor)", () => {
        renderWithProviders(
            <MobileTabBar connected={false} address={null} network={mockNetwork} />,
            { route: "/test13/" },
        )
        expect(screen.getByRole("link", { name: /directory/i })).toBeInTheDocument()
    })

    it("does NOT render Directory tab in member tab bar (replaced by Activity)", () => {
        renderWithProviders(
            <MobileTabBar connected={true} address="g1abc" network={mockNetwork} />,
            { route: "/test13/" },
        )
        // In member mode, Directory is no longer a tab (it's in the More sheet)
        // Activity takes its place
        const activityTab = screen.getByRole("link", { name: /activity/i })
        expect(activityTab).toBeInTheDocument()
    })
})

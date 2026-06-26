import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderWithProviders, mockLayoutContext } from "../test/test-utils"
import type { LayoutContext } from "../types/layout"
import type { UserProfile } from "../lib/profile"
import type { Token } from "../gen/memba/v1/memba_pb"
import type { ValidatorInfo } from "../lib/validators"
import type { ValoperWithStatus } from "../lib/valopers"

// Keep resolveValidatorProfile + types REAL (pure); only stub the network fetch.
vi.mock("../lib/valopers", async (orig) => ({
    ...(await orig<typeof import("../lib/valopers")>()),
    fetchValopers: vi.fn(),
}))
vi.mock("../lib/validators", async (orig) => ({
    ...(await orig<typeof import("../lib/validators")>()),
    getValidators: vi.fn(),
}))
vi.mock("../lib/profile", () => ({ fetchUserProfile: vi.fn(), updateBackendProfile: vi.fn() }))
vi.mock("../hooks/useAddressActivity", () => ({ useAddressActivity: vi.fn() }))
vi.mock("../lib/quests", async (orig) => ({
    ...(await orig<typeof import("../lib/quests")>()),
    loadQuestProgress: vi.fn(() => ({ completed: [], totalXP: 0 })),
    fetchUserQuests: vi.fn().mockResolvedValue(null),
    completeQuest: vi.fn(),
    trackPageVisit: vi.fn(),
}))
// The Performance panel does its own fetching; stub it and surface its props.
vi.mock("../components/validators/ValidatorPerformancePanel", () => ({
    ValidatorPerformancePanel: ({ signingAddress, isActive }: { signingAddress: string; isActive: boolean }) =>
        <div data-testid="perf-panel" data-active={String(isActive)} data-addr={signingAddress} />,
}))

import ValidatorProfile from "./ValidatorProfile"
import { fetchValopers } from "../lib/valopers"
import { getValidators } from "../lib/validators"
import { fetchUserProfile, updateBackendProfile } from "../lib/profile"
import { useAddressActivity } from "../hooks/useAddressActivity"
import { loadQuestProgress, fetchUserQuests } from "../lib/quests"
import type { ActivityItem } from "../lib/activity"

const OPERATOR = "g1n9y62agq998jt8w59az60xcqlftjknjg2grhn4"
const SIGN = "g1abc000000000000000000000000000000000sig"
const GENESIS = "g15sysd4jcpsw7t0n4ffe2hn8ndfup2ae2vwpves"
const MONIKER = "samourai-crew-1"

const valoper = (over: Partial<ValoperWithStatus> = {}): ValoperWithStatus => ({
    moniker: MONIKER, description: "Samourai's test13 validator.", operatorAddress: OPERATOR,
    signingAddress: SIGN, signingPubKey: "gpub1ptest", serverType: "on-prem", status: "candidate", ...over,
})
const validator = (gnoAddr: string, moniker: string): ValidatorInfo =>
    ({ gnoAddr, address: gnoAddr, moniker } as ValidatorInfo)

function setData(valopers: ValoperWithStatus[], activeGnoAddrs: string[] = []) {
    vi.mocked(getValidators).mockResolvedValue(activeGnoAddrs.map(a => validator(a, a === GENESIS ? "gfanton-1" : "")))
    vi.mocked(fetchValopers).mockResolvedValue(valopers)
}

function setActivity(over: Partial<ReturnType<typeof useAddressActivity>> = {}) {
    vi.mocked(useAddressActivity).mockReturnValue({
        items: [], loading: false, error: false, available: true, refetch: vi.fn(), ...over,
    })
}
const actItem = (over: Partial<ActivityItem> = {}): ActivityItem => ({
    kind: "call", title: "Approve · gnoswap/gns", actor: OPERATOR, pkgPath: "gno.land/r/gnoswap/gns",
    func: "Approve", txHash: "h1", blockHeight: 100, extraCount: 0, ...over,
})

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
    return {
        address: OPERATOR, username: "", userRealmUrl: "", githubLogin: "", githubAvatar: "", githubBio: "",
        githubLocation: "", githubFollowers: 0, socialLinks: { twitter: "", github: "", website: "" },
        totalCommits: 0, totalPRs: 0, totalIssues: 0, totalReviews: 0, lovePowerScore: 0,
        deployedPackages: [], governanceVotes: [], bio: "", company: "", title: "", avatarUrl: "",
        ...overrides,
    }
}
function fakeToken(addr: string): Token { return { userAddress: addr } as unknown as Token }
function ownerContext(addr = OPERATOR): Partial<LayoutContext> {
    return {
        adena: { ...mockLayoutContext().adena, connected: true, address: addr },
        auth: { token: fakeToken(addr), isAuthenticated: true, address: addr, loading: false, error: null },
    }
}

function LocationProbe() { return <span data-testid="loc">{useLocation().pathname}</span> }

/** Render with no Layout outlet → no connected wallet → never the owner. */
function renderAt(addr: string) {
    return renderWithProviders(
        <Routes>
            <Route path="/:network/validators/:address" element={<><LocationProbe /><ValidatorProfile /></>} />
        </Routes>,
        { route: `/test13/validators/${addr}` },
    )
}

/** Render through a Layout outlet that supplies wallet/auth context (owner-detection). */
function renderWithContext(addr: string, ctx: Partial<LayoutContext>) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[`/test13/validators/${addr}`]}>
                <Routes>
                    <Route element={<Outlet context={mockLayoutContext(ctx)} />}>
                        <Route path="/:network/validators/:address" element={<ValidatorProfile />} />
                    </Route>
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    )
}

describe("ValidatorProfile — resolution & routing", () => {
    beforeEach(() => { vi.clearAllMocks(); vi.mocked(fetchUserProfile).mockResolvedValue(null); setActivity() })

    it("registered ACTIVE operator → identity + Performance(active) + persistent reviews; NO Reviews tab", async () => {
        setData([valoper({ status: "active" })], [SIGN])
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        expect(screen.getByText("● Active")).toBeInTheDocument()
        expect(screen.getByTestId("vp-reviews")).toBeInTheDocument()
        expect(screen.queryByRole("tab", { name: "Reviews" })).toBeNull()
        fireEvent.click(screen.getByRole("tab", { name: /Performance/ }))
        const panel = await screen.findByTestId("perf-panel")
        expect(panel).toHaveAttribute("data-addr", SIGN)
        expect(panel).toHaveAttribute("data-active", "true")
    })

    it("registered CANDIDATE operator → Candidate badge + Performance inactive", async () => {
        setData([valoper({ status: "candidate" })], ["g1someoneelse"])
        renderAt(OPERATOR)
        await waitFor(() => expect(screen.getByText("○ Candidate")).toBeInTheDocument())
        fireEvent.click(screen.getByRole("tab", { name: /Performance/ }))
        expect(await screen.findByTestId("perf-panel")).toHaveAttribute("data-active", "false")
    })

    it("genesis validator (in active set, no valoper) → genesis note + active Performance", async () => {
        setData([], [GENESIS])
        renderAt(GENESIS)
        await screen.findByTestId("vp-genesis-note")
        expect(screen.getByRole("heading", { name: "gfanton-1" })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("tab", { name: /Performance/ }))
        const panel = await screen.findByTestId("perf-panel")
        expect(panel).toHaveAttribute("data-addr", GENESIS)
        expect(panel).toHaveAttribute("data-active", "true")
    })

    it("unknown address → not-found", async () => {
        setData([], ["g1other"])
        renderAt("g1nope")
        expect(await screen.findByTestId("vp-not-found")).toBeInTheDocument()
    })

    it("signing-address deep link of a registered valoper → redirects to the operator route", async () => {
        setData([valoper({ status: "active" })], [SIGN])
        renderAt(SIGN)
        await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent(`/test13/validators/${OPERATOR}`))
    })
})

describe("ValidatorProfile — identity header & tabs", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(fetchUserProfile).mockResolvedValue(makeProfile())
        setActivity()
        setData([valoper()], [])
    })

    it("renders the identity header: moniker, candidate badge, operator + signing addresses", async () => {
        renderAt(OPERATOR)
        expect(await screen.findByRole("heading", { name: MONIKER })).toBeInTheDocument()
        expect(screen.getByText(/○ candidate/i)).toBeInTheDocument()
        expect(screen.getByText(OPERATOR)).toBeInTheDocument()
        expect(screen.getByText(SIGN)).toBeInTheDocument()
    })

    it("shows an avatar image when the profile supplies one", async () => {
        vi.mocked(fetchUserProfile).mockResolvedValue(makeProfile({ avatarUrl: "https://example.com/a.png" }))
        renderAt(OPERATOR)
        const img = await screen.findByRole("img", { name: new RegExp(MONIKER, "i") })
        expect(img).toHaveAttribute("src", "https://example.com/a.png")
    })

    it("falls back to moniker initials when no avatar is available", async () => {
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        expect(screen.queryByRole("img", { name: new RegExp(MONIKER, "i") })).not.toBeInTheDocument()
        expect(screen.getByTestId("vp-avatar-fallback")).toHaveTextContent(/^S/i)
    })

    it("shows @username chip + realm link when the profile has a username", async () => {
        vi.mocked(fetchUserProfile).mockResolvedValue(makeProfile({ username: "@satoshi", userRealmUrl: "https://test13.testnets.gno.land/u/satoshi" }))
        renderAt(OPERATOR)
        const link = await screen.findByRole("link", { name: /@satoshi/i })
        expect(link).toHaveAttribute("href", "https://test13.testnets.gno.land/u/satoshi")
    })

    it("does NOT render an Edit profile button when there is no connected wallet", async () => {
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        expect(screen.queryByRole("button", { name: /edit profile/i })).not.toBeInTheDocument()
    })

    it("renders a tablist with the five tabs, Overview selected by default (no Reviews tab)", async () => {
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        const tabs = screen.getAllByRole("tab").map(t => t.textContent)
        expect(tabs).toEqual(expect.arrayContaining(["Overview", "Performance", "Quests", "Contributions", "Activity"]))
        expect(tabs.some(t => /review/i.test(t || ""))).toBe(false)
        expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true")
    })

    it("supports keyboard arrow navigation between tabs (Overview → Performance)", async () => {
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        const overview = screen.getByRole("tab", { name: "Overview" })
        overview.focus()
        fireEvent.keyDown(overview, { key: "ArrowRight" })
        expect(screen.getByRole("tab", { name: /Performance/ })).toHaveAttribute("aria-selected", "true")
    })

    it("still renders from valoper data alone when fetchUserProfile rejects", async () => {
        vi.mocked(fetchUserProfile).mockRejectedValue(new Error("gnolove down"))
        renderAt(OPERATOR)
        expect(await screen.findByRole("heading", { name: MONIKER })).toBeInTheDocument()
        expect(screen.getByText(OPERATOR)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("tab", { name: "Contributions" }))
        expect(screen.getByTestId("vp-tab-contributions")).toBeInTheDocument()
    })

    it("links 'View on gnoweb' to a test13 valoper host, never mainnet gno.land", async () => {
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        const link = screen.getByRole("link", { name: /view on gnoweb/i })
        const href = link.getAttribute("href") || ""
        expect(href).toContain("/r/gnops/valopers:")
        expect(href).not.toMatch(/\/\/gno\.land\//)
    })
})

describe("ValidatorProfile — Contributions / Activity / Quests / Reviews", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(fetchUserProfile).mockResolvedValue(makeProfile())
        setActivity()
        setData([valoper()], [])
    })

    it("Contributions tab shows gnolove stats", async () => {
        vi.mocked(fetchUserProfile).mockResolvedValue(makeProfile({
            totalCommits: 42, totalPRs: 7, totalIssues: 3, totalReviews: 11, lovePowerScore: 477,
            deployedPackages: [{ address: OPERATOR, path: "gno.land/r/foo/bar", namespace: "foo", blockHeight: 123 }],
        }))
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        fireEvent.click(screen.getByRole("tab", { name: "Contributions" }))
        const panel = screen.getByTestId("vp-tab-contributions")
        expect(within(panel).getByText("42")).toBeInTheDocument()
        expect(within(panel).getByText("477")).toBeInTheDocument()
        expect(within(panel).getByText("gno.land/r/foo/bar")).toBeInTheDocument()
    })

    it("Contributions tab shows an honest empty state when there is no gnolove data", async () => {
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        fireEvent.click(screen.getByRole("tab", { name: "Contributions" }))
        expect(within(screen.getByTestId("vp-tab-contributions")).getByText(/no .*contribution/i)).toBeInTheDocument()
    })

    it("Activity tab renders on-chain transaction rows + links the deploy row to the realm", async () => {
        setActivity({ items: [
            actItem({ txHash: "h1", title: "Deployed r/demo/foo", kind: "deploy", pkgPath: "gno.land/r/demo/foo" }),
            actItem({ txHash: "h2", title: "Approve · gnoswap/gns", kind: "call" }),
        ] })
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        fireEvent.click(screen.getByRole("tab", { name: "Activity" }))
        const panel = screen.getByTestId("vp-tab-activity")
        expect(within(panel).getAllByTestId("vp-activity-row")).toHaveLength(2)
        expect(within(panel).getByRole("link", { name: /Deployed r\/demo\/foo/i }).getAttribute("href")).toContain("/r/demo/foo")
    })

    it("Activity tab shows an honest empty state (not a fake coming-soon)", async () => {
        setActivity({ items: [] })
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        fireEvent.click(screen.getByRole("tab", { name: "Activity" }))
        const panel = screen.getByTestId("vp-tab-activity")
        expect(within(panel).getByText(/no recent on-chain activity/i)).toBeInTheDocument()
        expect(within(panel).queryByText(/coming soon/i)).not.toBeInTheDocument()
    })

    it("Activity tab shows a retry when the indexer errors", async () => {
        const refetch = vi.fn()
        setActivity({ error: true, refetch })
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        fireEvent.click(screen.getByRole("tab", { name: "Activity" }))
        fireEvent.click(within(screen.getByTestId("vp-tab-activity")).getByRole("button", { name: /retry/i }))
        expect(refetch).toHaveBeenCalled()
    })

    it("Activity tab shows a loading skeleton while fetching", async () => {
        setActivity({ loading: true })
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        fireEvent.click(screen.getByRole("tab", { name: "Activity" }))
        expect(within(screen.getByTestId("vp-tab-activity")).getByTestId("vp-activity-loading")).toBeInTheDocument()
    })

    it("Activity tab lists governance votes alongside the on-chain feed", async () => {
        vi.mocked(fetchUserProfile).mockResolvedValue(makeProfile({ governanceVotes: [{ proposalId: "12", proposalTitle: "Raise the gas cap", vote: "YES" }] }))
        setActivity({ items: [actItem()] })
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        fireEvent.click(screen.getByRole("tab", { name: "Activity" }))
        expect(within(screen.getByTestId("vp-tab-activity")).getByText(/Raise the gas cap/)).toBeInTheDocument()
    })

    it("Quests tab shows the private note for a non-owner / disconnected viewer", async () => {
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        fireEvent.click(screen.getByRole("tab", { name: "Quests" }))
        const panel = screen.getByTestId("vp-tab-quests")
        expect(within(panel).getByText(/private to the wallet holder/i)).toBeInTheDocument()
        expect(within(panel).queryByTestId("vp-quest-row")).not.toBeInTheDocument()
    })

    it("persistent community-reviews section is always present (not a tab)", async () => {
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        expect(within(screen.getByTestId("vp-reviews")).getByText(/community reviews/i)).toBeInTheDocument()
    })
})

describe("ValidatorProfile — owner Edit-profile flow", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(fetchUserProfile).mockResolvedValue(makeProfile())
        vi.mocked(updateBackendProfile).mockResolvedValue(undefined)
        setActivity()
        setData([valoper()], [])
    })

    it("ENABLES the Edit button when the connected wallet === the operator (owner)", async () => {
        renderWithContext(OPERATOR, ownerContext(OPERATOR))
        await screen.findByRole("heading", { name: MONIKER })
        expect(screen.getByRole("button", { name: /edit profile/i })).toBeEnabled()
    })

    it("does NOT render the Edit button for a non-owner", async () => {
        renderWithContext(OPERATOR, ownerContext("g1someoneelse00000000000000000000000000xx"))
        await screen.findByRole("heading", { name: MONIKER })
        expect(screen.queryByRole("button", { name: /edit profile/i })).not.toBeInTheDocument()
    })

    it("does NOT render the Edit button when connected but not authenticated", async () => {
        renderWithContext(OPERATOR, {
            adena: { ...mockLayoutContext().adena, connected: true, address: OPERATOR },
            auth: { token: null, isAuthenticated: false, address: "", loading: false, error: null },
        })
        await screen.findByRole("heading", { name: MONIKER })
        expect(screen.queryByRole("button", { name: /edit profile/i })).not.toBeInTheDocument()
    })

    it("opens an accessible edit dialog with editable fields", async () => {
        renderWithContext(OPERATOR, ownerContext(OPERATOR))
        await screen.findByRole("heading", { name: MONIKER })
        fireEvent.click(screen.getByRole("button", { name: /edit profile/i }))
        const dialog = await screen.findByRole("dialog")
        expect(dialog).toHaveAttribute("aria-modal", "true")
        expect(within(dialog).getByLabelText(/bio/i)).toBeInTheDocument()
        expect(within(dialog).getByLabelText(/website/i)).toBeInTheDocument()
    })

    it("pre-fills the form from the current profile", async () => {
        vi.mocked(fetchUserProfile).mockResolvedValue(makeProfile({ bio: "Existing bio", socialLinks: { twitter: "", github: "", website: "https://me.dev" } }))
        renderWithContext(OPERATOR, ownerContext(OPERATOR))
        await screen.findByRole("heading", { name: MONIKER })
        fireEvent.click(screen.getByRole("button", { name: /edit profile/i }))
        const dialog = await screen.findByRole("dialog")
        expect(within(dialog).getByLabelText(/bio/i)).toHaveValue("Existing bio")
        expect(within(dialog).getByLabelText(/website/i)).toHaveValue("https://me.dev")
    })

    it("closes the dialog on Cancel without saving", async () => {
        renderWithContext(OPERATOR, ownerContext(OPERATOR))
        await screen.findByRole("heading", { name: MONIKER })
        fireEvent.click(screen.getByRole("button", { name: /edit profile/i }))
        const dialog = await screen.findByRole("dialog")
        fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }))
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
        expect(updateBackendProfile).not.toHaveBeenCalled()
    })

    it("saves via updateBackendProfile with the edited fields and the auth token", async () => {
        renderWithContext(OPERATOR, ownerContext(OPERATOR))
        await screen.findByRole("heading", { name: MONIKER })
        fireEvent.click(screen.getByRole("button", { name: /edit profile/i }))
        const dialog = await screen.findByRole("dialog")
        fireEvent.change(within(dialog).getByLabelText(/bio/i), { target: { value: "New bio text" } })
        fireEvent.change(within(dialog).getByLabelText(/website/i), { target: { value: "https://new.site" } })
        fireEvent.click(within(dialog).getByRole("button", { name: /save/i }))
        await waitFor(() => expect(updateBackendProfile).toHaveBeenCalledTimes(1))
        const [tokenArg, fieldsArg] = vi.mocked(updateBackendProfile).mock.calls[0]
        expect((tokenArg as Token).userAddress).toBe(OPERATOR)
        expect(fieldsArg).toMatchObject({ bio: "New bio text", website: "https://new.site" })
    })

    it("surfaces an error and keeps the dialog open when the save fails", async () => {
        vi.mocked(updateBackendProfile).mockRejectedValue(new Error("backend unavailable"))
        renderWithContext(OPERATOR, ownerContext(OPERATOR))
        await screen.findByRole("heading", { name: MONIKER })
        fireEvent.click(screen.getByRole("button", { name: /edit profile/i }))
        const dialog = await screen.findByRole("dialog")
        fireEvent.change(within(dialog).getByLabelText(/bio/i), { target: { value: "x" } })
        fireEvent.click(within(dialog).getByRole("button", { name: /save/i }))
        expect(await screen.findByText(/backend unavailable/i)).toBeInTheDocument()
        expect(screen.getByRole("dialog")).toBeInTheDocument()
    })
})

describe("ValidatorProfile — Quests owner-gate", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(fetchUserProfile).mockResolvedValue(makeProfile())
        setActivity()
        setData([valoper()], [])
        vi.mocked(loadQuestProgress).mockReturnValue({ completed: [], totalXP: 0 })
        vi.mocked(fetchUserQuests).mockResolvedValue(null)
    })

    it("shows the OWNER's completed quests + XP when the connected wallet === operator", async () => {
        vi.mocked(loadQuestProgress).mockReturnValue({
            completed: [{ questId: "connect-wallet", completedAt: 1 }, { questId: "view-validator", completedAt: 2 }],
            totalXP: 20,
        })
        renderWithContext(OPERATOR, ownerContext(OPERATOR))
        await screen.findByRole("heading", { name: MONIKER })
        fireEvent.click(screen.getByRole("tab", { name: "Quests" }))
        const panel = screen.getByTestId("vp-tab-quests")
        expect(within(panel).getByText(/20 XP/i)).toBeInTheDocument()
        expect(within(panel).queryByText(/private to the wallet holder/i)).not.toBeInTheDocument()
    })

    it("prefers backend quest XP over localStorage for the owner", async () => {
        vi.mocked(loadQuestProgress).mockReturnValue({ completed: [{ questId: "connect-wallet", completedAt: 1 }], totalXP: 10 })
        vi.mocked(fetchUserQuests).mockResolvedValue({
            completed: [{ questId: "connect-wallet", completedAt: 1 }, { questId: "join-dao", completedAt: 2 }],
            totalXP: 350,
        })
        renderWithContext(OPERATOR, ownerContext(OPERATOR))
        await screen.findByRole("heading", { name: MONIKER })
        fireEvent.click(screen.getByRole("tab", { name: "Quests" }))
        await waitFor(() => expect(within(screen.getByTestId("vp-tab-quests")).getByText(/350 XP/i)).toBeInTheDocument())
    })
})

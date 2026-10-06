import { afterEach, describe, it, expect, vi, beforeEach } from "vitest"
// Pin the module-load ACTIVE network to /test13/ through the jsdom URL. `config.ts`
// resolves it from the URL BEFORE any import runs, so this must be hoisted above the
// imports; without it the file runs on DEFAULT_NETWORK (mainnet), whose realm set
// changes this file's subject for reasons that have nothing to do with what it
// asserts. test13 is hidden but not retired: it resolves by URL (never from storage)
// with its realm allowlist.
vi.hoisted(() => {
    window.history.replaceState(null, "", "/test13/")
})

import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { Link, MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router-dom"
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
    findValoperForProfile: vi.fn(),
}))
vi.mock("../lib/validators", async (orig) => ({
    ...(await orig<typeof import("../lib/validators")>()),
    getValidatorRpcSnapshot: vi.fn().mockResolvedValue({
        url: "https://rpc.test13.testnets.gno.land", chainId: "test13", height: 100,
        blockHash: "test-hash", status: { node_info: { network: "test13" }, sync_info: { latest_block_height: "100" } },
    }),
    getValidators: vi.fn(),
}))
vi.mock("../lib/profile", () => ({ fetchUserProfile: vi.fn(), updateBackendProfile: vi.fn() }))
// The reviews notice depends on a build flag and the network allowlist: both are
// pinned here (flag off, realm usable) so no test depends on the environment or on order.
vi.mock("../lib/config", async (orig) => ({
    ...(await orig<typeof import("../lib/config")>()),
    isReviewsAvailable: vi.fn(() => false),
    isReviewsValid: vi.fn(() => true),
}))
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

// gnolove identity hooks (for the curated validator→contributor/team mapping).
vi.mock("../hooks/gnolove", () => ({ useGnoloveContributor: vi.fn(() => ({ data: null })) }))
vi.mock("../hooks/gnolove/useGnoloveTeams", () => ({ useGnoloveTeam: vi.fn(() => null) }))

import ValidatorProfile from "./ValidatorProfile"
import { findValoperForProfile } from "../lib/valopers"
import { getValidators } from "../lib/validators"
import { isReviewsValid } from "../lib/config"
import { fetchUserProfile, updateBackendProfile } from "../lib/profile"
import { useAddressActivity } from "../hooks/useAddressActivity"
import { loadQuestProgress, fetchUserQuests } from "../lib/quests"
import { useGnoloveContributor } from "../hooks/gnolove"
import { useGnoloveTeam } from "../hooks/gnolove/useGnoloveTeams"
import type { ActivityItem } from "../lib/activity"

const OPERATOR = "g1n9y62agq998jt8w59az60xcqlftjknjg2grhn4"
const SIGN = "g1abc000000000000000000000000000000000sig"
const GENESIS = "g15sysd4jcpsw7t0n4ffe2hn8ndfup2ae2vwpves"
// An UNMAPPED moniker — keeps the default-valoper tests free of the curated mapping.
const MONIKER = "test-validator-x"

const valoper = (over: Partial<ValoperWithStatus> = {}): ValoperWithStatus => ({
    moniker: MONIKER, description: "Samourai's test13 validator.", operatorAddress: OPERATOR,
    signingAddress: SIGN, signingPubKey: "gpub1ptest", serverType: "on-prem", status: "candidate", ...over,
})
const validator = (gnoAddr: string, moniker: string): ValidatorInfo =>
    ({ gnoAddr, address: gnoAddr, moniker } as ValidatorInfo)

function setData(valopers: ValoperWithStatus[], activeGnoAddrs: string[] = []) {
    vi.mocked(getValidators).mockResolvedValue(activeGnoAddrs.map(a => validator(a, a === GENESIS ? "gfanton-1" : "")))
    vi.mocked(findValoperForProfile).mockImplementation(async (_rpc, address) =>
        valopers.find(v => v.operatorAddress === address || v.signingAddress === address) ?? null)
}

function setActivity(over: Partial<ReturnType<typeof useAddressActivity>> = {}) {
    vi.mocked(useAddressActivity).mockReturnValue({
        items: [], loading: false, error: false, available: true, refetch: vi.fn(), ...over,
    })
}
const actItem = (over: Partial<ActivityItem> = {}): ActivityItem => ({
    kind: "call", title: "Approve · gnoswap/gns", actor: OPERATOR, pkgPath: "gno.land/r/gnoswap/gns",
    func: "Approve", txHash: "h1", blockHeight: 100, extraCount: 0, msgIndex: 0, ...over,
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

afterEach(() => { vi.mocked(isReviewsValid).mockReset() })

describe("ValidatorProfile — resolution & routing", () => {
    beforeEach(() => { vi.clearAllMocks(); vi.mocked(fetchUserProfile).mockResolvedValue(null); setActivity() })

    it("registered ACTIVE operator → identity + performance ON Overview + persistent reviews; NO Reviews/Performance tab", async () => {
        setData([valoper({ status: "active" })], [SIGN])
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        expect(screen.getByText("● Active")).toBeInTheDocument()
        expect(screen.getByTestId("vp-reviews")).toBeInTheDocument()
        expect(screen.queryByRole("tab", { name: "Reviews" })).toBeNull()
        expect(screen.queryByRole("tab", { name: "Performance" })).toBeNull()
        // Performance metrics now render on the default Overview tab (no click needed).
        const panel = await screen.findByTestId("perf-panel")
        expect(panel).toHaveAttribute("data-addr", SIGN)
        expect(panel).toHaveAttribute("data-active", "true")
    })

    it("registered CANDIDATE operator → Candidate badge + performance inactive on Overview", async () => {
        setData([valoper({ status: "candidate" })], ["g1someoneelse"])
        renderAt(OPERATOR)
        await waitFor(() => expect(screen.getByText("○ Candidate")).toBeInTheDocument())
        expect(await screen.findByTestId("perf-panel")).toHaveAttribute("data-active", "false")
    })

    it("genesis validator (in active set, no valoper) → genesis note + active performance on Overview", async () => {
        setData([], [GENESIS])
        renderAt(GENESIS)
        await screen.findByTestId("vp-genesis-note")
        expect(screen.getByRole("heading", { name: "gfanton-1" })).toBeInTheDocument()
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

    it("clears the previous profile when navigating to another operator", async () => {
        const second = "g1second000000000000000000000000000000000"
        const secondMoniker = "second-validator"
        setData([valoper(), valoper({ operatorAddress: second, moniker: secondMoniker })], [])
        let resolveFirst: (profile: UserProfile) => void = () => {}
        vi.mocked(fetchUserProfile).mockImplementation((_, addr) => addr === OPERATOR
            ? new Promise<UserProfile>(resolve => { resolveFirst = resolve })
            : Promise.resolve(makeProfile({ address: second, bio: "Second operator bio" })))
        renderWithProviders(
            <Routes>
                <Route path="/:network/validators/:address" element={<><Link to={`/test13/validators/${second}`}>Next operator</Link><ValidatorProfile /></>} />
            </Routes>,
            { route: `/test13/validators/${OPERATOR}` },
        )
        await screen.findByRole("heading", { name: MONIKER })
        fireEvent.click(screen.getByRole("link", { name: "Next operator" }))
        await screen.findByRole("heading", { name: secondMoniker })
        await screen.findByText("Second operator bio")
        await act(async () => { resolveFirst(makeProfile({ bio: "First operator bio" })) })
        expect(screen.queryByText("First operator bio")).not.toBeInTheDocument()
        expect(screen.getByRole("heading", { name: secondMoniker })).toBeInTheDocument()
    })

    it("returns to Candidates when opened from that segment", async () => {
        setData([valoper()], [])
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        render(
            <QueryClientProvider client={client}>
                <MemoryRouter initialEntries={[{ pathname: `/test13/validators/${OPERATOR}`, state: { fromValidatorsTab: "candidates" } }]}>
                    <Routes><Route path="/:network/validators/:address" element={<ValidatorProfile />} /></Routes>
                </MemoryRouter>
            </QueryClientProvider>,
        )
        await screen.findByRole("heading", { name: MONIKER })
        expect(screen.getByRole("link", { name: "← Validators" })).toHaveAttribute("href", "/test13/validators?tab=candidates")
    })

    it("returns to the same roster query after opening a validator", async () => {
        setData([valoper()], [])
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        render(
            <QueryClientProvider client={client}>
                <MemoryRouter initialEntries={[{ pathname: `/test13/validators/${OPERATOR}`, state: { fromValidatorsQuery: "q=gno-core&sort=votingPower&direction=desc" } }]}>
                    <Routes><Route path="/:network/validators/:address" element={<ValidatorProfile />} /></Routes>
                </MemoryRouter>
            </QueryClientProvider>,
        )
        await screen.findByRole("heading", { name: MONIKER })
        expect(screen.getByRole("link", { name: "← Validators" })).toHaveAttribute("href", "/test13/validators?q=gno-core&sort=votingPower&direction=desc")
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
        expect(screen.getByTestId("vp-avatar-fallback")).toHaveTextContent(/^T/i)
    })

    it("shows @username chip + realm link when the profile has a username", async () => {
        vi.mocked(fetchUserProfile).mockResolvedValue(makeProfile({ username: "@satoshi", userRealmUrl: "https://test13.testnets.gno.land/u/satoshi" }))
        renderAt(OPERATOR)
        const link = await screen.findByRole("link", { name: /@satoshi/i })
        expect(link).toHaveAttribute("href", "https://test13.testnets.gno.land/u/satoshi")
    })

    it("does not render unsafe profile links", async () => {
        vi.mocked(fetchUserProfile).mockResolvedValue(makeProfile({
            username: "@satoshi", userRealmUrl: "javascript:alert(1)",
            socialLinks: { website: "javascript:alert(1)", github: "https://not-github.example/operator", twitter: "" },
        }))
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        await screen.findByText("@satoshi")
        expect(screen.queryByRole("link", { name: "@satoshi" })).not.toBeInTheDocument()
        expect(screen.queryByRole("link", { name: "Website" })).not.toBeInTheDocument()
        expect(screen.queryByRole("link", { name: "GitHub" })).not.toBeInTheDocument()
    })

    it("keeps a GitHub-labelled link on GitHub and upgrades it to HTTPS", async () => {
        vi.mocked(fetchUserProfile).mockResolvedValue(makeProfile({
            socialLinks: { website: "", github: "http://github.com/operator", twitter: "" },
        }))
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        expect(await screen.findByRole("link", { name: "GitHub" })).toHaveAttribute("href", "https://github.com/operator")
    })

    it("reports copy success only after the clipboard write succeeds", async () => {
        const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard")
        const writeText = vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce(undefined)
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
        try {
            renderAt(OPERATOR)
            await screen.findByRole("heading", { name: MONIKER })
            const copy = screen.getByRole("button", { name: "Copy operator address" })
            fireEvent.click(copy)
            expect(await screen.findByRole("status", { name: "" })).toHaveTextContent("Could not copy operator address")
            fireEvent.click(copy)
            await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Operator address copied"))
            expect(writeText).toHaveBeenCalledWith(OPERATOR)
        } finally {
            if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard)
            else Reflect.deleteProperty(navigator, "clipboard")
        }
    })

    it("renders the bio as sanitized markdown, not raw ### / ** markup", async () => {
        vi.mocked(fetchUserProfile).mockResolvedValue(makeProfile({ bio: "### Networks\n**Mainnets** matter here" }))
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        // raw markdown markers must not be shown literally
        expect(screen.queryByText(/###/)).toBeNull()
        // bold renders as <strong>
        expect(screen.getByText("Mainnets").tagName).toBe("STRONG")
    })

    it("does NOT render an Edit profile button when there is no connected wallet", async () => {
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        expect(screen.queryByRole("button", { name: /edit profile/i })).not.toBeInTheDocument()
    })

    it("renders a tablist with the four tabs, Overview selected by default (no Reviews/Performance tab)", async () => {
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        const tabs = screen.getAllByRole("tab").map(t => t.textContent)
        expect(tabs).toEqual(expect.arrayContaining(["Overview", "Quests", "Contributions", "Activity"]))
        expect(tabs.some(t => /review/i.test(t || ""))).toBe(false)
        expect(tabs.some(t => /performance/i.test(t || ""))).toBe(false)
        expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true")
    })

    it("supports keyboard arrow navigation between tabs (Overview → Quests)", async () => {
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        const overview = screen.getByRole("tab", { name: "Overview" })
        overview.focus()
        fireEvent.keyDown(overview, { key: "ArrowRight" })
        expect(screen.getByRole("tab", { name: "Quests" })).toHaveAttribute("aria-selected", "true")
    })

    it("moves the roving tab stop and focus with the selection", async () => {
        // Exactly what the old hand-rolled handler got wrong: it moved
        // selection but left both tabindex and focus on the previous button,
        // so the next arrow press operated on a tab the user had left.
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        const overview = screen.getByRole("tab", { name: "Overview" })
        overview.focus()
        fireEvent.keyDown(overview, { key: "ArrowRight" })

        const quests = screen.getByRole("tab", { name: "Quests" })
        expect(quests).toHaveAttribute("tabindex", "0")
        expect(overview).toHaveAttribute("tabindex", "-1")
        // Focus lands after the hook's post-render timeout, so it is async.
        await waitFor(() => expect(document.activeElement).toBe(quests))
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

    it("Activity tab says who a transfer came from or went to", async () => {
        const other = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
        setActivity({ items: [
            actItem({ txHash: "h1", kind: "transfer", title: "Received 1 GNOT", actor: other, to: OPERATOR, direction: "received", pkgPath: undefined, func: undefined }),
            actItem({ txHash: "h2", kind: "transfer", title: "Sent 2 GNOT", actor: OPERATOR, to: other, direction: "sent", pkgPath: undefined, func: undefined }),
        ] })
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        fireEvent.click(screen.getByRole("tab", { name: "Activity" }))
        const [received, sent] = within(screen.getByTestId("vp-tab-activity")).getAllByTestId("vp-activity-row")
        expect(received).toHaveTextContent(/from g1747t…/)
        expect(sent).toHaveTextContent(/to g1747t…/)
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

    it("Quests tab prompts a non-owner to connect the operator wallet", async () => {
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        fireEvent.click(screen.getByRole("tab", { name: "Quests" }))
        const panel = screen.getByTestId("vp-tab-quests")
        expect(within(panel).getByText(/connect the operator wallet/i)).toBeInTheDocument()
        expect(within(panel).queryByTestId("vp-quest-row")).not.toBeInTheDocument()
    })

    it("with the reviews flag off, says the realm is deployed here and the site has reviews switched off", async () => {
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        const section = screen.getByTestId("vp-reviews")
        expect(section).toHaveTextContent("The reviews realm is deployed on Testnet 13, but reviews are switched off on this site.")
        expect(within(section).getByRole("link", { name: "reviews realm" })).toHaveAttribute("href", "https://test13.testnets.gno.land/r/samcrew/memba_reviews_v1")
        expect(section).not.toHaveTextContent(/soon|goes live/i)
    })

    it("where the reviews realm is not usable, says reviews are not available on this network", async () => {
        vi.mocked(isReviewsValid).mockReturnValue(false)
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        const section = screen.getByTestId("vp-reviews")
        expect(section).toHaveTextContent("Validator reviews are not available on Testnet 13.")
        expect(within(section).queryByRole("link")).toBeNull()
    })

    it("Contributions: a validator mapped to a gnolove CONTRIBUTOR shows its stats + link", async () => {
        vi.mocked(useGnoloveContributor).mockReturnValue({
            data: { login: "aeddi", name: "Aeddi", avatarUrl: "https://x/a.png", totalCommits: 120, totalPullRequests: 30, totalIssues: 5 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        setData([valoper({ moniker: "aeddi-1" })], [])
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "aeddi-1" })
        fireEvent.click(screen.getByRole("tab", { name: "Contributions" }))
        const card = screen.getByTestId("vp-mapped-identity")
        expect(within(card).getByText("120")).toBeInTheDocument()
        expect(within(card).getByRole("link", { name: /view on gnolove/i }))
            .toHaveAttribute("href", "/test13/gnolove/contributor/aeddi")
    })

    it("Contributions: a validator mapped to a gnolove TEAM links to the team page", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(useGnoloveTeam).mockReturnValue({ slug: "samouraiworld", name: "Samourai.world", members: ["a", "b"] } as any)
        setData([valoper({ moniker: "samourai-crew-1" })], [])
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("tab", { name: "Contributions" }))
        const card = screen.getByTestId("vp-mapped-identity")
        expect(within(card).getByText(/2 members/)).toBeInTheDocument()
        expect(within(card).getByRole("link", { name: /view team on gnolove/i }))
            .toHaveAttribute("href", "/test13/gnolove/teams/samouraiworld")
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
        expect(within(panel).queryByText(/connect the operator wallet/i)).not.toBeInTheDocument()
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

describe("ValidatorProfile — a read that outlives the RPC timeout", () => {
    const timeout = () => new DOMException("The user aborted a request.", "AbortError")
    beforeEach(() => { vi.clearAllMocks(); vi.mocked(fetchUserProfile).mockResolvedValue(null); setActivity(); setData([valoper({ status: "active" })], [SIGN]) })

    it("is tried once more, so a slow first read does not fail the page", async () => {
        vi.mocked(getValidators).mockRejectedValueOnce(timeout())
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: MONIKER })
        expect(screen.queryByText("Failed to load validator")).toBeNull()
        expect(getValidators).toHaveBeenCalledTimes(2)
    })

    it("is reported in plain words after the second timeout, and Retry loads the page", async () => {
        vi.mocked(getValidators).mockRejectedValueOnce(timeout()).mockRejectedValueOnce(timeout())
        renderAt(OPERATOR)
        expect(await screen.findByText("The network took too long to answer.")).toBeInTheDocument()
        expect(screen.queryByText(/aborted/i)).toBeNull()
        expect(getValidators).toHaveBeenCalledTimes(2)
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        await screen.findByRole("heading", { name: MONIKER })
    })

    it("does not retry another kind of failure", async () => {
        vi.mocked(getValidators).mockRejectedValueOnce(new Error("Validator RPC chain mismatch: expected test-13, got other"))
        renderAt(OPERATOR)
        expect(await screen.findByText(/chain mismatch/)).toBeInTheDocument()
        expect(getValidators).toHaveBeenCalledTimes(1)
    })

    it("says it is trying once more while the second read is under way", async () => {
        const answer = vi.mocked(getValidators).getMockImplementation()!
        let release!: () => void
        const held = new Promise<void>((resolve) => { release = resolve })
        vi.mocked(getValidators).mockRejectedValueOnce(timeout()).mockImplementationOnce(async (...args) => { await held; return answer(...args) })
        renderAt(OPERATOR)
        expect(await screen.findByText("The network is slow. Trying once more…")).toBeInTheDocument()
        release()
        await screen.findByRole("heading", { name: MONIKER })
    })

    it("does not retry a read the member abandoned by leaving the page", async () => {
        let fail!: (e: unknown) => void
        vi.mocked(getValidators).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
        const view = renderAt(OPERATOR)
        await waitFor(() => expect(getValidators).toHaveBeenCalledTimes(1))
        view.unmount()
        fail(timeout())
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(getValidators).toHaveBeenCalledTimes(1)
    })

    it("treats the valoper scan's wrapped timeout the same way", async () => {
        const wrapped = () => new Error("Valoper registry scan incomplete", { cause: timeout() })
        vi.mocked(findValoperForProfile).mockRejectedValueOnce(wrapped()).mockRejectedValueOnce(wrapped())
        renderAt(OPERATOR)
        expect(await screen.findByText("The network took too long to answer.")).toBeInTheDocument()
        expect(screen.queryByText(/scan incomplete/)).toBeNull()
        expect(findValoperForProfile).toHaveBeenCalledTimes(2)
    })
})

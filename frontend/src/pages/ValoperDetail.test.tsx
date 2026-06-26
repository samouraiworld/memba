import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderWithProviders, mockLayoutContext } from "../test/test-utils"
import type { LayoutContext } from "../types/layout"
import ValoperDetail from "./ValoperDetail"
import type { UserProfile } from "../lib/profile"
import type { Token } from "../gen/memba/v1/memba_pb"

vi.mock("../lib/dao/shared", () => ({ queryRender: vi.fn() }))
vi.mock("../lib/validators", () => ({
    getValidators: vi.fn().mockResolvedValue([]),
    // Address-truncation helper reused by the Activity rows; keep a faithful stub.
    truncateValidatorAddr: (a: string) => (a.length > 12 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a),
}))
vi.mock("../lib/profile", () => ({ fetchUserProfile: vi.fn(), updateBackendProfile: vi.fn() }))
// On-chain by-address activity hook (P2a) — default empty; tests override.
vi.mock("../hooks/useAddressActivity", () => ({ useAddressActivity: vi.fn() }))
// Quest progress sources (P2b) — owner-only. Keep gnobuilders (pure catalog) real.
vi.mock("../lib/quests", async (orig) => ({
    ...(await orig<typeof import("../lib/quests")>()),
    loadQuestProgress: vi.fn(() => ({ completed: [], totalXP: 0 })),
    fetchUserQuests: vi.fn().mockResolvedValue(null),
}))

import { queryRender } from "../lib/dao/shared"
import { fetchUserProfile, updateBackendProfile } from "../lib/profile"
import { useAddressActivity } from "../hooks/useAddressActivity"
import { loadQuestProgress, fetchUserQuests } from "../lib/quests"
import type { ActivityItem } from "../lib/activity"

/** Default the activity hook to an available-but-empty state for every test. */
function setActivity(over: Partial<ReturnType<typeof useAddressActivity>> = {}) {
    vi.mocked(useAddressActivity).mockReturnValue({
        items: [], loading: false, error: false, available: true, refetch: vi.fn(), ...over,
    })
}

const actItem = (over: Partial<ActivityItem> = {}): ActivityItem => ({
    kind: "call", title: "Approve · gnoswap/gns", actor: OPERATOR, pkgPath: "gno.land/r/gnoswap/gns",
    func: "Approve", txHash: "h1", blockHeight: 100, extraCount: 0, ...over,
})

const OPERATOR = "g1n9y62agq998jt8w59az60xcqlftjknjg2grhn4"

const DETAIL = `Valoper's details:
## samourai-crew-1
Samourai's test13 validator.

- Operator Address: ${OPERATOR}
- Signing Address: g1abc000000000000000000000000000000000sig
- Signing PubKey: gpub1ptest
- Server Type: on-prem

[Profile link](/r/demo/profile:u/${OPERATOR})
`

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
    return {
        address: OPERATOR,
        username: "",
        userRealmUrl: "",
        githubLogin: "",
        githubAvatar: "",
        githubBio: "",
        githubLocation: "",
        githubFollowers: 0,
        socialLinks: { twitter: "", github: "", website: "" },
        totalCommits: 0,
        totalPRs: 0,
        totalIssues: 0,
        totalReviews: 0,
        lovePowerScore: 0,
        deployedPackages: [],
        governanceVotes: [],
        bio: "",
        company: "",
        title: "",
        avatarUrl: "",
        ...overrides,
    }
}

function renderAt(addr: string) {
    return renderWithProviders(
        <Routes>
            <Route path="/:network/validators/valoper/:operatorAddress" element={<ValoperDetail />} />
        </Routes>,
        { route: `/test13/validators/valoper/${addr}` },
    )
}

// A fake auth token — the save path only reads `userAddress` off it.
function fakeToken(addr: string): Token {
    return { userAddress: addr } as unknown as Token
}

/** Render the page through a Layout outlet that supplies the wallet/auth context,
 *  so owner-detection (connected address === operator) can be exercised. */
function renderWithContext(addr: string, ctx: Partial<LayoutContext>) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const context = mockLayoutContext(ctx)
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[`/test13/validators/valoper/${addr}`]}>
                <Routes>
                    <Route element={<Outlet context={context} />}>
                        <Route
                            path="/:network/validators/valoper/:operatorAddress"
                            element={<ValoperDetail />}
                        />
                    </Route>
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    )
}

/** Owner context: wallet connected + authenticated as the operator address. */
function ownerContext(addr = OPERATOR): Partial<LayoutContext> {
    return {
        adena: { ...mockLayoutContext().adena, connected: true, address: addr },
        auth: { token: fakeToken(addr), isAuthenticated: true, address: addr, loading: false, error: null },
    }
}

describe("ValoperDetail — Blend layout", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(fetchUserProfile).mockResolvedValue(makeProfile())
        vi.mocked(loadQuestProgress).mockReturnValue({ completed: [], totalXP: 0 })
        vi.mocked(fetchUserQuests).mockResolvedValue(null)
        setActivity()
    })

    // ── identity header ──────────────────────────────────────────

    it("renders the identity header: moniker, status badge, operator + signing addresses", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        renderAt(OPERATOR)

        expect(await screen.findByRole("heading", { name: "samourai-crew-1" })).toBeInTheDocument()
        // candidate status badge (no validators mocked → not in active set)
        expect(screen.getByText(/○ candidate/i)).toBeInTheDocument()
        // both addresses present
        expect(screen.getByText(OPERATOR)).toBeInTheDocument()
        expect(screen.getByText("g1abc000000000000000000000000000000000sig")).toBeInTheDocument()
    })

    it("shows an avatar image when the profile supplies one", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        vi.mocked(fetchUserProfile).mockResolvedValue(
            makeProfile({ avatarUrl: "https://example.com/a.png" }),
        )
        renderAt(OPERATOR)
        const img = await screen.findByRole("img", { name: /samourai-crew-1/i })
        expect(img).toHaveAttribute("src", "https://example.com/a.png")
    })

    it("falls back to moniker initials when no avatar is available", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        // no <img> avatar; an initials fallback element is shown instead
        expect(screen.queryByRole("img", { name: /samourai-crew-1/i })).not.toBeInTheDocument()
        expect(screen.getByTestId("vp-avatar-fallback")).toHaveTextContent(/^S/i)
    })

    it("shows @username chip + realm link when the profile has a username", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        vi.mocked(fetchUserProfile).mockResolvedValue(
            makeProfile({ username: "@satoshi", userRealmUrl: "https://test13.testnets.gno.land/u/satoshi" }),
        )
        renderAt(OPERATOR)
        const link = await screen.findByRole("link", { name: /@satoshi/i })
        expect(link).toHaveAttribute("href", "https://test13.testnets.gno.land/u/satoshi")
    })

    it("does NOT render an Edit profile button when there is no connected wallet", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        // renderAt has no Layout outlet → no connected address → not the owner
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        expect(screen.queryByRole("button", { name: /edit profile/i })).not.toBeInTheDocument()
    })

    // ── tabs ─────────────────────────────────────────────────────

    it("renders a tablist with all five tabs, Overview selected by default", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "samourai-crew-1" })

        const tabs = screen.getAllByRole("tab")
        expect(tabs.map(t => t.textContent)).toEqual(
            expect.arrayContaining(["Overview", "Reviews", "Quests", "Contributions", "Activity"]),
        )
        const overview = screen.getByRole("tab", { name: "Overview" })
        expect(overview).toHaveAttribute("aria-selected", "true")
    })

    it("switches tab content when a tab is clicked", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        vi.mocked(fetchUserProfile).mockResolvedValue(makeProfile({ totalCommits: 42, lovePowerScore: 420 }))
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "samourai-crew-1" })

        // Overview is shown; Contributions panel not yet
        expect(screen.queryByTestId("vp-tab-contributions")).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole("tab", { name: "Contributions" }))

        expect(screen.getByTestId("vp-tab-contributions")).toBeInTheDocument()
        expect(screen.getByRole("tab", { name: "Contributions" })).toHaveAttribute("aria-selected", "true")
        expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "false")
    })

    it("supports keyboard arrow navigation between tabs", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "samourai-crew-1" })

        const overview = screen.getByRole("tab", { name: "Overview" })
        overview.focus()
        fireEvent.keyDown(overview, { key: "ArrowRight" })
        expect(screen.getByRole("tab", { name: "Reviews" })).toHaveAttribute("aria-selected", "true")
    })

    // ── Contributions tab (real gnolove data) ────────────────────

    it("Contributions tab shows gnolove stats", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        vi.mocked(fetchUserProfile).mockResolvedValue(
            makeProfile({
                totalCommits: 42, totalPRs: 7, totalIssues: 3, totalReviews: 11, lovePowerScore: 477,
                deployedPackages: [
                    { address: OPERATOR, path: "gno.land/r/foo/bar", namespace: "foo", blockHeight: 123 },
                ],
            }),
        )
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("tab", { name: "Contributions" }))

        const panel = screen.getByTestId("vp-tab-contributions")
        expect(within(panel).getByText("42")).toBeInTheDocument()   // commits
        expect(within(panel).getByText("477")).toBeInTheDocument()  // love power
        expect(within(panel).getByText("gno.land/r/foo/bar")).toBeInTheDocument()
    })

    it("Contributions tab shows an honest empty state when there is no gnolove data", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("tab", { name: "Contributions" }))
        const panel = screen.getByTestId("vp-tab-contributions")
        expect(within(panel).getByText(/no .*contribution/i)).toBeInTheDocument()
    })

    // ── Activity tab (P2a — real on-chain txs by address + gov votes) ─────

    it("Activity tab renders on-chain transaction rows for the address", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        setActivity({
            items: [
                actItem({ txHash: "h1", title: "Deployed r/demo/foo", kind: "deploy", pkgPath: "gno.land/r/demo/foo" }),
                actItem({ txHash: "h2", title: "Approve · gnoswap/gns", kind: "call" }),
            ],
        })
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("tab", { name: "Activity" }))

        const panel = screen.getByTestId("vp-tab-activity")
        const rows = within(panel).getAllByTestId("vp-activity-row")
        expect(rows).toHaveLength(2)
        expect(within(panel).getByText("Deployed r/demo/foo")).toBeInTheDocument()
        // the deploy row links to the realm on gnoweb
        const link = within(panel).getByRole("link", { name: /Deployed r\/demo\/foo/i })
        expect(link.getAttribute("href")).toContain("/r/demo/foo")
    })

    it("Activity tab shows an honest empty state when the address has no on-chain activity", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        setActivity({ items: [] }) // available, not loading, no error, empty
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("tab", { name: "Activity" }))

        const panel = screen.getByTestId("vp-tab-activity")
        expect(within(panel).getByText(/no recent on-chain activity/i)).toBeInTheDocument()
        // honest framing of the windowed limitation, not a fake "coming soon"
        expect(within(panel).queryByText(/coming soon/i)).not.toBeInTheDocument()
    })

    it("Activity tab shows a retry when the indexer errors", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        const refetch = vi.fn()
        setActivity({ error: true, refetch })
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("tab", { name: "Activity" }))

        const panel = screen.getByTestId("vp-tab-activity")
        const retry = within(panel).getByRole("button", { name: /retry/i })
        fireEvent.click(retry)
        expect(refetch).toHaveBeenCalled()
    })

    it("Activity tab shows a loading skeleton while fetching", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        setActivity({ loading: true })
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("tab", { name: "Activity" }))
        expect(within(screen.getByTestId("vp-tab-activity")).getByTestId("vp-activity-loading")).toBeInTheDocument()
    })

    it("Activity tab still lists governance votes alongside the on-chain feed", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        vi.mocked(fetchUserProfile).mockResolvedValue(
            makeProfile({ governanceVotes: [{ proposalId: "12", proposalTitle: "Raise the gas cap", vote: "YES" }] }),
        )
        setActivity({ items: [actItem()] })
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("tab", { name: "Activity" }))

        const panel = screen.getByTestId("vp-tab-activity")
        expect(within(panel).getByText(/Raise the gas cap/)).toBeInTheDocument()
    })

    // ── Reviews (coming soon) ────────────────────────────────────

    it("Reviews tab is an honest coming-soon placeholder", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("tab", { name: "Reviews" }))
        const panel = screen.getByTestId("vp-tab-reviews")
        expect(within(panel).getByText(/reviews are coming soon/i)).toBeInTheDocument()
    })

    // ── Quests tab (P2b — owner-only progress) ───────────────────

    it("Quests tab shows the private note for a non-owner / disconnected viewer", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        // renderAt has no Layout outlet → not the owner
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("tab", { name: "Quests" }))
        const panel = screen.getByTestId("vp-tab-quests")
        expect(within(panel).getByText(/private to the wallet holder/i)).toBeInTheDocument()
        // not a fake list, not a hard "coming soon"
        expect(within(panel).queryByTestId("vp-quest-row")).not.toBeInTheDocument()
        expect(within(panel).queryByText(/coming soon/i)).not.toBeInTheDocument()
    })

    it("Overview tab shows the community-reviews hero placeholder", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        const panel = screen.getByTestId("vp-tab-overview")
        expect(within(panel).getByText(/community reviews/i)).toBeInTheDocument()
    })

    // ── graceful degradation ─────────────────────────────────────

    it("still renders from valoper data alone when fetchUserProfile rejects", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        vi.mocked(fetchUserProfile).mockRejectedValue(new Error("gnolove down"))
        renderAt(OPERATOR)

        // header still renders from valoper data
        expect(await screen.findByRole("heading", { name: "samourai-crew-1" })).toBeInTheDocument()
        expect(screen.getByText(OPERATOR)).toBeInTheDocument()
        // tabs still work
        expect(screen.getAllByRole("tab").length).toBe(5)
        fireEvent.click(screen.getByRole("tab", { name: "Contributions" }))
        expect(screen.getByTestId("vp-tab-contributions")).toBeInTheDocument()
    })

    // ── preserved states ─────────────────────────────────────────

    it("shows a not-found state when the operator is unregistered", async () => {
        vi.mocked(queryRender).mockResolvedValue("unknown address g1nope")
        renderAt("g1nope")
        expect(await screen.findByText(/valoper not found/i)).toBeInTheDocument()
    })

    it("links 'View on gnoweb' to a test13 host, never mainnet gno.land", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        const link = screen.getByRole("link", { name: /view on gnoweb/i })
        const href = link.getAttribute("href") || ""
        expect(href).toContain("/r/gnops/valopers:")
        expect(href).not.toMatch(/\/\/gno\.land\//)
    })
})

// ════════════════════════════════════════════════════════════════
// P1b — owner "Edit profile" flow (backend editable-profile API)
// ════════════════════════════════════════════════════════════════

describe("ValoperDetail — owner Edit-profile flow (P1b)", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(fetchUserProfile).mockResolvedValue(makeProfile())
        vi.mocked(updateBackendProfile).mockResolvedValue(undefined)
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        vi.mocked(loadQuestProgress).mockReturnValue({ completed: [], totalXP: 0 })
        vi.mocked(fetchUserQuests).mockResolvedValue(null)
        setActivity()
    })

    // ── owner-gate ───────────────────────────────────────────────

    it("ENABLES the Edit button when the connected wallet === the operator address (owner)", async () => {
        renderWithContext(OPERATOR, ownerContext(OPERATOR))
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        const editBtn = screen.getByRole("button", { name: /edit profile/i })
        expect(editBtn).toBeEnabled()
    })

    it("does NOT render the Edit button for a non-owner (connected wallet ≠ operator)", async () => {
        const OTHER = "g1someoneelse00000000000000000000000000xx"
        renderWithContext(OPERATOR, ownerContext(OTHER))
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        expect(screen.queryByRole("button", { name: /edit profile/i })).not.toBeInTheDocument()
    })

    it("does NOT render the Edit button when the wallet is connected but not authenticated", async () => {
        renderWithContext(OPERATOR, {
            adena: { ...mockLayoutContext().adena, connected: true, address: OPERATOR },
            auth: { token: null, isAuthenticated: false, address: "", loading: false, error: null },
        })
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        expect(screen.queryByRole("button", { name: /edit profile/i })).not.toBeInTheDocument()
    })

    // ── opening the form ─────────────────────────────────────────

    it("opens an accessible edit dialog when the owner clicks Edit", async () => {
        renderWithContext(OPERATOR, ownerContext(OPERATOR))
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("button", { name: /edit profile/i }))

        const dialog = await screen.findByRole("dialog")
        expect(dialog).toBeInTheDocument()
        expect(dialog).toHaveAttribute("aria-modal", "true")
        // editable fields present
        expect(within(dialog).getByLabelText(/bio/i)).toBeInTheDocument()
        expect(within(dialog).getByLabelText(/website/i)).toBeInTheDocument()
    })

    it("pre-fills the form from the current profile", async () => {
        vi.mocked(fetchUserProfile).mockResolvedValue(
            makeProfile({ bio: "Existing bio", socialLinks: { twitter: "", github: "", website: "https://me.dev" } }),
        )
        renderWithContext(OPERATOR, ownerContext(OPERATOR))
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("button", { name: /edit profile/i }))

        const dialog = await screen.findByRole("dialog")
        expect(within(dialog).getByLabelText(/bio/i)).toHaveValue("Existing bio")
        expect(within(dialog).getByLabelText(/website/i)).toHaveValue("https://me.dev")
    })

    it("closes the dialog on Cancel without saving", async () => {
        renderWithContext(OPERATOR, ownerContext(OPERATOR))
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("button", { name: /edit profile/i }))
        const dialog = await screen.findByRole("dialog")
        fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }))

        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
        expect(updateBackendProfile).not.toHaveBeenCalled()
    })

    // ── saving ───────────────────────────────────────────────────

    it("saves via updateBackendProfile with the edited fields and the auth token", async () => {
        renderWithContext(OPERATOR, ownerContext(OPERATOR))
        await screen.findByRole("heading", { name: "samourai-crew-1" })
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

    it("refreshes the displayed profile and closes the dialog on a successful save", async () => {
        // First load: empty bio. After save, the re-fetch returns the new bio.
        vi.mocked(fetchUserProfile)
            .mockResolvedValueOnce(makeProfile({ bio: "" }))
            .mockResolvedValue(makeProfile({ bio: "Saved bio shows now" }))

        renderWithContext(OPERATOR, ownerContext(OPERATOR))
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("button", { name: /edit profile/i }))
        const dialog = await screen.findByRole("dialog")
        fireEvent.change(within(dialog).getByLabelText(/bio/i), { target: { value: "Saved bio shows now" } })
        fireEvent.click(within(dialog).getByRole("button", { name: /save/i }))

        // dialog closes
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
        // a background re-fetch ran (initial load + post-save refresh)
        await waitFor(() => expect(fetchUserProfile).toHaveBeenCalledTimes(2))
        // refreshed bio is rendered
        expect(await screen.findByText("Saved bio shows now")).toBeInTheDocument()
    })

    it("surfaces an error and keeps the dialog open when the save fails", async () => {
        vi.mocked(updateBackendProfile).mockRejectedValue(new Error("backend unavailable"))
        renderWithContext(OPERATOR, ownerContext(OPERATOR))
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("button", { name: /edit profile/i }))
        const dialog = await screen.findByRole("dialog")
        fireEvent.change(within(dialog).getByLabelText(/bio/i), { target: { value: "x" } })
        fireEvent.click(within(dialog).getByRole("button", { name: /save/i }))

        expect(await screen.findByText(/backend unavailable/i)).toBeInTheDocument()
        // dialog stays open so the user can retry
        expect(screen.getByRole("dialog")).toBeInTheDocument()
    })

    it("disables the Save button while a save is in flight", async () => {
        // Hang the save so we can observe the in-flight state.
        let resolveSave: () => void = () => {}
        vi.mocked(updateBackendProfile).mockImplementation(
            () => new Promise<void>((res) => { resolveSave = res }),
        )
        renderWithContext(OPERATOR, ownerContext(OPERATOR))
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("button", { name: /edit profile/i }))
        const dialog = await screen.findByRole("dialog")
        const saveBtn = within(dialog).getByRole("button", { name: /save/i })
        fireEvent.click(saveBtn)

        await waitFor(() => expect(saveBtn).toBeDisabled())
        resolveSave()
    })
})

// ════════════════════════════════════════════════════════════════
// P2b — Quests tab (owner-only quest progress)
// ════════════════════════════════════════════════════════════════

describe("ValoperDetail — Quests tab (P2b owner-gate)", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(fetchUserProfile).mockResolvedValue(makeProfile())
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        vi.mocked(loadQuestProgress).mockReturnValue({ completed: [], totalXP: 0 })
        vi.mocked(fetchUserQuests).mockResolvedValue(null)
        setActivity()
    })

    it("shows the OWNER's completed quests + XP when the connected wallet === operator", async () => {
        // connect-wallet (10xp) + view-validator (10xp) completed → 20 XP.
        vi.mocked(loadQuestProgress).mockReturnValue({
            completed: [
                { questId: "connect-wallet", completedAt: 1 },
                { questId: "view-validator", completedAt: 2 },
            ],
            totalXP: 20,
        })
        renderWithContext(OPERATOR, ownerContext(OPERATOR))
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("tab", { name: "Quests" }))

        const panel = screen.getByTestId("vp-tab-quests")
        // XP total surfaced
        expect(within(panel).getByText(/20 XP/i)).toBeInTheDocument()
        // a completed quest is listed (catalog title for connect-wallet)
        expect(within(panel).getByText(/Wallet Connected|Connect Wallet/i)).toBeInTheDocument()
        // it is NOT the private note
        expect(within(panel).queryByText(/private to the wallet holder/i)).not.toBeInTheDocument()
    })

    it("does NOT show quest progress for a non-owner — shows the private note instead (owner-gate)", async () => {
        const OTHER = "g1someoneelse00000000000000000000000000xx"
        // Even if (hypothetically) local progress existed, a non-owner must not see it.
        vi.mocked(loadQuestProgress).mockReturnValue({
            completed: [{ questId: "connect-wallet", completedAt: 1 }],
            totalXP: 10,
        })
        renderWithContext(OPERATOR, ownerContext(OTHER))
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("tab", { name: "Quests" }))

        const panel = screen.getByTestId("vp-tab-quests")
        expect(within(panel).getByText(/private to the wallet holder/i)).toBeInTheDocument()
        expect(within(panel).queryByTestId("vp-quest-row")).not.toBeInTheDocument()
    })

    it("prefers backend quest XP over localStorage for the owner", async () => {
        vi.mocked(loadQuestProgress).mockReturnValue({
            completed: [{ questId: "connect-wallet", completedAt: 1 }],
            totalXP: 10,
        })
        // Backend is authoritative: 350 XP (Gold).
        vi.mocked(fetchUserQuests).mockResolvedValue({
            completed: [
                { questId: "connect-wallet", completedAt: 1 },
                { questId: "join-dao", completedAt: 2 },
            ],
            totalXP: 350,
        })
        renderWithContext(OPERATOR, ownerContext(OPERATOR))
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("tab", { name: "Quests" }))

        const panel = screen.getByTestId("vp-tab-quests")
        expect(await within(panel).findByText(/350 XP/i)).toBeInTheDocument()
    })
})

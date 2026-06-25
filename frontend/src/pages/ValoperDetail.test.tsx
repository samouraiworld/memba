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
vi.mock("../lib/validators", () => ({ getValidators: vi.fn().mockResolvedValue([]) }))
vi.mock("../lib/profile", () => ({ fetchUserProfile: vi.fn(), updateBackendProfile: vi.fn() }))

import { queryRender } from "../lib/dao/shared"
import { fetchUserProfile, updateBackendProfile } from "../lib/profile"

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

    // ── Activity tab (gov votes, first cut) ──────────────────────

    it("Activity tab shows governance votes plus a 'more coming' note", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        vi.mocked(fetchUserProfile).mockResolvedValue(
            makeProfile({
                governanceVotes: [
                    { proposalId: "12", proposalTitle: "Raise the gas cap", vote: "YES" },
                ],
            }),
        )
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("tab", { name: "Activity" }))

        const panel = screen.getByTestId("vp-tab-activity")
        expect(within(panel).getByText(/Raise the gas cap/)).toBeInTheDocument()
        expect(within(panel).getByText(/coming/i)).toBeInTheDocument()
    })

    // ── Reviews + Quests (coming soon) ───────────────────────────

    it("Reviews tab is an honest coming-soon placeholder", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("tab", { name: "Reviews" }))
        const panel = screen.getByTestId("vp-tab-reviews")
        expect(within(panel).getByText(/reviews are coming soon/i)).toBeInTheDocument()
    })

    it("Quests tab is an honest coming-soon placeholder", async () => {
        vi.mocked(queryRender).mockResolvedValue(DETAIL)
        renderAt(OPERATOR)
        await screen.findByRole("heading", { name: "samourai-crew-1" })
        fireEvent.click(screen.getByRole("tab", { name: "Quests" }))
        const panel = screen.getByTestId("vp-tab-quests")
        expect(within(panel).getByText(/quests .*are coming soon/i)).toBeInTheDocument()
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

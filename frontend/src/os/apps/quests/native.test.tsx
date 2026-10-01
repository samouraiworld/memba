import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getComingSoonQuests, getLiveQuests } from "../../../lib/gnobuilders"
import type { NativeViewProps } from "../../native/types"
import { specForTarget } from "../../shell/windows"

const mocks = vi.hoisted(() => ({ fetchUserQuests: vi.fn(), pointsEnabled: vi.fn(() => false) }))
// The one network reader. Everything else (the catalogue, ranks, the realm
// allowlist for mainnet, this browser's saved progress) is the real code.
vi.mock("../../../lib/quests", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/quests")>(),
    fetchUserQuests: mocks.fetchUserQuests,
}))
// Reputation is switched off in config today: the switch is the one thing replaced there.
vi.mock("../../../lib/config", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/config")>(),
    isPointsEnabled: mocks.pointsEnabled,
}))
// The classic panel signs through the wallet itself: here it only says whose vouchers it would read.
vi.mock("../../../components/quests/AttestationPanel", () => ({ AttestationPanel: ({ address }: { address: string }) => <p>attestation panel for {address}</p> }))

import QuestsWindow from "./native"

const MEMBER = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"
const LIVE = getLiveQuests().length
const openConnect = vi.fn()
/** `open`: the address was replaced. `push`: a history entry was added. */
const open = vi.fn()
const push = vi.fn()
const network = { key: "mainnet", chainId: "gnoland-1" }
const guest = { status: "guest", address: "", walletAddress: "", network, openConnect } as unknown as NativeViewProps["session"]
const member = { status: "member", address: MEMBER, walletAddress: MEMBER, network, openConnect } as unknown as NativeViewProps["session"]
/** A wallet connected but not signed in: a guest to the OS, with this browser's progress kept under the wallet. */
const connectedGuest = { status: "guest", address: "", walletAddress: MEMBER, network, openConnect } as unknown as NativeViewProps["session"]
const done = (...ids: string[]) => ids.map((questId) => ({ questId, completedAt: 1 }))
const spec = (section: string | null, query = "") => specForTarget({ kind: "app", app: "quests", section, query })

function view(props: Partial<NativeViewProps> = {}) {
    return (
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <QuestsWindow section={null} session={guest} active open={open} push={push} openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} fallback={<p>classic page</p>} {...props} />
        </QueryClientProvider>
    )
}
// No router around it: a native view that read one would throw here.
const show = (props: Partial<NativeViewProps> = {}) => render(view(props))
const quest = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title} \\+`) })

beforeEach(() => {
    localStorage.clear()
    open.mockReset()
    push.mockReset()
    openConnect.mockReset()
    mocks.fetchUserQuests.mockReset()
    mocks.pointsEnabled.mockReturnValue(false)
})

describe("Quests window: the home section", () => {
    it("lets a guest browse every quest, and says what connecting would show", () => {
        show()
        expect(screen.getByRole("heading", { level: 1, name: "Quests" })).toHaveAttribute("tabindex", "-1")
        expect(screen.getByRole("heading", { level: 2, name: `${LIVE} quests` })).toBeInTheDocument()
        expect(screen.getAllByRole("button", { name: / \+\d+ XP/ })).toHaveLength(LIVE)
        expect(within(quest("Wallet Connected")).getByText("Available")).toBeInTheDocument()
        expect(screen.getByText(/Connect a wallet to see the rank, XP and completed quests recorded for your address/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Connect" }))
        expect(openConnect).toHaveBeenCalledTimes(1)
        // Nothing is read for a guest, and no rank or XP is made up for one.
        expect(mocks.fetchUserQuests).not.toHaveBeenCalled()
        expect(screen.queryByText("Rank")).not.toBeInTheDocument()
        expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    })

    it("names the quests gno.land mainnet cannot complete, and keeps them locked", () => {
        show()
        expect(screen.getByRole("note")).toHaveTextContent("Not on gnoland-1 yet Completing DAO Member, Applicant, and Token Minter isn't available yet.")
        for (const title of ["DAO Member", "Applicant", "Token Minter"]) {
            expect(within(quest(title)).getByText("Locked")).toBeInTheDocument()
            expect(quest(title)).toHaveTextContent("Not available on this network yet")
        }
    })

    it("lists the quests with no completion check apart, without a way to open them", () => {
        show()
        const closed = getComingSoonQuests()
        const group = screen.getByText(`${closed.length} more quests cannot be completed yet`).closest("details")!
        expect(within(group).getAllByRole("listitem")).toHaveLength(closed.length)
        expect(group).toHaveTextContent("No completion check exists for these quests yet, so their XP cannot be earned.")
        expect(within(group).queryByRole("button")).not.toBeInTheDocument()
    })

    it("shows a guest the progress this browser saved, labelled as such", () => {
        localStorage.setItem("memba_quests", JSON.stringify({ completed: done("switch-network"), totalXP: 15 }))
        show()
        expect(screen.getByText("Saved in this browser")).toBeInTheDocument()
        expect(screen.getByText("15")).toBeInTheDocument()
        expect(screen.getByText(`1 / ${LIVE}`)).toBeInTheDocument()
        expect(within(quest("Network Hopper")).getByText("Completed")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument()
    })

    it("shows a member the rank and XP the server recorded for their address", async () => {
        mocks.fetchUserQuests.mockResolvedValue({ completed: done("connect-wallet", "deploy-hello-pkg"), totalXP: 360 })
        show({ session: member })
        expect(screen.getByRole("status")).toHaveTextContent("Reading your XP from the Memba server…")
        expect(await screen.findByText("Gold Architect")).toBeInTheDocument()
        expect(mocks.fetchUserQuests).toHaveBeenCalledWith(MEMBER)
        expect(screen.getByText("360")).toBeInTheDocument()
        expect(screen.getByText("240 XP to Platinum Master")).toBeInTheDocument()
        expect(screen.getByText("Recorded by the Memba server")).toBeInTheDocument()
        expect(screen.getByText(`2 / ${LIVE}`)).toBeInTheDocument()
        const bar = screen.getByRole("progressbar", { name: "XP toward Platinum Master" })
        expect(bar).toHaveAttribute("aria-valuenow", "360")
        expect(bar).toHaveAttribute("aria-valuemin", "350")
        expect(bar).toHaveAttribute("aria-valuemax", "600")
        // A completed prerequisite opens the next quest; an open one keeps it locked, with the reason.
        expect(within(quest("First Package")).getByText("Completed")).toBeInTheDocument()
        expect(within(quest("Test-Driven Dev")).getByText("Available")).toBeInTheDocument()
        expect(quest("Test Warrior")).toHaveTextContent("Locked Intermediate · Requires First Realm")
        expect(screen.queryByRole("button", { name: "Connect" })).not.toBeInTheDocument()
    })

    it("shows a connected wallet that is not signed in the progress this browser saved for it", () => {
        localStorage.setItem(`memba_quests_${MEMBER}`, JSON.stringify({ completed: done("switch-network"), totalXP: 15 }))
        show({ session: connectedGuest })
        expect(screen.getByText("Saved in this browser")).toBeInTheDocument()
        expect(within(quest("Network Hopper")).getByText("Completed")).toBeInTheDocument()
        // Nothing is read from the server before sign-in.
        expect(mocks.fetchUserQuests).not.toHaveBeenCalled()
    })

    it("keeps on-chain attestation in the window for any connected wallet, as the classic hub does, and asks nothing of a visitor", async () => {
        const visitor = show()
        expect(screen.queryByText(/attestation panel/)).toBeNull()
        visitor.unmount()
        const connected = show({ session: connectedGuest })
        expect(screen.getByText(`attestation panel for ${MEMBER}`)).toBeInTheDocument()
        connected.unmount()
        mocks.fetchUserQuests.mockResolvedValue({ completed: [], totalXP: 0 })
        show({ session: member })
        expect(await screen.findByText(`attestation panel for ${MEMBER}`)).toBeInTheDocument()
    })

    it("says so when this browser holds a completion the server has not recorded", async () => {
        localStorage.setItem(`memba_quests_${MEMBER}`, JSON.stringify({ completed: done("use-cmdk"), totalXP: 10 }))
        mocks.fetchUserQuests.mockResolvedValue({ completed: [], totalXP: 0 })
        show({ session: member })
        expect(await screen.findByText("This browser holds completed quests that are not in the server’s record.")).toBeInTheDocument()
        expect(within(quest("Power User")).getByText("Completed")).toBeInTheDocument()
    })

    it.each([
        ["answers nothing", () => mocks.fetchUserQuests.mockResolvedValueOnce(null)],
        ["rejects", () => mocks.fetchUserQuests.mockRejectedValueOnce(new Error("offline"))],
    ])("shows the server as unreachable when the read %s, never as 0 XP, and reads again on Retry", async (_, fail) => {
        fail()
        mocks.fetchUserQuests.mockResolvedValue({ completed: [], totalXP: 60 })
        show({ session: member })
        expect(await screen.findByRole("alert")).toHaveTextContent("Your XP and completed quests could not be read from the Memba server.")
        expect(screen.queryByText("Rank")).not.toBeInTheDocument()
        expect(screen.queryByText("Newcomer")).not.toBeInTheDocument()
        // The catalogue does not depend on the server.
        expect(screen.getAllByRole("button", { name: / \+\d+ XP/ })).toHaveLength(LIVE)
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByText("Bronze Explorer")).toBeInTheDocument()
        expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    })

    it("counts as a page visit toward the five-pages quest, as the classic hub does", () => {
        show()
        expect(JSON.parse(localStorage.getItem("memba_quest_pages")!)).toEqual(["quests"])
    })

    it("reads again when a quest completes elsewhere in Memba", async () => {
        mocks.fetchUserQuests.mockResolvedValueOnce({ completed: [], totalXP: 0 }).mockResolvedValue({ completed: done("connect-wallet"), totalXP: 10 })
        show({ session: member })
        expect(await screen.findByText(`0 / ${LIVE}`)).toBeInTheDocument()
        fireEvent(window, new Event("quest-completed"))
        expect(await screen.findByText(`1 / ${LIVE}`)).toBeInTheDocument()
    })
})

describe("Quests window: a page is a history entry, a filter replaces the address", () => {
    it("opens a quest on its own page in the same window", () => {
        show()
        fireEvent.click(quest("First Package"))
        expect(push).toHaveBeenCalledWith(spec("deploy-hello-pkg"))
        expect(push.mock.calls[0][0].key).toBe("app:quests")
        expect(open).not.toHaveBeenCalled()
    })

    it("hands the quest's page the filters to return to", () => {
        show({ query: "category=developer&difficulty=beginner&q=deploy" })
        fireEvent.click(quest("First Package"))
        expect(push).toHaveBeenCalledWith(spec("deploy-hello-pkg", "from=category%3Ddeveloper%26difficulty%3Dbeginner%26q%3Ddeploy"))
    })

    it("opens the leaderboard, and offers Reputation only in a build that has it", () => {
        const off = show()
        fireEvent.click(screen.getByRole("button", { name: "Leaderboard" }))
        expect(push).toHaveBeenLastCalledWith(spec("leaderboard"))
        expect(screen.queryByRole("button", { name: "Reputation" })).toBeNull()
        off.unmount()
        mocks.pointsEnabled.mockReturnValue(true)
        show()
        fireEvent.click(screen.getByRole("button", { name: "Reputation" }))
        expect(push).toHaveBeenLastCalledWith(spec("points"))
        expect(open).not.toHaveBeenCalled()
    })

    it("filters from the window's query and writes each change back to it", () => {
        show({ query: "category=everyone&status=locked" })
        expect(screen.getByRole("button", { name: /^Everyone/ })).toHaveAttribute("aria-pressed", "true")
        expect(screen.getByRole("button", { name: "Locked" })).toHaveAttribute("aria-pressed", "true")
        // On mainnet the locked Everyone quests are the three whose realm is not published there.
        expect(screen.getByRole("heading", { level: 2, name: `3 of ${LIVE} quests` })).toBeInTheDocument()
        expect(screen.getAllByRole("button", { name: / \+\d+ XP/ }).map((b) => b.querySelector("b")!.textContent)).toEqual(["DAO Member", "Applicant", "Token Minter"])

        fireEvent.click(screen.getByRole("button", { name: /^Developers/ }))
        expect(open).toHaveBeenLastCalledWith(spec(null, "category=developer&status=locked"))
        fireEvent.click(screen.getByRole("button", { name: "Any state" }))
        expect(open).toHaveBeenLastCalledWith(spec(null, "category=everyone"))
        fireEvent.click(screen.getByRole("button", { name: "Expert" }))
        expect(open).toHaveBeenLastCalledWith(spec(null, "category=everyone&difficulty=expert&status=locked"))
        fireEvent.change(screen.getByRole("searchbox", { name: "Search quests" }), { target: { value: " token " } })
        fireEvent.click(screen.getByRole("button", { name: "Search" }))
        expect(open).toHaveBeenLastCalledWith(spec(null, "category=everyone&status=locked&q=token"))
        expect(push).not.toHaveBeenCalled()
    })

    it("filters by difficulty, as the classic hub does", () => {
        const expert = getLiveQuests().filter((q) => q.difficulty === "expert")
        show({ query: "difficulty=expert" })
        expect(screen.getByRole("button", { name: "Expert" })).toHaveAttribute("aria-pressed", "true")
        expect(screen.getAllByRole("button", { name: / \+\d+ XP/ }).map((b) => b.querySelector("b")!.textContent)).toEqual(expert.map((q) => q.title))
        expect(expert.length).toBeGreaterThan(0)
        expect(expert.length).toBeLessThan(LIVE)
    })

    it("searches titles, descriptions and ids, and clears every filter from the empty state", () => {
        const { rerender } = show({ query: "q=namespace" })
        expect(screen.getByRole("searchbox", { name: "Search quests" })).toHaveValue("namespace")
        expect(screen.getAllByRole("button", { name: / \+\d+ XP/ }).map((b) => b.querySelector("b")!.textContent)).toEqual(["First Package", "First Realm"])

        rerender(view({ query: "category=champion&q=nothing-matches-this" }))
        expect(screen.getByRole("searchbox", { name: "Search quests" })).toHaveValue("nothing-matches-this")
        expect(screen.getByText("No quests match these filters.")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Clear filters" }))
        // An empty query, not an absent one: the shell keeps the old query for a spec without one.
        expect(open).toHaveBeenLastCalledWith(spec(null, ""))
        expect(open.mock.calls.at(-1)![0].target).toHaveProperty("query", "")
    })
})

describe("Quests window: the other sections stay the classic pages", () => {
    it.each(["leaderboard", "points", "quest-admin", "deploy-hello-pkg", "no/such/page"])("hands %s to the fallback and reads nothing", (section) => {
        show({ section, session: member })
        expect(screen.getByText("classic page")).toBeInTheDocument()
        expect(screen.queryByRole("heading", { name: "Quests" })).not.toBeInTheDocument()
        expect(mocks.fetchUserQuests).not.toHaveBeenCalled()
    })

    it("lands on the heading when the window comes back from a quest's page", () => {
        const { rerender } = show({ section: "deploy-hello-pkg" })
        rerender(view())
        expect(screen.getByRole("heading", { level: 1, name: "Quests" })).toHaveFocus()
    })

    it("leaves focus alone when the window opens on the hub", () => {
        show()
        expect(screen.getByRole("heading", { level: 1, name: "Quests" })).not.toHaveFocus()
    })
})

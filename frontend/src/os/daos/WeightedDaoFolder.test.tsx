import { fireEvent, screen } from "@testing-library/react"
import { QueryClient } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithProviders } from "../../test/test-utils"
import type { OsSession } from "../shell/useOsSession"
import type { OsWindow } from "../shell/windows"

// The page a window shows is stubbed to what it was asked to show, and with which wallet context.
const classicPage = vi.fn((props: { network: string; page: string }) => <div data-testid="page">{props.network}/{props.page}</div>)
vi.mock("../page/ClassicPage", () => ({ ClassicPage: (props: { network: string; page: string }) => classicPage(props) }))
vi.mock("../../lib/config", async original => ({
    ...(await original<typeof import("../../lib/config")>()),
    isFeedEnabled: vi.fn(() => false),
}))
vi.mock("./useOsDao", async original => ({
    ...(await original<typeof import("./useOsDao")>()),
    useDaoConfig: vi.fn(() => ({ data: null, isPending: false, isError: false })),
    useDaoProposals: vi.fn(() => ({ data: [], isPending: false, isError: false })),
    useDaoMembers: vi.fn(() => ({ data: [], isPending: false, isError: false })),
}))
vi.mock("../../hooks/useDaoKind", async original => ({ ...(await original<typeof import("../../hooks/useDaoKind")>()), useDaoKind: vi.fn() }))
vi.mock("./ProposeWizard", () => ({ ProposeWizard: ({ dao }: { dao: string }) => <div>wizard for {dao}</div> }))
const { WindowBody } = await import("../shell/WindowFrame")
// The folder is a lazy chunk of the window frame: loaded here, so a test never waits on its import.
await import("./DaoWindows")
const { useDaoKind } = await import("../../hooks/useDaoKind")
const { useDaoConfig, useDaoMembers, useDaoProposals } = await import("./useOsDao")

const session = { status: "guest", network: { key: "mainnet" }, layout: { balance: "0" }, openConnect: vi.fn() } as unknown as OsSession
const open = vi.fn()
const windowFor = (key: string, title: string, target: OsWindow["target"]): OsWindow => ({ id: "w1", key, title, app: "daos", x: 0, y: 0, width: 560, height: 420, z: 1, min: false, max: false, target })
const showWindow = (win: OsWindow) => renderWithProviders(<WindowBody win={win} session={session} open={open} openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} active />)
const show = (name: string, section: "overview" | "members" = "overview") => showWindow(windowFor(`dao:${name}`, name, { kind: "dao", name, section }))
const showProposal = (dao: string, n: number) => showWindow(windowFor(`prop:${dao}:${n}`, `${dao} · Proposal #${n}`, { kind: "proposal", dao, n }))
const showNewProposal = (dao: string) => showWindow(windowFor(`flow:prop:${dao}`, `New proposal · ${dao}`, { kind: "new-proposal", dao }))
const kindState = (state: { kind: string | null; loading?: boolean; error?: string | null }) =>
    vi.mocked(useDaoKind).mockReturnValue({ loading: false, error: null, capabilities: { propose: [] }, ...state } as unknown as ReturnType<typeof useDaoKind>)
const kindIs = (kind: string) => kindState({ kind })
const MEMBA_DAO = "gno.land/r/samcrew/memba_dao"

beforeEach(() => { vi.clearAllMocks() })

describe("a weighted DAO's folder window", () => {
    it("shows the weighted workspace inside the window, on the OS session, with no link out of Memba OS", async () => {
        kindIs("weighted")
        show("memba_dao")
        expect(await screen.findByTestId("page")).toHaveTextContent("mainnet/weighted-dao/gno.land/r/samcrew/memba_dao")
        expect(classicPage).toHaveBeenLastCalledWith(expect.objectContaining({ layout: session.layout, active: true }))
        expect(screen.queryByRole("link")).toBeNull()
        // One workspace, not the four sections of the other DAO kinds.
        expect(screen.queryByRole("tablist")).toBeNull()
        // Nothing of a weighted DAO is read through the equal-headcount loaders.
        expect(useDaoConfig).toHaveBeenLastCalledWith(MEMBA_DAO, false)
        expect(useDaoProposals).toHaveBeenLastCalledWith(MEMBA_DAO, false)
    })

    it("reads no member list through those loaders either, on the members address", async () => {
        kindIs("weighted")
        show("memba_dao", "members")
        await screen.findByTestId("page")
        expect(useDaoMembers).toHaveBeenLastCalledWith(MEMBA_DAO, undefined, false)
    })

    it("keeps the community applications of the Memba DAO under its workspace", async () => {
        kindIs("weighted")
        show("memba_dao")
        await screen.findByTestId("page")
        expect(screen.getByText(/#join posts are Feed posts/)).toBeInTheDocument()
    })

    it("shows another weighted DAO without the Memba DAO's community applications", async () => {
        kindIs("weighted")
        show("samcrew.memba_dao_v2")
        expect(await screen.findByTestId("page")).toHaveTextContent("mainnet/weighted-dao/gno.land/r/samcrew/memba_dao_v2")
        expect(screen.queryByText(/#join posts/)).toBeNull()
    })

    it("leaves the other DAO kinds on their four sections and their own loaders", async () => {
        kindIs("memba-v2")
        show("samcrew.team")
        expect(await screen.findByRole("tablist", { name: "DAO sections" })).toBeInTheDocument()
        expect(classicPage).not.toHaveBeenCalled()
        expect(useDaoConfig).toHaveBeenLastCalledWith("gno.land/r/samcrew/team", true)
    })
})

describe("a DAO folder before its contract is known", () => {
    it("shows no sections and reads nothing while the contract is being identified", async () => {
        kindState({ kind: null, loading: true })
        show("memba_dao")
        expect(await screen.findByText("Loading the DAO contract…")).toBeInTheDocument()
        expect(screen.queryByRole("tablist")).toBeNull()
        expect(useDaoConfig).toHaveBeenLastCalledWith(MEMBA_DAO, false)
    })

    it("says the contract could not be identified, retries that read, and never claims the DAO is absent", async () => {
        const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries")
        kindState({ kind: null, error: "RPC unavailable" })
        show("memba_dao")
        expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this DAO's contract.")
        expect(screen.queryByText(/No DAO answers/)).toBeNull()
        expect(screen.queryByRole("tablist")).toBeNull()
        expect(useDaoConfig).toHaveBeenLastCalledWith(MEMBA_DAO, false)
        // The #join posts do not depend on the DAO read.
        expect(screen.getByText(/#join posts are Feed posts/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Try again" }))
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ["dao", "kind", "gnoland-1", MEMBA_DAO], exact: true })
        invalidate.mockRestore()
    })
})

describe("the proposal windows of a DAO", () => {
    it("send a weighted DAO's proposal address to its DAO window, reading nothing through the other kinds' loaders", async () => {
        kindIs("weighted")
        showProposal("memba_dao", 12)
        expect(await screen.findByText("This DAO votes by points")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Open memba_dao" }))
        expect(open).toHaveBeenCalledWith(expect.objectContaining({ key: "dao:memba_dao", target: { kind: "dao", name: "memba_dao", section: "overview" } }))
        expect(useDaoConfig).not.toHaveBeenCalled()
        expect(useDaoMembers).not.toHaveBeenCalled()
    })

    it("send a weighted DAO's new-proposal address there too, without mounting the wizard", async () => {
        kindIs("weighted")
        showNewProposal("memba_dao")
        expect(await screen.findByText("This DAO votes by points")).toBeInTheDocument()
        expect(screen.queryByText(/wizard for/)).toBeNull()
        expect(useDaoConfig).not.toHaveBeenCalled()
    })

    it("read nothing before the contract is known, and retry the contract read when it fails", async () => {
        kindState({ kind: null, loading: true })
        showProposal("memba_dao", 12)
        expect(await screen.findByText("Loading proposal #12…")).toBeInTheDocument()
        showNewProposal("memba_dao")
        expect(await screen.findByText("Loading the DAO contract…")).toBeInTheDocument()
        expect(screen.queryByText(/wizard for/)).toBeNull()
        expect(useDaoConfig).not.toHaveBeenCalled()
        const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries")
        kindState({ kind: null, error: "RPC unavailable" })
        showProposal("memba_dao", 12)
        fireEvent.click((await screen.findAllByRole("button", { name: "Try again" }))[0])
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ["dao", "kind", "gnoland-1", MEMBA_DAO], exact: true })
        invalidate.mockRestore()
    })

    it("open the wizard for the DAO kinds it serves", async () => {
        kindIs("memba-v2")
        showNewProposal("samcrew.team")
        expect(await screen.findByText("wizard for samcrew.team")).toBeInTheDocument()
    })
})

import { fireEvent, render as renderBare, screen } from "@testing-library/react"
import type { ReactElement } from "react"
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import type { NativeViewProps } from "../native/types"
import type { OsSession } from "./useOsSession"
import { appSpec, type OsWindow } from "./windows"
import { WindowBody, WindowFrame, type FrameActions } from "./WindowFrame"

// A native view that only shows what Body hands it: whatever Body would have drawn
// without a native view (for a guest on a wallet page, that must be the Connect tile),
// whether its window is in front, and the two ways to go somewhere.
vi.mock("../native/registry", () => {
    const Native = ({ fallback, active, push }: NativeViewProps) => (
        <div data-testid="native">
            {fallback}
            <span>{active ? "in front" : "behind"}</span>
            <button type="button" onClick={() => push(appSpec("profile", "edit"))}>Push edit</button>
            <button type="button" onClick={() => push(appSpec("profile"))}>Push the view shown</button>
            <button type="button" onClick={() => push(appSpec("profile", null, "x=1&tab=a%20b"))}>Push the same query, written differently</button>
            <button type="button" onClick={() => push(appSpec("meet", "abc-defg-hij"))}>Push a room</button>
        </div>
    )
    return { nativeView: (app: string) => (app === "profile" || app === "meet" ? Native : undefined) }
})
vi.mock("../page/ClassicPage", () => ({ ClassicPage: () => <div>classic profile page</div> }))

const session = {
    status: "guest",
    network: { key: "gnoland-1" },
    layout: {},
    openConnect: vi.fn(),
} as unknown as OsSession

/** Where the router is, how it got there, and a Back button. */
function Address() {
    const at = useLocation()
    const how = useNavigationType()
    const navigate = useNavigate()
    return <><output>{at.pathname + at.search} {how}</output><button type="button" onClick={() => navigate(-1)}>Back</button></>
}
const render = (ui: ReactElement) => renderBare(<MemoryRouter initialEntries={["/os", "/os/profile"]}>{ui}<Address /></MemoryRouter>)

const win: OsWindow = {
    id: "w1", key: "app:profile", title: "Profile", app: "profile",
    x: 0, y: 0, width: 600, height: 400, z: 1, min: false, max: false,
    target: { kind: "app", app: "profile", section: null },
}

describe("WindowBody with a native view", () => {
    it("hands a guest the Connect tile, never the wallet-only classic page", async () => {
        render(<WindowBody win={win} session={session} open={vi.fn()} openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} />)
        const native = await screen.findByTestId("native")
        expect(native).toHaveTextContent("Connect a wallet to use Profile.")
        expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument()
        expect(screen.queryByText("classic profile page")).not.toBeInTheDocument()
    })

    it("hands a member the classic page", async () => {
        const member = { ...session, status: "member" } as unknown as OsSession
        render(<WindowBody win={win} session={member} open={vi.fn()} openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} />)
        expect(await screen.findByText("classic profile page")).toBeInTheDocument()
        expect(screen.getByTestId("native")).toContainElement(screen.getByText("classic profile page"))
        expect(screen.queryByText("Connect a wallet to use Profile.")).not.toBeInTheDocument()
    })

    it("push adds exactly one history entry, and none for the view already shown", async () => {
        render(<WindowBody win={win} session={session} open={vi.fn()} openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} />)
        await screen.findByTestId("native")
        const address = screen.getByRole("status")
        expect(address).toHaveTextContent("/os/profile POP")
        fireEvent.click(screen.getByRole("button", { name: "Push the view shown" }))
        expect(address).toHaveTextContent("/os/profile POP")
        fireEvent.click(screen.getByRole("button", { name: "Push edit" }))
        expect(address).toHaveTextContent("/os/profile/edit PUSH")
        // One entry: one Back returns to the view it left, the next to where the test started.
        fireEvent.click(screen.getByRole("button", { name: "Back" }))
        expect(address).toHaveTextContent("/os/profile POP")
        fireEvent.click(screen.getByRole("button", { name: "Back" }))
        expect(address).toHaveTextContent("/os POP")
    })

    it("takes a query written in another order or encoding for the view already shown", async () => {
        const held: OsWindow = { ...win, target: { kind: "app", app: "profile", section: null, query: "tab=a+b&x=1" } }
        const member = { ...session, status: "member" } as unknown as OsSession
        renderBare(<MemoryRouter initialEntries={["/os/profile?tab=a+b&x=1"]}><WindowBody win={held} session={member} open={vi.fn()} openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} /><Address /></MemoryRouter>)
        await screen.findByTestId("native")
        fireEvent.click(screen.getByRole("button", { name: "Push the same query, written differently" }))
        expect(screen.getByRole("status")).toHaveTextContent("/os/profile?tab=a+b&x=1 POP")
        // The page without its query is another view.
        fireEvent.click(screen.getByRole("button", { name: "Push the view shown" }))
        expect(screen.getByRole("status")).toHaveTextContent("/os/profile PUSH")
    })

    it("shows a target whose address is the window's own (a meeting room) without a history entry", async () => {
        const lobby: OsWindow = { ...win, key: "app:meet", title: "Meet", app: "meet", target: { kind: "app", app: "meet", section: null } }
        const open = vi.fn()
        renderBare(<MemoryRouter initialEntries={["/os/meet"]}><WindowBody win={lobby} session={session} open={open} openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} /><Address /></MemoryRouter>)
        await screen.findByTestId("native")
        fireEvent.click(screen.getByRole("button", { name: "Push a room" }))
        expect(open).toHaveBeenCalledTimes(1)
        expect(open.mock.calls[0][0].target).toMatchObject({ app: "meet", section: "abc-defg-hij" })
        expect(screen.getByRole("status")).toHaveTextContent("/os/meet POP")
    })

    it("tells the view whether its window is the front one", async () => {
        const frame = { focus: vi.fn(), close: vi.fn(), minimise: vi.fn(), toggleMax: vi.fn(), move: vi.fn(), resize: vi.fn(), retarget: vi.fn() } satisfies FrameActions
        const at = (active: boolean) => (
            <MemoryRouter><WindowFrame win={win} active={active} desk={{ w: 1200, h: 800 }} frame={frame} session={session} open={vi.fn()} openApp={vi.fn()} toast={vi.fn()} /></MemoryRouter>
        )
        const view = renderBare(at(true))
        expect(await screen.findByText("in front")).toBeInTheDocument()
        view.rerender(at(false))
        expect(screen.getByText("behind")).toBeInTheDocument()
        view.rerender(at(true))
        expect(screen.getByText("in front")).toBeInTheDocument()
    })
})

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { StrictMode } from "react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import type { ArcadeLaunchIntent } from "../../games/arcade/LaunchContext"
import type { OsSession } from "./useOsSession"
import { appSpec, type OsWindow } from "./windows"
import { WindowBody, WindowFrame, type FrameActions } from "./WindowFrame"

vi.mock("../native/registry", () => ({ nativeView: () => undefined }))
// A route consumer fixture checks the bridge and mount lifetime, not B's engine.
vi.mock("../page/ClassicPage", async () => {
    const { useEffect, useState } = await import("react")
    const { useArcadeLaunchIntent } = await import("../../games/arcade/LaunchContext")
    return { ClassicPage: function Consumer() {
        const bridge = useArcadeLaunchIntent()
        const [score, setScore] = useState(0)
        useEffect(() => { if (bridge.launch) bridge.onLaunchConsumed?.(bridge.launch.id) }, [bridge])
        return <><p>intent: {bridge.launch?.id ?? "none"}</p><button onClick={() => setScore((s) => s + 1)}>score {score}</button></>
    } }
})

const session = { status: "guest", network: { key: "mainnet", family: "gno" }, layout: {}, openConnect: vi.fn() } as unknown as OsSession
const win: OsWindow = { ...appSpec("arcade", "space-invaders"), id: "w1", x: 10, y: 10, z: 1, min: false, max: true }
const launch: ArcadeLaunchIntent = { id: "play:1", game: "space-invaders", mode: "free" }
const actions = { session, open: vi.fn(), openApp: vi.fn(), close: vi.fn(), toast: vi.fn() }
const frame: FrameActions = { focus: vi.fn(), close: vi.fn(), minimise: vi.fn(), toggleMax: vi.fn(), move: vi.fn(), resize: vi.fn(), retarget: vi.fn() }

describe("Arcade WindowBody bridge", () => {
    it("passes and acknowledges a command only while active without remounting the page", async () => {
        const consumed = vi.fn()
        const at = (active: boolean, intent = launch) => <StrictMode><MemoryRouter><WindowBody win={win} {...actions} active={active} launch={intent} onLaunchConsumed={consumed} /></MemoryRouter></StrictMode>
        const view = render(at(false))
        expect(await screen.findByText("intent: none")).toBeInTheDocument()
        expect(consumed).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", { name: "score 0" }))
        view.rerender(at(true))
        await waitFor(() => expect(consumed).toHaveBeenCalledWith("play:1"))
        expect(screen.getByRole("button", { name: "score 1" })).toBeInTheDocument()
        view.rerender(at(false))
        expect(screen.getByText("intent: none")).toBeInTheDocument()
        view.rerender(at(true, { ...launch, id: "play:2" }))
        expect(screen.getByRole("button", { name: "score 1" })).toBeInTheDocument()
        await waitFor(() => expect(consumed).toHaveBeenCalledWith("play:2"))
    })

    it("offers a separate return action and keeps Close unchanged", async () => {
        const back = vi.fn()
        render(<MemoryRouter><WindowFrame {...actions} win={win} active desk={{ w: 1200, h: 800 }} frame={frame} returnToArcade={back} /></MemoryRouter>)
        await screen.findByText("intent: none")
        fireEvent.click(screen.getByRole("button", { name: "← Arcade" }))
        expect(back).toHaveBeenCalledOnce()
        expect(frame.close).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", { name: "Close Space Invaders · Arcade" }))
        expect(frame.close).toHaveBeenCalledWith(win.id)
    })

    it("never adds the host return action to Connect 4", async () => {
        const c4 = { ...win, ...appSpec("arcade", "connect4") }
        render(<MemoryRouter><WindowFrame {...actions} win={c4} active desk={{ w: 1200, h: 800 }} frame={frame} returnToArcade={vi.fn()} /></MemoryRouter>)
        await screen.findByText("intent: none")
        expect(screen.queryByRole("button", { name: "← Arcade" })).not.toBeInTheDocument()
    })

    it("does not steal focus from a modal when the frame becomes active", async () => {
        const at = (active: boolean) => <MemoryRouter><div role="dialog" aria-modal="true"><button>Modal action</button></div><WindowFrame {...actions} win={win} active={active} desk={{ w: 1200, h: 800 }} frame={frame} /></MemoryRouter>
        const view = render(at(false))
        await screen.findByText("intent: none")
        screen.getByRole("button", { name: "Modal action" }).focus()
        view.rerender(at(true))
        expect(screen.getByRole("button", { name: "Modal action" })).toHaveFocus()
    })
})

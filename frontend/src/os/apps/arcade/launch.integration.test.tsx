import { act, fireEvent, render, screen } from "@testing-library/react"
import { StrictMode } from "react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WindowBody } from "../../shell/WindowFrame"
import { appSpec, EMPTY_WINDOWS, useWindows } from "../../shell/windows"
import type { OsSession } from "../../shell/useOsSession"
import { useArcadeLaunch } from "./useArcadeLaunch"

const advanceSpy = vi.hoisted(() => vi.fn())
vi.mock("../../../games/space-invaders/render/draw", () => ({ draw: vi.fn() }))
vi.mock("../../../games/space-invaders/hooks/useGameLoop", async (original) => {
    const actual = await original<typeof import("../../../games/space-invaders/hooks/useGameLoop")>()
    return { ...actual, advanceWithEvents: (...args: Parameters<typeof actual.advanceWithEvents>) => { advanceSpy(...args); return actual.advanceWithEvents(...args) } }
})
vi.mock("../../native/registry", () => ({ nativeView: () => undefined }))
// Keep the real ClassicPage router/providers with only the route under test.
vi.mock("../../../routes/networkRoutes", async () => {
    const { Route } = await import("react-router-dom")
    const { default: SpaceInvadersGame } = await import("../../../pages/SpaceInvadersGame")
    return { networkRouteChildren: () => <Route path="game/space-invaders" element={<SpaceInvadersGame />} /> }
})
const desk = () => ({ w: 1400, h: 900 })
const session = { status: "guest", network: { key: "mainnet", family: "gno" }, layout: {}, openConnect: vi.fn() } as unknown as OsSession
function Host({ blocked = false }: { blocked?: boolean }) {
    const windows = useWindows(() => EMPTY_WINDOWS)
    const host = useArcadeLaunch({ wins: windows.wins, scope: "mainnet:guest", blocked, dispatch: windows.dispatch, desk })
    const game = windows.wins.find((w) => w.key === "game:space-invaders")
    return <>
        <button onClick={() => host.play(appSpec("arcade", "space-invaders"))}>Store Play</button>
        {game && <><button onClick={() => host.returnToArcade(game.id)}>Return to Arcade</button>
            <p>pending {host.launchFor(game)?.id ?? "none"}</p>
            <div hidden={game.min}><WindowBody win={game} session={session} open={vi.fn()} openApp={vi.fn()} close={() => windows.close(game.id)} toast={vi.fn()}
                active={!blocked && !game.min && windows.front?.id === game.id} launch={host.launchFor(game)} onLaunchConsumed={(id) => host.consume(game.id, id)} /></div></>}
    </>
}
let callbacks: Map<number, FrameRequestCallback>, sequence: number
const frame = (time: number) => act(() => { const current = [...callbacks.values()]; callbacks.clear(); current.forEach((cb) => cb(time)) })
beforeEach(() => {
    callbacks = new Map(); sequence = 0; advanceSpy.mockClear(); localStorage.clear()
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { callbacks.set(++sequence, cb); return sequence })
    vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id))
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D)
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 320, bottom: 400, width: 320, height: 400, toJSON: () => ({}) })
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("Arcade host with the approved Space Invaders consumer", () => {
    it("starts from Play, clears the ACK, and preserves the run and pause across return/reopen", async () => {
        render(<StrictMode><MemoryRouter><Host /></MemoryRouter></StrictMode>)
        fireEvent.click(screen.getByRole("button", { name: "Store Play" }))
        await screen.findByRole("group", { name: /game surface/i })
        frame(0); frame(25)
        expect(screen.getByText("pending none")).toBeInTheDocument()
        expect(advanceSpy).toHaveBeenCalledTimes(1)
        expect(advanceSpy.mock.calls[0][0]).toMatchObject({ tick: 0, phase: "ready" })
        expect(screen.getByRole("group", { name: /game surface/i })).toHaveFocus()
        fireEvent.click(screen.getByRole("button", { name: "Return to Arcade" }))
        frame(50)
        expect(advanceSpy).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByRole("button", { name: "Store Play" }))
        frame(75); frame(100)
        expect(screen.getByRole("heading", { name: /relay paused/i })).toBeInTheDocument()
        expect(screen.getByText("pending none")).toBeInTheDocument()
        expect(advanceSpy).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByRole("button", { name: "Resume defense", exact: true }))
        frame(125)
        expect(advanceSpy.mock.calls.at(-1)?.[0].tick).toBeGreaterThan(0)
    })
    it("does not consume a queued frame after a modal blocks the window", async () => {
        const at = (blocked: boolean) => <MemoryRouter><Host blocked={blocked} /></MemoryRouter>
        const view = render(at(false))
        fireEvent.click(screen.getByRole("button", { name: "Store Play" }))
        await screen.findByRole("group", { name: /game surface/i })
        const stale = [...callbacks.values()][0]
        view.rerender(at(true))
        act(() => stale(0))
        expect(advanceSpy).not.toHaveBeenCalled()
        view.rerender(at(false)); frame(25); frame(50)
        expect(advanceSpy).toHaveBeenCalledTimes(1)
        expect(screen.getByText("pending none")).toBeInTheDocument()
    })
})

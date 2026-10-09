/** Preserve a live run while inspecting an archived result at the same account.
 * Real engine, host intent, WindowBody/ClassicPage and saved-run panels on both surfaces.
 */
import { StrictMode } from "react"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { WindowBody } from "../../shell/WindowFrame"
import { PhoneShell } from "../../phone/PhoneShell"
import { appSpec, EMPTY_WINDOWS, useWindows, type WindowSpec } from "../../shell/windows"
import type { OsSession } from "../../shell/useOsSession"
import { useArcadeLaunch } from "./useArcadeLaunch"
import { FreePlayRuntimeProvider } from "../../../games/arcade/freeplay/FreePlayRuntimeProvider"
import type { FreePlayRuntime } from "../../../games/arcade/freeplay/FreePlayRuntimeContext"
import { createFreePlaySnapshot, listFreePlaySnapshots, loadFreePlaySnapshot, saveFreePlaySnapshot } from "../../../games/arcade/freeplay/snapshot"
import { createFreePlayClient } from "../../../lib/arcadeFreePlay"
import type { SpaceInvadersFreePlayInput } from "../../../games/space-invaders/lib/freePlayCodec"
import vectors from "../../../games/space-invaders/lib/testdata/freeplay_vectors.json"

const probe = vi.hoisted(() => ({ advance: vi.fn(), ack: vi.fn() }))
vi.mock("../../../games/space-invaders/render/draw", () => ({ draw: vi.fn() }))
vi.mock("../../../games/space-invaders/lib/audio", () => ({ createAudioEngine: () => ({ muted: true, droning: false, unlock: vi.fn(), play: vi.fn(), setDrone: vi.fn(), setMuted: vi.fn(), dispose: vi.fn() }) }))
vi.mock("../../../games/space-invaders/hooks/useGameLoop", async original => {
    const actual = await original<typeof import("../../../games/space-invaders/hooks/useGameLoop")>()
    return { ...actual, advanceWithEvents: (...args: Parameters<typeof actual.advanceWithEvents>) => {
        const result = actual.advanceWithEvents(...args)
        probe.advance(structuredClone(args[0]), structuredClone(result.state))
        return result
    } }
})
// Keep actual Arcade native view and classic fallback; omit unrelated app imports.
vi.mock("../../native/registry", async () => {
    const { default: ArcadeWindow } = await import("./native")
    return { nativeView: (app: string) => app === "arcade" ? ArcadeWindow : undefined }
})
vi.mock("../../../routes/networkRoutes", async () => {
    const { Route } = await import("react-router-dom")
    const { default: SpaceInvadersGame } = await import("../../../pages/SpaceInvadersGame")
    return { networkRouteChildren: () => <Route path="game/space-invaders" element={<SpaceInvadersGame />} /> }
})
// Review RPC and unrelated phone chrome are not part of the recovery contract.
vi.mock("../../kit/storefront", async original => ({ ...(await original<typeof import("../../kit/storefront")>()), useReviewSummaries: () => new Map() }))
vi.mock("../../shell/clock", () => ({ useClock: () => ["12:00"] }))
vi.mock("../../sign/signerContext", () => ({ useSigner: () => ({ notices: [], pending: [], unread: 0, markRead: vi.fn() }) }))
vi.mock("../../multisig/useOsMultisig", () => ({ useAwaiting: () => ({ mine: 0, shared: 0 }), notificationsLabel: () => "Notifications" }))

const desk = () => ({ w: 1400, h: 900 })
const session = { status: "guest", address: "", network: { key: "mainnet", chainId: "gnoland-1", family: "gno", isTestnet: false }, layout: {}, openConnect: vi.fn() } as unknown as OsSession
const noop = () => {}
function Host({ surface, runtime }: { surface: "desktop" | "phone"; runtime: FreePlayRuntime }) {
    const windows = useWindows(() => EMPTY_WINDOWS)
    const host = useArcadeLaunch({ wins: windows.wins, scope: "mainnet:guest", blocked: false, dispatch: windows.dispatch, desk })
    const game = windows.wins.find(win => win.key === "game:space-invaders")
    const open = (spec: WindowSpec) => host.dispatch({ type: "open", spec, desk: desk() })
    const acknowledge = (windowId: string, id: string) => { probe.ack(windowId, id); host.consume(windowId, id) }
    return <FreePlayRuntimeProvider value={runtime}>
        <button onClick={() => host.play(appSpec("arcade", "space-invaders"))}>Store Play</button>
        <button onClick={() => open(appSpec("arcade", "runs"))}>Open Your runs window</button>
        <button disabled={!game} onClick={() => game && windows.focus(game.id)}>Focus existing game</button>
        <output data-testid="launch-pending">{game ? host.launchFor(game)?.id ?? "none" : "no game"}</output>
        <output data-testid="game-window-id">{game?.id ?? "none"}</output>
        {surface === "phone" ? <PhoneShell locked={false} session={session} front={windows.front} wins={windows.wins} items={[]}
            open={open} openApp={noop} openItem={noop} close={windows.close} home={windows.minimise} toast={noop} openSearch={noop}
            play={host.play} launchFor={host.launchFor} consumeLaunch={acknowledge} returnToArcade={host.returnToArcade} />
            : windows.wins.map(win => <div key={win.id} hidden={win.min} data-window-key={win.key}>
                <WindowBody win={win} session={session} open={open} openApp={noop} close={() => windows.close(win.id)} toast={noop}
                    active={!win.min && windows.front?.id === win.id} play={host.play} launch={host.launchFor(win)} onLaunchConsumed={id => acknowledge(win.id, id)} />
            </div>)}
    </FreePlayRuntimeProvider>
}

let frames: Map<number, FrameRequestCallback>, sequence: number
const frame = (time: number) => act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(cb => cb(time)) })
beforeEach(() => {
    frames = new Map(); sequence = 0; probe.advance.mockClear(); probe.ack.mockClear(); localStorage.clear()
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.set(++sequence, cb); return sequence })
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id))
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D)
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 320, bottom: 400, width: 320, height: 400, toJSON: () => ({}) })
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("Unexpected network request"))))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each(["desktop", "phone"] as const)("preserves the real active run through Your runs and archive viewing: %s", async surface => {
    const input = vectors.valid[0].input as SpaceInvadersFreePlayInput
    const archived = createFreePlaySnapshot(input)
    saveFreePlaySnapshot(localStorage, archived)
    const request = vi.fn(() => Promise.reject(new Error("No automatic Free play request allowed")))
    const token = vi.fn(), connect = vi.fn()
    const client = createFreePlayClient({ origin: "https://example.invalid", target: vectors.valid[0].target,
        auth: { identity: () => null, subscribe: () => noop, token }, fetch: request })
    const verify = vi.spyOn(client, "verify"), quote = vi.spyOn(client, "quote"), publish = vi.spyOn(client, "publish"), read = vi.spyOn(client, "read")
    const runtime: FreePlayRuntime = { games: { "space-invaders": { client, storage: localStorage, rules: input.rules, simVersion: input.simVersion, connect } } }
    const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const view = render(<StrictMode><QueryClientProvider client={query}><MemoryRouter><Host surface={surface} runtime={runtime} /></MemoryRouter></QueryClientProvider></StrictMode>)
    fireEvent.click(screen.getByRole("button", { name: "Store Play" }))
    await screen.findByRole("group", { name: /game surface/i })
    frame(0); frame(25); frame(50); frame(75)
    expect(probe.ack).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("launch-pending")).toHaveTextContent(/^none$/)
    expect(probe.advance).toHaveBeenCalled()
    expect(probe.advance.mock.calls[0][0]).toMatchObject({ tick: 0, phase: "ready" })
    const previous = probe.advance.mock.calls.at(-1)![1]
    expect(previous.tick).toBeGreaterThan(0)
    const count = probe.advance.mock.calls.length
    const canvas = view.container.querySelector("canvas")!
    expect(canvas).not.toBeNull()
    const gameRoot = canvas.closest<HTMLElement>(".si-root")!
    const windowId = screen.getByTestId("game-window-id").textContent
    const identity = localStorage.getItem("memba:space-invaders:active-free:v1")!
    expect(identity).not.toBeNull()
    expect(JSON.parse(identity).clientRunId).not.toBe(input.clientRunId)
    const assertPreserved = () => {
        expect(view.container.querySelectorAll("canvas")).toHaveLength(1)
        expect(view.container.querySelector("canvas")).toBe(canvas)
        expect(screen.getByTestId("game-window-id").textContent).toBe(windowId)
        expect(localStorage.getItem("memba:space-invaders:active-free:v1")).toBe(identity)
        expect(probe.advance).toHaveBeenCalledTimes(count)
        expect(probe.ack).toHaveBeenCalledTimes(1)
        expect(screen.getByTestId("launch-pending")).toHaveTextContent(/^none$/)
        expect(loadFreePlaySnapshot(localStorage, input.clientRunId)).toEqual(archived)
        expect(listFreePlaySnapshots(localStorage).total).toBe(1)
        expect(verify).not.toHaveBeenCalled(); expect(quote).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled()
        expect(request).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled()
    }
    fireEvent.click(screen.getByRole("button", { name: "Open Your runs window" }))
    await screen.findByRole("heading", { name: "Your runs" })
    frame(1000)
    assertPreserved()
    expect(within(gameRoot).getByText("Relay paused")).toBeInTheDocument()
    if (surface === "phone") expect(canvas.closest(".os-ph-game-slot")).toHaveAttribute("hidden")
    fireEvent.change(screen.getByRole("combobox", { name: "Game" }), { target: { value: "space-invaders" } })
    fireEvent.click(screen.getByRole("button", { name: `Open saved Space Invaders result ${input.clientRunId}` }))
    await screen.findByRole("region", { name: "Saved Free play result" })
    frame(2000)
    assertPreserved()
    expect(within(gameRoot).getByText("Relay paused")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Back to saved results" }))
    frame(3000)
    assertPreserved()
    fireEvent.click(screen.getByRole("button", { name: "Focus existing game" }))
    frame(4000); frame(4025)
    assertPreserved()
    expect(within(gameRoot).getByRole("heading", { name: "Relay paused" })).toBeVisible()
    if (surface === "phone") expect(canvas.closest(".os-ph-game-slot")).not.toHaveAttribute("hidden")
    fireEvent.click(within(gameRoot).getByRole("button", { name: "Resume defense" }))
    frame(4050); frame(4075)
    expect(probe.advance.mock.calls.length).toBeGreaterThan(count)
    expect(probe.advance.mock.calls[count][0]).toMatchObject({ seed: previous.seed, tick: previous.tick, score: previous.score, player: previous.player })
    expect(localStorage.getItem("memba:space-invaders:active-free:v1")).toBe(identity)
    expect(probe.ack).toHaveBeenCalledTimes(1)
    view.unmount(); query.clear()
})

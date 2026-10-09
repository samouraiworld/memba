import { act, renderHook } from "@testing-library/react"
import { StrictMode, type ReactNode } from "react"
import { describe, expect, it } from "vitest"
import { appSpec, EMPTY_WINDOWS, useWindows } from "../../shell/windows"
import { saveWindows, loadSavedTargets, urlForWindows, windowsStorageKey } from "../../shell/urlSync"
import { useArcadeLaunch } from "./useArcadeLaunch"

const desk = () => ({ w: 1400, h: 900 })
const space = appSpec("arcade", "space-invaders")
const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>
function setup() {
    return renderHook(({ scope, blocked }) => {
        const win = useWindows(() => EMPTY_WINDOWS)
        const launch = useArcadeLaunch({ wins: win.wins, scope, blocked, dispatch: win.dispatch, desk })
        return { win, ...launch }
    }, { initialProps: { scope: "mainnet:guest", blocked: false }, wrapper })
}

describe("Arcade launch transport", () => {
    it("coalesces synchronous double clicks, binds the created instance, and delivers Free play", () => {
        const { result } = setup()
        act(() => { result.current.play(space); result.current.play(space) })
        expect(result.current.win.wins).toHaveLength(1)
        const w = result.current.win.wins[0]
        const launch = result.current.launchFor(w)!
        expect(launch).toMatchObject({ game: "space-invaders", mode: "free" })
        expect(w.max).toBe(true)
        act(() => result.current.play(space))
        expect(result.current.launchFor(result.current.win.wins[0])).toEqual(launch)
        act(() => result.current.consume(w.id, launch.id))
        expect(result.current.launchFor(w)).toBeUndefined()
    })

    it("delivers a newer ID only after ACK and ignores late/wrong-instance acknowledgements", () => {
        const { result } = setup()
        act(() => result.current.play(space))
        const w = result.current.win.wins[0]
        const first = result.current.launchFor(w)!
        act(() => result.current.consume(w.id, first.id))
        act(() => result.current.play(space))
        const second = result.current.launchFor(w)!
        expect(second.id).not.toBe(first.id)
        act(() => { result.current.consume(w.id, first.id); result.current.consume("another-window", second.id) })
        expect(result.current.launchFor(w)).toEqual(second)
    })

    it("has no command on a normal open, Dock focus, or session restore", () => {
        const { result } = setup()
        act(() => result.current.win.dispatch({ type: "open", spec: space, desk: desk() }))
        const w = result.current.win.wins[0]
        act(() => result.current.win.minimise(w.id))
        act(() => result.current.win.focus(w.id))
        expect(result.current.launchFor(w)).toBeUndefined()
        act(() => result.current.dispatch({ type: "restore", wins: [w] }))
        expect(result.current.launchFor(w)).toBeUndefined()
    })

    it("cancels a pending launch when restoring even the same window ID", () => {
        const { result } = setup()
        act(() => result.current.play(space))
        const w = result.current.win.wins[0]
        expect(result.current.launchFor(w)).toBeDefined()
        act(() => result.current.dispatch({ type: "restore", wins: [{ ...w }] }))
        expect(result.current.launchFor(result.current.win.wins[0])).toBeUndefined()
    })

    it("never persists or puts the command in a URL", () => {
        const { result } = setup()
        act(() => result.current.play(space))
        const w = result.current.win.wins[0]
        const launch = result.current.launchFor(w)!
        saveWindows(result.current.win.wins, "d1-test")
        const saved = localStorage.getItem(windowsStorageKey("d1-test"))!
        expect(saved).not.toContain(launch.id)
        expect(saved).not.toContain("launch")
        expect(JSON.stringify(w)).not.toContain(launch.id)
        expect(urlForWindows([w])).toBe("/os/arcade/space-invaders")
        expect(loadSavedTargets("d1-test")[0].geom.max).toBe(true)
    })

    it("cancels a closed instance and does not replay on its replacement", () => {
        const { result } = setup()
        act(() => result.current.play(space))
        const w = result.current.win.wins[0]
        act(() => result.current.win.close(w.id))
        act(() => result.current.win.dispatch({ type: "open", spec: space, desk: desk() }))
        expect(result.current.win.wins[0].id).not.toBe(w.id)
        expect(result.current.launchFor(result.current.win.wins[0])).toBeUndefined()
    })

    it("drops commands on retarget and on reset before IDs can be reused", () => {
        const { result } = setup()
        act(() => result.current.play(space))
        const w = result.current.win.wins[0]
        act(() => result.current.win.dispatch({ type: "retarget", id: w.id, spec: appSpec("arcade", "barricade") }))
        expect(result.current.launchFor(result.current.win.wins[0])).toBeUndefined()
        act(() => result.current.play(space))
        act(() => result.current.dispatch({ type: "restore", wins: [] }))
        act(() => result.current.win.dispatch({ type: "open", spec: space, desk: desk() }))
        expect(result.current.launchFor(result.current.win.wins[0])).toBeUndefined()
    })

    it("drops commands on owner/network changes and rejects an old event callback", () => {
        const { result, rerender } = setup()
        const stalePlay = result.current.play
        act(() => result.current.play(space))
        rerender({ scope: "testnet:member:alice", blocked: false })
        expect(result.current.launchFor(result.current.win.wins[0])).toBeUndefined()
        act(() => stalePlay(space))
        expect(result.current.launchFor(result.current.win.wins[0])).toBeUndefined()
    })

    it("defers delivery while a modal is active and rejects actions during it", () => {
        const { result, rerender } = setup()
        act(() => result.current.play(space))
        const w = result.current.win.wins[0]
        const launch = result.current.launchFor(w)
        const stalePlay = result.current.play
        rerender({ scope: "mainnet:guest", blocked: true })
        expect(result.current.launchFor(w)).toBeUndefined()
        act(() => { stalePlay(appSpec("arcade", "barricade")); result.current.returnToArcade(w.id) })
        expect(result.current.win.wins).toHaveLength(1)
        expect(result.current.win.wins[0].min).toBe(false)
        rerender({ scope: "mainnet:guest", blocked: false })
        expect(result.current.launchFor(w)).toEqual(launch)
    })

    it("returns to the catalogue without closing the run; Play restores the same instance", () => {
        const { result } = setup()
        act(() => result.current.play(space))
        const w = result.current.win.wins[0]
        const launch = result.current.launchFor(w)!
        act(() => result.current.consume(w.id, launch.id))
        act(() => result.current.returnToArcade(w.id))
        expect(result.current.win.wins.find((x) => x.id === w.id)?.min).toBe(true)
        expect(result.current.win.front?.key).toBe("app:arcade")
        act(() => result.current.play(space))
        expect(result.current.win.front).toMatchObject({ id: w.id, min: false, max: true })
    })

    it("presents A/C without sending commands, and preserves Connect 4", () => {
        const { result } = setup()
        for (const section of ["game", "barricade", "connect4", "connect4/12"]) {
            act(() => result.current.play(appSpec("arcade", section)))
            const w = result.current.win.front!
            expect(result.current.launchFor(w)).toBeUndefined()
            expect(w.max).toBe(!section.startsWith("connect4"))
        }
        const c4 = result.current.win.front!
        act(() => result.current.returnToArcade(c4.id))
        expect(result.current.win.front?.id).toBe(c4.id)
    })
})

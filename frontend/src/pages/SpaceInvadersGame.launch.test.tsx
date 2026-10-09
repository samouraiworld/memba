import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ArcadeLaunchContext } from "../games/arcade/LaunchContext"
import SpaceInvadersGame from "./SpaceInvadersGame"

const game = vi.hoisted(() => vi.fn(() => null))
vi.mock("../games/space-invaders/SpaceInvaders", () => ({ default: game }))
const hostLaunch = { id: "host:1", game: "space-invaders" as const, mode: "free" as const }
beforeEach(() => game.mockClear())

describe("Space Invaders page launch bridge", () => {
    it("passes the host command and ACK to the game while preserving replay callback", () => {
        const ack = vi.fn(), replay = vi.fn()
        render(<ArcadeLaunchContext.Provider value={{ launch: hostLaunch, onLaunchConsumed: ack }}><SpaceInvadersGame onReplayReady={replay} /></ArcadeLaunchContext.Provider>)
        expect(game).toHaveBeenLastCalledWith(expect.objectContaining({ launch: hostLaunch, onLaunchConsumed: ack, onReplayReady: replay }), undefined)
    })
    it("prefers explicit launch and callbacks over the host", () => {
        const explicit = { ...hostLaunch, id: "explicit", mode: "daily" as const }, ack = vi.fn()
        render(<ArcadeLaunchContext.Provider value={{ launch: hostLaunch, onLaunchConsumed: vi.fn() }}><SpaceInvadersGame launch={explicit} onLaunchConsumed={ack} /></ArcadeLaunchContext.Provider>)
        expect(game).toHaveBeenLastCalledWith(expect.objectContaining({ launch: explicit, onLaunchConsumed: ack }), undefined)
    })
    it("does not acknowledge an explicit launch through an unrelated host callback", () => {
        render(<ArcadeLaunchContext.Provider value={{ launch: hostLaunch, onLaunchConsumed: vi.fn() }}><SpaceInvadersGame launch={{ ...hostLaunch, id: "explicit" }} /></ArcadeLaunchContext.Provider>)
        expect(game).toHaveBeenLastCalledWith(expect.objectContaining({ onLaunchConsumed: undefined }), undefined)
    })
    it("keeps classic navigation without an implicit launch", () => {
        render(<SpaceInvadersGame />)
        expect(game).toHaveBeenLastCalledWith(expect.objectContaining({ launch: undefined, onLaunchConsumed: undefined }), undefined)
    })
})

import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ArcadeLaunchIntent } from "../../games/arcade/LaunchContext"
import type { OsSession } from "../shell/useOsSession"
import { appSpec, type OsWindow } from "../shell/windows"
import { PhoneShell } from "./PhoneShell"

vi.mock("../shell/clock", () => ({ useClock: () => ["12:00"] }))
vi.mock("../sign/signerContext", () => ({ useSigner: () => ({ notices: [], pending: [], unread: 0, markRead: vi.fn() }) }))
vi.mock("../multisig/useOsMultisig", () => ({ useAwaiting: () => ({ mine: 0, shared: 0 }), notificationsLabel: () => "Notifications" }))
vi.mock("../shell/WindowFrame", async () => {
    const { useState } = await import("react")
    return { WindowBody: function Body({ active, launch, onLaunchConsumed }: { active: boolean; launch?: ArcadeLaunchIntent; onLaunchConsumed?: (id: string) => void }) {
        const [score, setScore] = useState(0)
        return <><p>{active ? "game active" : "game inactive"}</p><p>intent {launch?.id ?? "none"}</p>
            <button onClick={() => setScore(score + 1)}>score {score}</button><button onClick={() => launch && onLaunchConsumed?.(launch.id)}>ack</button></>
    } }
})

const session = { status: "guest", network: { key: "mainnet", chainId: "gnoland-1", family: "gno" }, layout: {}, openConnect: vi.fn() } as unknown as OsSession
const win: OsWindow = { ...appSpec("arcade", "space-invaders"), id: "w1", x: 10, y: 10, z: 1, min: false, max: true }
const launch: ArcadeLaunchIntent = { id: "play:1", game: "space-invaders", mode: "free" }
const base = { session, items: [], open: vi.fn(), openApp: vi.fn(), openItem: vi.fn(), close: vi.fn(), home: vi.fn(), toast: vi.fn(), openSearch: vi.fn() }

describe("Arcade phone sheet", () => {
    it("passes the command and ACK to the same mounted page through Home and return", () => {
        const back = vi.fn(), ack = vi.fn()
        const at = (front: OsWindow | null, locked = false) => <PhoneShell {...base} locked={locked} front={front} wins={[win]} launchFor={() => launch} consumeLaunch={ack} returnToArcade={back} />
        const view = render(at(win))
        fireEvent.click(screen.getByRole("button", { name: "score 0" }))
        fireEvent.click(screen.getByRole("button", { name: "ack" }))
        expect(ack).toHaveBeenCalledWith(win.id, launch.id)
        fireEvent.click(screen.getByRole("button", { name: "← Arcade" }))
        expect(back).toHaveBeenCalledWith(win.id)
        expect(base.close).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", { name: "‹ Home" }))
        expect(base.home).toHaveBeenCalledWith(win.id)
        view.rerender(at(null))
        expect(screen.getByText("game inactive").closest(".os-ph-game-slot")).toHaveAttribute("hidden")
        view.rerender(at(win, true))
        expect(screen.getByText("game inactive")).toBeInTheDocument()
        view.rerender(at(win))
        expect(screen.getByRole("button", { name: "score 1" })).toBeInTheDocument()
    })

    it("keeps Connect 4 without the Arcade host return action", () => {
        const c4 = { ...win, ...appSpec("arcade", "connect4") }
        render(<PhoneShell {...base} locked={false} front={c4} wins={[c4]} returnToArcade={vi.fn()} />)
        expect(screen.queryByRole("button", { name: "← Arcade" })).not.toBeInTheDocument()
    })
})

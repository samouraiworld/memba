import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import RadioStage from "./RadioStage"
import { loadNow } from "./client"
import { radioPlayer } from "./player"

vi.mock("./client", async original => ({
    ...await original<typeof import("./client")>(),
    loadStations: vi.fn(async () => [{ id: 0, name: "Main" }]),
    loadNow: vi.fn(async () => ({ schedule: { station: 0, now: 100, entries: [{ track: 1, start: 80, end: 140 }] }, track: { id: 1, title: "Evening light", artistName: "Artist", audio: "https://archive.org/song.mp3", cover: "", source: "https://archive.org/details/song", license: "CC BY", attribution: "Artist, CC BY" }, urls: ["https://archive.org/song.mp3"] })),
}))
class AudioStub {
    src = ""; duration = 300; volume = .65; currentTime = 0
    onplaying: (() => void) | null = null; onpause: (() => void) | null = null; onloadedmetadata: (() => void) | null = null
    play = vi.fn(async () => { this.onplaying?.() })
    pause() { this.onpause?.() }
    load() { this.onloadedmetadata?.() }
    removeAttribute() { this.src = "" }
}
let audio: AudioStub
beforeEach(() => { audio = new AudioStub(); vi.stubGlobal("Audio", class { constructor() { return audio } }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const props = () => ({ locked: false, visible: true, onHide: vi.fn(), onStop: vi.fn() })
const controls = () => fireEvent.click(screen.getByRole("button", { name: "Radio controls", exact: true }))

describe("Radio widget lifecycle", () => {
    it("does not autoplay, keeps audio while hidden, and pauses on lock", async () => {
        const p = props()
        const { rerender } = render(<RadioStage {...p} />)
        expect(audio.play).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", { name: "Play radio" }))
        await screen.findByText("Evening light")
        expect(radioPlayer.snapshot().playing).toBe(true)
        controls(); fireEvent.click(screen.getByRole("button", { name: "Hide widget" }))
        expect(p.onHide).toHaveBeenCalledOnce()
        rerender(<RadioStage {...p} visible={false} />)
        expect(screen.queryByRole("region", { name: "Radio player" })).toBeNull()
        expect(radioPlayer.snapshot().playing).toBe(true)
        rerender(<RadioStage {...p} />)
        expect(screen.getByRole("button", { name: "Pause radio" })).toBeVisible()
        expect(screen.queryByRole("region", { name: "Radio controls" })).toBeNull()
        rerender(<RadioStage {...p} locked />)
        expect(radioPlayer.snapshot().playing).toBe(false)
    })
    it("restores the chosen volume, returns focus on Escape and releases audio when stopped", async () => {
        const p = props()
        const { unmount, rerender } = render(<RadioStage {...p} />)
        controls()
        fireEvent.change(screen.getByRole("slider"), { target: { value: "0.23" } })
        fireEvent.click(screen.getByRole("button", { name: "Mute radio" }))
        expect(audio.volume).toBe(0)
        rerender(<RadioStage {...p} visible={false} />)
        rerender(<RadioStage {...p} />)
        controls()
        fireEvent.click(screen.getByRole("button", { name: "Unmute radio" }))
        expect(audio.volume).toBe(.23)
        fireEvent.keyDown(window, { key: "Escape" })
        expect(screen.queryByRole("region", { name: "Radio controls" })).toBeNull()
        expect(screen.getByRole("button", { name: "Radio controls", exact: true })).toHaveFocus()
        fireEvent.click(screen.getByRole("button", { name: "Play radio" }))
        await screen.findByText("Evening light")
        controls()
        expect(screen.getByText(/Artist, CC BY/)).toBeVisible()
        expect(screen.getByRole("link", { name: "Track source" })).toHaveAttribute("href", "https://archive.org/details/song")
        fireEvent.click(screen.getByRole("button", { name: "Stop radio" }))
        expect(p.onStop).toHaveBeenCalledOnce()
        unmount()
        expect(radioPlayer.snapshot().ready).toBe(false)
        expect(audio.src).toBe("")
    })
    it("offers retry after a failed read and keeps the full error in the popover", async () => {
        vi.mocked(loadNow).mockRejectedValueOnce(new Error("offline"))
        render(<RadioStage {...props()} />)
        fireEvent.click(screen.getByRole("button", { name: "Play radio" }))
        await screen.findByRole("button", { name: "Retry radio" })
        expect(screen.queryByRole("alert")).toBeNull()
        controls()
        expect(screen.getByRole("alert")).toHaveTextContent("Check your connection and try again")
        fireEvent.click(screen.getByRole("button", { name: "Retry radio" }))
        await waitFor(() => expect(radioPlayer.snapshot().playing).toBe(true))
        expect(screen.queryByRole("alert")).toBeNull()
    })
})

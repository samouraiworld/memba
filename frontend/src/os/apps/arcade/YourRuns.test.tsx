import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { FreePlayGame, FreePlayInput } from "../../../lib/arcadeFreePlay"
import { createFreePlaySnapshot, sanitizeSnapshot, saveFreePlaySnapshot } from "../../../games/arcade/freeplay/snapshot"
import vectors from "../../../games/arcade/freeplay/vectors.json"
import { YourRuns } from "./YourRuns"
function setup() {
    const data = new Map<string, string>()
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: vi.fn((key: string, value: string) => { data.set(key, value) }) }
    const save = (n: number, game: FreePlayGame = "block-party") => {
        const input = { ...vectors.runs[0].input, game, claimedScore: vectors.runs[0].score, clientRunId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` } as FreePlayInput
        saveFreePlaySnapshot(storage, createFreePlaySnapshot(input))
        return input.clientRunId
    }
    return { data, storage, save }
}
describe("Your runs local recovery", () => {
    it.each(["block-party", "space-invaders", "barricade"] as const)("opens the saved %s ID without writing", game => {
        const { storage, save } = setup()
        const id = save(1, game), open = vi.fn()
        storage.setItem.mockClear()
        render(<YourRuns storage={storage} onOpenSavedRun={open} />)
        fireEvent.change(screen.getByLabelText("Game"), { target: { value: game } })
        expect(screen.getByText("Saved locally · not rechecked")).toBeVisible()
        fireEvent.click(screen.getByRole("button", { name: /^Open saved/ }))
        expect(open).toHaveBeenCalledExactlyOnceWith({ game, clientRunId: id })
        expect(storage.setItem).not.toHaveBeenCalled()
    })
    it("does not present a stored confirmed receipt as freshly confirmed", () => {
        const { storage } = setup()
        const v = vectors.runs[0]
        const input = { ...v.input, claimedScore: v.score }
        const entry = { game: input.game, player: v.player, rules: input.rules, simVersion: input.simVersion, runID: v.runID, seed: input.seed, score: v.score, stateHash: v.stateHash, replayHash: v.replayHash }
        saveFreePlaySnapshot(storage, sanitizeSnapshot({ schemaVersion: 1, input, binding: { player: v.player, target: v.target }, result: { entry, payloadHash: v.payloadHash, status: "confirmed", receipt: { target: v.target, entry, height: 42, attester: v.player, schemaVersion: 2 } } }))
        render(<YourRuns storage={storage} onOpenSavedRun={vi.fn()} />)
        expect(screen.getByText("A saved receipt is available; its current status has not been checked.")).toBeVisible()
        expect(screen.queryByText(/confirmed/i)).not.toBeInTheDocument()
    })
    it("paginates games independently and resets after changing game", () => {
        const { storage, save } = setup()
        for (let i = 1; i <= 12; i++) save(i)
        save(30, "barricade")
        render(<YourRuns storage={storage} onOpenSavedRun={vi.fn()} />)
        expect(screen.getAllByRole("button", { name: /^Open saved/ })).toHaveLength(10)
        fireEvent.click(screen.getByRole("button", { name: "Next results" }))
        expect(screen.getAllByRole("button", { name: /^Open saved/ })).toHaveLength(2)
        fireEvent.change(screen.getByLabelText("Game"), { target: { value: "barricade" } })
        expect(screen.getByText("Page 1")).toBeVisible()
        expect(screen.getAllByRole("button", { name: /^Open saved/ })).toHaveLength(1)
    })
    it("distinguishes empty, corrupt entries and unavailable storage", () => {
        const { storage, data, save } = setup()
        const view = render(<YourRuns storage={storage} onOpenSavedRun={vi.fn()} />)
        expect(screen.getByText("No saved Free play results for this game yet.")).toBeVisible()
        const id = save(1)
        data.set(`memba:arcade:freeplay:v1:${id}`, "broken")
        fireEvent.click(screen.getByRole("button", { name: "Refresh saved results" }))
        expect(screen.getByText(/1 saved result\(s\).*missing or unreadable/)).toBeVisible()
        view.rerender(<YourRuns storage={{ ...storage, getItem: () => { throw new Error("denied") } }} onOpenSavedRun={vi.fn()} />)
        expect(screen.getByText(/Saved results could not be read/)).toBeVisible()
    })
    it("refuses a result deleted after listing", () => {
        const { storage, data, save } = setup()
        const id = save(1), open = vi.fn()
        render(<YourRuns storage={storage} onOpenSavedRun={open} />)
        data.delete(`memba:arcade:freeplay:v1:${id}`)
        fireEvent.click(screen.getByRole("button", { name: /^Open saved/ }))
        expect(screen.getByRole("alert")).toHaveTextContent("missing or unreadable")
        expect(open).not.toHaveBeenCalled()
    })
    it("refreshes on host events and unsubscribes", () => {
        const { storage, save } = setup()
        let refresh = () => {}
        const unsubscribe = vi.fn()
        const subscribe = (listener: () => void) => { refresh = listener; return unsubscribe }
        const view = render(<YourRuns storage={storage} subscribe={subscribe} onOpenSavedRun={vi.fn()} />)
        save(1)
        act(() => refresh())
        expect(screen.getByRole("button", { name: /^Open saved/ })).toBeVisible()
        view.unmount()
        expect(unsubscribe).toHaveBeenCalledOnce()
    })
    it("discards rows when injected storage changes", () => {
        const first = setup(), second = setup()
        first.save(1)
        const view = render(<YourRuns storage={first.storage} onOpenSavedRun={vi.fn()} />)
        view.rerender(<YourRuns storage={second.storage} onOpenSavedRun={vi.fn()} />)
        expect(screen.queryByRole("button", { name: /^Open saved/ })).not.toBeInTheDocument()
    })
})

import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SavedRunPanel } from "./SavedRunPanel"
import { createFreePlaySnapshot, saveFreePlaySnapshot, loadFreePlaySnapshot } from "../../../games/arcade/freeplay/snapshot"
import type { FreePlayGameRuntime } from "../../../games/arcade/freeplay/FreePlayRuntimeContext"
import type { FreePlayClient, FreePlayInput, FreePlayRun } from "../../../lib/arcadeFreePlay"
import vectors from "../../../games/arcade/freeplay/vectors.json"
function fixture() {
    const data = new Map<string, string>()
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
    const input = { ...vectors.runs[0].input, claimedScore: vectors.runs[0].score } as FreePlayInput
    saveFreePlaySnapshot(storage, createFreePlaySnapshot(input))
    const runtime: FreePlayGameRuntime = { storage, rules: input.rules, simVersion: input.simVersion }
    return { input, runtime, data }
}
describe("independent saved result panel", () => {
    it("opens a local result without a client or new launch, then closes explicitly", () => {
        const { input, runtime } = fixture(), close = vi.fn()
        render(<SavedRunPanel game={input.game} clientRunId={input.clientRunId} runtime={runtime} onClose={close} />)
        expect(screen.getByText(`Local score: ${input.claimedScore.toLocaleString()}`)).toBeVisible()
        expect(screen.getByRole("status")).toHaveTextContent("not rechecked")
        expect(screen.getByRole("heading", { name: "Saved result" })).toHaveFocus()
        expect(close).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", { name: "Back to saved results" }))
        expect(close).toHaveBeenCalledOnce()
    })
    it("starts no network action on open and aborts a requested verification when closed", async () => {
        const { input, runtime } = fixture()
        const v = vectors.runs[0], unsubscribe = vi.fn()
        let resolve!: (run: FreePlayRun) => void
        const pending = new Promise<FreePlayRun>(done => { resolve = done })
        const client = { board: vi.fn(), bind: vi.fn(() => ({ player: v.player, target: v.target })), subscribeIdentity: vi.fn(() => unsubscribe), verify: vi.fn<FreePlayClient["verify"]>(() => pending), read: vi.fn(), quote: vi.fn(), publish: vi.fn() } satisfies FreePlayClient
        const view = render(<SavedRunPanel game={input.game} clientRunId={input.clientRunId} runtime={{ ...runtime, client }} onClose={vi.fn()} />)
        for (const request of [client.bind, client.verify, client.read, client.quote, client.publish]) expect(request).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", { name: "Verify score" }))
        const signal = client.verify.mock.calls[0][2] as AbortSignal
        view.unmount()
        expect(unsubscribe).toHaveBeenCalledOnce()
        expect(signal.aborted).toBe(true)
        await act(async () => resolve({ target: v.target, clientRunId: input.clientRunId, payloadHash: v.payloadHash, replayCodec: input.replayCodec, replay: input.replay, status: "verified", entry: { game: input.game, player: v.player, rules: input.rules, simVersion: input.simVersion, runID: v.runID, seed: input.seed, score: v.score, stateHash: v.stateHash, replayHash: v.replayHash } }))
        expect(loadFreePlaySnapshot(runtime.storage, input.clientRunId)?.result).toBeUndefined()
    })
    it("does not silently reinterpret a saved result as another game", () => {
        const { input, runtime } = fixture()
        render(<SavedRunPanel game="space-invaders" clientRunId={input.clientRunId} runtime={runtime} onClose={vi.fn()} />)
        expect(screen.getByRole("alert")).toHaveTextContent("No new game has started")
    })
    it("replaces the old local result when the runtime storage changes", () => {
        const { input, runtime } = fixture()
        const view = render(<SavedRunPanel game={input.game} clientRunId={input.clientRunId} runtime={runtime} onClose={vi.fn()} />)
        view.rerender(<SavedRunPanel game={input.game} clientRunId={input.clientRunId} runtime={{ ...runtime, storage: { ...runtime.storage, getItem: () => null } }} onClose={vi.fn()} />)
        expect(screen.queryByText(/^Local score:/)).not.toBeInTheDocument()
        expect(screen.getByRole("alert")).toBeVisible()
    })
})

import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SavedRunPanel } from "./SavedRunPanel"
import { createFreePlaySnapshot, saveFreePlaySnapshot, loadFreePlaySnapshot } from "../../../games/arcade/freeplay/snapshot"
import type { FreePlayGameRuntime } from "../../../games/arcade/freeplay/FreePlayRuntimeContext"
import { createFreePlayClient, type FreePlayClient, type FreePlayInput, type FreePlayRun } from "../../../lib/arcadeFreePlay"
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

describe("saved result Connect persistence boundary", () => {
    it("announces recovery only after readback and connects explicitly with the same input", () => {
        const { input, runtime } = fixture(), connect = vi.fn()
        render(<SavedRunPanel game={input.game} clientRunId={input.clientRunId} runtime={{ ...runtime, connect }} onClose={vi.fn()} />)
        expect(screen.getByText("After connecting, find this completed result in Arcade → Your runs.")).toBeVisible()
        expect(connect).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", { name: "Connect wallet for saved scores" }))
        expect(connect).toHaveBeenCalledOnce()
        expect(loadFreePlaySnapshot(runtime.storage, input.clientRunId)?.input).toEqual(input)
    })
    it("exports the readable local result when index persistence fails, without promising recovery", () => {
        const { input, runtime } = fixture(), connect = vi.fn()
        const storage = { ...runtime.storage, setItem: (key: string, value: string) => {
            if (key.endsWith(":index:v1")) throw new Error("quota")
            runtime.storage.setItem(key, value)
        } }
        render(<SavedRunPanel game={input.game} clientRunId={input.clientRunId} runtime={{ ...runtime, storage, connect }} onClose={vi.fn()} />)
        expect(screen.getByRole("alert")).toHaveTextContent("could not be saved for recovery")
        expect(screen.queryByText(/After connecting/)).toBeNull()
        expect(screen.queryByRole("button", { name: "Connect wallet for saved scores" })).toBeNull()
        fireEvent.click(screen.getByText("Export completed result"))
        expect(JSON.parse((screen.getByRole("textbox", { name: "Completed result export" }) as HTMLTextAreaElement).value).input).toEqual(input)
        expect(connect).not.toHaveBeenCalled()
    })
    it("rechecks storage at the click instead of trusting the earlier ready notice", () => {
        const { input, runtime } = fixture(), connect = vi.fn()
        let blocked = false
        const storage = { ...runtime.storage, setItem: (key: string, value: string) => {
            if (blocked) throw new Error("quota")
            runtime.storage.setItem(key, value)
        } }
        render(<SavedRunPanel game={input.game} clientRunId={input.clientRunId} runtime={{ ...runtime, storage, connect }} onClose={vi.fn()} />)
        blocked = true
        fireEvent.click(screen.getByRole("button", { name: "Connect wallet for saved scores" }))
        expect(connect).not.toHaveBeenCalled()
        expect(screen.getByRole("alert")).toHaveTextContent("could not be saved for recovery")
    })
    it("keeps account A binding and consent when reopened with a real account B client", async () => {
        const { input, runtime } = fixture(), v = vectors.runs[0], connect = vi.fn(), token = vi.fn(), request = vi.fn()
        const saved = { ...createFreePlaySnapshot(input), binding: { player: v.player, target: v.target },
            result: { status: "verified" as const, payloadHash: v.payloadHash, entry: {
                game: input.game, player: v.player, rules: input.rules, simVersion: input.simVersion,
                runID: v.runID, seed: input.seed, score: v.score, stateHash: v.stateHash, replayHash: v.replayHash,
            } }, publication: { payloadHash: v.payloadHash, quoteId: "1".repeat(64), nonce: "2".repeat(64) } }
        saveFreePlaySnapshot(runtime.storage, saved)
        const client = createFreePlayClient({ origin: "https://example.test", target: v.target, fetch: request,
            auth: { identity: () => ({ player: "g1" + "b".repeat(38), chainId: v.target.chainId, revision: "B" }), subscribe: () => () => {}, token } })
        render(<SavedRunPanel game={input.game} clientRunId={input.clientRunId} runtime={{ ...runtime, client, connect }} onClose={vi.fn()} />)
        expect(request).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", { name: "Connect wallet for saved scores" }))
        expect(connect).toHaveBeenCalledOnce()
        fireEvent.click(screen.getByRole("button", { name: "Check saved result" }))
        await screen.findByText("Reconnect the wallet and network used for this result, then check again.")
        expect(request).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled()
        expect(loadFreePlaySnapshot(runtime.storage, input.clientRunId)).toEqual(saved)
    })
})


it("exports canonical binding, consent and receipt when session persistence fails without Connect", () => {
    const { input, runtime } = fixture(), v = vectors.runs[0]
    const entry = { game: input.game, player: v.player, rules: input.rules, simVersion: input.simVersion,
        runID: v.runID, seed: input.seed, score: v.score, stateHash: v.stateHash, replayHash: v.replayHash }
    const saved = { ...createFreePlaySnapshot(input), binding: { player: v.player, target: v.target },
        result: { status: "confirmed" as const, payloadHash: v.payloadHash, entry,
            receipt: { target: v.target, entry, height: 42, attester: v.player, schemaVersion: 2 as const } },
        publication: { payloadHash: v.payloadHash, quoteId: "1".repeat(64), nonce: "2".repeat(64) } }
    saveFreePlaySnapshot(runtime.storage, saved)
    const request = vi.fn(), token = vi.fn()
    const client = createFreePlayClient({ origin: "https://example.test", target: v.target, fetch: request,
        auth: { identity: () => null, subscribe: () => () => {}, token } })
    const storage = { ...runtime.storage, setItem: (key: string, value: string) => {
        if (key.endsWith(":index:v1")) throw new Error("quota")
        runtime.storage.setItem(key, value)
    } }
    render(<SavedRunPanel game={input.game} clientRunId={input.clientRunId} runtime={{ ...runtime, client, storage }} onClose={vi.fn()} />)
    expect(screen.getByText(`Local score: ${input.claimedScore.toLocaleString()}`)).toBeVisible()
    expect(screen.getByRole("status")).toHaveTextContent("not rechecked")
    expect(screen.queryByText(/After connecting/)).toBeNull()
    expect(screen.queryByRole("button", { name: /Connect/ })).toBeNull()
    expect(screen.getByRole("alert")).toHaveTextContent("Local recovery could not be confirmed")
    fireEvent.click(screen.getByText("Export completed result"))
    expect(JSON.parse((screen.getByRole("textbox", { name: "Completed result export" }) as HTMLTextAreaElement).value)).toEqual(saved)
    expect(loadFreePlaySnapshot(runtime.storage, input.clientRunId)).toEqual(saved)
    expect(request).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled()
})

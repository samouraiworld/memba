import { afterEach, expect, it, vi } from "vitest"
import { QueryClient, dehydrate, hydrate } from "@tanstack/react-query"
import { persistQueryClient, persistQueryClientRestore } from "@tanstack/react-query-persist-client"

vi.mock("@tanstack/react-query-persist-client", async importOriginal => ({
    ...await importOriginal<typeof import("@tanstack/react-query-persist-client")>(),
    persistQueryClient: vi.fn(),
}))
import "./queryClient"

const options = vi.mocked(persistQueryClient).mock.calls[0][0]
const clients: QueryClient[] = []
function client() {
    const value = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    clients.push(value)
    return value
}
afterEach(() => clients.splice(0).forEach(value => value.clear()))

it("round-trips completed Dev Report reads without serializing pending promises or other features", async () => {
    const source = client()
    source.setQueryData(["gnolove", "completed"], { total: 3 })
    source.setQueryData(["wallet", "private"], { balance: 42 })
    let resolve!: (value: number) => void
    const pending = source.fetchQuery({ queryKey: ["gnolove", "pending"], queryFn: () => new Promise<number>(done => { resolve = done }) })
    await expect(source.fetchQuery({ queryKey: ["gnolove", "failed"], queryFn: () => Promise.reject(new Error("offline")) })).rejects.toThrow("offline")
    try {
        // Reproduce the original failure: the namespace-only filter includes a
        // live promise, and JSON serializes it to an object without .then().
        const unsafe = JSON.parse(JSON.stringify(dehydrate(source, {
            shouldDehydrateQuery: query => query.queryKey[0] === "gnolove",
        })))
        expect(() => hydrate(client(), unsafe)).toThrow("promise.then is not a function")
        const stored = JSON.parse(JSON.stringify(dehydrate(source, options.dehydrateOptions)))
        expect(stored.queries.map((query: { queryKey: string[] }) => query.queryKey)).toEqual([["gnolove", "completed"]])
        const restored = client()
        expect(() => hydrate(restored, stored)).not.toThrow()
        expect(restored.getQueryData(["gnolove", "completed"])).toEqual({ total: 3 })
    } finally {
        resolve(1)
        await pending
    }
})

it("discards the old persisted format before attempting to hydrate serialized promises", async () => {
    const source = client()
    const pending = source.getQueryCache().build(source, { queryKey: ["gnolove", "pending"] })
    const oldState = dehydrate(source, { shouldDehydrateQuery: () => true })
    oldState.queries[0] = { ...oldState.queries[0], state: pending.state, promise: {} as Promise<unknown> }
    const persister = {
        persistClient: vi.fn(),
        restoreClient: vi.fn().mockResolvedValue({ buster: "", timestamp: Date.now(), clientState: oldState }),
        removeClient: vi.fn(),
    }
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
        await persistQueryClientRestore({ ...options, queryClient: client(), persister })
        expect(persister.removeClient).toHaveBeenCalledOnce()
        expect(consoleError).not.toHaveBeenCalled()
    } finally {
        consoleError.mockRestore()
    }
})

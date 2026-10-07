import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => { vi.doUnmock("../flag"); vi.resetModules() })

async function loader(enabled: boolean) {
    vi.resetModules()
    vi.doMock("../flag", () => ({ EVM_ENABLED: enabled }))
    return (await import("./load")).loadEvmAdapter
}

describe("loadEvmAdapter", () => {
    it("refuses with the flag off: nothing EVM is loaded", async () => {
        await expect((await loader(false))()).rejects.toThrow("The EVM network is off in this build.")
    })

    it("loads the adapter once with the flag on", async () => {
        const load = await loader(true)
        const a = await load()
        expect(typeof a.readNetworkStatus).toBe("function")
        expect(await load()).toBe(a)
    })
})

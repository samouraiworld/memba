import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => { vi.doUnmock("../../flag"); vi.resetModules() })

async function loader(enabled: boolean) {
    vi.resetModules()
    vi.doMock("../../flag", () => ({ EVM_ENABLED: enabled }))
    return (await import("./load")).loadSafeSdk
}

describe("loadSafeSdk", () => {
    it("refuses with the flag off: nothing of the Safe SDK is loaded", async () => {
        await expect((await loader(false))()).rejects.toThrow("The EVM network is off in this build.")
    })

    it("loads the SDK once with the flag on", async () => {
        const load = await loader(true)
        const sdk = await load()
        expect(typeof sdk.safeApiKit).toBe("function")
        expect(await load()).toBe(sdk)
    })
})

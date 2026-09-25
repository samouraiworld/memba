import { describe, expect, it } from "vitest"
import { nativeViewFrom, resolveNative } from "./registry"

const load = async () => ({ default: () => null })
describe("resolveNative", () => {
    it("finds an app's native window by its folder", () => {
        expect(resolveNative({ "../apps/settings/native.tsx": load }, "settings")).toBe(load)
    })
    it("has none for an app without a folder", () => {
        expect(resolveNative({ "../apps/settings/native.tsx": load }, "feed")).toBeUndefined()
    })
})

describe("nativeViewFrom", () => {
    it("returns the same component reference across calls, so a window never remounts", () => {
        const modules = { "../apps/settings/native.tsx": load }
        const first = nativeViewFrom(modules, "settings")
        const second = nativeViewFrom(modules, "settings")
        expect(first).toBeDefined()
        expect(first).toBe(second)
    })
})

import { describe, expect, it } from "vitest"
import { resolveNative } from "./registry"

const load = async () => ({ default: () => null })
describe("resolveNative", () => {
    it("finds an app's native window by its folder", () => {
        expect(resolveNative({ "../apps/settings/native.tsx": load }, "settings")).toBe(load)
    })
    it("has none for an app without a folder", () => {
        expect(resolveNative({ "../apps/settings/native.tsx": load }, "feed")).toBeUndefined()
    })
})

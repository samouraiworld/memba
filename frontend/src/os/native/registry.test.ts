import { describe, expect, it } from "vitest"
import { nativeModuleKeys, nativeViewFrom, resolveNative, unknownNativeFolders } from "./registry"

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

    it("scopes the cache per modules map, so a different map for the same app id gets its own component", () => {
        const modulesA = { "../apps/settings/native.tsx": load }
        const modulesB = { "../apps/settings/native.tsx": load }
        const fromA = nativeViewFrom(modulesA, "settings")
        const fromB = nativeViewFrom(modulesB, "settings")
        expect(fromA).toBeDefined()
        expect(fromB).toBeDefined()
        expect(fromA).not.toBe(fromB)
        // The same map still returns its own cached component, unaffected by modulesB.
        expect(nativeViewFrom(modulesA, "settings")).toBe(fromA)
        expect(nativeViewFrom(modulesB, "settings")).toBe(fromB)
    })
})

describe("unknownNativeFolders", () => {
    it("flags a folder that isn't an OS app id, and nothing else", () => {
        expect(unknownNativeFolders([
            "../apps/settings/native.tsx",
            "../apps/news/native.tsx",
            "../apps/setings/native.tsx",
            "../apps/Settings/native.tsx",
        ])).toEqual(["../apps/setings/native.tsx", "../apps/Settings/native.tsx"])
    })
    it("finds no stray folder in the real src/os/apps", () => {
        expect(unknownNativeFolders(nativeModuleKeys())).toEqual([])
    })
})

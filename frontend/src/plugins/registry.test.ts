import { describe, it, expect } from "vitest"
import { getPlugins, getPlugin, BUILT_IN_PLUGINS } from "./registry"
import type { PluginManifest } from "./types"

describe("plugin registry", () => {
    it("getPlugins() returns non-empty array", () => {
        const plugins = getPlugins()
        expect(plugins.length).toBeGreaterThan(0)
    })

    it("getPlugin('proposals') returns the proposals manifest", () => {
        const manifest = getPlugin("proposals")
        expect(manifest).toBeDefined()
        expect(manifest!.id).toBe("proposals")
        expect(manifest!.name).toBe("Proposals")
        expect(manifest!.icon).toBe("📋")
        expect(manifest!.route).toBe("proposals")
        expect(manifest!.version).toBe("1.0.0")
    })

    it("getPlugin('nonexistent') returns undefined", () => {
        expect(getPlugin("nonexistent")).toBeUndefined()
        expect(getPlugin("")).toBeUndefined()
    })

    it("every manifest has all required fields", () => {
        const requiredKeys: (keyof PluginManifest)[] = [
            "id", "name", "icon", "route", "description", "version", "component",
        ]
        for (const plugin of getPlugins()) {
            for (const key of requiredKeys) {
                expect(plugin[key], `Plugin "${plugin.id}" missing key "${key}"`).toBeDefined()
                expect(plugin[key], `Plugin "${plugin.id}" key "${key}" is empty`).not.toBe("")
            }
        }
    })

    it("component field is a function (lazy loader)", () => {
        for (const plugin of getPlugins()) {
            expect(typeof plugin.component).toBe("function")
        }
    })

    it("BUILT_IN_PLUGINS is frozen (immutable)", () => {
        expect(Object.isFrozen(BUILT_IN_PLUGINS)).toBe(true)
    })

    it("no duplicate IDs in registry", () => {
        const ids = getPlugins().map(p => p.id)
        const unique = new Set(ids)
        expect(unique.size).toBe(ids.length)
    })

    it("all plugin IDs are URL-safe", () => {
        for (const plugin of getPlugins()) {
            expect(plugin.id).toMatch(/^[a-z0-9-]+$/)
        }
    })

    it("all plugin routes are URL-safe", () => {
        for (const plugin of getPlugins()) {
            expect(plugin.route).toMatch(/^[a-z0-9-]+$/)
        }
    })

    it("all plugin versions follow semver format", () => {
        for (const plugin of getPlugins()) {
            expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/)
        }
    })
})

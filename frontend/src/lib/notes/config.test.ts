import { afterEach, describe, expect, it, vi } from "vitest"
import { notesDeployment, validNoteTitle } from "./config"
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
describe("Notes release and title boundaries", () => {
    it.each([["false", "false"], ["true", "false"], ["false", "true"], ["true", "true"]])("keeps the empty deployment registry closed with local=%s and chain=%s", async (local, chain) => {
        vi.stubEnv("VITE_ENABLE_NOTES", local)
        vi.stubEnv("VITE_ENABLE_NOTES_CHAIN", chain)
        vi.resetModules()
        const config = await import("./config")
        expect(config.NOTES_ENABLED).toBe(local === "true")
        for (const id of ["gnoland-1", "onyx-1", "unknown", "__proto__", "constructor", "toString"]) expect(config.notesDeployment(id)).toBeNull()
    })
    it("never invents a deployment on a known or unknown chain", () => {
        for (const chain of ["gnoland-1", "onyx-1", "test"]) expect(notesDeployment(chain)).toBeNull()
    })
    it("counts Unicode code points and UTF-8 bytes separately", () => {
        expect(validNoteTitle("é".repeat(80))).toBe(true)
        expect(validNoteTitle("😀".repeat(40))).toBe(true)
        expect(validNoteTitle("😀".repeat(41))).toBe(false)
        expect(validNoteTitle("a".repeat(81))).toBe(false)
    })
    it("rejects hidden formatting, control characters and unnormalised titles", () => {
        for (const title of ["", " title", "title ", "a/b", "a\nb", "a\u202eb", "a\u200bb"]) expect(validNoteTitle(title)).toBe(false)
    })
})

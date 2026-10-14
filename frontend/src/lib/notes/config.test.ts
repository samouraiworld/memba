import { afterEach, describe, expect, it, vi } from "vitest"
import { DEPLOYMENTS, deploymentRealm, notesDeployment, validNoteTitle } from "./config"
import { validNotesRealm } from "./chain/schema"
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
describe("Notes release and title boundaries", () => {
    it.each([["false", "false"], ["true", "false"], ["false", "true"], ["true", "true"]])("opens only the reviewed gnoland-1 and onyx-1 deployments, and only with local=%s and chain=%s both true", async (local, chain) => {
        vi.stubEnv("VITE_ENABLE_NOTES", local)
        vi.stubEnv("VITE_ENABLE_NOTES_CHAIN", chain)
        vi.resetModules()
        const config = await import("./config")
        expect(config.NOTES_ENABLED).toBe(local === "true")
        const open = local === "true" && chain === "true"
        expect(config.notesDeployment("gnoland-1")).toEqual(open ? { realm: "gno.land/r/samcrew/memba_notes_v1", version: 1 } : null)
        expect(config.notesDeployment("onyx-1")).toEqual(open ? { realm: "gno.land/r/samcrew/memba_notes_rc1", version: 1 } : null)
        for (const id of ["gnoland1", "unknown", "__proto__", "constructor", "toString", "hasOwnProperty"]) expect(config.notesDeployment(id)).toBeNull()
    })
    it("names a valid Notes realm path in every deployment entry, read back unflagged for receipts", () => {
        expect(Object.keys(DEPLOYMENTS).length).toBeGreaterThan(0)
        for (const [chainId, entry] of Object.entries(DEPLOYMENTS)) {
            expect(validNotesRealm(entry.realm)).toBe(true); expect(entry.version).toBe(1)
            expect(deploymentRealm(chainId)).toBe(entry.realm)
        }
        for (const id of ["gnoland1", "unknown", "__proto__", "constructor"]) expect(deploymentRealm(id)).toBeNull()
    })
    it("names the exact published realm on each network", () => {
        expect(Object.keys(DEPLOYMENTS).sort()).toEqual(["gnoland-1", "onyx-1"])
        expect(deploymentRealm("gnoland-1")).toBe("gno.land/r/samcrew/memba_notes_v1")
        expect(deploymentRealm("onyx-1")).toBe("gno.land/r/samcrew/memba_notes_rc1")
    })
    it("never invents a deployment without both release switches", () => {
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

import { afterEach, describe, expect, it, vi } from "vitest"
import { DEPLOYMENTS, deploymentRealm, notesDeployment, PRIVATE_CHAINS, privateNotesDeployment, validNoteTitle, vaultRevealEnabled } from "./config"
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
    const flags = ["false", "true"].flatMap(notes => ["false", "true"].flatMap(chain => ["false", "true"].flatMap(encrypted => ["false", "true"].map(vault => [notes, chain, encrypted, vault]))))
    it.each(flags)("opens private notes only on onyx-1 with every switch on (notes=%s chain=%s encrypted=%s vault=%s)", async (notes, chain, encrypted, vault) => {
        vi.stubEnv("VITE_ENABLE_NOTES", notes)
        vi.stubEnv("VITE_ENABLE_NOTES_CHAIN", chain)
        vi.stubEnv("VITE_ENABLE_NOTES_ENCRYPTED", encrypted)
        vi.stubEnv("VITE_ENABLE_NOTES_VAULT_REVEAL", vault)
        vi.resetModules()
        const config = await import("./config")
        const open = notes === "true" && chain === "true" && encrypted === "true"
        expect(config.PRIVATE_NOTES_BUILD).toBe(encrypted === "true")
        expect(config.loadPrivateNotes === null).toBe(encrypted !== "true")
        expect(config.privateNotesDeployment("onyx-1")).toEqual(open ? { realm: "gno.land/r/samcrew/memba_notes_rc1", version: 1 } : null)
        expect(config.vaultRevealEnabled("onyx-1")).toBe(open && vault === "true")
        // Mainnet stays closed even with every switch on, until its own release review.
        expect(config.privateNotesDeployment("gnoland-1")).toBeNull()
        expect(config.vaultRevealEnabled("gnoland-1")).toBe(false)
        for (const id of ["onyx1", "ONYX-1", "unknown", "test-chain-id", "__proto__", "constructor", "toString", "hasOwnProperty", "includes", "0", "length"]) {
            expect(config.privateNotesDeployment(id)).toBeNull(); expect(config.vaultRevealEnabled(id)).toBe(false)
        }
    })
    it("freezes the private network allowlist", () => {
        expect(PRIVATE_CHAINS).toEqual(["onyx-1"])
        expect(Object.isFrozen(PRIVATE_CHAINS)).toBe(true)
        expect(() => (PRIVATE_CHAINS as string[]).push("gnoland-1")).toThrow()
        for (const chain of ["gnoland-1", "onyx-1"]) { expect(privateNotesDeployment(chain)).toBeNull(); expect(vaultRevealEnabled(chain)).toBe(false) }
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

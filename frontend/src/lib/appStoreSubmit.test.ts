import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
    MAX_NAME_LEN,
    MAX_TAGLINE_LEN,
    MAX_DESCR_LEN,
    MAX_CATEGORY_LEN,
    MAX_URL_LEN,
    MAX_CID_LEN,
    MAX_SCREENSHOTS,
    MAX_RESUBMITS,
    validateAppURL,
    validateSubmission,
    buildRegisterAppMsg,
    buildEditListingMsg,
    buildDelistAppMsg,
    fetchRegistrationFee,
    listingToSubmission,
    loadEditForm,
    formatGnot,
    registerStorageBytes,
    editStorageBytes,
    assertRegisterApplies,
    assertEditApplies,
    assertDelistApplies,
    submitRegisterApp,
    submitDelistApp,
    submitEditListing,
    submitErrorText,
    REGISTER_GAS_WANTED,
    EDIT_GAS_WANTED,
    DELIST_GAS_WANTED,
    type AppSubmission,
} from "./appStoreSubmit"
import * as grc20 from "./grc20"
import { depositCapUgnot } from "./dao/v2Budget"
import { APPSTORE_REALM_PATH, NothingSentError, type AppListing } from "./appStore"
import * as appStore from "./appStore"
import * as shared from "./dao/shared"

const CALLER = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"

function submission(over: Partial<AppSubmission> = {}): AppSubmission {
    return {
        pkgPath: "gno.land/r/samcrew/my_app_v1",
        name: "My App",
        tagline: "Does a thing",
        descr: "A longer description.",
        category: "Tools",
        iconCID: "",
        screenshotsCSV: "",
        appURL: "https://example.com/app",
        ...over,
    }
}

describe("field limits mirror the memba_appstore_v3 realm", () => {
    it("uses the realm's exact constants", () => {
        expect(MAX_NAME_LEN).toBe(80)
        expect(MAX_TAGLINE_LEN).toBe(140)
        expect(MAX_DESCR_LEN).toBe(2000)
        expect(MAX_CATEGORY_LEN).toBe(40)
        expect(MAX_URL_LEN).toBe(400)
        expect(MAX_CID_LEN).toBe(100)
        expect(MAX_SCREENSHOTS).toBe(6)
        expect(MAX_RESUBMITS).toBe(5)
    })
})

describe("validateAppURL (client mirror of the realm's scheme allowlist)", () => {
    it("accepts the allowlisted shapes: empty, http(s)://, leading-slash path", () => {
        expect(validateAppURL("")).toBeNull()
        expect(validateAppURL("https://example.com/x")).toBeNull()
        expect(validateAppURL("http://example.com")).toBeNull()
        expect(validateAppURL("/feed")).toBeNull()
        expect(validateAppURL("/")).toBeNull()
    })

    it("rejects every other scheme (javascript:, data:, ftp:, mailto:, bare host)", () => {
        expect(validateAppURL("javascript:alert(1)")).toBeTruthy()
        expect(validateAppURL("data:text/html,x")).toBeTruthy()
        expect(validateAppURL("ftp://example.com")).toBeTruthy()
        expect(validateAppURL("mailto:x@example.com")).toBeTruthy()
        expect(validateAppURL("example.com/app")).toBeTruthy()
    })

    it("rejects protocol-relative leading-slash paths (//host and /\\host escape the allowlist)", () => {
        expect(validateAppURL("//evil.com")).toBeTruthy()
        expect(validateAppURL("/\\evil.com")).toBeTruthy()
    })
})

describe("validateSubmission (client mirror of validateListingFields + validatePkgPath)", () => {
    it("passes a well-formed submission with no errors", () => {
        expect(validateSubmission(submission())).toEqual({})
    })

    it("requires a name and caps it at the realm limit", () => {
        expect(validateSubmission(submission({ name: "" })).name).toBeTruthy()
        expect(validateSubmission(submission({ name: "a".repeat(MAX_NAME_LEN + 1) })).name).toBeTruthy()
        expect(validateSubmission(submission({ name: "a".repeat(MAX_NAME_LEN) })).name).toBeUndefined()
    })

    it("caps tagline / descr / category at the realm limits", () => {
        expect(validateSubmission(submission({ tagline: "a".repeat(MAX_TAGLINE_LEN + 1) })).tagline).toBeTruthy()
        expect(validateSubmission(submission({ descr: "a".repeat(MAX_DESCR_LEN + 1) })).descr).toBeTruthy()
        expect(validateSubmission(submission({ category: "a".repeat(MAX_CATEGORY_LEN + 1) })).category).toBeTruthy()
    })

    it("requires a safe gno.land realm/package pkgPath (it becomes the listing key AND a qeval arg)", () => {
        expect(validateSubmission(submission({ pkgPath: "" })).pkgPath).toBeTruthy()
        expect(validateSubmission(submission({ pkgPath: "evil.com/r/x" })).pkgPath).toBeTruthy()
        expect(validateSubmission(submission({ pkgPath: `gno.land/r/x") + Evil("` })).pkgPath).toBeTruthy()
        expect(validateSubmission(submission({ pkgPath: "gno.land/p/nt/avl" })).pkgPath).toBeUndefined()
    })

    it("applies the URL allowlist and length cap to appURL", () => {
        expect(validateSubmission(submission({ appURL: "javascript:alert(1)" })).appURL).toBeTruthy()
        expect(validateSubmission(submission({ appURL: "https://x.com/" + "a".repeat(MAX_URL_LEN) })).appURL).toBeTruthy()
        expect(validateSubmission(submission({ appURL: "" })).appURL).toBeUndefined()
    })

    it("bounds screenshots: ≤6 comma-separated CIDs, each ≤100 chars (blank entries ignored)", () => {
        expect(validateSubmission(submission({ screenshotsCSV: "cidA,cidB" })).screenshotsCSV).toBeUndefined()
        expect(validateSubmission(submission({ screenshotsCSV: "a,b,c,d,e,f,g" })).screenshotsCSV).toBeTruthy()
        expect(validateSubmission(submission({ screenshotsCSV: "x".repeat(MAX_CID_LEN + 1) })).screenshotsCSV).toBeTruthy()
        expect(validateSubmission(submission({ screenshotsCSV: " , ," })).screenshotsCSV).toBeUndefined()
    })

    it("caps iconCID at the realm limit", () => {
        expect(validateSubmission(submission({ iconCID: "x".repeat(MAX_CID_LEN + 1) })).iconCID).toBeTruthy()
    })
})

describe("buildRegisterAppMsg (the money path — exact-coin fee attach)", () => {
    it("builds a vm/MsgCall on the active App Store realm with the exact fee attached", () => {
        const msg = buildRegisterAppMsg(CALLER, 1_000_000, submission())
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.pkg_path).toBe(APPSTORE_REALM_PATH)
        expect(msg.value.func).toBe("RegisterApp")
        expect(msg.value.caller).toBe(CALLER)
        expect(msg.value.send).toBe("1000000ugnot")
    })

    it("passes the realm's 8 args in signature order", () => {
        const s = submission({ iconCID: "cidIcon", screenshotsCSV: "cidA,cidB" })
        const msg = buildRegisterAppMsg(CALLER, 1_000_000, s)
        expect(msg.value.args).toEqual([
            s.pkgPath, s.name, s.tagline, s.descr, s.category, s.iconCID, s.screenshotsCSV, s.appURL,
        ])
    })

    it("attaches no coins when the realm fee is zero (exact-coin: 0 expected means send nothing)", () => {
        const msg = buildRegisterAppMsg(CALLER, 0, submission())
        expect(msg.value.send).toBe("")
    })

    it("throws on a non-integer or negative fee (never sign a malformed coin amount)", () => {
        expect(() => buildRegisterAppMsg(CALLER, 1.5, submission())).toThrow()
        expect(() => buildRegisterAppMsg(CALLER, -1, submission())).toThrow()
        expect(() => buildRegisterAppMsg(CALLER, Number.NaN, submission())).toThrow()
    })

    it("throws when a field fails validation (never broadcast a tx the realm will reject)", () => {
        expect(() => buildRegisterAppMsg(CALLER, 1_000_000, submission({ name: "" }))).toThrow()
        expect(() => buildRegisterAppMsg(CALLER, 1_000_000, submission({ appURL: "javascript:x" }))).toThrow()
    })
})

describe("buildEditListingMsg (free resubmit — no coin attach)", () => {
    it("builds an EditListing call with no coins and the same 8-arg order", () => {
        const s = submission()
        const msg = buildEditListingMsg(CALLER, s, s)
        expect(msg.value.func).toBe("EditListing")
        expect(msg.value.send).toBe("")
        expect(msg.value.pkg_path).toBe(APPSTORE_REALM_PATH)
        expect(msg.value.args).toEqual([
            s.pkgPath, s.name, s.tagline, s.descr, s.category, s.iconCID, s.screenshotsCSV, s.appURL,
        ])
    })

    it("throws on invalid fields", () => {
        expect(() => buildEditListingMsg(CALLER, submission({ pkgPath: "evil.com/x" }), submission())).toThrow()
    })
})

describe("fetchRegistrationFee (read the live fee from the realm, never hardcode)", () => {
    beforeEach(() => vi.restoreAllMocks())
    afterEach(() => vi.restoreAllMocks())

    it("queries GetRegistrationFee() and parses the qeval int64", async () => {
        const qe = vi.spyOn(shared, "queryEval").mockResolvedValue("(1000000 int64)\n")
        await expect(fetchRegistrationFee()).resolves.toBe(1_000_000)
        expect(qe).toHaveBeenCalledWith(expect.any(String), APPSTORE_REALM_PATH, "GetRegistrationFee()")
    })

    it("returns null on an empty / malformed / failed response (caller must block submit)", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValue(null)
        await expect(fetchRegistrationFee()).resolves.toBeNull()
        vi.spyOn(shared, "queryEval").mockResolvedValue("nonsense")
        await expect(fetchRegistrationFee()).resolves.toBeNull()
    })
})

describe("formatGnot", () => {
    it("renders ugnot as a trimmed GNOT amount", () => {
        expect(formatGnot(1_000_000)).toBe("1")
        expect(formatGnot(1_500_000)).toBe("1.5")
        expect(formatGnot(250_000)).toBe("0.25")
        expect(formatGnot(0)).toBe("0")
    })
})

describe("buildDelistAppMsg (free, one-way for the publisher)", () => {
    it("builds the DelistApp call with no coins and just the pkgPath", () => {
        const m = buildDelistAppMsg(CALLER, "gno.land/r/samcrew/my_app_v1")
        expect(m.type).toBe("vm/MsgCall")
        expect(m.value.func).toBe("DelistApp")
        expect(m.value.pkg_path).toBe(APPSTORE_REALM_PATH)
        expect(m.value.send).toBe("")
        expect(m.value.args).toEqual(["gno.land/r/samcrew/my_app_v1"])
        expect(m.value.caller).toBe(CALLER)
    })

    it("refuses an empty pkgPath", () => {
        expect(() => buildDelistAppMsg(CALLER, "  ")).toThrow()
    })
})

describe("listingToSubmission (map a full listing to the editable form — never drop artwork/descr)", () => {
    const base: AppListing = {
        id: 1, pkgPath: "gno.land/r/samcrew/a_v1", name: "A", tagline: "t", category: "C",
        iconCID: "i", appURL: "/a", publisher: CALLER, status: "pending", flagCount: 0, createdAt: 0,
    }

    it("copies every editable field, joining screenshots into the CSV wire form", () => {
        expect(listingToSubmission({ ...base, descr: "d", screenshotCIDs: ["x", "y"] })).toEqual({
            pkgPath: "gno.land/r/samcrew/a_v1", name: "A", tagline: "t", descr: "d",
            category: "C", iconCID: "i", screenshotsCSV: "x,y", appURL: "/a",
        })
    })

    it("coerces a missing descr / screenshots to empty strings (form shows blank, not 'undefined')", () => {
        expect(listingToSubmission(base)).toMatchObject({ descr: "", screenshotsCSV: "" })
    })
})

describe("loadEditForm (fetch full detail before editing so EditListing can't wipe descr + screenshots)", () => {
    beforeEach(() => vi.restoreAllMocks())
    afterEach(() => vi.restoreAllMocks())

    it("reads GetListingJSON (fetchApp) and returns the mapped, edit-ready submission", async () => {
        const full: AppListing = {
            id: 3, pkgPath: "gno.land/r/samcrew/app_v1", name: "App", tagline: "tag", category: "Tools",
            iconCID: "bafyicon", appURL: "/x", publisher: CALLER, status: "rejected", flagCount: 0,
            createdAt: 1, descr: "Full description.", screenshotCIDs: ["s1", "s2"],
        }
        const spy = vi.spyOn(appStore, "fetchApp").mockResolvedValue(full)
        await expect(loadEditForm("gno.land/r/samcrew/app_v1")).resolves.toEqual({
            pkgPath: "gno.land/r/samcrew/app_v1", name: "App", tagline: "tag", descr: "Full description.",
            category: "Tools", iconCID: "bafyicon", screenshotsCSV: "s1,s2", appURL: "/x",
        })
        expect(spy).toHaveBeenCalledWith("gno.land/r/samcrew/app_v1")
    })

    it("returns null when the listing can't be read — the caller MUST abort, never open a wiping form", async () => {
        vi.spyOn(appStore, "fetchApp").mockResolvedValue(null)
        await expect(loadEditForm("gno.land/r/samcrew/app_v1")).resolves.toBeNull()
    })
})

describe("what a listing costs, bounded on what gnoland-1 measured", () => {
    const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
    const base = submission({ pkgPath: "gno.land/r/samcrew/memba_feed_v1", name: "Feed", tagline: "", descr: "A feed.", category: "Community", appURL: "https://memba.club/feed" })

    it("covers every RegisterApp simulated, one field at a time and all at their limits", () => {
        const measured: [AppSubmission, number][] = [
            [base, 8_014],
            [{ ...base, descr: "D".repeat(2000) }, 10_011],
            [{ ...base, pkgPath: `gno.land/r/samcrew/${"p".repeat(82)}` }, 8_364],
            [{ ...base, iconCID: CID }, 8_077],
            [{ ...base, screenshotsCSV: Array(6).fill(CID).join(",") }, 9_053],
            [{ ...base, name: "N".repeat(80) }, 8_091],
            [{ pkgPath: `gno.land/r/${"x".repeat(189)}`, name: "N".repeat(80), tagline: "T".repeat(140), descr: "D".repeat(2000), category: "C".repeat(40), iconCID: CID, screenshotsCSV: Array(6).fill(CID).join(","), appURL: `https://example.org/${"u".repeat(380)}` }, 12_610],
        ]
        for (const [s, bytes] of measured) {
            expect(registerStorageBytes(s)).toBeGreaterThanOrEqual(bytes)
            // Close enough that the stated deposit is not an overstatement.
            expect(registerStorageBytes(s)).toBeLessThan(bytes * 1.1)
        }
        expect(buildRegisterAppMsg(CALLER, 1_000_000, base).value.max_deposit).toBe(`${depositCapUgnot(registerStorageBytes(base))}ugnot`)
    })

    it("sizes an edit on what it adds, and a delist on the bytes it measured", () => {
        expect(editStorageBytes(base, base)).toBe(64) // measured +32 B unchanged
        expect(editStorageBytes(base, { ...base, descr: "D".repeat(1007) })).toBe(64 + Math.ceil(1.1 * 1000))
        expect(editStorageBytes(base, { ...base, descr: "" })).toBe(64)
        // Longer screenshot CIDs grow the listing though the count stays: six 1-byte CIDs to six real ones stored about 380 B.
        const shots = (cid: string) => Array(6).fill(cid).join(",")
        expect(editStorageBytes({ ...base, screenshotsCSV: shots("x") }, { ...base, screenshotsCSV: shots(CID) })).toBeGreaterThanOrEqual(64 + 380)
        // Screenshots added while text shrinks: the shrink is credited at its exact size, the additions in full.
        expect(editStorageBytes({ ...base, descr: "D".repeat(1000) }, { ...base, descr: "", screenshotsCSV: shots(CID) })).toBe(64 + (-1000 + 359) + 720)
        expect(buildEditListingMsg(CALLER, base, base).value.max_deposit).toBe(`${depositCapUgnot(64)}ugnot`)
        expect(buildDelistAppMsg(CALLER, base.pkgPath).value.max_deposit).toBe(`${depositCapUgnot(64)}ugnot`)
    })

    it("counts field limits in UTF-8 bytes, as the realm does", () => {
        expect(validateSubmission(submission({ name: "é".repeat(40) }))).toEqual({})
        expect(validateSubmission(submission({ name: "é".repeat(41) })).name).toMatch(/80 bytes/)
        expect(validateSubmission(submission({ tagline: "🙂".repeat(36) })).tagline).toMatch(/140 bytes/)
        expect(validateSubmission(submission({ descr: "é".repeat(1001) })).descr).toMatch(/2000 bytes/)
        expect(validateSubmission(submission({ category: "é".repeat(21) })).category).toMatch(/40 bytes/)
        expect(validateSubmission(submission({ iconCID: "é".repeat(51) })).iconCID).toMatch(/100 bytes/)
        expect(validateSubmission(submission({ appURL: `https://example.org/${"é".repeat(191)}` })).appURL).toMatch(/400 bytes/)
        expect(validateSubmission(submission({ screenshotsCSV: "é".repeat(51) })).screenshotsCSV).toMatch(/100 bytes/)
        expect(validateSubmission(submission({ descr: "é".repeat(1000), category: "é".repeat(20), iconCID: "é".repeat(50), appURL: `https://example.org/${"é".repeat(190)}`, screenshotsCSV: "é".repeat(50) }))).toEqual({})
    })
})

describe("checks made before the wallet, on a verified node", () => {
    afterEach(() => vi.restoreAllMocks())
    const s = submission()
    const mine = (over: Partial<AppListing> = {}): AppListing => ({ id: 1, pkgPath: s.pkgPath, name: s.name, tagline: s.tagline, category: s.category, iconCID: s.iconCID, appURL: s.appURL, publisher: CALLER, status: "rejected", flagCount: 0, createdAt: 0, descr: s.descr, screenshotCIDs: [], resubmitCount: 1, ...over })
    const state = (over = {}) => vi.spyOn(appStore, "fetchRegistryState").mockResolvedValue({ pending: 0, registrationFee: 1_000_000, paused: false, ...over })

    it("registers only unpaused, at the fee shown, on a free path", async () => {
        state(); const read = vi.spyOn(appStore, "fetchAppStrict").mockResolvedValue(null)
        await expect(assertRegisterApplies(s, 1_000_000)).resolves.toBeUndefined()
        expect(read).toHaveBeenCalledWith(s.pkgPath)
        state({ paused: true })
        await expect(assertRegisterApplies(s, 1_000_000)).rejects.toThrow("paused")
        state({ registrationFee: 2_000_000 })
        await expect(assertRegisterApplies(s, 1_000_000)).rejects.toThrow("The listing fee is now 2 GNOT")
        state(); read.mockResolvedValue(mine({ publisher: "g1someoneelse" }))
        await expect(assertRegisterApplies(s, 1_000_000)).rejects.toThrow("already listed")
    })

    it("edits only the publisher's pending or rejected listing, with edits left, unchanged since loaded", async () => {
        const read = vi.spyOn(appStore, "fetchAppStrict").mockResolvedValue(mine())
        await expect(assertEditApplies(CALLER, { ...s, descr: "New" }, s)).resolves.toBeUndefined()
        read.mockResolvedValue(mine({ publisher: "g1someoneelse" }))
        await expect(assertEditApplies(CALLER, s, s)).rejects.toThrow("publisher")
        read.mockResolvedValue(mine({ status: "live" }))
        await expect(assertEditApplies(CALLER, s, s)).rejects.toThrow("pending or rejected")
        read.mockResolvedValue(mine({ resubmitCount: MAX_RESUBMITS }))
        await expect(assertEditApplies(CALLER, s, s)).rejects.toThrow("used its 5 edits")
        read.mockResolvedValue(mine({ resubmitCount: undefined }))
        await expect(assertEditApplies(CALLER, s, s)).rejects.toThrow("used its 5 edits")
        read.mockResolvedValue(mine({ descr: "Changed on chain" }))
        await expect(assertEditApplies(CALLER, s, s)).rejects.toThrow("changed since it was loaded")
    })

    it("delists only the publisher's listing that is not delisted yet", async () => {
        const read = vi.spyOn(appStore, "fetchAppStrict").mockResolvedValue(mine({ status: "live" }))
        await expect(assertDelistApplies(CALLER, s.pkgPath)).resolves.toBeUndefined()
        read.mockResolvedValue(null)
        await expect(assertDelistApplies(CALLER, s.pkgPath)).rejects.toThrow("publisher")
        read.mockResolvedValue(mine({ status: "delisted" }))
        await expect(assertDelistApplies(CALLER, s.pkgPath)).rejects.toThrow("already delisted")
    })

    it("sends each call at its measured gas and the fee read now, checking again before the wallet", async () => {
        state(); const read = vi.spyOn(appStore, "fetchAppStrict").mockResolvedValue(null)
        vi.spyOn(grc20, "freshFeeForGasWanted").mockImplementation(async (gas) => gas / 1000)
        const broadcast = vi.spyOn(grc20, "doContractBroadcast").mockImplementation(async (_m, _memo, opts) => { await opts?.beforeSign?.(); return { hash: "h" } as never })
        await expect(submitRegisterApp(CALLER, s, 1_000_000)).resolves.toBe("h")
        expect(broadcast).toHaveBeenLastCalledWith([buildRegisterAppMsg(CALLER, 1_000_000, s)], "Submit app", expect.objectContaining({ gasWanted: REGISTER_GAS_WANTED, gasFee: 36_000 }))
        expect(read).toHaveBeenCalledTimes(2)
        read.mockResolvedValue(mine())
        await submitEditListing(CALLER, s, s)
        expect(broadcast).toHaveBeenLastCalledWith([buildEditListingMsg(CALLER, s, s)], "Resubmit app", expect.objectContaining({ gasWanted: EDIT_GAS_WANTED, gasFee: 30_000 }))
        await submitDelistApp(CALLER, s.pkgPath)
        expect(broadcast).toHaveBeenLastCalledWith([buildDelistAppMsg(CALLER, s.pkgPath)], "Delist app", expect.objectContaining({ gasWanted: DELIST_GAS_WANTED, gasFee: 21_000 }))
    })

    it("sends nothing when the fee changed while the confirmation was open", async () => {
        const fee = state(); vi.spyOn(appStore, "fetchAppStrict").mockResolvedValue(null)
        vi.spyOn(grc20, "freshFeeForGasWanted").mockResolvedValue(36_000)
        const wallet = vi.fn()
        vi.spyOn(grc20, "doContractBroadcast").mockImplementation(async (_m, _memo, opts) => {
            fee.mockResolvedValue({ pending: 0, registrationFee: 5_000_000, paused: false })
            await opts?.beforeSign?.(); wallet(); return { hash: "h" } as never
        })
        await expect(submitRegisterApp(CALLER, s, 1_000_000)).rejects.toThrow("The listing fee is now 5 GNOT")
        expect(wallet).not.toHaveBeenCalled()
    })

    it("tells the user what stopped a call, and never says a failed transaction was free", () => {
        expect(submitErrorText(new Error("user denied"), "delist")).toBeNull()
        expect(submitErrorText(new NothingSentError("This listing is already delisted."), "delist")).toBe("This listing is already delisted.")
        // Only Memba's own checks are quoted: a node's or wallet's text is not, whatever it says.
        expect(submitErrorText(new Error("This listing is already delisted."), "delist")).toBe("The delist did not go through. A transaction that fails on chain still costs its network fee; nothing else is taken.")
        expect(submitErrorText(new Error("out of gas"), "submission")).toBe("The submission did not go through. A transaction that fails on chain still costs its network fee; nothing else is taken.")
        // Adena could not say whether it went through: its own advice, not a claim that it failed.
        const odd = "Adena returned an indeterminate transaction status. Check the transaction before trying again."
        expect(submitErrorText(new Error(odd), "submission")).toBe(odd)
    })

    it("does not quote a network failure met before the wallet, and says nothing was sent", async () => {
        const read = vi.spyOn(appStore, "fetchAppStrict")
        for (const cause of [new TypeError("Failed to fetch"), new Error("RPC error: node down"), new Error("HTTP 502")]) {
            read.mockRejectedValueOnce(cause)
            const sent = submitDelistApp(CALLER, s.pkgPath)
            await expect(sent).rejects.toBeInstanceOf(NothingSentError)
            await expect(sent).rejects.toThrow("Memba could not reach the network. Nothing was sent; try again in a moment.")
        }
    })
})

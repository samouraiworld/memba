import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
    MAX_NAME_LEN,
    MAX_TAGLINE_LEN,
    MAX_DESCR_LEN,
    MAX_CATEGORY_LEN,
    MAX_URL_LEN,
    MAX_CID_LEN,
    MAX_SCREENSHOTS,
    validateAppURL,
    validateSubmission,
    buildRegisterAppMsg,
    buildEditListingMsg,
    fetchRegistrationFee,
    formatGnot,
    type AppSubmission,
} from "./appStoreSubmit"
import { APPSTORE_REALM_PATH } from "./appStore"
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
        const msg = buildEditListingMsg(CALLER, s)
        expect(msg.value.func).toBe("EditListing")
        expect(msg.value.send).toBe("")
        expect(msg.value.pkg_path).toBe(APPSTORE_REALM_PATH)
        expect(msg.value.args).toEqual([
            s.pkgPath, s.name, s.tagline, s.descr, s.category, s.iconCID, s.screenshotsCSV, s.appURL,
        ])
    })

    it("throws on invalid fields", () => {
        expect(() => buildEditListingMsg(CALLER, submission({ pkgPath: "evil.com/x" }))).toThrow()
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

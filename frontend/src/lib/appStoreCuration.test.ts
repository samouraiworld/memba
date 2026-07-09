import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
    MAX_REASON_LEN,
    fetchIsCurator,
    buildApproveAppMsg,
    buildRejectAppMsg,
} from "./appStoreCuration"
import { APPSTORE_REALM_PATH } from "./appStore"
import * as shared from "./dao/shared"

const CURATOR = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"
const APP = "gno.land/r/samcrew/my_app_v1"

describe("MAX_REASON_LEN mirrors the realm", () => {
    it("is the realm's MaxReasonLen", () => {
        expect(MAX_REASON_LEN).toBe(500)
    })
})

describe("fetchIsCurator (UX gate only — the realm is the authority)", () => {
    beforeEach(() => vi.restoreAllMocks())
    afterEach(() => vi.restoreAllMocks())

    it("queries IsCurator with the JSON-encoded address and parses the bool", async () => {
        const qe = vi.spyOn(shared, "queryEval").mockResolvedValue("(true bool)\n")
        await expect(fetchIsCurator(CURATOR)).resolves.toBe(true)
        expect(qe).toHaveBeenCalledWith(
            expect.any(String),
            APPSTORE_REALM_PATH,
            `IsCurator(${JSON.stringify(CURATOR)})`,
        )
        vi.spyOn(shared, "queryEval").mockResolvedValue("(false bool)\n")
        await expect(fetchIsCurator(CURATOR)).resolves.toBe(false)
    })

    it("fails CLOSED: false on error, empty, or a non-address-shaped input (never queried)", async () => {
        const qe = vi.spyOn(shared, "queryEval").mockResolvedValue("[unused]")
        await expect(fetchIsCurator(`g1x") + Evil("`)).resolves.toBe(false)
        await expect(fetchIsCurator("")).resolves.toBe(false)
        expect(qe).not.toHaveBeenCalled()
        vi.spyOn(shared, "queryEval").mockResolvedValue(null)
        await expect(fetchIsCurator(CURATOR)).resolves.toBe(false)
    })
})

describe("buildApproveAppMsg", () => {
    it("builds an ApproveApp vm/MsgCall with no coins", () => {
        const msg = buildApproveAppMsg(CURATOR, APP)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value).toEqual({
            caller: CURATOR, send: "", pkg_path: APPSTORE_REALM_PATH, func: "ApproveApp", args: [APP],
        })
    })

    it("throws on an unsafe pkgPath", () => {
        expect(() => buildApproveAppMsg(CURATOR, `gno.land/r/x") + Evil("`)).toThrow()
    })
})

describe("buildRejectAppMsg", () => {
    it("builds a RejectApp vm/MsgCall carrying the curator's reason", () => {
        const msg = buildRejectAppMsg(CURATOR, APP, "broken link")
        expect(msg.value.func).toBe("RejectApp")
        expect(msg.value.send).toBe("")
        expect(msg.value.args).toEqual([APP, "broken link"])
    })

    it("throws on an unsafe pkgPath or an over-limit reason (the realm would panic)", () => {
        expect(() => buildRejectAppMsg(CURATOR, "evil.com/x", "r")).toThrow()
        expect(() => buildRejectAppMsg(CURATOR, APP, "a".repeat(MAX_REASON_LEN + 1))).toThrow()
    })

    it("allows an empty reason (realm-legal; requiring text is the page's concern)", () => {
        expect(buildRejectAppMsg(CURATOR, APP, "").value.args).toEqual([APP, ""])
    })
})

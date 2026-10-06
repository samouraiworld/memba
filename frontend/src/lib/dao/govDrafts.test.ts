import { describe, expect, it } from "vitest"
import { bridgeDraftCall, opsFor, rosterDraft } from "./govDrafts"
import { planGovCall } from "./govTx"
import { CRITICAL, FINANCIAL, GOV_PATH, ROUTINE } from "./govActions"

const ADDR = "g1mtmrdmqfu0aryqfl4aw65n35haw2wdjkh5p4cp"

describe("proposal drafts", () => {
    it("asks the bridge with exactly the calls its node fixtures check", () => {
        expect(bridgeDraftCall("SetFee", "memba_market_config", ["service", "300"])).toBe("s:6:SetFee|s:7:service|i:300")
        expect(bridgeDraftCall("ResolveDispute", "escrow_v4", ["0", "0", "0"])).toBe("s:14:ResolveDispute|s:1:0|i:0|b:0")
        expect(bridgeDraftCall("AddMember", "memba_dao_channels_v2", [ADDR, "dev"])).toBe(`s:9:AddMember|s:21:memba_dao_channels_v2|a:${ADDR}|s:3:dev`)
        expect(bridgeDraftCall("CreateChannel", "memba_dao_channels_v2", ["news", "Team news", "text"])).toBe("s:13:CreateChannel|s:21:memba_dao_channels_v2|s:4:news|s:9:Team news|s:4:text")
        expect(bridgeDraftCall("SetSigner", "memba_quest_attestation_v1", ["ab".repeat(32)])).toMatch(/^s:14:SetQuestSigner\|s:64:/)
        expect(bridgeDraftCall("CancelTransfer", "memba_feed_v1", [])).toBe("s:14:CancelTransfer|s:13:memba_feed_v1")
    })

    it("offers each app only the actions the bridge applies to it", () => {
        expect(opsFor("memba_market_config").sort()).toEqual(["CancelTransfer", "SetFee", "SetTreasury", "TransferAdmin"])
        expect(opsFor("memba_reviews_v2")).toContain("Unhide")
        expect(opsFor("memba_reviews_v2")).not.toContain("SetPause")
        expect(() => bridgeDraftCall("SetFee", "escrow_v4", ["service", "1"])).toThrow("does not apply")
        expect(() => bridgeDraftCall("Grant", "memba_feed_v1", ["G1UPPER"])).toThrow("lowercase bech32")
    })

    it("encodes roster actions with the class the core fixes", () => {
        const add = rosterDraft("AddMember", ["nina", ADDR, "1"], "welcome")
        expect(add).toEqual({ target: GOV_PATH, action: "AddMember", args: `s:4:nina|a:${ADDR}|u:1`, scope: "", class: CRITICAL, note: "welcome" })
        expect(rosterDraft("RemoveInactive", ["lours"], "").class).toBe(ROUTINE)
        expect(rosterDraft("Uninvite", ["mikael"], "").class).toBe(FINANCIAL)
        expect(() => rosterDraft("AddMember", ["nina", "nope", "1"], "")).toThrow()
        expect(planGovCall(ADDR, { type: "propose", draft: add }).msg.value).toMatchObject({ func: "Propose", args: [GOV_PATH, "AddMember", `s:4:nina|a:${ADDR}|u:1`, "", "3", "welcome"], max_deposit: "1000000ugnot" })
        expect(() => planGovCall(ADDR, { type: "propose", draft: { ...add, note: "x".repeat(281) } })).toThrow("280")
        expect(() => planGovCall(ADDR, { type: "propose", draft: { ...add, note: "tab\there" } })).toThrow("280")
    })
})

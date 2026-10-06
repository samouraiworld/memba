import { describe, expect, it } from "vitest"
import native from "./testdata/memba-gov/native.json"
import { BRIDGE_PATH, CRITICAL, decodeGovAction, FINANCIAL, GOV_PATH, govNeverRuns, ROUTINE } from "./govActions"

const proposals = [...native.page0.proposals, ...native.page22.proposals]

describe("decodeGovAction", () => {
    it("names every argument of every proposal memba_gov holds, except the unknown app", () => {
        for (const p of proposals) {
            const d = decodeGovAction(p.target, p.action, p.args)
            if (p.target === "gno.land/r/samcrew/govtest/app") { expect(d).toBeNull(); continue }
            expect(d, `${p.action} ${p.args}`).not.toBeNull()
            expect(d!.rows.length).toBeGreaterThan(0)
            expect(p.class).toBeGreaterThanOrEqual(d!.minClass)
            if (p.target === BRIDGE_PATH) expect(d!.rows.at(-1)!.label).toMatch(/tenure/)
        }
        const decoded = new Set(proposals.map(p => p.action))
        for (const op of ["TransferAdmin", "CancelTransfer", "SetPause", "Grant", "Revoke", "Curate", "SetRegistrationFee", "SetTreasury", "SetFee", "ResolveDispute",
            "ProposeFeeRecipient", "CancelFeeRecipient", "HideReview", "HideComment", "Unhide", "SetSigner", "AddMember", "RemoveMember", "SetRoles", "CreateChannel"]) {
            expect([...decoded].some(a => a.endsWith(`.${op}`)), op).toBe(true)
        }
    })

    it("labels the state each approval was voted on", () => {
        const pay = decodeGovAction(BRIDGE_PATH, "escrow_v4.ResolveDispute", "s:1:0|i:0|b:0|s:8:disputed|s:9:completed|i:1000000|i:42|i:200|s:40:g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5|u:1")!
        expect(pay.title).toBe("Escrow · Settle an escrow dispute")
        expect(pay.minClass).toBe(FINANCIAL)
        expect(pay.rows.map(r => [r.label, r.value])).toContainEqual(["Platform fee", "200"])
        const refund = decodeGovAction(BRIDGE_PATH, "escrow_v4.ResolveDispute", "s:1:0|i:1|b:1|s:8:disputed|s:6:funded|i:2000000|i:43|u:1")!
        expect(refund.rows.map(r => r.label)).not.toContain("Platform fee")
        const badge = decodeGovAction(BRIDGE_PATH, "gnobuilders_badges_v2.Grant", "a:g1mtmrdmqfu0aryqfl4aw65n35haw2wdjkh5p4cp|i:1|u:1")!
        expect(badge.rows[1]).toEqual({ label: "Badge admins now", value: "1", kind: "count" })
        expect(decodeGovAction(GOV_PATH, "RemoveInactive", "s:5:lours")).toMatchObject({ title: "Remove an inactive member", minClass: ROUTINE })
        expect(decodeGovAction(GOV_PATH, "Recover", "s:5:lours|a:g1mtmrdmqfu0aryqfl4aw65n35haw2wdjkh5p4cp")!.minClass).toBe(CRITICAL)
    })

    it("shows raw anything whose target, action, app or argument shape it does not know", () => {
        const fee = "s:7:service|i:300|i:200|u:1"
        expect(decodeGovAction(BRIDGE_PATH, "memba_market_config.SetFee", fee)).not.toBeNull()
        for (const [target, action, args] of [
            ["gno.land/r/samcrew/memba_bridge_v2", "memba_market_config.SetFee", fee],
            [BRIDGE_PATH, "memba_market_config.SetFees", fee],
            [BRIDGE_PATH, "memba_dao.SetFee", fee],
            [BRIDGE_PATH, "escrow_v4.SetFee", fee], // the op exists, but not on that app
            [BRIDGE_PATH, "memba_market_config.SetFee", "s:7:service|i:300|i:200"],
            [BRIDGE_PATH, "memba_market_config.SetFee", "s:7:service|u:300|i:200|u:1"],
            [BRIDGE_PATH, "memba_market_config.SetFee", "s:7:service|i:300|i:200|u:01"],
            [BRIDGE_PATH, "memba_market_config.toString", fee],
            [BRIDGE_PATH, "__proto__.SetFee", fee],
            [GOV_PATH, "constructor", "s:1:x"],
            [GOV_PATH, "Uninvite", "s:1:x|u:1"],
        ]) expect(decodeGovAction(target, action, args), `${target} ${action} ${args}`).toBeNull()
    })

    it("says why a decoded proposal can never run: class, scope, or values the bridge refuses", () => {
        const fee = "s:7:service|i:300|i:200|u:1"
        const d = decodeGovAction(BRIDGE_PATH, "memba_market_config.SetFee", fee)!
        expect(d.scope).toBe("memba_market_config")
        expect(govNeverRuns({ class: FINANCIAL, scope: "memba_market_config" }, d)).toBeNull()
        expect(govNeverRuns({ class: ROUTINE, scope: "memba_market_config" }, d)).toMatch(/below the Financial class/)
        expect(govNeverRuns({ class: FINANCIAL, scope: "memba_market_config/bogus" }, d)).toMatch(/not the "memba_market_config"/)
        for (const p of proposals) {
            const decoded = decodeGovAction(p.target, p.action, p.args)
            if (decoded) expect(govNeverRuns(p, decoded), `${p.action} ${p.scope}`).toBeNull()
        }
        const curate = (op: string, reason: string) => decodeGovAction(BRIDGE_PATH, "memba_appstore_v3.Curate",
            `s:${op.length}:${op}|s:19:gno.land/r/demo/app|s:${reason.length}:${reason}|s:7:pending|u:1`)!
        expect(curate("delist", "").scope).toBe("memba_appstore_v3/l/gno.land/r/demo/app")
        expect(curate("delist", "").refused).toBeNull()
        expect(curate("destroy", "").refused).toMatch(/no curation "destroy"/)
        expect(curate("reject", "").refused).toMatch(/reason goes with reject/)
        expect(curate("delist", "spam").refused).toMatch(/reason goes with reject/)
        const member = (roles: string) => decodeGovAction(BRIDGE_PATH, "memba_feedback_v2.AddMember",
            `a:g1mtmrdmqfu0aryqfl4aw65n35haw2wdjkh5p4cp|s:${roles.length}:${roles}|u:1|s:0:|u:1`)!.refused
        expect(member("admin,ops")).toBeNull()
        expect(member("ops,admin")).toMatch(/ordered subset/)
        expect(member("owner")).toMatch(/ordered subset/)
        expect(member("")).toMatch(/ordered subset/)
        expect(decodeGovAction(BRIDGE_PATH, "memba_dao_channels_v2.CreateChannel", "s:4:news|s:4:News|s:5:forum|i:6|u:1")!.refused).toMatch(/channel type/)
        expect(decodeGovAction(BRIDGE_PATH, "memba_quest_attestation_v1.SetSigner", "s:4:ABCD|s:0:|u:1")!.refused).toMatch(/64 lowercase hex/)
        expect(decodeGovAction(BRIDGE_PATH, "escrow_v4.ResolveDispute", "s:1:7|i:2|b:1|s:8:disputed|s:6:funded|i:5|i:9|u:1")!.scope).toBe("escrow_v4/c/7/m/2")
        expect(decodeGovAction(BRIDGE_PATH, "memba_reviews_v2.Unhide", `u:4|b:1|b:1|b:0|a:g1mtmrdmqfu0aryqfl4aw65n35haw2wdjkh5p4cp|i:7|s:64:${"a".repeat(64)}|i:0|b:1|u:1`)!.scope).toBe("memba_reviews_v2/i/4")
        expect(decodeGovAction(GOV_PATH, "Uninvite", "s:6:mikael")!.scope).toBe("")
    })

    it("flags every proposal whose bound values the bridge refuses, as a proposal filed directly on memba_gov can carry them", () => {
        const A = "g1mtmrdmqfu0aryqfl4aw65n35haw2wdjkh5p4cp", BRIDGE = "g1ejzh9w5z3wuylrrnkc97epjtrdylpmzdj2a0zp", H = "a".repeat(64)
        const refused = (action: string, args: string) => decodeGovAction(BRIDGE_PATH, action, args)!.refused
        for (const [action, args, why] of [
            ["memba_reviews_v2.HideReview", `u:2|b:0|b:0|b:0|a:${A}|i:6|u:1`, "a comment, not a review"],
            ["memba_reviews_v2.HideComment", `u:1|b:1|b:0|b:0|a:${A}|i:5|u:1`, "a review, not a comment"],
            ["memba_reviews_v2.HideReview", `u:1|b:1|b:1|b:0|a:${A}|i:5|u:1`, "already hidden or deleted"],
            ["memba_reviews_v2.HideComment", `u:2|b:0|b:0|b:1|a:${A}|i:6|u:1`, "already hidden or deleted"],
            ["memba_reviews_v2.Unhide", `u:1|b:1|b:0|b:0|a:${A}|i:5|s:64:${H}|i:0|b:0|u:1`, "neither hidden nor flagged"],
            ["escrow_v4.ResolveDispute", "s:1:0|i:0|b:1|s:8:released|s:9:completed|i:5|i:9|u:1", "released, not disputed"],
            ["memba_dao_channels_v2.AddMember", `a:${A}|s:3:dev|u:1|s:6:member|u:1`, "already a member"],
            ["memba_dao_channels_v2.SetRoles", `a:${A}|s:3:dev|u:1|s:0:|u:1`, "not a member"],
            ["memba_dao_channels_v2.RemoveMember", `a:${A}|s:0:|u:1|s:0:|u:1`, "not a member"],
            ["memba_dao_channels_v2.RemoveMember", `a:${A}|s:3:dev|u:1|s:3:dev|u:1`, "names no roles"],
            ["memba_feed_v1.CancelTransfer", "s:0:|u:1", "nothing is staged"],
            ["escrow_v4.CancelFeeRecipient", "s:0:|u:1", "nothing is staged"],
            ["memba_market_config.SetFee", "s:0:|i:100|i:200|u:1", "names its lane"],
            ["memba_market_config.SetFee", "s:3:nft|i:501|i:200|u:1", "0 to 500 bps"],
            ["memba_appstore_v3.SetRegistrationFee", "i:-5|i:1000000|u:1", "0 to 100000000 ugnot"],
            ["memba_feedback_v2.CreateChannel", "s:8:Bad_Name|s:3:Bad|s:4:text|i:4|u:1", "a channel name is"],
            ["memba_feedback_v2.CreateChannel", "s:3:c20|s:1:x|s:4:text|i:20|u:1", "at most 20 channels"],
            ["memba_feed_v1.Grant", `a:${BRIDGE}|u:1`, "governance or app realm"],
            ["memba_market_config.TransferAdmin", `a:${BRIDGE}|s:0:|u:1`, "governance or app realm"],
            ["memba_appstore_v3.SetTreasury", `a:${BRIDGE}|s:0:|u:1`, "governance or app realm"],
            ["escrow_v4.ProposeFeeRecipient", `a:${BRIDGE}|s:0:|s:0:|u:1`, "governance or app realm"],
            ["memba_dao_channels_v2.AddMember", `a:${BRIDGE}|s:3:dev|u:1|s:0:|u:1`, "governance or app realm"],
            ["memba_appstore_v3.Revoke", `a:${BRIDGE}|u:1`, "keeps its own role"],
        ]) expect(refused(action, args), `${action} ${args}`).toContain(why)
        // A stale grant held by another protected realm can still be revoked.
        expect(refused("memba_feed_v1.Revoke", "a:g1lyejwwmxef5tn8nx69saykmgm8rlr4xq9yeh3z|u:1")).toBeNull()
    })
})

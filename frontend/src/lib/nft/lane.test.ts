import { beforeEach, describe, expect, it, vi } from "vitest"

const reads = vi.hoisted(() => ({ queryEval: vi.fn() }))
vi.mock("../dao/shared", async (original) => ({ ...(await original<object>()), queryEval: reads.queryEval }))

import { getLaneStatus, laneClosedReason, LAUNCHPAD_CONFIG_PATH } from "./lane"

const answer = (json: object) => `(${JSON.stringify(JSON.stringify(json))} string)`
const status = (more: object = {}) => ({
    schema: "launchpad-config-action-v1", lane: "nft_drops", currency: "ugnot", version: "3",
    paused: false, allowlisted: true, laneReady: true, configGateOpen: true, ...more,
})

describe("lane status", () => {
    beforeEach(() => { reads.queryEval.mockReset() })

    it("reads config's answer for one lane and currency", async () => {
        reads.queryEval.mockResolvedValue(answer(status()))
        expect(await getLaneStatus("nft_drops", "ugnot")).toEqual({ lane: "nft_drops", currency: "ugnot", paused: false, allowlisted: true, laneReady: true, open: true })
        expect(reads.queryEval).toHaveBeenCalledWith(expect.any(String), LAUNCHPAD_CONFIG_PATH, `ActionStatusJSON("nft_drops", "ugnot")`, true)
    })

    it("refuses an answer for another lane, another schema or one that contradicts itself", async () => {
        for (const bad of [status({ lane: "nft_market" }), status({ schema: "launchpad-action-terms/v1" }), status({ paused: true }), status({ version: 3 })]) {
            reads.queryEval.mockResolvedValueOnce(answer(bad))
            await expect(getLaneStatus("nft_drops", "ugnot")).rejects.toThrow()
        }
        await expect(getLaneStatus("nft_drops", `ugnot")`)).rejects.toThrow("Invalid currency")
    })

    it("says why a lane is closed", async () => {
        const of = async (more: object) => { reads.queryEval.mockResolvedValueOnce(answer(status({ ...more, configGateOpen: false }))); return laneClosedReason(await getLaneStatus("nft_drops", "ugnot"), "Minting") }
        expect(await of({ paused: true })).toBe("Minting is paused on this network for now.")
        expect(await of({ allowlisted: false })).toBe("Minting in this currency is not allowed on this network.")
        expect(await of({ laneReady: false })).toBe("Minting is not set up on this network yet.")
    })
})

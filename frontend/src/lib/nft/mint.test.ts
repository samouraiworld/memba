import { beforeEach, describe, expect, it, vi } from "vitest"

const reads = vi.hoisted(() => ({ queryEval: vi.fn() }))
vi.mock("../dao/shared", async (original) => ({ ...(await original<object>()), queryEval: reads.queryEval }))

import { NFT_DROPS_PATH, type NftStage } from "./drops"
import { getLaneStatus, laneClosedReason, LAUNCHPAD_CONFIG_PATH } from "./lane"
import { buildMintMsg, mintBlocker } from "./mint"

const BUYER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const stage = (more: Partial<NftStage> = {}): NftStage => ({
    index: 2, kind: "fixed", start: 1n, end: 2n, open: true, price: 1_500_000n, floor: 0n, currentPrice: 1_500_000n, currency: "ugnot",
    feeBPS: 200n, supplyCap: 0n, perWallet: 2n, root: "", gate: "", minted: 0n, ...more,
})
const answer = (json: object) => `(${JSON.stringify(JSON.stringify(json))} string)`
const status = (more: object = {}) => ({
    schema: "launchpad-config-action-v1", lane: "nft_drops", currency: "ugnot", version: "3",
    paused: false, allowlisted: true, laneReady: true, configGateOpen: true, ...more,
})

describe("mint call", () => {
    it("attaches exactly the amount offered and names the stage's currency", () => {
        expect(buildMintMsg(BUYER, "C1", stage(), 1_500_000n, 0n)).toEqual({
            type: "vm/MsgCall",
            value: {
                caller: BUYER, send: "1500000ugnot", pkg_path: NFT_DROPS_PATH, func: "Mint",
                args: ["C1", "2", "ugnot", "1500000", "0", "", "0"], max_deposit: "2000000ugnot",
            },
        })
    })

    it("attaches nothing for a free mint and passes the gate token of a holder stage", () => {
        const msg = buildMintMsg(BUYER, "C1", stage({ kind: "holder", gate: "C2", price: 0n, currentPrice: 0n }), 0n, 7n)
        expect(msg.value).toMatchObject({ send: "", args: ["C1", "2", "ugnot", "0", "0", "", "7"] })
    })

    it("refuses what the realm would refuse, before any wallet", () => {
        expect(() => buildMintMsg(BUYER, "C1", stage(), 1_499_999n, 0n)).toThrow("below the stage's price")
        expect(() => buildMintMsg(BUYER, "C1", stage({ kind: "holder", gate: "C2" }), 1_500_000n, 0n)).toThrow("Choose the gate token")
        expect(() => buildMintMsg(BUYER, "C1", stage(), 1_500_000n, 3n)).toThrow("takes no gate token")
        expect(() => buildMintMsg(BUYER, "C1", stage(), -1n, 0n)).toThrow("Invalid amount offered")
        expect(() => buildMintMsg(BUYER.toUpperCase(), "C1", stage(), 1_500_000n, 0n)).toThrow("Invalid minter")
        expect(() => buildMintMsg(BUYER, "C01", stage(), 1_500_000n, 0n)).toThrow("Invalid collection ID")
        expect(() => buildMintMsg(BUYER, "C1", stage({ open: false }), 1_500_000n, 0n)).toThrow("not open")
    })

    it("names each stage Memba cannot mint in yet", () => {
        expect(mintBlocker(stage())).toBe("")
        expect(mintBlocker(stage({ kind: "dutch", floor: 1n }))).toBe("")
        expect(mintBlocker(stage({ open: false }))).toBe("This stage is not open.")
        expect(mintBlocker(stage({ supplyCap: 3n, minted: 3n }))).toBe("This stage is sold out.")
        expect(mintBlocker(stage({ supplyCap: 3n, minted: 2n }))).toBe("")
        expect(mintBlocker(stage({ kind: "allowlist", perWallet: 0n }))).toMatch(/^Minting from an allowlist/)
        expect(mintBlocker(stage({ currency: "gno.land/r/demo/foo20" }))).toMatch(/^Minting in a token/)
    })
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

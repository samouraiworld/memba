import { describe, expect, it } from "vitest"

import { NFT_DROPS_PATH, type NftStage } from "./drops"
import { buildMintMsg, mintBlocker } from "./mint"

const BUYER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const stage = (more: Partial<NftStage> = {}): NftStage => ({
    index: 2, kind: "fixed", start: 1n, end: 2n, open: true, price: 1_500_000n, floor: 0n, currentPrice: 1_500_000n, currency: "ugnot",
    feeBPS: 200n, supplyCap: 0n, perWallet: 2n, root: "", gate: "", gateLimit: 0n, minted: 0n, ...more,
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
        expect(() => buildMintMsg(BUYER, "C1", stage({ kind: "holder", gate: "C2" }), 1_500_000n, 0n)).toThrow("Choose the gate token that allows this mint.")
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

/**
 * grc721.test.ts — regression for the broadcast-type bug.
 *
 * Every GRC721 MsgCall builder must emit the Amino type "vm/MsgCall". They are
 * broadcast via doContractBroadcast → toAdenaMessages, which ONLY accepts
 * "vm/MsgCall" and throws on the Adena wire type "/vm.m_call". Builders that
 * emitted "/vm.m_call" directly made NFT mint/transfer/list/buy fail before
 * ever reaching the wallet.
 */

import { describe, it, expect } from "vitest"
import { buildMintMsg, buildTransferMsg, buildApproveMsg, buildBurnMsg, buildListForSaleMsg, buildBuyMsg } from "./grc721"
import { toAdenaMessages } from "./grc20"

describe("grc721 builders — broadcast path", () => {
    const caller = "g1testcaller"
    const realm = "gno.land/r/test/nft"

    it("every GRC721 builder survives toAdenaMessages", () => {
        const market = "gno.land/r/test/nft_market"
        const msgs = [
            buildMintMsg(caller, realm, caller, "tok-1", "ipfs://uri"),
            buildTransferMsg(caller, realm, caller, "g1to", "tok-1"),
            buildApproveMsg(caller, realm, "g1op", "tok-1"),
            buildBurnMsg(caller, realm, "tok-1"),
            buildListForSaleMsg(caller, market, realm, "tok-1", 1000000),
            buildBuyMsg(caller, market, realm, "tok-1", 1000000),
        ]
        expect(() => toAdenaMessages(msgs)).not.toThrow()
        expect(toAdenaMessages(msgs).every((m) => m.type === "/vm.m_call")).toBe(true)
    })

    it("buildMintMsg emits vm/MsgCall with Mint func", () => {
        const msg = buildMintMsg(caller, realm, caller, "tok-1", "ipfs://uri")
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("Mint")
    })
})

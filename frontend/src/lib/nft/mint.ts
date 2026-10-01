/**
 * The drops realm's Mint call as Memba signs it: one token from an open
 * fixed-price, dutch or holder stage priced in GNOT. The buyer attaches the
 * price it read; a dutch price only falls, so the realm charges the price at
 * the block and sends the rest back in the same transaction. Allowlist stages
 * need the creator's list to build a proof, and stages priced in a token need
 * that token's own approval call: Memba does not mint in either yet, and says so.
 *
 * @module lib/nft/mint
 */
import { depositCapUgnot } from "../dao/v2Budget"
import type { AminoMsg } from "../grc20"
import { NFT_DROPS_PATH, type NftStage } from "./drops"
import { address, collectionId } from "./parse"
import { natural } from "./read"

export const NATIVE_CURRENCY = "ugnot"

/**
 * Measured 18 to 25.5M gas for one mint (pinned Gno e75fef8, committed-node
 * fixtures): fixed price at the low end, dutch, holder and allowlist stages at
 * the high end. The limit leaves a third of headroom over the highest.
 */
export const MINT_GAS_WANTED = 35_000_000

/** Measured 4.1 to 10 KB of new storage for one mint; the deposit cap is twice the highest. */
export const MINT_STORAGE_BYTES = 10_000

/** Why Memba cannot mint in this stage now; empty when it can. */
export function mintBlocker(stage: NftStage): string {
    if (!stage.open) return "This stage is not open."
    if (stage.supplyCap > 0n && stage.minted >= stage.supplyCap) return "This stage is sold out."
    if (stage.kind === "allowlist") return "Minting from an allowlist arrives in a later version of Memba OS."
    if (stage.currency !== NATIVE_CURRENCY) return "Minting in a token arrives in a later version of Memba OS."
    return ""
}

/**
 * Mint(id, index, currencyKey, offered, allowance, proof, gateNumber), with
 * exactly `offered` ugnot attached. `gateNumber` names the gate token of a
 * holder stage and is 0 elsewhere.
 */
export function buildMintMsg(caller: string, collection: string, stage: NftStage, offered: bigint, gateNumber: bigint): AminoMsg {
    const blocker = mintBlocker(stage)
    if (blocker) throw new Error(blocker)
    natural(offered, "amount offered")
    natural(gateNumber, "gate token number")
    if (offered < stage.currentPrice) throw new Error("The amount offered is below the stage's price.")
    if ((stage.kind === "holder") !== (gateNumber > 0n)) throw new Error(stage.kind === "holder" ? "Choose the gate token that pays for this mint." : "This stage takes no gate token.")
    return {
        type: "vm/MsgCall",
        value: {
            caller: address(caller, "minter"),
            // Exactly the amount offered, as the realm requires: none at all for a free mint.
            send: offered > 0n ? `${offered}${NATIVE_CURRENCY}` : "",
            pkg_path: NFT_DROPS_PATH,
            func: "Mint",
            args: [collectionId(collection), String(natural(stage.index, "stage index")), NATIVE_CURRENCY, offered.toString(), "0", "", gateNumber.toString()],
            max_deposit: `${depositCapUgnot(MINT_STORAGE_BYTES)}${NATIVE_CURRENCY}`,
        },
    }
}

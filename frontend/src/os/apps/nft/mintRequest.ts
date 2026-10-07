/**
 * Minting one token goes through the OS review sheet like every OS write. The
 * sheet shows what was read when the member asked; right before the wallet
 * opens, the lane, the stage, the member's count and the gate token are read
 * again, and any change stops the signature.
 *
 * @module os/apps/nft/mintRequest
 */
import { isNftEnabled, isRealmValidOn } from "../../../lib/config"
import { isValidGnoAddressChecksum } from "../../../lib/dao/address"
import { depositCapUgnot, formatUgnot, formatUgnotExact } from "../../../lib/dao/v2Budget"
import { assertFeeStillCovers, doContractBroadcast, feeForGasWanted, freshFeeForGasWanted, type GasPrice } from "../../../lib/grc20"
import { NFT_DROPS_PATH, gateUsed, listStages, mintedBy, type NftStage } from "../../../lib/nft/drops"
import { formatAmount, formatBPS } from "../../../lib/nft/format"
import { getCollection, getToken } from "../../../lib/nft/ledger"
import { MINT_GAS_WANTED, MINT_STORAGE_BYTES, NATIVE_CURRENCY, buildMintMsg, mintBlocker, supplyBlocker, type MintSupply } from "../../../lib/nft/mint"
import { laneClosedReason, readActionStatus } from "../../../lib/tokenLaunchpadConfigClient"
import type { SettledOutcome, SignRequest } from "../../sign/signer"
import { verifySendTx } from "../../wallet/sendRequest"

export interface MintDraft {
    collection: string
    collectionName: string
    /** The collection's supply as read when the member asked: a sealed or full collection mints nothing. */
    supply: MintSupply
    /** The stage as read when the member asked to mint. */
    stage: NftStage
    /** The gate token of a holder stage; 0 elsewhere. */
    gateNumber: bigint
    /** What the member had minted in this stage when the sheet was asked for. */
    mintedSoFar: bigint
    caller: string
    networkKey: string
    chainId: string
    /** The network gas price, read from the chain when the sheet was asked for. */
    price: GasPrice
    onSettled?: (outcome: SettledOutcome) => void
}

/** Stops a draft Memba must not sign. Throws with a user message. */
function validated(draft: MintDraft): MintDraft {
    if (!isNftEnabled() || !isRealmValidOn(draft.networkKey, NFT_DROPS_PATH)) throw new Error("Minting is not available on this network.")
    if (!isValidGnoAddressChecksum(draft.caller)) throw new Error("Connect your wallet before minting.")
    const blocker = supplyBlocker(draft.supply) || mintBlocker(draft.stage)
    if (blocker) throw new Error(blocker)
    if (draft.mintedSoFar >= draft.stage.perWallet) throw new Error("This account has minted as many tokens as this stage allows per wallet.")
    return draft
}

/** The gate token must have existed when the stage was scheduled, still be the member's, live, and not yet used in this stage. */
export async function assertGateToken(collection: string, stage: NftStage, gateNumber: bigint, owner: string): Promise<void> {
    if (gateNumber > stage.gateLimit) throw new Error(gateLimitText(stage, gateNumber))
    const [token, used] = await Promise.all([getToken(stage.gate, gateNumber), gateUsed(collection, stage.index, gateNumber)])
    if (token.status !== "active" || token.owner !== owner) throw new Error(`This account does not hold ${stage.gate} #${gateNumber}.`)
    if (used) throw new Error(`${stage.gate} #${gateNumber} has already been used for a mint in this stage.`)
}

/** Why a gate token minted after the stage was scheduled opens no mint. */
function gateLimitText(stage: NftStage, gateNumber: bigint): string {
    return stage.gateLimit === 0n
        ? `${stage.gate} #${gateNumber} was minted after this stage was scheduled, when ${stage.gate} had no token: no token opens a mint here.`
        : `${stage.gate} #${gateNumber} was minted after this stage was scheduled: only ${stage.gate} #1 to #${stage.gateLimit} allow a mint here.`
}

/** The fresh stage still has the terms the member reviewed, and is still open for one more token. */
function assertSameStage(read: NftStage | undefined, reviewed: NftStage, offered: bigint): asserts read is NftStage {
    const same = !!read && read.kind === reviewed.kind && read.currency === reviewed.currency && read.feeBPS === reviewed.feeBPS &&
        read.start === reviewed.start && read.end === reviewed.end && read.gate === reviewed.gate && read.gateLimit === reviewed.gateLimit &&
        read.perWallet === reviewed.perWallet
    if (!same) throw new Error("This stage changed after your review. Nothing was sent. Close the review and read the stage again.")
    const blocker = mintBlocker(read)
    if (blocker) throw new Error(`${blocker} Nothing was sent.`)
    if (read.currentPrice > offered) throw new Error("The price is now above the amount you reviewed. Nothing was sent.")
}

export function mintRequest(input: MintDraft): SignRequest {
    const draft = validated(input)
    const { stage } = draft
    // A dutch price only falls: what was read is the most the realm can charge.
    const offered = stage.currentPrice
    const msg = buildMintMsg(draft.caller, draft.collection, stage, offered, draft.gateNumber)
    const fee = feeForGasWanted(MINT_GAS_WANTED, draft.price)
    const amount = (value: bigint) => formatAmount(value, NATIVE_CURRENCY)
    const price = offered === 0n ? "Free"
        : stage.kind === "dutch" ? `At most ${amount(offered)}. The price at the block is charged; the rest comes back in the same transaction.`
        : amount(offered)
    const label = `Mint from ${draft.collection}`
    return {
        title: "Mint",
        summary: `Mint one ${draft.collectionName} token`,
        sub: `Stage ${stage.index + 1} of ${draft.collection}`,
        lines: () => [
            ["Account", draft.caller],
            ["Collection", `${draft.collectionName} (${draft.collection})`],
            ["Price", price],
            ...(stage.kind === "holder" ? [["Gate token", `${stage.gate} #${draft.gateNumber}, used up for this stage by this mint`] as [string, string]] : []),
            ["Split", stage.feeBPS === 0n ? "The creator receives the whole price." : `${formatBPS(stage.feeBPS)} to the Launchpad treasury, the rest to the creator`],
            ["Minted by you in this stage", `${draft.mintedSoFar} of ${stage.perWallet}`],
            ["Drops realm", NFT_DROPS_PATH],
            ["Network", draft.chainId],
            ["Storage deposit", `Up to ${formatUgnot(depositCapUgnot(MINT_STORAGE_BYTES))}, locked with the new token`],
            ["Network fee", formatUgnotExact(fee)],
        ],
        note: offered === 0n ? "A free mint: nothing is paid but the network fee and the storage deposit. The token is yours once the transaction is in a block."
            : stage.feeBPS === 0n ? "A mint is a sale: the price goes to the creator in the same transaction and is not refunded. The token is yours once the transaction is in a block."
            : "A mint is a sale: the price goes to the creator and the treasury in the same transaction and is not refunded. The token is yours once the transaction is in a block.",
        label: () => label,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            validated(draft)
            const [lane, collection, stages, minted] = await Promise.all([
                readActionStatus(draft.networkKey, "nft_drops", NATIVE_CURRENCY), getCollection(draft.collection),
                listStages(draft.collection), mintedBy(draft.collection, stage.index, draft.caller),
                stage.kind === "holder" ? assertGateToken(draft.collection, stage, draft.gateNumber, draft.caller) : undefined,
            ])
            if (!lane.open) throw new Error(`${laneClosedReason(lane, "Minting")} Nothing was sent.`)
            const full = supplyBlocker(collection)
            if (full) throw new Error(`${full} Nothing was sent.`)
            assertSameStage(stages[stage.index], stage, offered)
            if (minted >= stage.perWallet) throw new Error("This account has minted as many tokens as this stage allows per wallet. Nothing was sent.")
            await assertFeeStillCovers(fee, () => freshFeeForGasWanted(MINT_GAS_WANTED))
        },
        send: (_choice, beforeSign) => doContractBroadcast([msg], label, { gasWanted: MINT_GAS_WANTED, gasFee: fee, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled: draft.onSettled,
    }
}

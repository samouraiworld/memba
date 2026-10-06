/**
 * Scheduling a stage and ending one go through the OS review sheet. What the
 * sheet shows is read again right before the wallet opens: that the signer is
 * still the collection's creator, the mint lane and its fee, the stages
 * already scheduled and, for a holder stage, the gate collection. Ending a
 * stage never asks the lane: a creator stops its own sale whatever is paused.
 *
 * @module os/apps/nft/studioRequest
 */
import { isNftEnabled, isRealmValidOn } from "../../../lib/config"
import { isValidGnoAddressChecksum } from "../../../lib/dao/address"
import { depositCapUgnot, formatUgnot, formatUgnotExact } from "../../../lib/dao/v2Budget"
import { assertFeeStillCovers, doContractBroadcast, feeForGasWanted, freshFeeForGasWanted, type GasPrice } from "../../../lib/grc20"
import { NFT_DROPS_PATH, getDropTerms, listStages, type NftStage } from "../../../lib/nft/drops"
import { formatAmount, formatBPS, formatTime } from "../../../lib/nft/format"
import { getCollection } from "../../../lib/nft/ledger"
import { RealmRefusedError } from "../../../lib/nft/read"
import {
    ADD_STAGE_GAS_WANTED, ADD_STAGE_STORAGE_BYTES, END_STAGE_GAS_WANTED, END_STAGE_STORAGE_BYTES, buildAddStageMsg, buildEndStageMsg, stageProblem, type StageTerms,
} from "../../../lib/nft/studio"
import { laneClosedReason, readActionStatus } from "../../../lib/tokenLaunchpadConfigClient"
import type { SettledOutcome, SignRequest } from "../../sign/signer"
import { verifySendTx } from "../../wallet/sendRequest"

interface Common {
    collection: string
    caller: string
    networkKey: string
    chainId: string
    gas: GasPrice
    onSettled?: (outcome: SettledOutcome) => void
}

export interface AddStageDraft extends Common {
    terms: StageTerms
    /** The protocol fee a new stage pins now, as read when the creator asked. */
    feeBPS: bigint
    /** The collection's stages as read then. */
    existing: readonly NftStage[]
}

export interface EndStageDraft extends Common {
    stage: NftStage
}

const nowSeconds = () => BigInt(Math.floor(Date.now() / 1000))

function available(draft: Common): void {
    if (!isNftEnabled() || !isRealmValidOn(draft.networkKey, NFT_DROPS_PATH)) throw new Error("Mint stages are not available on this network.")
    if (!isValidGnoAddressChecksum(draft.caller)) throw new Error("Connect your wallet first.")
}

/** Only the creator schedules or ends a stage. */
async function assertCreator(draft: Common): Promise<void> {
    if ((await getCollection(draft.collection)).creator !== draft.caller) throw new Error(`This account is not the creator of ${draft.collection}. Nothing was sent.`)
}

/** The same instant on this device's clock, as the form took it. */
function yourTime(seconds: bigint): string {
    const date = new Date(Number(seconds) * 1000)
    const two = (n: number) => String(n).padStart(2, "0")
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

const KIND: Record<StageTerms["kind"], string> = { fixed: "Fixed price", dutch: "Dutch auction", holder: "Holders" }

export function addStageRequest(draft: AddStageDraft): SignRequest {
    available(draft)
    const { terms } = draft
    const msg = buildAddStageMsg(draft.caller, draft.collection, terms, draft.feeBPS, nowSeconds(), draft.existing)
    const fee = feeForGasWanted(ADD_STAGE_GAS_WANTED, draft.gas)
    const amount = (value: bigint) => (value === 0n ? "Free" : formatAmount(value, "ugnot"))
    const number = draft.existing.length + 1
    const label = `Stage ${number} for ${draft.collection}`
    return {
        title: "Schedule a stage",
        summary: `${KIND[terms.kind]} stage ${number} for ${draft.collection}`,
        sub: `Stage ${number} of at most 10 for the collection's whole life`,
        lines: () => [
            ["Creator", draft.caller],
            ["Window", `${formatTime(terms.start)} to ${formatTime(terms.end)}`],
            ["Your time", `${yourTime(terms.start)} to ${yourTime(terms.end)}`],
            ["Price", terms.kind === "dutch" ? `${amount(terms.price)}, falling to ${amount(terms.floor)}` : amount(terms.price)],
            ["Per wallet", terms.perWallet.toString()],
            ["Stage cap", terms.supplyCap === 0n ? "None beyond the collection's" : terms.supplyCap.toString()],
            ...(terms.kind === "holder" ? [["Gate", `Each token of ${terms.gate} allows one mint`] as [string, string]] : []),
            ["Split of each mint", draft.feeBPS === 0n ? "The whole price to you" : `${formatBPS(draft.feeBPS)} to the Launchpad treasury, the rest to you`],
            ["Drops realm", NFT_DROPS_PATH],
            ["Network", draft.chainId],
            ["Storage deposit", `Up to ${formatUgnot(depositCapUgnot(ADD_STAGE_STORAGE_BYTES))}`],
            ["Network fee", formatUgnotExact(fee)],
        ],
        note: "The split is fixed for this stage. Once the stage opens its terms are final; you can still end it early. An ended stage keeps its place among the 10.",
        label: () => label,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            available(draft)
            await assertCreator(draft)
            const [lane, drop, stages] = await Promise.all([readActionStatus(draft.networkKey, "nft_drops", "ugnot"), getDropTerms("ugnot"), listStages(draft.collection)])
            if (!lane.open) throw new Error(`${laneClosedReason(lane, "Minting")} Nothing was sent.`)
            if (drop.primaryFeeBPS !== draft.feeBPS) throw new Error("The protocol fee for new stages changed after your review. Nothing was sent. Close the review and read it again.")
            if (stages.length !== draft.existing.length) throw new Error("The collection's stages changed after your review. Nothing was sent. Close the review and read them again.")
            const problem = stageProblem(draft.collection, terms, nowSeconds(), stages)
            if (problem) throw new Error(`${problem} Nothing was sent.`)
            if (terms.kind === "holder") {
                await getCollection(terms.gate).catch((err: unknown) => {
                    throw err instanceof RealmRefusedError ? new Error(`There is no collection ${terms.gate} to gate this stage. Nothing was sent.`) : err
                })
            }
            await assertFeeStillCovers(fee, () => freshFeeForGasWanted(ADD_STAGE_GAS_WANTED))
        },
        send: (_choice, beforeSign) => doContractBroadcast([msg], label, { gasWanted: ADD_STAGE_GAS_WANTED, gasFee: fee, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled: draft.onSettled,
    }
}

export function endStageRequest(draft: EndStageDraft): SignRequest {
    available(draft)
    const { stage } = draft
    const msg = buildEndStageMsg(draft.caller, draft.collection, stage)
    const fee = feeForGasWanted(END_STAGE_GAS_WANTED, draft.gas)
    const label = `End stage ${stage.index + 1} of ${draft.collection}`
    return {
        title: "End stage",
        summary: label,
        sub: `${stage.minted} minted so far`,
        lines: () => [
            ["Creator", draft.caller],
            ["Stage", `${stage.index + 1}, open until ${formatTime(stage.end)}`],
            ["Drops realm", NFT_DROPS_PATH],
            ["Network", draft.chainId],
            ["Storage deposit", `Up to ${formatUgnot(depositCapUgnot(END_STAGE_STORAGE_BYTES))}`],
            ["Network fee", formatUgnotExact(fee)],
        ],
        acks: ["I understand that an ended stage never opens again."],
        note: "Minting in this stage stops at the block of this transaction. It keeps its place among the collection's 10 stages, and a new stage can start right away.",
        label: () => label,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            available(draft)
            await assertCreator(draft)
            const read = (await listStages(draft.collection))[stage.index]
            if (!read?.open) throw new Error("This stage is no longer open. Nothing was sent.")
            await assertFeeStillCovers(fee, () => freshFeeForGasWanted(END_STAGE_GAS_WANTED))
        },
        send: (_choice, beforeSign) => doContractBroadcast([msg], label, { gasWanted: END_STAGE_GAS_WANTED, gasFee: fee, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled: draft.onSettled,
    }
}

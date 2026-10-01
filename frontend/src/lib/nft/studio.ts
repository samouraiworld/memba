/**
 * The drops realm's stage calls as a creator signs them in Memba: scheduling
 * a fixed-price, dutch or holder stage priced in GNOT, and ending an open
 * stage. The terms are checked by the realm's own rules (a window that has
 * not started and lasts at most a year, the fields a kind does not use left
 * zero), so a call the chain would refuse is stopped before any wallet.
 * Allowlist stages need the list of addresses kept where buyers can fetch
 * their proofs: Memba does not schedule them yet.
 *
 * @module lib/nft/studio
 */
import { depositCapUgnot } from "../dao/v2Budget"
import type { AminoMsg } from "../grc20"
import { NFT_DROPS_PATH, type NftStage } from "./drops"
import { INT64_MAX, address, collectionId } from "./parse"
import { natural } from "./read"

/** Measured 12 to 15M gas and 0.9 to 3.3 KB for a new stage, 9.8M and nothing for ending one; about twice each. */
export const ADD_STAGE_GAS_WANTED = 30_000_000
export const ADD_STAGE_STORAGE_BYTES = 3_500
export const END_STAGE_GAS_WANTED = 20_000_000
export const END_STAGE_STORAGE_BYTES = 500

/** The realm's hard limits. */
export const MAX_STAGES = 10
const MAX_STAGE_SECONDS = 365n * 24n * 60n * 60n
const MAX_PER_WALLET = 1_000_000n

export type StudioStageKind = "fixed" | "dutch" | "holder"

export interface StageTerms {
    kind: StudioStageKind
    /** Unix seconds; the stage is open during [start, end). */
    start: bigint
    end: bigint
    /** In ugnot; for a dutch stage, the price at the start. */
    price: bigint
    /** Dutch only: the price reached at the end. */
    floor: bigint
    /** Zero: no cap beyond the collection's. */
    supplyCap: bigint
    perWallet: bigint
    /** Holder only: the collection whose tokens each pay for one mint. */
    gate: string
}

/**
 * The first rule the realm would refuse a new stage by, in words; empty when
 * it would take it. `now` is Unix seconds: a start must still be ahead when
 * the transaction lands, so one less than a minute away is refused here.
 */
export function stageProblem(t: StageTerms, now: bigint, existing: readonly NftStage[] = []): string {
    if (existing.length >= MAX_STAGES) return "A collection has 10 stages for its whole life, and this one has used them all."
    if (t.start < now + 60n) return "The stage must start at least a minute from now."
    if (t.end <= t.start) return "The stage must end after it starts."
    if (t.end - t.start > MAX_STAGE_SECONDS) return "A stage lasts at most a year."
    if (t.price < 0n || t.price > INT64_MAX) return "The price is an amount of GNOT, 0 for a free mint."
    if (t.supplyCap < 0n || t.supplyCap > INT64_MAX) return "The stage cap is a whole number, 0 for no cap."
    if (t.perWallet < 1n || t.perWallet > MAX_PER_WALLET) return "Each wallet may mint between 1 and 1,000,000 tokens."
    if (t.kind === "dutch" ? !(t.floor >= 0n && t.floor < t.price) : t.floor !== 0n) return "A dutch stage falls to a floor below its starting price."
    if (t.kind === "holder") {
        try { collectionId(t.gate) } catch { return "Name the collection whose tokens give access, such as C1." }
    } else if (t.gate !== "") return "Only a holder stage names a gate collection."
    const clash = existing.find((other) => t.start < other.end && other.start < t.end)
    if (clash) return `The window overlaps stage ${clash.index + 1}.`
    return ""
}

/** AddStage(id, kind, start, end, price, floor, supplyCap, perWallet, "", gate, "ugnot", maxFeeBPS). */
export function buildAddStageMsg(caller: string, collection: string, t: StageTerms, maxFeeBPS: bigint, now: bigint, existing: readonly NftStage[]): AminoMsg {
    const problem = stageProblem(t, now, existing)
    if (problem) throw new Error(problem)
    return {
        type: "vm/MsgCall",
        value: {
            caller: address(caller, "account"),
            send: "",
            pkg_path: NFT_DROPS_PATH,
            func: "AddStage",
            args: [
                collectionId(collection), t.kind, t.start.toString(), t.end.toString(), t.price.toString(), t.floor.toString(),
                t.supplyCap.toString(), t.perWallet.toString(), "", t.gate, "ugnot", natural(maxFeeBPS, "maximum fee").toString(),
            ],
            max_deposit: `${depositCapUgnot(ADD_STAGE_STORAGE_BYTES)}ugnot`,
        },
    }
}

/** EndStage(id, index): closes an open stage at once and for good. */
export function buildEndStageMsg(caller: string, collection: string, stage: NftStage): AminoMsg {
    if (!stage.open) throw new Error("Only an open stage can be ended.")
    return {
        type: "vm/MsgCall",
        value: {
            caller: address(caller, "account"),
            send: "",
            pkg_path: NFT_DROPS_PATH,
            func: "EndStage",
            args: [collectionId(collection), String(natural(stage.index, "stage index"))],
            max_deposit: `${depositCapUgnot(END_STAGE_STORAGE_BYTES)}ugnot`,
        },
    }
}

/** Submit, edit or delist an App Store listing through the OS signing sheet. */
import { isAppStoreSubmitEnabled } from "../../../lib/config"
import { isValidGnoAddressChecksum } from "../../../lib/dao/address"
import { depositCapUgnot, formatUgnot, formatUgnotExact, STORAGE_PRICE_UGNOT } from "../../../lib/dao/v2Budget"
import { APPSTORE_REALM_PATH, isAppStoreV3On } from "../../../lib/appStore"
import {
    assertDelistApplies, assertEditApplies, assertRegisterApplies, buildDelistAppMsg, buildEditListingMsg, buildRegisterAppMsg,
    DELIST_GAS_WANTED, DELIST_STORAGE_BYTES, EDIT_GAS_WANTED, editStorageBytes, formatGnot, LISTING_MEMO, MAX_RESUBMITS, REGISTER_GAS_WANTED,
    registerStorageBytes, type AppSubmission,
} from "../../../lib/appStoreSubmit"
import { assertFeeStillCovers, doContractBroadcast, feeForGasWanted, freshFeeForGasWanted, type AminoMsg, type GasPrice } from "../../../lib/grc20"
import type { SettledOutcome, SignRequest } from "../../sign/signer"
import { verifySendTx } from "../../wallet/sendRequest"

export type ListingAction =
    | { kind: "register"; submission: AppSubmission; feeUgnot: number }
    /** `was` is the listing as loaded; `editsUsed` its count then. */
    | { kind: "edit"; submission: AppSubmission; was: AppSubmission; editsUsed: number }
    | { kind: "delist"; pkgPath: string; name: string }

export interface StoreListingCall {
    action: ListingAction
    caller: string
    networkKey: string
    chainId: string
    /** The network gas price the fee is quoted at, read from the chain when the sheet is asked for. */
    price: GasPrice
    onSettled?: (outcome: SettledOutcome) => void
}

/** Submitting needs the v3 registry on this network and the submission switch on; off, nothing is offered. */
export function isListingSubmitOpen(networkKey: string): boolean {
    return isAppStoreSubmitEnabled() && isAppStoreV3On(networkKey)
}

function plan(action: ListingAction, caller: string): { msg: AminoMsg; gas: number; storage: number; check: () => Promise<void> } {
    switch (action.kind) {
        case "register": return {
            msg: buildRegisterAppMsg(caller, action.feeUgnot, action.submission), gas: REGISTER_GAS_WANTED,
            storage: registerStorageBytes(action.submission), check: () => assertRegisterApplies(action.submission, action.feeUgnot),
        }
        case "edit": return {
            msg: buildEditListingMsg(caller, action.submission, action.was), gas: EDIT_GAS_WANTED,
            storage: editStorageBytes(action.was, action.submission), check: () => assertEditApplies(caller, action.submission, action.was, action.editsUsed),
        }
        case "delist": return {
            msg: buildDelistAppMsg(caller, action.pkgPath), gas: DELIST_GAS_WANTED,
            storage: DELIST_STORAGE_BYTES, check: () => assertDelistApplies(caller, action.pkgPath),
        }
    }
}

export function listingRequest(input: StoreListingCall): SignRequest {
    const { action, caller, chainId, onSettled } = input
    if (!isListingSubmitOpen(input.networkKey)) throw new Error("Submitting listings is not open on this network.")
    if (!isValidGnoAddressChecksum(caller)) throw new Error("Connect your wallet first.")
    const { msg, gas, storage, check } = plan(action, caller)
    const fee = feeForGasWanted(gas, input.price)
    const deposit = formatUgnot(storage * STORAGE_PRICE_UGNOT)
    const cap = formatUgnot(depositCapUgnot(storage))
    const path = action.kind === "delist" ? action.pkgPath : action.submission.pkgPath
    const name = action.kind === "delist" ? action.name : action.submission.name
    const title = action.kind === "register" ? "Submit an app" : action.kind === "edit" ? "Resubmit a listing" : "Delist an app"
    const specific: [string, string][] = action.kind === "register"
        ? [["Listing fee", `${formatGnot(action.feeUgnot)} GNOT, forwarded to the App Store treasury; not returned, including if the listing is rejected`],
            ["Storage deposit", `≈ ${deposit}, not returned (cap ${cap})`]]
        : action.kind === "edit"
            ? [["Edits used", `${action.editsUsed + 1} of ${MAX_RESUBMITS} after this one`], ["Storage deposit", `Up to ${deposit} for what this edit adds (cap ${cap})`]]
            : [["Storage deposit", `at most ${cap}, the cap sent with the call`]]
    return {
        title,
        summary: `${title}: ${name}`,
        sub: "Public onchain action",
        lines: () => [
            ["Account", caller],
            ["Package path", path],
            ...specific,
            ["App Store realm", APPSTORE_REALM_PATH],
            ["Network", chainId],
            ["Network fee", formatUgnotExact(fee)],
        ],
        warns: action.kind === "delist" ? ["Delisting is one-way for you: only a curator can restore the listing, and its package path stays taken."] : undefined,
        acks: action.kind === "delist" ? ["I understand only a curator can bring this listing back."] : ["I understand this listing is public and its chain history cannot be erased."],
        note: action.kind === "delist" ? "The listing leaves the public lists." : "The listing waits as pending until a curator approves or rejects it.",
        label: () => title,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            await check()
            await assertFeeStillCovers(fee, () => freshFeeForGasWanted(gas))
        },
        send: (_choice, beforeSign) => doContractBroadcast([msg], LISTING_MEMO[action.kind], { gasWanted: gas, gasFee: fee, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled,
    }
}

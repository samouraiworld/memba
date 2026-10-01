/** A report on an App Store listing (FlagApp) through the OS signing sheet. */
import { isValidGnoAddressChecksum } from "../../../lib/dao/address"
import { depositCapUgnot, formatUgnot, formatUgnotExact, STORAGE_PRICE_UGNOT } from "../../../lib/dao/v2Budget"
import { APP_FLAG_GAS_WANTED, APPSTORE_REALM_PATH, appFlagStorageBytes, assertAppReportApplies, buildFlagAppMsg, FLAG_HIDE_THRESHOLD, isAppStoreV3On, isSafeRealmPath } from "../../../lib/appStore"
import { assertFeeStillCovers, doContractBroadcast, feeForGasWanted, freshFeeForGasWanted, type GasPrice } from "../../../lib/grc20"
import type { SettledOutcome, SignRequest } from "../../sign/signer"
import { verifySendTx } from "../../wallet/sendRequest"
import { withFeeCheck } from "../../sign/recheck"

export interface StoreReport {
    pkgPath: string
    appName: string
    caller: string
    networkKey: string
    chainId: string
    /** The network gas price the fee is quoted at, read from the chain when the sheet is asked for; a rise is caught again before the wallet opens. */
    price: GasPrice
    onSettled?: (outcome: SettledOutcome) => void
}

function validated(input: StoreReport): StoreReport {
    if (!isAppStoreV3On(input.networkKey)) throw new Error("Reports are not available on this network.")
    if (!isValidGnoAddressChecksum(input.caller)) throw new Error("Connect your wallet first.")
    if (!isSafeRealmPath(input.pkgPath)) throw new Error("This listing cannot be identified. Refresh the page.")
    return input
}

export function reportRequest(input: StoreReport): SignRequest {
    const { pkgPath, appName, caller, chainId, onSettled } = validated({ ...input })
    const msg = buildFlagAppMsg(caller, pkgPath)
    const storage = appFlagStorageBytes(pkgPath)
    const fee = feeForGasWanted(APP_FLAG_GAS_WANTED, input.price)
    const title = "Report a listing"
    return {
        title,
        summary: `Report ${appName} to the App Store curators`,
        sub: "Public onchain action",
        lines: () => [
            ["Account", caller],
            ["Listing", pkgPath],
            ["App Store realm", APPSTORE_REALM_PATH],
            ["Network", chainId],
            ["Storage deposit", `≈ ${formatUgnot(storage * STORAGE_PRICE_UGNOT)}, not returned (cap ${formatUgnot(depositCapUgnot(storage))})`],
            ["Network fee", formatUgnotExact(fee)],
        ],
        acks: ["I understand this report is public and cannot be withdrawn."],
        note: `One report per account. Reports from ${FLAG_HIDE_THRESHOLD} different accounts hide the listing from the public lists until a curator clears them. Reporting the same listing again fails, and a failed transaction still costs its fee.`,
        label: () => title,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            validated(input)
            await withFeeCheck(assertAppReportApplies(caller, pkgPath), assertFeeStillCovers(fee, () => freshFeeForGasWanted(APP_FLAG_GAS_WANTED)))
        },
        send: (_choice, beforeSign) => doContractBroadcast([msg], title, { gasWanted: APP_FLAG_GAS_WANTED, gasFee: fee, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled,
    }
}

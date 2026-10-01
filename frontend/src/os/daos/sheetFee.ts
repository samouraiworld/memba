/**
 * The network fee a DAO signing sheet shows, re-checks and sends. A plan with a
 * measured gas limit pays the network price for it, with the usual headroom;
 * when the price could not be read the sheet says so and the fee is re-checked
 * before signing. A DAO without a measured budget keeps the gas and fee set in
 * Settings, which the broadcaster would use anyway: now shown, and checked
 * against what the chain needs (gas × price, no headroom). Either way the fee is
 * sent exactly as shown.
 *
 * @module os/daos/sheetFee
 */
import type { DaoTxPlan } from "../../lib/dao/daoTx"
import { formatUgnotExact } from "../../lib/dao/v2Budget"
import { getGasConfig } from "../../lib/gasConfig"
import { assertFeeStillCovers, FALLBACK_GAS_PRICE, feeForGasWanted, freshFeeForGasWanted, networkGasPriceFresh, type GasPrice } from "../../lib/grc20"

/** The price for a review: a fresh read, or the fallback, which the sheet then names as not read. */
export function quoteSheetGasPrice(): Promise<GasPrice> {
    return networkGasPriceFresh().catch(() => FALLBACK_GAS_PRICE)
}

const UNCONFIRMED = "Couldn't confirm the current network fee. Nothing was sent; try again when the network is available."

/** A fee set in Settings still pays what the chain charges for its gas limit right now. */
async function assertSettingsFeeCovers(gasFee: number, gasWanted: number): Promise<void> {
    let price: GasPrice
    try { price = await networkGasPriceFresh() } catch { throw new Error(UNCONFIRMED) }
    if (gasFee * price.gas < gasWanted * price.ugnot) {
        throw new Error("The fee set in Settings is below what the network now charges for this gas limit. Nothing was sent: raise it in Settings, then review again.")
    }
}

export function sheetFee(plan: DaoTxPlan, price: GasPrice) {
    const settings = getGasConfig()
    const measured = plan.gasWanted !== undefined
    const gasWanted = plan.gasWanted ?? settings.wanted
    const gasFee = measured ? feeForGasWanted(gasWanted, price) : settings.fee
    const label = !measured ? "Network fee (set in Settings)"
        : price === FALLBACK_GAS_PRICE ? "Network fee (price not read; re-checked before signing)" : "Network fee"
    return {
        /** The review line. No gas limit: Adena sets its own when it signs. */
        line: [label, formatUgnotExact(gasFee)] as [string, string],
        assertStillCovers: measured
            ? () => assertFeeStillCovers(gasFee, () => freshFeeForGasWanted(gasWanted))
            : () => assertSettingsFeeCovers(gasFee, gasWanted),
        fee: { gasWanted, gasFee },
    }
}

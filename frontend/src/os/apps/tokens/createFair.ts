/**
 * Opening a fair sale for a new Launchpad token: the rules `tokens/v1` and
 * `sales/v1` apply, checked before anything is signed, and the one call to
 * `CreateFairSale` with the creation fee attached exactly and the config
 * version it was read under.
 *
 * @module os/apps/tokens/createFair
 */
import { GNO_CHAIN_ID } from "../../../lib/config"
import { depositCapUgnot, formatUgnotExact } from "../../../lib/dao/v2Budget"
import { assertFeeStillCovers, doContractBroadcast, feeForGasWanted, formatTokenAmount, freshFeeForGasWanted, type AminoMsg, type GasPrice } from "../../../lib/grc20"
import { readActionStatus, readReserved } from "../../../lib/tokenLaunchpadConfigClient"
import { TOKEN_LAUNCHPAD_SALES_PATH, TokenLaunchpadSalesClient, type LaunchTermsView } from "../../../lib/tokenLaunchpadSalesClient"
import type { SignRequest } from "../../sign/signer"
import { verifySendTx } from "../../wallet/sendRequest"
import { LAUNCH_CURRENCY, MAX_INT64, tokenProblem } from "./createDirect"

/** The longest window `p/fairmath` accepts. */
export const MAX_WINDOW_SECONDS = 365n * 86_400n
/**
 * A sale must start after the block that creates it. The review starts it at
 * least this long after the moment the creator signs, and refuses to sign
 * with less left: time to approve in the wallet, plus clock skew.
 */
export const START_MARGIN_SECONDS = 300n
/** The earliest a sale may open: the margin plus five minutes to sign in the wallet. */
export const MIN_OPENS_IN_SECONDS = START_MARGIN_SECONDS + 300n
/**
 * Creating a sale measured 31 to 34M gas and 18.5 to 20 KB on a committed node
 * at the pinned Gno; a ledger holding 3,000 entries per tree adds about 25M
 * and 1.4 KB. Gas is half again the estimate; depositCapUgnot doubles the bytes.
 */
export const FAIR_GAS_WANTED = 90_000_000
export const FAIR_BYTES = 21_500

/** Told to the creator before signing: what a sale is not, and when its money moves. */
export const SETTLEMENT_DISCLOSURE = "A fair sale creates no trading market or liquidity. What it raises reaches you only after the sale closes, someone settles it and its proceeds are released to you; until then the buyers' GNOT stays in escrow in the sales realm."

export interface FairLaunch {
    name: string
    ticker: string
    decimals: number
    initialSupply: bigint
    description: string
    /** Token base units per lot. */
    lotSize: bigint
    /** Lots on offer: the hard cap. The sale escrows lotSize × lots. */
    lots: bigint
    walletCapLots: bigint
    /** ugnot the sale must raise at its closing price to succeed. */
    softQuote: bigint
    /** ugnot per lot. A fixed-price sale has floor = start and no decrement. */
    startPrice: bigint
    floorPrice: bigint
    decrement: bigint
    intervalSeconds: bigint
    /** Seconds after signing that the sale opens, at least START_MARGIN_SECONDS. */
    startsIn: bigint
    durationSeconds: bigint
}

export type FairPart = "token" | "sale"
export interface FairProblem { part: FairPart; message: string }

/** The tokens the sale escrows. */
export const saleAllocation = (l: FairLaunch) => l.lotSize * l.lots

/** The first rule the launch breaks, worded for its creator, or null. `raiseCap` is the terms' cap, in ugnot. */
export function fairLaunchProblem(l: FairLaunch, raiseCap: bigint = MAX_INT64): FairProblem | null {
    const tokenRule = tokenProblem(l)
    if (tokenRule) return { part: "token", message: tokenRule }
    const sale = (message: string): FairProblem => ({ part: "sale", message })
    if (l.lotSize <= 0n || l.lots <= 0n) return sale("A lot needs at least one token unit, and the sale at least one lot.")
    if (saleAllocation(l) > l.initialSupply) return sale("The lots on offer exceed the supply.")
    if (l.walletCapLots < 1n || l.walletCapLots > l.lots) return sale("A wallet may buy from 1 lot up to every lot on offer.")
    if (l.startPrice <= 0n || l.floorPrice <= 0n || l.floorPrice > l.startPrice) return sale("Prices must be above zero, the floor no higher than the start.")
    if (l.decrement < 0n || (l.decrement === 0n && l.floorPrice !== l.startPrice)) return sale("A price that falls to a floor needs a price step.")
    if (l.intervalSeconds <= 0n) return sale("The price step needs a period of at least a second.")
    if (l.startsIn < MIN_OPENS_IN_SECONDS || l.startsIn > MAX_WINDOW_SECONDS) return sale("The sale opens from ten minutes to 365 days after you sign.")
    if (l.durationSeconds <= 0n || l.durationSeconds > MAX_WINDOW_SECONDS) return sale("A sale lasts up to 365 days.")
    const most = l.lots * l.startPrice
    if (most > MAX_INT64 || most > raiseCap) return sale("The lots on offer at the start price exceed what one sale may raise.")
    if (l.softQuote <= 0n || l.softQuote > most) return sale("The soft cap must be above zero and reachable: at most every lot at the start price.")
    return null
}

export interface FairContext {
    network: string
    creator: string
    launch: FairLaunch
    terms: LaunchTermsView
    /** Unix second the review was signed from; the sale opens at now + startsIn. */
    now: bigint
    gasPrice: GasPrice
    onSettled: (outcome: string) => void
}

export function createFairRequest(ctx: FairContext): SignRequest {
    const { launch: l, terms, creator, network } = ctx
    if (terms.fairSaleCreationFee === null || terms.primaryFeeBps === null || terms.currency !== LAUNCH_CURRENCY) {
        throw new Error("Fair sales have no terms in GNOT on this network.")
    }
    const problem = fairLaunchProblem(l, terms.fairSaleRaiseCap)
    if (problem) throw new Error(problem.message)
    const fee = terms.fairSaleCreationFee
    const start = ctx.now + l.startsIn
    const end = start + l.durationSeconds
    const args = [l.name, l.ticker, String(l.decimals), l.initialSupply.toString(), saleAllocation(l).toString(), l.lotSize.toString(),
        l.lots.toString(), l.walletCapLots.toString(), l.softQuote.toString(), LAUNCH_CURRENCY, terms.version.toString(),
        start.toString(), end.toString(), l.startPrice.toString(), l.floorPrice.toString(), l.decrement.toString(), l.intervalSeconds.toString(),
        l.description, "", "", "", ""]
    const depositCap = depositCapUgnot(FAIR_BYTES)
    const msg: AminoMsg = {
        type: "vm/MsgCall",
        value: {
            caller: creator, send: fee > 0n ? `${fee}${LAUNCH_CURRENCY}` : "", pkg_path: TOKEN_LAUNCHPAD_SALES_PATH,
            func: "CreateFairSale", args, max_deposit: `${depositCap}ugnot`,
        },
    }
    const gasFee = feeForGasWanted(FAIR_GAS_WANTED, ctx.gasPrice)
    const units = (amount: bigint) => formatTokenAmount(amount, l.decimals)
    const gnot = formatUgnotExact
    const opens = new Date(Number(start) * 1000).toLocaleString()
    const closes = new Date(Number(end) * 1000).toLocaleString()

    return {
        title: "Open a fair sale",
        summary: `Sell ${units(saleAllocation(l))} ${l.ticker} in ${l.lots} lots`,
        sub: `On ${GNO_CHAIN_ID}, by ${creator}`,
        lines: () => [
            ["Token", `${l.name}: ${units(l.initialSupply)} ${l.ticker}, fixed; ${units(l.initialSupply - saleAllocation(l))} ${l.ticker} to you now`],
            ["On sale", `${l.lots} lots of ${units(l.lotSize)} ${l.ticker}, at most ${l.walletCapLots} per wallet`],
            ["Price per lot", l.decrement === 0n ? gnot(l.startPrice) : `${gnot(l.startPrice)}, falling ${gnot(l.decrement)} every ${l.intervalSeconds} s to ${gnot(l.floorPrice)}`],
            ["Window", `${opens} to ${closes}, or until every lot is sold`],
            ["Soft cap", `${gnot(l.softQuote)} raised at the closing price, or every buyer is refunded`],
            ["Primary fee", `${Number(terms.primaryFeeBps) / 100}% of what the sale raises, pinned now`],
            ["Creation fee", fee === 0n ? "Free" : gnot(fee)],
            ["Storage deposit", `Up to ${formatUgnotExact(depositCap)}`],
            ["Network fee", formatUgnotExact(gasFee)],
            ["Launch terms", `Config version ${terms.version}`],
        ],
        warns: [
            `Sign within ${(l.startsIn - START_MARGIN_SECONDS) / 60n} minutes: later, the sale would open too soon and the review refuses it.`,
            SETTLEMENT_DISCLOSURE,
            "The terms cannot change once the sale exists. Unsold tokens come back to you at settlement; the creation fee does not come back.",
            "Every buyer pays the same closing price; anything paid above it is refunded.",
        ],
        acks: ["I checked the token, the sale's terms and its costs."],
        note: "Adena shows a contract call to the Launchpad's sales realm with the creation fee attached.",
        label: () => `Open the ${l.ticker} sale`,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            if (BigInt(Math.floor(Date.now() / 1000)) + START_MARGIN_SECONDS > start) {
                throw new Error("The sale would open too soon after this signature. Start the review again; nothing was sent.")
            }
            const now = await new TokenLaunchpadSalesClient(network).terms(LAUNCH_CURRENCY)
            if (now.version !== terms.version || now.fairSaleCreationFee !== fee) throw new Error("The launch terms changed. Close this review and start again; nothing was sent.")
            if (!(await readActionStatus(network, "fairsale", LAUNCH_CURRENCY)).open) throw new Error("The Launchpad is not opening new sales right now; nothing was sent.")
            if (await readReserved(network, l.ticker)) throw new Error(`${l.ticker} is reserved; nothing was sent.`)
            await assertFeeStillCovers(gasFee, () => freshFeeForGasWanted(FAIR_GAS_WANTED))
        },
        send: (_choice, beforeSign) => doContractBroadcast([msg], `Open the ${l.ticker} sale`, { gasWanted: FAIR_GAS_WANTED, gasFee, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled: outcome => ctx.onSettled(outcome),
    }
}

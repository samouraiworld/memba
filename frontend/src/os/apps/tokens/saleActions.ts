/**
 * The fair-sale calls a member signs from the Tokens window: an order, the
 * settlement, a buyer's claim and the release of the creator's proceeds.
 * Each is one call to the sales realm (see callRequest).
 *
 * @module os/apps/tokens/saleActions
 */
import { formatTokenAmount, type GasPrice } from "../../../lib/grc20"
import { TokenLaunchpadClient } from "../../../lib/tokenLaunchpadClient"
import { readActionStatus } from "../../../lib/tokenLaunchpadConfigClient"
import { TOKEN_LAUNCHPAD_SALES_PATH, TokenLaunchpadSalesClient, type FairSaleView, type LaunchView } from "../../../lib/tokenLaunchpadSalesClient"
import type { SignRequest } from "../../sign/signer"
import { formatUgnot } from "../../wallet/send"
import { launchCallRequest } from "./callRequest"

/** The schedule's price per lot at a Unix second, as fairmath.Schedule.PriceAt computes it. */
export function priceAt(sale: FairSaleView, at: bigint): bigint {
    if (sale.decrement === 0n) return sale.startPrice
    const steps = (at - sale.start) / sale.intervalSeconds
    const toFloor = (sale.startPrice - sale.floorPrice + sale.decrement - 1n) / sale.decrement
    return steps >= toFloor ? sale.floorPrice : sale.startPrice - steps * sale.decrement
}

/**
 * A device clock can run ahead of or behind block time. Within this many
 * seconds of a sale's start or end the window offers no order and no
 * settlement, and an order is priced as of this long ago (prices only fall:
 * any excess comes back in the order's transaction).
 */
export const CLOCK_MARGIN = 60n

/** Whether the sale takes orders at a Unix second, by its own record; config's lane is read separately. */
export function takingOrders(sale: FairSaleView, at: bigint, margin = 0n): boolean {
    return !sale.cancelled && !sale.settled && sale.hardClosedAt === 0n && at >= sale.start + margin && at < sale.end - margin
}

/** Whether anyone can settle the sale at a Unix second: closed by its hard cap, or past its end by the margin. */
export function canSettle(sale: FairSaleView, at: bigint): boolean {
    return !sale.settled && !sale.cancelled && (sale.hardClosedAt !== 0n || at >= sale.end + CLOCK_MARGIN)
}

/** The sale's holding gates: hold at least `minimum` base units of each token. */
export function holdingGates(sale: FairSaleView): { tokenId: string; minimum: bigint }[] {
    return sale.holdingGates === "" ? [] : sale.holdingGates.split(";").map(gate => {
        const [, tokenId, minimum] = gate.split(":")
        return { tokenId, minimum: BigInt(minimum) }
    })
}

/** A proof as ClaimAirdrop and allowlists take it: lowercase hashes, comma-separated; empty for a one-leaf tree. */
export const PROOF_FORMAT = /^([0-9a-f]{64}(,[0-9a-f]{64})*)?$/

export type SaleAction =
    | { kind: "order"; lots: bigint; proof: string; /** The caller's lots already ordered. */ mine: bigint }
    | { kind: "settle" }
    | { kind: "claim"; buyer: string; claimableTokens: bigint; claimableRefund: bigint }
    | { kind: "release" }

/**
 * About twice what each call measured on a committed node, and the bytes it
 * can add. An order with an allowlist proof and a holding gate measured 24.7M;
 * 80M leaves room for three gates, a 32-level proof and a grown ledger.
 */
const COST: Record<SaleAction["kind"], { gasWanted: number; bytes: number }> = {
    order: { gasWanted: 80_000_000, bytes: 3_000 },
    settle: { gasWanted: 60_000_000, bytes: 1_000 },
    claim: { gasWanted: 50_000_000, bytes: 2_500 },
    release: { gasWanted: 40_000_000, bytes: 1_000 },
}

export interface SaleActionContext {
    network: string
    caller: string
    launch: LaunchView
    action: SaleAction
    /** The Unix second the order is priced at; prices only fall within a sale. */
    now: bigint
    gasPrice: GasPrice
    onSettled: (outcome: string) => void
}

export function saleActionRequest(ctx: SaleActionContext): SignRequest {
    const { launch, action, caller, network } = ctx
    const sale = launch.fairSale
    if (!sale) throw new Error("This token has no fair sale.")
    const id = launch.token.id
    const ticker = launch.token.ticker
    const tokens = (amount: bigint) => `${formatTokenAmount(amount, launch.token.decimals)} ${ticker}`
    const quote = (amount: bigint) => sale.quoteCurrency === "ugnot" ? formatUgnot(amount) : `${amount} base units of ${sale.quoteCurrency}`
    const reader = new TokenLaunchpadSalesClient(network)

    let func: string, args: string[], send = "", title: string, summary: string
    let facts: [string, string][], recheck: () => Promise<void>, note: string
    switch (action.kind) {
        case "order": {
            if (sale.quoteCurrency !== "ugnot") throw new Error("Orders in this currency are paid from a token allowance, which this window does not set.")
            if (!takingOrders(sale, ctx.now)) throw new Error("The sale is not taking orders.")
            if (action.lots <= 0n) throw new Error("Order at least one lot.")
            if (action.mine + action.lots > sale.walletCapLots) throw new Error(`One wallet orders at most ${sale.walletCapLots} lots; you have ${action.mine}.`)
            if (sale.totalLots + action.lots > sale.hardCapLots) throw new Error(`Only ${sale.hardCapLots - sale.totalLots} lots remain.`)
            if (!PROOF_FORMAT.test(action.proof)) throw new Error("A proof is lowercase hashes separated by commas.")
            if (!sale.allowlistRoot && action.proof) throw new Error("This sale takes no allowlist proof.")
            const bound = action.lots * priceAt(sale, ctx.now - sale.intervalSeconds > sale.start ? ctx.now - sale.intervalSeconds : sale.start)
            func = sale.allowlistRoot ? "ContributeFairWithProof" : "ContributeFair"
            args = [id, action.lots.toString(), bound.toString(), ...(sale.allowlistRoot ? [action.proof] : [])]
            send = `${bound}ugnot`
            title = "Order in a fair sale"
            summary = `Order ${action.lots} lots of ${tokens(sale.lotSize)}`
            const gates = holdingGates(sale)
            facts = [["Lots", `${action.lots}, ${tokens(action.lots * sale.lotSize)} in all`], ["You pay at most", quote(bound)],
                ...gates.map((g): [string, string] => ["Holding gate", `at least ${g.minimum} base units of ${g.tokenId}`])]
            note = "The price can step down before the network includes the order: the sale keeps the order's cost at that moment and pays the rest back in the same transaction. If the sale settles below that price, or fails, the difference or the whole deposit is yours to claim."
            recheck = async () => {
                const fresh = (await reader.launch(id)).fairSale
                if (!fresh || !takingOrders(fresh, BigInt(Math.floor(Date.now() / 1000)), CLOCK_MARGIN)) throw new Error("The sale is no longer taking orders. Nothing was sent.")
                if (fresh.totalLots + action.lots > fresh.hardCapLots) throw new Error(`Only ${fresh.hardCapLots - fresh.totalLots} lots remain. Nothing was sent.`)
                if ((await reader.fairBuyer(id, caller)).lots + action.lots > fresh.walletCapLots) throw new Error(`One wallet orders at most ${fresh.walletCapLots} lots. Nothing was sent.`)
                for (const gate of gates) {
                    if (await new TokenLaunchpadClient(network).balanceOf(gate.tokenId, caller) < gate.minimum) throw new Error(`You hold less ${gate.tokenId} than the sale requires. Nothing was sent.`)
                }
                if (!(await readActionStatus(network, "fairsale", sale.quoteCurrency)).open) throw new Error("New orders are paused on the Launchpad. Nothing was sent.")
            }
            break
        }
        case "settle":
            func = "SettleFair"; args = [id]
            title = "Settle a fair sale"; summary = `Settle the sale of ${ticker}`
            facts = [["Effect", "Closes the sale: unsold tokens, or all of them if it failed, go back to its creator, and buyers can claim"]]
            note = "Anyone may settle a sale once it has closed."
            recheck = async () => {
                const fresh = (await reader.launch(id)).fairSale
                if (!fresh || fresh.cancelled) throw new Error("The sale was cancelled. Nothing was sent.")
                if (fresh.settled) throw new Error("The sale is already settled. Nothing was sent.")
            }
            break
        case "claim":
            func = "ClaimFair"; args = [id, action.buyer]
            title = "Claim from a fair sale"; summary = `Claim ${ticker} for ${action.buyer === caller ? "your order" : action.buyer}`
            facts = [["Buyer", action.buyer], ["It pays", `${tokens(action.claimableTokens)} and ${quote(action.claimableRefund)} back`]]
            note = "The tokens and any refund go to the buyer of record, whoever sends the claim."
            recheck = async () => {
                const buyer = await reader.fairBuyer(id, action.buyer)
                if (!buyer.settled || buyer.claimed || buyer.claimableTokens !== action.claimableTokens || buyer.claimableRefund !== action.claimableRefund) {
                    throw new Error("The claim changed or was already made. Nothing was sent.")
                }
            }
            break
        case "release":
            func = "ReleaseFairProceeds"; args = [id]
            title = "Release a sale's proceeds"; summary = `Release the proceeds of ${ticker}`
            facts = [["Pays", `${quote(sale.creatorQuote)} to the creator, ${sale.creator}`]]
            note = "Anyone may release them; they go to the creator of record."
            recheck = async () => {
                const fresh = (await reader.launch(id)).fairSale
                if (!fresh || !fresh.settled || !fresh.succeeded || fresh.proceedsReleased) throw new Error("The proceeds are not waiting to be released. Nothing was sent.")
            }
            break
    }

    return launchCallRequest({
        caller, pkgPath: TOKEN_LAUNCHPAD_SALES_PATH, func, args, send, ...COST[action.kind],
        title, summary, subject: `${launch.token.name} (${id})`, facts, note, recheck,
        gasPrice: ctx.gasPrice, onSettled: ctx.onSettled,
    })
}

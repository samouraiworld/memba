/** Mainnet fee transparency. Wallet balances are never treated as revenue or DAO assets. */
import { assertWeightedChain, qevalText } from "./weighted"
import { parseQevalAddress } from "./weightedAcceptance"
import { readHeldUgnot } from "./weightedTreasury"
import { formatUgnotExact } from "./v2Budget"
import type { GovContext } from "./membaGov"

const ROOT = "gno.land/r/samcrew/"
export const FEE_SOURCES = [
    { id: "market", label: "Market fee policy", path: ROOT + "memba_market_config", mode: "policy" },
    { id: "escrow", label: "Services escrow", path: ROOT + "escrow_v4", mode: "forwarded" },
    { id: "appstore", label: "App Store", path: ROOT + "memba_appstore_v3", mode: "forwarded" },
    { id: "connect4", label: "Connect 4", path: ROOT + "connect4", mode: "retained" },
] as const
export type FeeSource = typeof FEE_SOURCES[number]
export interface FeeValues {
    rate: string
    /** For retained fees this is the withdrawal authority, not a destination. */
    recipient: string
    /** Retained fees since the last withdrawal; never lifetime revenue or the realm's balance. */
    retainedUgnot: bigint | null
}
export interface FeeSnapshot {
    sources: { source: FeeSource; values: FeeValues | null }[]
    wallets: { address: string; balanceUgnot: bigint | null }[]
}

/** Exact int64 amounts; reject wrong types, negative balances and overflow. */
export function parseFeeInteger(raw: string): bigint {
    const m = /^\((0|[1-9][0-9]*) (?:int|int64)\)$/.exec(raw.trim())
    if (!m || BigInt(m[1]) > 9223372036854775807n) throw new Error("Invalid fee amount")
    return BigInt(m[1])
}
function percent(n: bigint) {
    if (n > 10_000n) throw new Error("Invalid fee rate")
    return `${Number(n) / 100}%`
}

export async function readGovFees(ctx: GovContext, signal?: AbortSignal): Promise<FeeSnapshot> {
    // The paths and counter semantics below were verified on mainnet. Do not reuse them on another chain.
    if (ctx.chainId !== "gnoland-1") throw new Error("Fee transparency is available on gno.land mainnet")
    await assertWeightedChain(ctx, signal)
    const readSource = async (source: FeeSource): Promise<FeeValues> => {
        const read = (expr: string) => qevalText(ctx.rpcUrl, source.path, expr, signal)
        const amount = async (expr: string) => parseFeeInteger(await read(expr))
        const address = async (expr: string) => parseQevalAddress(await read(expr), "address")
        if (source.id === "connect4") {
            // These public qeval expressions read the deployed realm's state without a transaction.
            // WithdrawFees resets feesCollected; the realm balance also contains players' stakes.
            const [fee, retainedUgnot, recipient] = await Promise.all([amount("fee"), amount("feesCollected"), address("owner.Owner()")])
            return { rate: `${formatUgnotExact(fee)} per decisive game`, recipient, retainedUgnot }
        }
        if (source.id === "appstore") {
            const [fee, recipient] = await Promise.all([amount("GetRegistrationFee()"), address("GetTreasury()")])
            return { rate: `${formatUgnotExact(fee)} per registration`, recipient, retainedUgnot: null }
        }
        if (source.id === "escrow") {
            const [fee, recipient] = await Promise.all([amount("GetGovernanceFeeTerms().EffectiveBPS"), address("GetGovernanceFeeTerms().EffectiveTreasury")])
            return { rate: `${percent(fee)} on payments to freelancers`, recipient, retainedUgnot: null }
        }
        const [nft, service, token, recipient] = await Promise.all([
            amount('GetFeeBPS("nft")'), amount('GetFeeBPS("service")'), amount('GetFeeBPS("token")'), address("GetTreasury()"),
        ])
        return { rate: `NFT ${percent(nft)} · Services ${percent(service)} · Token OTC ${percent(token)}`, recipient, retainedUgnot: null }
    }
    const sources = await Promise.all(FEE_SOURCES.map(async source => ({ source, values: await readSource(source).catch(() => null) })))
    if (signal?.aborted) throw new Error("Fee read cancelled")
    // A common receiving wallet is read and displayed once, even when several apps pay it.
    const addresses = [...new Set(sources.flatMap(({ source, values }) => source.mode !== "retained" && values?.recipient ? [values.recipient] : []))]
    const wallets = await Promise.all(addresses.map(async address => ({ address, balanceUgnot: await readHeldUgnot(ctx, address, signal).catch(() => null) })))
    if (signal?.aborted) throw new Error("Fee read cancelled")
    return { sources, wallets }
}

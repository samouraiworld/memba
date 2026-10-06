/**
 * Creating a direct Launchpad token: the rules `tokens/v1` and `sales/v1`
 * apply, checked before anything is signed, and the one call to
 * `CreateDirect` (or `CreateDirectWithAirdrop`) with the creation fee
 * attached exactly and the config version it was read under.
 *
 * @module os/apps/tokens/createDirect
 */
import { GNO_CHAIN_ID } from "../../../lib/config"
import { isValidGnoAddressChecksum } from "../../../lib/dao/address"
import { depositCapUgnot, formatUgnotExact } from "../../../lib/dao/v2Budget"
import { assertFeeStillCovers, doContractBroadcast, feeForGasWanted, formatTokenAmount, freshFeeForGasWanted, type AminoMsg, type GasPrice } from "../../../lib/grc20"
import type { AirdropEntry, AirdropManifest } from "../../../lib/tokenLaunchpadAirdropManifest"
import { TokenLaunchpadClient } from "../../../lib/tokenLaunchpadClient"
import { readActionStatus, readReserved } from "../../../lib/tokenLaunchpadConfigClient"
import { TOKEN_LAUNCHPAD_SALES_ADDRESS, TOKEN_LAUNCHPAD_SALES_PATH, TokenLaunchpadSalesClient, type LaunchTermsView } from "../../../lib/tokenLaunchpadSalesClient"
import type { SignRequest } from "../../sign/signer"
import { verifySendTx } from "../../wallet/sendRequest"

export const MAX_INT64 = 9223372036854775807n
const DAY = 86_400n
/** The ledger refuses these tickers whatever config says. */
const PROTECTED_TICKERS = new Set(["MEMBA", "GNOT", "UGNOT", "WUGNOT", "GNS", "USDC", "USDT", "ATOM", "BTC", "ETH", "SAMCREW"])
/**
 * Gas and storage for a creation, from a committed node at the pinned Gno: no
 * allocation 23.4M gas and 9.5 KB; 50 immediate allocations 165.9M and
 * 113.9 KB; 50 vested 126.2M and 156.0 KB; one with an airdrop about 40M and
 * 24.6 KB. A ledger holding 3,000 entries per tree adds about 25M and 11 KB.
 * Gas is half again the estimate; depositCapUgnot doubles the bytes.
 */
export function directCost(immediate: number, vested: number, airdrop: boolean): { gasWanted: number; bytes: number } {
    const gas = 50_000_000 + 3_000_000 * immediate + 2_500_000 * vested + (airdrop ? 20_000_000 : 0)
    return { gasWanted: Math.ceil(gas * 1.5), bytes: 21_000 + 2_200 * immediate + 3_100 * vested + (airdrop ? 16_000 : 0) }
}
export const LAUNCH_CURRENCY = "ugnot"

export interface AllocationDraft {
    beneficiary: string
    /** Base units. */
    amount: bigint
    /** 0: paid at creation. Otherwise vested linearly over this many days from creation. */
    vestingDays: number
    /** Nothing vests before this many days; at most vestingDays. */
    cliffDays: number
}

export interface DirectLaunch {
    mode: "direct_fixed" | "direct_capped"
    name: string
    ticker: string
    decimals: number
    initialSupply: bigint
    /** Equal to the initial supply for a fixed token; above it for a capped one. */
    maxSupply: bigint
    description: string
    allocations: AllocationDraft[]
    /** Base units reserved for an airdrop; its manifest is built for the token's ID at review. */
    airdropTotal: bigint
}

const encoder = new TextEncoder()
/** As Go's unicode.IsPrint: no control or format character, and no space but U+0020. */
const printable = (s: string) => !/[\p{C}\p{Z}]/u.test(s.replaceAll(" ", ""))

/** A whole-token amount such as "1.5" in base units, or null; exact, no float. */
export function toBaseUnits(text: string, decimals: number): bigint | null {
    const match = text.trim().match(/^(\d+)(?:\.(\d+))?$/)
    if (!match || (match[2] ?? "").length > decimals) return null
    return BigInt(match[1] + (match[2] ?? "").padEnd(decimals, "0"))
}

/** Airdrop lines "address amount", in order: line n is leaf n. Checks each line, not the tree. */
export function parseAirdrop(text: string, decimals: number): AirdropEntry[] | string {
    const lines = text.split("\n").map(line => line.trim()).filter(Boolean)
    const entries: AirdropEntry[] = []
    for (const [index, line] of lines.entries()) {
        const [beneficiary, amountText, extra] = line.split(/[\s,;]+/)
        const amount = amountText === undefined ? null : toBaseUnits(amountText, decimals)
        if (extra !== undefined || amount === null || amount <= 0n) return `Line ${index + 1} needs an address and an amount above zero.`
        if (!isValidGnoAddressChecksum(beneficiary) || beneficiary === TOKEN_LAUNCHPAD_SALES_ADDRESS) return `Line ${index + 1}: ${beneficiary} is not an address that can receive tokens.`
        entries.push({ index, beneficiary, amount: amount.toString() })
    }
    return entries
}

/** Which part of the wizard a problem belongs to. */
export type LaunchPart = "token" | "distribution" | "airdrop"
export interface LaunchProblem { part: LaunchPart; message: string }

/** The token ledger's rules for any new token, worded for its creator, or null. */
export function tokenProblem(t: { name: string; ticker: string; decimals: number; initialSupply: bigint; description: string }): string | null {
    const { name, ticker, decimals, initialSupply, description } = t
    if (encoder.encode(name).length < 1 || encoder.encode(name).length > 32 || !printable(name) || /[[\]()*#<>`|\\]/.test(name) || name.trim() !== name) {
        return "The name needs 1 to 32 bytes, no surrounding spaces, and none of [ ] ( ) * # < > ` | \\."
    }
    if (!/^[A-Z0-9]{1,10}$/.test(ticker)) return "The ticker needs 1 to 10 capital letters or digits."
    if (PROTECTED_TICKERS.has(ticker)) return `${ticker} is reserved.`
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 12) return "Decimals must be 0 to 12."
    if (initialSupply <= 0n || initialSupply > MAX_INT64) return "The supply must be above zero and fit in 64 bits."
    if (encoder.encode(description).length > 280 || !printable(description) || /[[\]()<>]/.test(description)) {
        return "The description needs at most 280 bytes and none of [ ] ( ) < >."
    }
    return null
}

/** The first rule the launch breaks, worded for its creator, or null. */
export function directLaunchProblem(launch: DirectLaunch): LaunchProblem | null {
    const { initialSupply, maxSupply, allocations } = launch
    const token = (message: string): LaunchProblem => ({ part: "token", message })
    const distribution = (message: string): LaunchProblem => ({ part: "distribution", message })
    const tokenRule = tokenProblem(launch)
    if (tokenRule) return token(tokenRule)
    if (launch.mode === "direct_fixed" ? maxSupply !== initialSupply : maxSupply <= initialSupply || maxSupply > MAX_INT64) {
        return token("A capped token's maximum supply must be above its initial supply.")
    }
    if (allocations.length > 50) return distribution("At most 50 allocations.")
    const seen = new Set<string>()
    let committed = 0n
    for (const a of allocations) {
        if (!isValidGnoAddressChecksum(a.beneficiary) || a.beneficiary === TOKEN_LAUNCHPAD_SALES_ADDRESS) return distribution(`${a.beneficiary || "An allocation"} is not an address that can receive tokens.`)
        if (seen.has(a.beneficiary)) return distribution(`${a.beneficiary} appears twice.`)
        seen.add(a.beneficiary)
        if (a.amount <= 0n) return distribution("Every allocation needs an amount above zero.")
        if (!Number.isInteger(a.vestingDays) || a.vestingDays < 0 || a.vestingDays > 36_500) return distribution("Vesting lasts 0 to 36,500 days.")
        if (!Number.isInteger(a.cliffDays) || a.cliffDays < 0 || a.cliffDays > a.vestingDays) return distribution("A cliff cannot be longer than its vesting.")
        committed += a.amount
    }
    if (committed > initialSupply) return distribution("The allocations exceed the initial supply.")
    if (launch.airdropTotal < 0n || committed + launch.airdropTotal > initialSupply) return { part: "airdrop", message: "The allocations and the airdrop together exceed the initial supply." }
    return null
}

/** The sales realm's allocation argument: records sorted by address, vesting from `start`. */
export function encodeAllocations(allocations: readonly AllocationDraft[], start: bigint): string {
    return [...allocations].sort((a, b) => (a.beneficiary < b.beneficiary ? -1 : 1)).map(a => a.vestingDays === 0
        ? `${a.beneficiary}:${a.amount}:0:0:0:0`
        : `${a.beneficiary}:${a.amount}:${start}:${BigInt(a.cliffDays) * DAY}:${BigInt(a.vestingDays) * DAY}:0`).join(";")
}

/** What stays with the creator: the initial supply less every allocation and the airdrop. */
export function creatorShare(launch: DirectLaunch): bigint {
    return launch.allocations.reduce((left, a) => left - a.amount, launch.initialSupply - launch.airdropTotal)
}

export interface DirectContext {
    network: string
    creator: string
    launch: DirectLaunch
    terms: LaunchTermsView
    /** The ID the token will get; required with an airdrop, whose leaves name it. */
    airdrop: AirdropManifest | null
    /** Unix second vesting starts from. */
    start: bigint
    gasPrice: GasPrice
    onSettled: (outcome: string) => void
}

export function createDirectRequest(ctx: DirectContext): SignRequest {
    const { launch, terms, airdrop, creator, network } = ctx
    const problem = directLaunchProblem(launch)
    if (problem) throw new Error(problem.message)
    if (terms.directCreationFee === null || terms.currency !== LAUNCH_CURRENCY) throw new Error("Token creation has no terms in GNOT on this network.")
    if ((airdrop === null) !== (launch.airdropTotal === 0n) || (airdrop && BigInt(airdrop.total) !== launch.airdropTotal)) throw new Error("The airdrop manifest does not match the airdrop total.")
    const fee = terms.directCreationFee
    const args = [launch.mode, launch.name, launch.ticker, String(launch.decimals), launch.initialSupply.toString(), launch.maxSupply.toString(),
        LAUNCH_CURRENCY, terms.version.toString(), launch.description, "", "", "", "", encodeAllocations(launch.allocations, ctx.start)]
    if (airdrop) args.push(airdrop.tokenId, airdrop.root, airdrop.total)
    const vested = launch.allocations.filter(a => a.vestingDays > 0).length
    const { gasWanted, bytes } = directCost(launch.allocations.length - vested, vested, airdrop !== null)
    const depositCap = depositCapUgnot(bytes)
    const msg: AminoMsg = {
        type: "vm/MsgCall",
        value: {
            caller: creator, send: fee > 0n ? `${fee}${LAUNCH_CURRENCY}` : "", pkg_path: TOKEN_LAUNCHPAD_SALES_PATH,
            func: airdrop ? "CreateDirectWithAirdrop" : "CreateDirect", args, max_deposit: `${depositCap}ugnot`,
        },
    }
    const gasFee = feeForGasWanted(gasWanted, ctx.gasPrice)
    const units = (amount: bigint) => formatTokenAmount(amount, launch.decimals)
    const lanes = airdrop ? ["direct", "airdrop"] as const : ["direct"] as const

    return {
        title: "Create a token",
        summary: `Create ${launch.name} (${launch.ticker})`,
        sub: `On ${GNO_CHAIN_ID}, by ${creator}`,
        lines: () => [
            ["Supply", `${units(launch.initialSupply)} ${launch.ticker}${launch.mode === "direct_capped" ? `, at most ${units(launch.maxSupply)}` : ", fixed"}`],
            ["To you", `${units(creatorShare(launch))} ${launch.ticker}`],
            ["Allocations", launch.allocations.length === 0 ? "None" : `${launch.allocations.length}, ${vested} of them vesting`],
            ["Airdrop", airdrop ? `${units(launch.airdropTotal)} ${launch.ticker} to ${airdrop.claims.length} addresses, for token ${airdrop.tokenId}` : "None"],
            ["Creation fee", fee === 0n ? "Free" : formatUgnotExact(Number(fee))],
            ["Storage deposit", `Up to ${formatUgnotExact(depositCap)}; when a vesting claim later frees bytes, their deposit goes to whoever sends that claim, which anyone may do`],
            ["Network fee", formatUgnotExact(gasFee)],
            ["Launch terms", `Config version ${terms.version}`],
        ],
        warns: ["The name, ticker, decimals and supply rules cannot change after creation."],
        acks: ["I checked the token, its distribution and its costs."],
        note: fee === 0n ? "Adena shows a contract call to the Launchpad's sales realm, with no coins attached." : "Adena shows a contract call to the Launchpad's sales realm with the creation fee attached.",
        label: () => `Create ${launch.ticker}`,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            const now = await new TokenLaunchpadSalesClient(network).terms(LAUNCH_CURRENCY)
            if (now.version !== terms.version || now.directCreationFee !== fee) throw new Error("The launch terms changed. Close this review and start again; nothing was sent.")
            for (const lane of lanes) {
                if (!(await readActionStatus(network, lane, LAUNCH_CURRENCY)).open) throw new Error("The Launchpad is not taking new tokens right now; nothing was sent.")
            }
            if (await readReserved(network, launch.ticker)) throw new Error(`${launch.ticker} is reserved; nothing was sent.`)
            if (airdrop && `T${(await new TokenLaunchpadClient(network).count()) + 1n}` !== airdrop.tokenId) {
                throw new Error("Another token was created first, so the airdrop names the wrong token. Start the review again; nothing was sent.")
            }
            await assertFeeStillCovers(gasFee, () => freshFeeForGasWanted(gasWanted))
        },
        send: (_choice, beforeSign) => doContractBroadcast([msg], `Create ${launch.ticker}`, { gasWanted, gasFee, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled: outcome => ctx.onSettled(outcome),
    }
}

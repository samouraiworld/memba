/**
 * Claims on a token's vesting records and airdrop, signed from the Tokens
 * window. Anyone may send either; the tokens always go to the beneficiary of
 * record, whom the chain checks.
 *
 * @module os/apps/tokens/claims
 */
import { formatTokenAmount, type GasPrice } from "../../../lib/grc20"
import type { AirdropClaim } from "../../../lib/tokenLaunchpadAirdropManifest"
import { TOKEN_LAUNCHPAD_SALES_PATH, TokenLaunchpadSalesClient, type LaunchView, type VestingView } from "../../../lib/tokenLaunchpadSalesClient"
import type { SignRequest } from "../../sign/signer"
import { launchCallRequest } from "./callRequest"
import { CLOCK_MARGIN } from "./saleActions"

/** What ClaimVested would pay at a Unix second, as vesting.Schedule.Releasable computes it. */
export function releasable(r: VestingView, now: bigint): bigint {
    if (r.revoked) return r.revokedVested - r.claimed
    let vested: bigint
    if (now < r.start + r.cliff) vested = 0n
    else if (now - r.start >= r.duration) vested = r.total
    else vested = (r.total * (now - r.start)) / r.duration
    return vested - r.claimed
}

interface ClaimContext {
    network: string
    caller: string
    launch: LaunchView
    gasPrice: GasPrice
    onSettled: (outcome: string) => void
}

/**
 * What a vesting record can be claimed for now, judged as of CLOCK_MARGIN ago
 * so a device clock ahead of the block never offers a claim the chain refuses.
 */
export function claimableNow(r: VestingView, now: bigint): bigint {
    return r.pendingBeneficiary ? 0n : releasable(r, now - CLOCK_MARGIN)
}

/** Gas and bytes are about twice the most a claim measured on a committed node (19.9M, 2 KB). */
export function vestingClaimRequest(ctx: ClaimContext & { record: VestingView; now: bigint }): SignRequest {
    const { launch, record } = ctx
    const id = launch.token.id
    if (record.pendingBeneficiary) throw new Error("A move of this record is pending; nothing can be claimed until it is accepted or cancelled.")
    const amount = claimableNow(record, ctx.now)
    if (amount <= 0n) throw new Error("Nothing has vested to claim yet.")
    const final = record.revoked || ctx.now - CLOCK_MARGIN >= record.start + record.duration
    const tokens = `${formatTokenAmount(amount, launch.token.decimals)} ${launch.token.ticker}`
    return launchCallRequest({
        caller: ctx.caller, pkgPath: TOKEN_LAUNCHPAD_SALES_PATH, func: "ClaimVested", args: [id, String(record.index)], send: "",
        gasWanted: 60_000_000, bytes: 2_500,
        title: "Claim vested tokens", summary: `Claim vested ${launch.token.ticker}`, subject: `${launch.token.name} (${id})`,
        facts: [["Record", `${record.index + 1}`], ["To", record.beneficiary], final ? ["Amount", tokens] : ["At least", `${tokens}, and what vests until the network includes the claim`]],
        note: "The tokens go to the record's beneficiary, whoever sends the claim.",
        recheck: async () => {
            const fresh = await new TokenLaunchpadSalesClient(ctx.network).vesting(id, record.index)
            if (fresh.pendingBeneficiary) throw new Error("A move of this record is now pending. Nothing was sent.")
            if (fresh.beneficiary !== record.beneficiary) throw new Error("The record's beneficiary changed. Nothing was sent.")
            if (claimableNow(fresh, BigInt(Math.floor(Date.now() / 1000))) <= 0n) throw new Error("Nothing has vested to claim yet. Nothing was sent.")
        },
        gasPrice: ctx.gasPrice, onSettled: ctx.onSettled,
    })
}

/** Gas and bytes are about twice the most a claim measured, 35M and 4.2 KB with 3,000 entries per tree. */
export function airdropClaimRequest(ctx: ClaimContext & { claim: AirdropClaim }): SignRequest {
    const { launch, claim } = ctx
    const id = launch.token.id
    const amount = `${formatTokenAmount(BigInt(claim.amount), launch.token.decimals)} ${launch.token.ticker}`
    return launchCallRequest({
        caller: ctx.caller, pkgPath: TOKEN_LAUNCHPAD_SALES_PATH, func: "ClaimAirdrop",
        args: [id, String(claim.index), claim.beneficiary, claim.amount, claim.proof], send: "",
        gasWanted: 70_000_000, bytes: 5_000,
        title: "Claim an airdrop", summary: `Claim ${amount}`, subject: `${launch.token.name} (${id})`,
        facts: [["Leaf", `${claim.index}`], ["To", claim.beneficiary], ["Amount", amount]],
        note: "The proof comes from the airdrop's manifest, checked against the root recorded on chain.",
        recheck: async () => {
            if (await new TokenLaunchpadSalesClient(ctx.network).airdropClaimed(id, claim.index)) throw new Error("This leaf is already claimed. Nothing was sent.")
        },
        gasPrice: ctx.gasPrice, onSettled: ctx.onSettled,
    })
}

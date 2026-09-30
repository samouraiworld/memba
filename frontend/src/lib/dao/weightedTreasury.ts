/**
 * Where the fees of the applications a weighted DAO governs go.
 *
 * The DAO itself holds and spends nothing: the host has no treasury
 * (`treasuryExecution: false`) and no withdrawal path. Its v12 policies name
 * one treasury address for each fee-collecting target; a financial vote can
 * set it once the DAO controls that target. Until then the target pays
 * whatever its own state says, so that is read from the target itself.
 */
import { ugnotInCoinsJson } from "../bankBalance"
import { abciQueryText } from "./packageStatus"
import type { WeightedContext, WeightedV12Config } from "./weighted"
import { assertWeightedChain, qevalText } from "./weighted"
import { parseQevalAddress } from "./weightedAcceptance"
import { address as gnoAddress } from "./weightedPrimitives"

/**
 * The targets whose treasury a policy names; both realms export
 * `GetTreasury() address`. Escrow has no treasury of its own: it pays its
 * service fee to the Market config treasury, and to its own fallback
 * recipient only while that treasury is unset.
 */
const FEE_TARGETS = [
    { key: "marketPolicy", fees: "Market fees" },
    { key: "appstorePolicy", fees: "App Store registration fees" },
] as const

export interface FeeDestination {
    key: (typeof FEE_TARGETS)[number]["key"]
    fees: string
    target: string
    /** The treasury the DAO's policy names for this target. */
    policyTreasury: string
    /** The target's treasury right now: "" when unset, null when it could not be read. */
    current: string | null
}

/** Each fee-collecting target's current treasury, after checking the RPC serves the selected chain. */
export async function readFeeDestinations(ctx: WeightedContext, config: WeightedV12Config, signal?: AbortSignal): Promise<FeeDestination[]> {
    await assertWeightedChain(ctx, signal)
    return Promise.all(FEE_TARGETS.map(async ({ key, fees }) => {
        const { target, treasury } = config[key]
        const current = await qevalText(ctx.rpcUrl, target, "GetTreasury()", signal).then(raw => parseQevalAddress(raw, "address")).catch(() => null)
        return { key, fees, target, policyTreasury: treasury, current }
    }))
}

/** What an address holds, in ugnot, read from an RPC checked to serve the selected chain. */
export async function readHeldUgnot(ctx: Pick<WeightedContext, "rpcUrl" | "chainId">, address: string, signal?: AbortSignal): Promise<bigint> {
    gnoAddress.parse(address)
    return ugnotInCoinsJson(await abciQueryText({ rpcUrl: ctx.rpcUrl, chainId: ctx.chainId }, `bank/balances/${address}`, "", signal))
}

export interface TeamWallet {
    name: string
    /** What the team says the wallet is. Its signer set is not readable on chain before a first outgoing transaction, so this is a declaration, not a read. */
    declared: string
}

/** The team's wallets that hold or receive funds. An address is derived from its key set, so a name holds on any chain. */
const TEAM_WALLETS: Readonly<Record<string, TeamWallet>> = {
    g1jw76lxvzjafw2kyjhdnzwggcftyhnlfjaer2u0: { name: "Reserve wallet", declared: "a 4-of-7 multisig" },
    g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf: { name: "Publisher wallet", declared: "a 2-of-3 multisig" },
}

/** The team wallet at an address, or null for any other address. */
export function teamWallet(address: string): TeamWallet | null {
    return Object.hasOwn(TEAM_WALLETS, address) ? TEAM_WALLETS[address] : null
}

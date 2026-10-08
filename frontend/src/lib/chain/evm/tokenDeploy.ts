/**
 * Creating a Memba token: the one reviewed template (contracts/evm/src/MembaToken.sol, Wizard ERC20 + Permit +
 * Votes) deployed through the CREATE2 deployer in ONE transaction that also mints the 0.5% fee to the treasury.
 * Any wallet (EOA or Safe) can send it; no batch is needed. The fee is enforced by this code, not on chain.
 *
 * This module only plans and checks; it never talks to a wallet. The transaction it returns ({ chainId, to, data,
 * value }) goes through Memba's one EVM send path (`sendEvmWrite` in ./adapter.ts), which re-checks the wallet's
 * chain and the target's code right before sending and passes the chain to viem.
 *
 * A viem module: reach it only through the lazy EVM adapter (./load.ts), never from eager code.
 *
 * @module lib/chain/evm/tokenDeploy
 */
import { encodeDeployData, getContractAddress, isAddress, isAddressEqual, keccak256, type Address, type Hex, type PublicClient } from "viem"
import { evmContract } from "./manifest"
import { MEMBA_TOKEN } from "./membaToken.generated"
import type { EvmWrite } from "./send"

/** 0.5% of the total supply goes to the treasury, as a second mint in the constructor. */
export const TOKEN_FEE_PER_MILLE = 5n
/** ERC20Votes caps the total supply at 2^208 - 1 (in base units). */
export const TOKEN_MAX_SUPPLY = (1n << 208n) - 1n
/** OpenZeppelin 5.7 stores the EIP-712 name in 31 bytes; a longer name reverts the deployment. */
export const TOKEN_NAME_MAX_BYTES = 31

const utf8Length = (s: string) => new TextEncoder().encode(s).length

/** Why `name` cannot be a token name, or null. */
export function tokenNameProblem(name: string): string | null {
    if (name.trim() === "") return "Enter a name."
    if (utf8Length(name) > TOKEN_NAME_MAX_BYTES) return `The name must fit in ${TOKEN_NAME_MAX_BYTES} bytes (accents and emoji take more than one).`
    return null
}

/** Why `symbol` cannot be a token symbol, or null. */
export function tokenSymbolProblem(symbol: string): string | null {
    if (symbol.trim() === "") return "Enter a symbol."
    if (utf8Length(symbol) > TOKEN_NAME_MAX_BYTES) return `The symbol must fit in ${TOKEN_NAME_MAX_BYTES} bytes.`
    return null
}

/** Splits a total supply (base units) into the creator's premint and the treasury fee (rounded down). */
export function splitSupply(totalSupply: bigint): { premint: bigint; fee: bigint } {
    if (totalSupply <= 0n) throw new Error("The supply must be above zero.")
    if (totalSupply > TOKEN_MAX_SUPPLY) throw new Error("The supply is above the 2^208 - 1 limit of a voting token.")
    const fee = (totalSupply * TOKEN_FEE_PER_MILLE) / 1000n
    return { premint: totalSupply - fee, fee }
}

/** A fresh 32-byte CREATE2 salt. Random, so nobody can deploy the token before its creator has even signed. */
export function randomSalt(): Hex {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`
}

export interface TokenPlanInput {
    chainId: number
    name: string
    symbol: string
    /** Total supply in base units (18 decimals): creator premint + treasury fee. */
    totalSupply: bigint
    /** Receives the premint; the account that sends the transaction. */
    creator: Address
    /** Receives the 0.5% fee (the Memba team Safe). */
    treasury: Address
    salt: Hex
}

/** A transaction for Memba's EVM send path (`sendEvmWrite`): bound to its chain and to its sender, the creator. */
export interface TokenWrite extends EvmWrite {
    from: Address
    to: Address
    data: Hex
    value: bigint
}

export interface TokenPlan {
    chainId: number
    /** Receives the premint and sends the transaction. */
    creator: Address
    /** The CREATE2 deployer from the manifest. */
    to: Address
    /** salt ++ initcode, the deployer's whole input. */
    data: Hex
    /** Where the token will live: fixed by the deployer, the salt and the initcode (so by every argument). */
    token: Address
    premint: bigint
    fee: bigint
}

/** The transaction that creates the token, and the token's address. Pure: no network. */
export function planTokenDeploy(input: TokenPlanInput): TokenPlan {
    const nameProblem = tokenNameProblem(input.name) ?? tokenSymbolProblem(input.symbol)
    if (nameProblem) throw new Error(nameProblem)
    for (const [label, a] of [["creator", input.creator], ["treasury", input.treasury]] as const) {
        if (!isAddress(a, { strict: false }) || /^0x0{40}$/i.test(a)) throw new Error(`The ${label} address is not valid.`)
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(input.salt)) throw new Error("The salt must be 32 bytes.")
    const { premint, fee } = splitSupply(input.totalSupply)
    const initcode = encodeDeployData({
        abi: MEMBA_TOKEN.abi,
        bytecode: MEMBA_TOKEN.bytecode,
        args: [input.name, input.symbol, input.creator, premint, input.treasury, fee],
    })
    const to = evmContract(input.chainId, "create2Deployer")
    return {
        chainId: input.chainId,
        creator: input.creator,
        to,
        data: `${input.salt}${initcode.slice(2)}`,
        token: getContractAddress({ opcode: "CREATE2", from: to, salt: input.salt, bytecodeHash: keccak256(initcode) }),
        premint,
        fee,
    }
}

export type TokenDeployStep =
    /** Code already sits at the token address. A CREATE2 address commits to the deployer and the whole initcode
     *  (name, symbol, recipients, amounts), so it is this exact token: someone (or an earlier attempt) deployed
     *  it, the supply went to the creator and the fee to the treasury. Nothing to send. */
    | { kind: "deployed"; token: Address }
    /** Send `write` through sendEvmWrite. `estimatedGas` is the successful estimate this decision rests on. */
    | { kind: "send"; token: Address; write: TokenWrite; estimatedGas: bigint }

/**
 * Decides what to do with a plan right before signing, on the plan's chain: if the token already exists, nothing;
 * otherwise the transaction, once an estimate succeeded (an estimate that reverts throws, so a doomed deployment,
 * such as a CREATE2 collision that would burn the whole gas limit, is never sent). Refuses an RPC on another chain
 * and a sender other than the creator (the write carries it as `from`, which sendEvmWrite checks against the wallet).
 */
export async function prepareTokenDeploy(
    client: Pick<PublicClient, "getChainId" | "getCode" | "estimateGas">,
    plan: TokenPlan,
    account: Address,
): Promise<TokenDeployStep> {
    if (!isAddressEqual(account, plan.creator)) throw new Error("This token is planned for another creator account.")
    const chainId = await client.getChainId()
    if (chainId !== plan.chainId) throw new Error(`This token is planned for chain ${plan.chainId}, not chain ${chainId}.`)
    const code = await client.getCode({ address: plan.token })
    if (code && code !== "0x") return { kind: "deployed", token: plan.token }
    const estimatedGas = await client.estimateGas({ account, to: plan.to, data: plan.data })
    return { kind: "send", token: plan.token, write: { chainId: plan.chainId, from: plan.creator, to: plan.to, data: plan.data, value: 0n }, estimatedGas }
}

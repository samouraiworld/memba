/**
 * Writing a Basename profile on Base: registering a name with its profile in ONE payable transaction, and editing
 * the records of a name the account already owns in one resolver multicall. Both flows are exercised on both
 * forks by contracts/evm/test/fork/Basenames.t.sol (register + records + primary name; owner multicall on the
 * upgradeable and on the legacy resolver).
 *
 * Registration goes through the manifest's UpgradeableRegistrarController only (the legacy controller is denied:
 * refused on Base, still accepted on Base Sepolia). It points the name at the UpgradeableL2Resolver, sets the
 * forward address to the owner and the given text records through the request's resolver data, and sets the
 * primary name (legacy reverse record; no ENSIP-19 signature needed). The controller refunds overpayment, so
 * the transaction carries a small margin over the quoted price.
 *
 * A viem module: reach it only through a lazy loader, never from eager code (docs/evm/README.md).
 *
 * @module lib/chain/evm/basenamesWrite
 */
import { encodeFunctionData, isAddress, parseAbi, type Address, type Hex, type PublicClient } from "viem"
import { namehash } from "viem/ens"
import { BASENAME_TEXT_KEYS, basenameSuffix, isAcceptableBasename, isKnownResolver, type BasenameTextKey, type PrimaryBasename } from "./basenames"
import { evmContract } from "./manifest"

/** One Basenames year, as the controller counts it. */
export const BASENAME_YEAR_SECONDS = 365n * 24n * 60n * 60n
/** Margin over the quoted price; the controller refunds what is not used. */
const PRICE_MARGIN_PERCENT = 105n
/** Gas head-room over the estimate. */
const GAS_MARGIN_PERCENT = 120n
/** A record larger than this is refused before it costs gas (the layout document is capped at 4 KB too). */
const MAX_RECORD_BYTES = 4096

export const controllerAbi = parseAbi([
    "struct RegisterRequest { string name; address owner; uint256 duration; address resolver; bytes[] data; bool reverseRecord; uint256[] coinTypes; uint256 signatureExpiry; bytes signature; }",
    "function available(string name) view returns (bool)",
    "function registerPrice(string name, uint256 duration) view returns (uint256)",
    "function register(RegisterRequest request) payable",
])
export const resolverWriteAbi = parseAbi([
    "function setAddr(bytes32 node, address a)",
    "function setText(bytes32 node, string key, string value)",
    "function multicall(bytes[] data) returns (bytes[])",
])

export type BasenameTextChanges = Partial<Record<BasenameTextKey, string>>

export interface BasenameWrite {
    to: Address
    data: Hex
    value: bigint
}

function textCalls(node: Hex, changes: BasenameTextChanges): Hex[] {
    return Object.entries(changes).map(([key, value]) => {
        if (!(BASENAME_TEXT_KEYS as readonly string[]).includes(key)) throw new Error(`Memba does not write the "${key}" record.`)
        if (typeof value !== "string" || new TextEncoder().encode(value).length > MAX_RECORD_BYTES) throw new Error(`The ${key} record is too large.`)
        return encodeFunctionData({ abi: resolverWriteAbi, functionName: "setText", args: [node, key, value] })
    })
}

/** The full name for a label on this chain, if it is an acceptable Basename (one normalized label). */
export function basenameFor(chainId: number, label: string): string {
    const name = `${label}${basenameSuffix(chainId)}`
    if (!isAcceptableBasename(name, chainId)) throw new Error("Use one word in lower case, without dots or look-alike characters.")
    return name
}

/** Whether the label is free on this chain, and its price for `years` (wei). Throws on RPC failure. */
export async function quoteBasename(
    client: Pick<PublicClient, "readContract">,
    chainId: number,
    label: string,
    years: number,
): Promise<{ available: boolean; price: bigint }> {
    basenameFor(chainId, label)
    if (!Number.isInteger(years) || years < 1 || years > 10) throw new Error("Register for 1 to 10 years.")
    const controller = evmContract(chainId, "basenamesRegistrarController")
    const duration = BigInt(years) * BASENAME_YEAR_SECONDS
    const [available, price] = await Promise.all([
        client.readContract({ address: controller, abi: controllerAbi, functionName: "available", args: [label] }),
        client.readContract({ address: controller, abi: controllerAbi, functionName: "registerPrice", args: [label, duration] }),
    ])
    return { available, price }
}

export interface RegistrationInput {
    chainId: number
    label: string
    owner: Address
    years: number
    /** The quoted price (quoteBasename); the transaction sends it plus a refunded margin. */
    price: bigint
    /** Records set in the same transaction; empty values are skipped. */
    texts?: BasenameTextChanges
}

/** The one transaction that registers `label`, points it at the owner, sets its records and makes it primary. */
export function planBasenameRegistration(input: RegistrationInput): BasenameWrite & { name: string; node: Hex } {
    const name = basenameFor(input.chainId, input.label)
    if (!isAddress(input.owner, { strict: false }) || /^0x0{40}$/i.test(input.owner)) throw new Error("The owner address is not valid.")
    if (!Number.isInteger(input.years) || input.years < 1 || input.years > 10) throw new Error("Register for 1 to 10 years.")
    if (input.price <= 0n) throw new Error("Quote the price first.")
    const node = namehash(name)
    const texts = Object.fromEntries(Object.entries(input.texts ?? {}).filter(([, v]) => v !== "")) as BasenameTextChanges
    const data = [encodeFunctionData({ abi: resolverWriteAbi, functionName: "setAddr", args: [node, input.owner] }), ...textCalls(node, texts)]
    return {
        name,
        node,
        to: evmContract(input.chainId, "basenamesRegistrarController"),
        value: (input.price * PRICE_MARGIN_PERCENT) / 100n,
        data: encodeFunctionData({
            abi: controllerAbi,
            functionName: "register",
            args: [{
                name: input.label,
                owner: input.owner,
                duration: BigInt(input.years) * BASENAME_YEAR_SECONDS,
                resolver: evmContract(input.chainId, "basenamesL2Resolver"),
                data,
                reverseRecord: true,
                coinTypes: [],
                signatureExpiry: 0n,
                signature: "0x",
            }],
        }),
    }
}

/** One multicall on the name's own resolver that sets the changed records. Only the name's owner can send it. */
export function planBasenameTextUpdate(chainId: number, primary: PrimaryBasename, changes: BasenameTextChanges): BasenameWrite {
    if (!isKnownResolver(chainId, primary.resolver)) throw new Error("This name uses a resolver Memba does not write to.")
    const calls = textCalls(primary.node, changes)
    if (calls.length === 0) throw new Error("Nothing changed.")
    return { to: primary.resolver, value: 0n, data: encodeFunctionData({ abi: resolverWriteAbi, functionName: "multicall", args: [calls] }) }
}

/** The write with a gas limit from a successful estimate; an estimate that reverts throws, so nothing doomed is sent. */
export async function prepareBasenameWrite(
    client: Pick<PublicClient, "estimateGas">,
    write: BasenameWrite,
    account: Address,
): Promise<BasenameWrite & { gas: bigint }> {
    const estimate = await client.estimateGas({ account, to: write.to, data: write.data, value: write.value })
    return { ...write, gas: (estimate * GAS_MARGIN_PERCENT) / 100n }
}

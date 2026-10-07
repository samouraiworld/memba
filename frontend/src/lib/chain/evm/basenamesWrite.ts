/**
 * Writing a Basename profile on Base: registering a name with its profile in ONE payable transaction, and editing
 * the records of a name the account already owns in one resolver multicall. Each flow is exercised on both forks
 * by contracts/evm/test/fork/Basenames.t.sol.
 *
 * Registration goes through the manifest's UpgradeableRegistrarController only (the legacy controller is denied:
 * refused on Base, still accepted on Base Sepolia). The name is registered for the SENDING account: the
 * controller refunds overpayment and writes the reverse record for msg.sender whatever the request's owner says,
 * so owner = payer is the only safe pairing. The request points the name at the UpgradeableL2Resolver, sets the
 * forward address and the given text records, and, unless asked not to, sets the LEGACY reverse record
 * (`reverseRecord: true` with no coin types and no signature sets only that one; ENSIP-19 readers do not see it). An account that already has a different ENSIP-19 primary name (read first, see
 * readPrimaryBasename) keeps it until a second, free transaction calls `setName` on the L2ReverseRegistrar:
 * planBasenameRegistration returns that step as `primaryName`, and the UI must send it too.
 *
 * Every write is bound to its chain: `prepareBasenameWrite` refuses an RPC on another chain and a target with no
 * code (a plan for one chain sent on the other would pay a codeless address, which keeps the ETH), and the sender
 * must pass the chain to the wallet (viem `sendTransaction({ chain, ... })`), which refuses a wallet on another
 * chain. Re-quote right before sending: the price can move (expiry premium).
 *
 * A viem module: reach it only through a lazy loader, never from eager code (docs/evm/README.md).
 *
 * @module lib/chain/evm/basenamesWrite
 */
import { encodeFunctionData, isAddressEqual, parseAbi, type Address, type Hex, type PublicClient } from "viem"
import { namehash } from "viem/ens"
import { BASENAME_TEXT_KEYS, basenameSuffix, isAcceptableBasename, isKnownResolver, type BasenameTextKey, type PrimaryBasename } from "./basenames"
import { evmContract } from "./manifest"

/** One Basenames year, as the controller counts it. */
export const BASENAME_YEAR_SECONDS = 365n * 24n * 60n * 60n
/** The controller refuses shorter labels (upstream MIN_NAME_LENGTH, in characters). */
export const BASENAME_MIN_LABEL_CHARS = 3
/** Margin over the quoted price; the controller refunds what is not used, to the sender. */
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
export const reverseRegistrarAbi = parseAbi([
    "function nameForAddr(address addr) view returns (string)",
    "function setName(string name)",
])

/** Record values to set; "" clears a record (ENS has no delete). */
export type BasenameTextChanges = Partial<Record<BasenameTextKey, string>>

/** A transaction bound to its chain and its sender. */
export interface BasenameWrite {
    chainId: number
    from: Address
    to: Address
    data: Hex
    value: bigint
}

function textCalls(node: Hex, changes: BasenameTextChanges): Hex[] {
    return Object.entries(changes).filter(([, value]) => value !== undefined).map(([key, value]) => {
        if (!(BASENAME_TEXT_KEYS as readonly string[]).includes(key)) throw new Error(`Memba does not write the "${key}" record.`)
        if (typeof value !== "string") throw new Error(`The ${key} record must be text.`)
        if (new TextEncoder().encode(value).length > MAX_RECORD_BYTES) throw new Error(`The ${key} record is too large.`)
        return encodeFunctionData({ abi: resolverWriteAbi, functionName: "setText", args: [node, key, value] })
    })
}

/** The full name for a label to register on this chain: one normalized label of at least 3 characters. */
export function basenameFor(chainId: number, label: string): string {
    const name = `${label}${basenameSuffix(chainId)}`
    if (!isAcceptableBasename(name, chainId)) throw new Error("Use one word in lower case, without dots or look-alike characters.")
    if ([...label].length < BASENAME_MIN_LABEL_CHARS) throw new Error(`A name needs at least ${BASENAME_MIN_LABEL_CHARS} characters.`)
    return name
}

function checkYears(years: number): void {
    if (!Number.isInteger(years) || years < 1 || years > 10) throw new Error("Register for 1 to 10 years.")
}

export interface BasenameQuote {
    chainId: number
    label: string
    years: number
    available: boolean
    /** Price in wei for `years`, as the controller quotes it now. */
    price: bigint
    /** The account's current ENSIP-19 primary name ("" when none): a different one needs the setName step. */
    ensip19Primary: string
}

/** Availability and price of `label`, and the account's ENSIP-19 primary name. Throws on RPC failure. */
export async function quoteBasename(
    client: Pick<PublicClient, "readContract">,
    chainId: number,
    label: string,
    years: number,
    account: Address,
): Promise<BasenameQuote> {
    basenameFor(chainId, label)
    checkYears(years)
    const controller = evmContract(chainId, "basenamesRegistrarController")
    const [available, price, ensip19Primary] = await Promise.all([
        client.readContract({ address: controller, abi: controllerAbi, functionName: "available", args: [label] }),
        client.readContract({ address: controller, abi: controllerAbi, functionName: "registerPrice", args: [label, BigInt(years) * BASENAME_YEAR_SECONDS] }),
        client.readContract({ address: evmContract(chainId, "basenamesL2ReverseRegistrar"), abi: reverseRegistrarAbi, functionName: "nameForAddr", args: [account] }),
    ])
    return { chainId, label, years, available, price, ensip19Primary }
}

/** The free transaction that makes `name` the account's ENSIP-19 primary name (setName, for msg.sender). */
export function planPrimaryName(chainId: number, account: Address, name: string): BasenameWrite {
    if (!isAcceptableBasename(name, chainId)) throw new Error("Not a Basename on this network.")
    return {
        chainId,
        from: account,
        to: evmContract(chainId, "basenamesL2ReverseRegistrar"),
        value: 0n,
        data: encodeFunctionData({ abi: reverseRegistrarAbi, functionName: "setName", args: [name] }),
    }
}

export interface RegistrationPlan {
    name: string
    node: Hex
    /** The payable registration: name, address, records and, when asked, the LEGACY reverse record. */
    register: BasenameWrite
    /** Send after `register` when the name becomes primary and the account has another ENSIP-19 primary name. */
    primaryName: BasenameWrite | null
}

export interface RegistrationInput {
    account: Address
    /** The quote this plan pays: chain, label, years and price come from it, never separately. */
    quote: BasenameQuote
    texts?: BasenameTextChanges
    /**
     * Make the new name the account's primary name (default true). False keeps the current primary name: a second
     * name never silently replaces it.
     */
    makePrimary?: boolean
}

/** Registration of the quoted label for `account` (owner = payer), with its records, from a fresh quote. */
export function planBasenameRegistration(input: RegistrationInput): RegistrationPlan {
    const { account, quote } = input
    const makePrimary = input.makePrimary ?? true
    const name = basenameFor(quote.chainId, quote.label)
    checkYears(quote.years)
    if (!quote.available) throw new Error("This name is taken.")
    if (quote.price <= 0n) throw new Error("Quote the price first.")
    const node = namehash(name)
    const texts = Object.fromEntries(Object.entries(input.texts ?? {}).filter(([, v]) => v !== "" && v !== undefined)) as BasenameTextChanges
    const data = [encodeFunctionData({ abi: resolverWriteAbi, functionName: "setAddr", args: [node, account] }), ...textCalls(node, texts)]
    return {
        name,
        node,
        register: {
            chainId: quote.chainId,
            from: account,
            to: evmContract(quote.chainId, "basenamesRegistrarController"),
            value: (quote.price * PRICE_MARGIN_PERCENT) / 100n,
            data: encodeFunctionData({
                abi: controllerAbi,
                functionName: "register",
                args: [{
                    name: quote.label,
                    owner: account,
                    duration: BigInt(quote.years) * BASENAME_YEAR_SECONDS,
                    resolver: evmContract(quote.chainId, "basenamesL2Resolver"),
                    data,
                    reverseRecord: makePrimary,
                    coinTypes: [],
                    signatureExpiry: 0n,
                    signature: "0x",
                }],
            }),
        },
        primaryName: makePrimary && quote.ensip19Primary && quote.ensip19Primary !== name ? planPrimaryName(quote.chainId, account, name) : null,
    }
}

/**
 * One multicall on the name's own resolver that sets the given records ("" clears one). Only the name's owner can
 * send it; anyone else's estimate reverts.
 */
export function planBasenameTextUpdate(chainId: number, account: Address, primary: PrimaryBasename, changes: BasenameTextChanges): BasenameWrite {
    if (!isKnownResolver(chainId, primary.resolver)) throw new Error("This name uses a resolver Memba does not write to.")
    if (primary.node !== namehash(primary.name)) throw new Error("The name and its node do not match.")
    const calls = textCalls(primary.node, changes)
    if (calls.length === 0) throw new Error("Nothing changed.")
    return { chainId, from: account, to: primary.resolver, value: 0n, data: encodeFunctionData({ abi: resolverWriteAbi, functionName: "multicall", args: [calls] }) }
}

/**
 * The write with a gas limit, after proving it can only land where it was planned: the sender is the planned
 * account, the RPC serves the planned chain, the target has code there, and the estimate succeeds (an estimate
 * that reverts throws, so nothing doomed is sent). The caller still passes the chain to the wallet.
 */
export async function prepareBasenameWrite(
    client: Pick<PublicClient, "getChainId" | "getCode" | "estimateGas">,
    write: BasenameWrite,
    account: Address,
): Promise<BasenameWrite & { gas: bigint }> {
    if (!isAddressEqual(account, write.from)) throw new Error("This transaction was prepared for another account.")
    const chainId = await client.getChainId()
    if (chainId !== write.chainId) throw new Error(`This transaction is for chain ${write.chainId}, not chain ${chainId}.`)
    const code = await client.getCode({ address: write.to })
    if (!code || code === "0x") throw new Error("The contract is not deployed on this chain.")
    const estimate = await client.estimateGas({ account, to: write.to, data: write.data, value: write.value })
    return { ...write, gas: (estimate * GAS_MARGIN_PERCENT) / 100n }
}

/**
 * What the chain says an address is, before Memba shows it as a Safe, imports
 * it or proposes a payment from it. A look-alike contract can answer
 * `getOwners()` like a Safe, so the code is checked first:
 *
 * 1. the address holds a Safe proxy (known runtime codehash);
 * 2. its singleton (storage slot 0) is a known Safe singleton whose code
 *    matches its published codehash, and `VERSION()` agrees;
 * 3. only then are owners, threshold, nonce, modules, guards and fallback
 *    handler read, and anything that can act without the owners is reported.
 *
 * The RPC must answer as the expected chain first. A failed read is
 * "unavailable", never "not a Safe" (outage ≠ absent). No EVM library: the
 * reader and the hash function are passed in (the adapter gives viem's).
 *
 * @module lib/chain/evm/safe/inspect
 */
import type { Read } from "../../types"
import { AbiError, addressWord, body, readAddressArray, readString, uintWord, word, wordToAddress, wordToBigInt, ZERO_ADDRESS } from "./abi"
import { isKnownFallbackHandler, isKnownProxyCodeHash, SAFE_SLOTS, singletonAt, type Hex, type SafeVersion } from "./known"

/** The RPC calls the check needs. A viem public client provides each of them. */
export interface SafeReader {
    getChainId: () => Promise<number>
    getCode: (address: Hex) => Promise<Hex | undefined>
    getStorageAt: (address: Hex, slot: Hex) => Promise<Hex | undefined>
    /** `eth_call` at the latest block, returning the raw result. */
    call: (to: Hex, data: Hex) => Promise<Hex>
}

export type Keccak256 = (data: Hex) => Hex

export type WarningCode = "modules" | "guard" | "module-guard" | "unknown-fallback-handler" | "no-fallback-handler"

export interface SafeWarning {
    code: WarningCode
    severity: "danger" | "caution"
    /** The contracts concerned, lowercase. */
    addresses: Hex[]
    text: string
}

export type NotASafeReason = "no-contract" | "unknown-proxy" | "unknown-singleton" | "singleton-code-mismatch" | "version-mismatch"

export type SafeInspection =
    | {
        kind: "safe"
        /** Lowercase, like every address here (EIP-55 is for display). */
        address: Hex
        version: SafeVersion
        l2: boolean
        singleton: Hex
        owners: Hex[]
        threshold: number
        nonce: bigint
        modules: Hex[]
        /** More modules are enabled than the first page read. */
        modulesTruncated: boolean
        guard: Hex | null
        moduleGuard: Hex | null
        fallbackHandler: Hex | null
        warnings: SafeWarning[]
    }
    | { kind: "not-a-safe"; address: Hex; reason: NotASafeReason }

const SENTINEL: Hex = "0x0000000000000000000000000000000000000001"
const MODULES_PAGE = 10

const SELECTOR = {
    VERSION: "0xffa1ad74",
    getOwners: "0xa0e67e2b",
    getThreshold: "0xe75235b8",
    nonce: "0xaffed0e0",
    getModulesPaginated: "0xcc2f8452",
} as const

export const NOT_A_SAFE_TEXT: Readonly<Record<NotASafeReason, string>> = {
    "no-contract": "There is no contract at this address on this network. It is not a Safe here (yet).",
    "unknown-proxy": "This contract is not a Safe proxy Memba recognises.",
    "unknown-singleton": "This contract does not run a Safe version Memba recognises (1.3.0, 1.4.1 or 1.5.0).",
    "singleton-code-mismatch": "This contract points at a Safe address whose code is not the published Safe code.",
    "version-mismatch": "This contract reports a Safe version that does not match its code.",
}

const unavailable = (reason: string) => ({ kind: "unavailable", reason }) as const

/** An address kept in a storage slot, or null when the slot is empty. */
function slotAddress(value: Hex | undefined): Hex | null {
    const hex = body(value && value !== "0x" ? value : "0x00").padStart(64, "0")
    if (hex.length !== 64) throw new AbiError("slot is not one word")
    const address = wordToAddress(hex)
    return address === ZERO_ADDRESS ? null : address
}

function warningsFor(s: { modules: Hex[]; modulesTruncated: boolean; guard: Hex | null; moduleGuard: Hex | null; fallbackHandler: Hex | null }): SafeWarning[] {
    const warnings: SafeWarning[] = []
    if (s.modules.length > 0) warnings.push({
        code: "modules", severity: "danger", addresses: s.modules,
        text: `${s.modules.length}${s.modulesTruncated ? " or more" : ""} module${s.modules.length === 1 && !s.modulesTruncated ? " is" : "s are"} enabled. A module can move this Safe's funds and change its owners without their signatures. Check that you know each one.`,
    })
    if (s.guard) warnings.push({
        code: "guard", severity: "caution", addresses: [s.guard],
        text: "A transaction guard checks every transaction. A guard you don't know can block this Safe's transactions.",
    })
    if (s.moduleGuard) warnings.push({
        code: "module-guard", severity: "caution", addresses: [s.moduleGuard],
        text: "A module guard checks every module transaction. A module guard you don't know can block or allow module actions.",
    })
    if (!s.fallbackHandler) warnings.push({
        code: "no-fallback-handler", severity: "caution", addresses: [],
        text: "No fallback handler is set: this Safe cannot sign messages for apps, and some token transfers to it will fail.",
    })
    else if (!isKnownFallbackHandler(s.fallbackHandler)) warnings.push({
        code: "unknown-fallback-handler", severity: "danger", addresses: [s.fallbackHandler],
        text: "The fallback handler is not a Safe handler Memba recognises. It answers signature checks for this Safe, so it could approve token permits or orders the owners never signed.",
    })
    return warnings
}

export async function inspectSafe(reader: SafeReader, keccak256: Keccak256, expectedChainId: number, safeAddress: string): Promise<Read<SafeInspection>> {
    let address: Hex
    try {
        address = `0x${body(safeAddress)}`
        if (address.length !== 42) throw new AbiError("not an address")
    } catch {
        return unavailable("this is not an address")
    }
    let chainId: number
    try {
        chainId = await reader.getChainId()
    } catch {
        return unavailable("the RPC did not answer")
    }
    if (chainId !== expectedChainId) return unavailable(`the RPC answered as chain ${chainId}, not ${expectedChainId}`)

    try {
        const notASafe = (reason: NotASafeReason) => ({ kind: "ok", value: { kind: "not-a-safe", address, reason } }) as const
        const code = await reader.getCode(address)
        if (!code || code === "0x") return notASafe("no-contract")
        if (!isKnownProxyCodeHash(keccak256(code))) return notASafe("unknown-proxy")

        const singletonAddress = slotAddress(await reader.getStorageAt(address, SAFE_SLOTS.singleton))
        const singleton = singletonAddress ? singletonAt(singletonAddress) : undefined
        if (!singletonAddress || !singleton) return notASafe("unknown-singleton")
        const singletonCode = await reader.getCode(singletonAddress)
        if (!singletonCode || keccak256(singletonCode).toLowerCase() !== singleton.codeHash) return notASafe("singleton-code-mismatch")

        const call = async (data: string) => body(await reader.call(address, data as Hex))
        const [version, owners, threshold, nonce, modulesPage, guard, fallbackHandler, moduleGuard] = await Promise.all([
            call(SELECTOR.VERSION).then((r) => readString(r, 0)),
            call(SELECTOR.getOwners).then((r) => readAddressArray(r, 0)),
            call(SELECTOR.getThreshold).then((r) => wordToBigInt(word(r, 0))),
            call(SELECTOR.nonce).then((r) => wordToBigInt(word(r, 0))),
            call(SELECTOR.getModulesPaginated + addressWord(SENTINEL) + uintWord(MODULES_PAGE)).then((r) => ({ modules: readAddressArray(r, 0), next: wordToAddress(word(r, 1)) })),
            reader.getStorageAt(address, SAFE_SLOTS.guard).then(slotAddress),
            reader.getStorageAt(address, SAFE_SLOTS.fallbackHandler).then(slotAddress),
            singleton.version === "1.5.0" ? reader.getStorageAt(address, SAFE_SLOTS.moduleGuard).then(slotAddress) : Promise.resolve(null),
        ])
        if (version !== singleton.version) return notASafe("version-mismatch")
        if (owners.length === 0 || threshold < 1n || threshold > BigInt(owners.length)) return unavailable("the Safe's owners and threshold do not add up")

        const modulesTruncated = modulesPage.next !== SENTINEL && modulesPage.next !== ZERO_ADDRESS
        const facts = { modules: modulesPage.modules, modulesTruncated, guard, moduleGuard, fallbackHandler }
        return {
            kind: "ok",
            value: {
                kind: "safe", address, version: singleton.version, l2: singleton.l2, singleton: singletonAddress,
                owners, threshold: Number(threshold), nonce, ...facts, warnings: warningsFor(facts),
            },
        }
    } catch (err) {
        return unavailable(err instanceof AbiError ? `the RPC gave an answer that is not a Safe's (${err.message})` : "the RPC did not answer")
    }
}

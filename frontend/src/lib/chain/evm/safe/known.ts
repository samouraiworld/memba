/**
 * The Safe contracts Memba recognises on Base and Base Sepolia (same addresses
 * on both). Plain data, no EVM library.
 *
 * Sources: safe-global/safe-deployments 1.37.63 (addresses and codehashes,
 * v1.3.0 canonical and eip155, v1.4.1, v1.5.0), checked on chain by the Phase 0
 * fork tests (docs/evm/PHASE0.md) and the per-chain manifests
 * (deployments/evm/<chainId>.json) for v1.5.0, and, on 2026-10-07, every v1.3.0 canonical
 * and eip155 singleton, fallback handler and MultiSend by codehash on both
 * chains. Proxy runtime codehashes: v1.3.0 from the factory's
 * `proxyRuntimeCode()`; v1.4.1 and v1.5.0 from running each factory's
 * `proxyCreationCode()` with its singleton in an `eth_call` (the v1.3.0 value
 * matches both ways). A proxy keeps its singleton in storage slot 0, so its
 * runtime code is the same for every Safe a factory creates.
 *
 * Memba creates Safes with SafeL2 v1.5.0 only. The others are recognised when
 * someone imports a Safe that already exists.
 *
 * @module lib/chain/evm/safe/known
 */

export type Hex = `0x${string}`

export type SafeVersion = "1.3.0" | "1.4.1" | "1.5.0"

export interface KnownSingleton {
    version: SafeVersion
    /** The L2 singleton emits the events indexers read; Memba creates L2 Safes. */
    l2: boolean
    address: Hex
    codeHash: Hex
}

export const SAFE_SINGLETONS: readonly KnownSingleton[] = [
    { version: "1.3.0", l2: false, address: "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552", codeHash: "0xbba688fbdb21ad2bb58bc320638b43d94e7d100f6f3ebaab0a4e4de6304b1c2e" },
    { version: "1.3.0", l2: false, address: "0x69f4D1788e39c87893C980c06EdF4b7f686e2938", codeHash: "0xbba688fbdb21ad2bb58bc320638b43d94e7d100f6f3ebaab0a4e4de6304b1c2e" },
    { version: "1.3.0", l2: true, address: "0x3E5c63644E683549055b9Be8653de26E0B4CD36E", codeHash: "0x21842597390c4c6e3c1239e434a682b054bd9548eee5e9b1d6a4482731023c0f" },
    { version: "1.3.0", l2: true, address: "0xfb1bffC9d739B8D520DaF37dF666da4C687191EA", codeHash: "0x21842597390c4c6e3c1239e434a682b054bd9548eee5e9b1d6a4482731023c0f" },
    { version: "1.4.1", l2: false, address: "0x41675C099F32341bf84BFc5382aF534df5C7461a", codeHash: "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4" },
    { version: "1.4.1", l2: true, address: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762", codeHash: "0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff" },
    { version: "1.5.0", l2: false, address: "0xFf51A5898e281Db6DfC7855790607438dF2ca44b", codeHash: "0xdda019cbd7c867a533a2a86e5c53434fdc50b13122b5a5ddb4a8df61b31c20f2" },
    { version: "1.5.0", l2: true, address: "0xEdd160fEBBD92E350D4D398fb636302fccd67C7e", codeHash: "0x180193227186ccb85316c94db1f0d156ed932b14712cfaac78901899178572dc" },
]

/** The singleton new Safes use: SafeL2 v1.5.0. */
export const CREATE_SINGLETON = SAFE_SINGLETONS.find((s) => s.version === "1.5.0" && s.l2)!

/** Runtime codehash of a Safe proxy, by the factory version that created it. */
export const SAFE_PROXY_CODE_HASHES: Readonly<Record<SafeVersion, Hex>> = {
    "1.3.0": "0xb89c1b3bdf2cf8827818646bce9a8f6e372885f8c55e5c07acbd307cb133b000",
    "1.4.1": "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
    "1.5.0": "0x4e381985ca68b3e5d27b4425fa581c19cf33146d3f887a3cfca96f55528ea46f",
}

export const SAFE_PROXY_FACTORY_1_5_0: Hex = "0x14F2982D601c9458F93bd70B218933A6f8165e7b"

/** CompatibilityFallbackHandler, the handler Safe{Wallet} and Memba install. */
export const SAFE_FALLBACK_HANDLERS: readonly { version: SafeVersion; address: Hex }[] = [
    { version: "1.3.0", address: "0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4" },
    { version: "1.3.0", address: "0x017062a1dE2FE6b99BE3d9d37841FeD19F573804" },
    { version: "1.4.1", address: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99" },
    { version: "1.5.0", address: "0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4" },
]

export type MultiSendKind = "multiSend" | "multiSendCallOnly"

/** MultiSend may delegatecall each inner call; MultiSendCallOnly refuses to. */
export const SAFE_MULTISENDS: readonly { version: SafeVersion; kind: MultiSendKind; address: Hex }[] = [
    { version: "1.3.0", kind: "multiSend", address: "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761" },
    { version: "1.3.0", kind: "multiSend", address: "0x998739BFdAAdde7C933B942a68053933098f9EDa" },
    { version: "1.3.0", kind: "multiSendCallOnly", address: "0x40A2aCCbd92BCA938b02010E17A5b8929b49130D" },
    { version: "1.3.0", kind: "multiSendCallOnly", address: "0xA1dabEF33b3B82c7814B6D82A79e50F4AC44102B" },
    { version: "1.4.1", kind: "multiSend", address: "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526" },
    { version: "1.4.1", kind: "multiSendCallOnly", address: "0x9641d764fc13c8B624c04430C7356C1C7C8102e2" },
    { version: "1.5.0", kind: "multiSend", address: "0x218543288004CD07832472D464648173c77D7eB7" },
    { version: "1.5.0", kind: "multiSendCallOnly", address: "0xA83c336B20401Af773B6219BA5027174338D1836" },
]

/** Storage slots read by address (a Safe exposes no getter for these before 1.5.0). */
export const SAFE_SLOTS = {
    /** keccak256("guard_manager.guard.address") */
    guard: "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8",
    /** keccak256("fallback_manager.handler.address") */
    fallbackHandler: "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5",
    /** keccak256("module_manager.module_guard.address"), Safe 1.5.0 only */
    moduleGuard: "0xb104e0b93118902c651344349b610029d694cfdec91c589c91ebafbcd0289947",
    /** The proxy's singleton. */
    singleton: "0x0000000000000000000000000000000000000000000000000000000000000000",
} as const satisfies Record<string, Hex>

/** The chains this table describes. */
export const SAFE_CHAIN_IDS: readonly number[] = [8453, 84532]

const lower = (a: string) => a.toLowerCase()

export function singletonAt(address: string): KnownSingleton | undefined {
    return SAFE_SINGLETONS.find((s) => lower(s.address) === lower(address))
}

export function multiSendAt(address: string): (typeof SAFE_MULTISENDS)[number] | undefined {
    return SAFE_MULTISENDS.find((m) => lower(m.address) === lower(address))
}

export function isKnownFallbackHandler(address: string): boolean {
    return SAFE_FALLBACK_HANDLERS.some((h) => lower(h.address) === lower(address))
}

export function isKnownProxyCodeHash(hash: string): boolean {
    return Object.values(SAFE_PROXY_CODE_HASHES).some((h) => h === lower(hash))
}

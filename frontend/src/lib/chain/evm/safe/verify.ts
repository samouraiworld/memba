/**
 * What the Transaction Service says about a queued Safe transaction, checked
 * in the browser before Memba shows it as signed:
 *
 * - its `safeTxHash` is recomputed from its own fields (EIP-712, Safe ≥ 1.3.0
 *   domain = chain id + Safe address); a mismatch means the listing does not
 *   describe what the owners signed;
 * - each confirmation's signer is recovered from its signature (an EIP-712
 *   signature, or an `eth_sign` one with v + 4) and must be the owner it claims
 *   and an owner of the Safe. Contract signatures (EIP-1271) and on-chain
 *   approvals cannot be checked offline: they count as submitted, not verified.
 *
 * Part of the lazy Safe SDK chunk (imported by ./sdk.ts only).
 *
 * @module lib/chain/evm/safe/verify
 */
import { hashMessage, hashTypedData, recoverAddress, type Hex } from "viem"

export interface QueuedSafeTx {
    safe: string
    to: string
    value: string
    data?: string | null
    operation: number
    safeTxGas: string | number
    baseGas: string | number
    gasPrice: string | number
    gasToken: string
    refundReceiver?: string | null
    nonce: string | number
    safeTxHash: string
    confirmations?: readonly { owner: string; signature: string }[]
}

export interface TxCheck {
    /** The listed safeTxHash is the hash of the listed fields. */
    hashMatches: boolean
    /** Owners (lowercase) who submitted a confirmation. */
    submitted: Set<string>
    /** Owners (lowercase) whose signature recovers to them over this hash. */
    verified: Set<string>
}

const ZERO = "0x0000000000000000000000000000000000000000"

const SAFE_TX_TYPES = {
    SafeTx: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "operation", type: "uint8" },
        { name: "safeTxGas", type: "uint256" },
        { name: "baseGas", type: "uint256" },
        { name: "gasPrice", type: "uint256" },
        { name: "gasToken", type: "address" },
        { name: "refundReceiver", type: "address" },
        { name: "nonce", type: "uint256" },
    ],
} as const

/** The EIP-712 hash a Safe (v1.3.0 and later) owner signs for this transaction. */
export function safeTxHash(chainId: number, tx: QueuedSafeTx): Hex {
    return hashTypedData({
        domain: { chainId, verifyingContract: tx.safe as Hex },
        types: SAFE_TX_TYPES,
        primaryType: "SafeTx",
        message: {
            to: tx.to as Hex,
            value: BigInt(tx.value),
            data: (tx.data || "0x") as Hex,
            operation: tx.operation,
            safeTxGas: BigInt(tx.safeTxGas),
            baseGas: BigInt(tx.baseGas),
            gasPrice: BigInt(tx.gasPrice),
            gasToken: tx.gasToken as Hex,
            refundReceiver: (tx.refundReceiver || ZERO) as Hex,
            nonce: BigInt(tx.nonce),
        },
    })
}

/** The owner an ECDSA confirmation recovers to, or null for one that can't be checked offline. */
export async function confirmationSigner(hash: Hex, signature: string): Promise<string | null> {
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return null
    const v = parseInt(signature.slice(130, 132), 16)
    if (v === 27 || v === 28) return (await recoverAddress({ hash, signature: signature as Hex })).toLowerCase()
    if (v === 31 || v === 32) {
        const adjusted = `${signature.slice(0, 130)}${(v - 4).toString(16)}` as Hex
        return (await recoverAddress({ hash: hashMessage({ raw: hash }), signature: adjusted })).toLowerCase()
    }
    return null // 0: contract signature (EIP-1271), 1: approved on chain
}

export async function checkQueuedTx(chainId: number, owners: readonly string[], tx: QueuedSafeTx): Promise<TxCheck> {
    const ownerSet = new Set(owners.map((o) => o.toLowerCase()))
    const submitted = new Set<string>()
    const verified = new Set<string>()
    let hash: Hex
    try {
        hash = safeTxHash(chainId, tx)
    } catch {
        return { hashMatches: false, submitted, verified }
    }
    const hashMatches = hash === tx.safeTxHash.toLowerCase()
    for (const c of tx.confirmations ?? []) {
        const owner = c.owner.toLowerCase()
        if (!ownerSet.has(owner)) continue
        submitted.add(owner)
        if (!hashMatches) continue
        try {
            if ((await confirmationSigner(hash, c.signature)) === owner) verified.add(owner)
        } catch { /* an unreadable signature stays unverified */ }
    }
    return { hashMatches, submitted, verified }
}

/**
 * Safe reads for the Multisig app on an EVM network. Each query loads the Safe
 * SDK chunk on first use (loadSafeSdk); this module imports no EVM library.
 *
 * Sources of truth: the chain for what a Safe is and who controls it
 * (inspection: owners, threshold, nonce, modules, guards); the Safe
 * Transaction Service, through Memba's proxy, for the Safes listing an owner,
 * the queue and the history. Queued transactions are checked in the browser
 * (hash and signatures) before any is shown as signed. Every address is
 * lowercase here; the EIP-55 spelling is returned for display.
 *
 * @module os/multisig/evm/useSafes
 */
import { useQuery } from "@tanstack/react-query"
import { API_BASE_URL } from "../../../lib/config"
import { EVM_ENABLED } from "../../../lib/chain/flag"
import { loadSafeSdk } from "../../../lib/chain/evm/safe/load"
import type { SafeInspection } from "../../../lib/chain/evm/safe/inspect"
import { decodeSafeTx, type DecodedTx } from "../../../lib/chain/evm/safe/decode"
import type { Read } from "../../../lib/chain/types"
import type { Awaiting } from "../useOsMultisig"

export interface SafeNetwork {
    /** Registry key (lib/chain/evm/networks.ts). */
    key: string
    chainId: number
}

/** The Safe network of a session on an EVM network. */
export function safeNetworkOf(session: { network: { key: string; chainId: string } }): SafeNetwork {
    return { key: session.network.key, chainId: Number(session.network.chainId) }
}

/** Safes the Transaction Service lists `owner` in: any Safe can list anyone, so these are never "yours" by default. */
export function useSafesListing(net: SafeNetwork, owner: string) {
    return useQuery({
        queryKey: ["safe", "owners", net.chainId, owner],
        enabled: EVM_ENABLED && !!owner,
        queryFn: async (): Promise<{ address: string; display: string }[]> => {
            const sdk = await loadSafeSdk()
            const { safes } = await sdk.safeApiKit(API_BASE_URL, net.chainId).getSafesByOwner(owner)
            return [...new Set(safes.map((s) => s.toLowerCase()))].map((address) => ({ address, display: sdk.toChecksum(address) }))
        },
    })
}

export interface SafeFacts {
    inspection: Read<SafeInspection>
    /** EIP-55 spellings, by lowercase address, for what the window shows. */
    display: Record<string, string>
}

/** What the chain says `address` is. A failed read is "unavailable", never "not a Safe". */
export function useSafeFacts(net: SafeNetwork, address: string) {
    return useQuery({
        queryKey: ["safe", "inspect", net.chainId, address],
        enabled: EVM_ENABLED,
        queryFn: async (): Promise<SafeFacts> => {
            const sdk = await loadSafeSdk()
            const inspection = await sdk.inspect(net.key, address)
            const shown = [address, ...(inspection.kind === "ok" && inspection.value.kind === "safe"
                ? [...inspection.value.owners, ...inspection.value.warnings.flatMap((w) => w.addresses)]
                : [])]
            return { inspection, display: Object.fromEntries(shown.map((a) => [a, sdk.toChecksum(a)])) }
        },
    })
}

export function useSafeBalance(net: SafeNetwork, address: string) {
    return useQuery({
        queryKey: ["safe", "balance", net.chainId, address],
        enabled: EVM_ENABLED,
        queryFn: async () => (await loadSafeSdk()).readBalance(net.key, address),
    })
}

export interface QueuedTx {
    safeTxHash: string
    nonce: bigint
    decoded: DecodedTx
    submitted: Set<string>
    verified: Set<string>
    hashMatches: boolean
    threshold: number
    submissionDate: string
}

/** Pending transactions at or above the Safe's on-chain nonce, oldest nonce first, each checked in the browser. */
export function useSafeQueue(net: SafeNetwork, address: string, safe: { owners: readonly string[]; threshold: number; nonce: bigint } | null) {
    return useQuery({
        queryKey: ["safe", "queue", net.chainId, address, safe?.nonce.toString() ?? ""],
        enabled: EVM_ENABLED && !!safe,
        queryFn: async (): Promise<QueuedTx[]> => {
            const sdk = await loadSafeSdk()
            const { results } = await sdk.safeApiKit(API_BASE_URL, net.chainId)
                .getPendingTransactions(address, { currentNonce: Number(safe!.nonce), ordering: "nonce", limit: 50 })
            const queued = await Promise.all(results.filter((tx) => tx.safe.toLowerCase() === address).map(async (tx) => {
                const check = await sdk.checkQueuedTx(net.chainId, safe!.owners, tx)
                return {
                    safeTxHash: tx.safeTxHash.toLowerCase(), nonce: BigInt(tx.nonce), decoded: decodeSafeTx(address, { ...tx, data: tx.data ?? null }),
                    ...check, threshold: safe!.threshold, submissionDate: tx.submissionDate,
                }
            }))
            return queued.filter((tx) => tx.nonce >= safe!.nonce).sort((a, b) => (a.nonce === b.nonce ? 0 : a.nonce < b.nonce ? -1 : 1))
        },
    })
}

export interface ExecutedTx {
    safeTxHash: string
    nonce: bigint
    decoded: DecodedTx
    transactionHash: string | null
    executionDate: string | null
    successful: boolean | null
}

const HISTORY_LIMIT = 20

/** The Safe's last executed transactions, newest first. */
export function useSafeHistory(net: SafeNetwork, address: string, enabled: boolean) {
    return useQuery({
        queryKey: ["safe", "history", net.chainId, address],
        enabled: EVM_ENABLED && enabled,
        queryFn: async (): Promise<ExecutedTx[]> => {
            const sdk = await loadSafeSdk()
            const { results } = await sdk.safeApiKit(API_BASE_URL, net.chainId)
                .getMultisigTransactions(address, { executed: true, ordering: "-nonce", limit: HISTORY_LIMIT })
            return results.filter((tx) => tx.safe.toLowerCase() === address && tx.isExecuted).map((tx) => ({
                safeTxHash: tx.safeTxHash.toLowerCase(), nonce: BigInt(tx.nonce), decoded: decodeSafeTx(address, { ...tx, data: tx.data ?? null }),
                transactionHash: tx.transactionHash, executionDate: tx.executionDate, successful: tx.isSuccessful,
            }))
        },
    })
}

export { HISTORY_LIMIT }

/** Queued transactions per nonce that more than one proposal claims: only one of them can execute. */
export function sameNonce(queue: readonly QueuedTx[]): Map<string, number> {
    const counts = new Map<string, number>()
    for (const tx of queue) counts.set(tx.nonce.toString(), (counts.get(tx.nonce.toString()) ?? 0) + 1)
    return new Map([...counts].filter(([, n]) => n > 1))
}

/** How many queued transactions of each Safe still wait for `me`. */
export function countSafeAwaiting(queues: readonly { address: string; pending: readonly { confirmations?: readonly { owner: string }[] }[] }[], me: string): Map<string, number> {
    const counts = new Map<string, number>()
    for (const q of queues) {
        const n = q.pending.filter((tx) => !(tx.confirmations ?? []).some((c) => c.owner.toLowerCase() === me)).length
        if (n > 0) counts.set(q.address, n)
    }
    return counts
}

const NONE: Awaiting = { counts: new Map(), mine: 0, shared: 0 }

/**
 * The bell's count on an EVM network: queued transactions waiting for `me`
 * in the Safes listing them. Memba keeps no list of "your" Safes yet, so all
 * of them count as shared with you (named neutrally, never as yours).
 */
export function useSafeAwaiting(net: SafeNetwork | null, me: string): Awaiting {
    const listing = useSafesListing(net ?? { key: "", chainId: 0 }, net ? me : "")
    const pending = useQuery({
        queryKey: ["safe", "awaiting", net?.chainId ?? 0, me, (listing.data ?? []).map((s) => s.address).join(",")],
        enabled: EVM_ENABLED && !!net && !!me && !!listing.data?.length,
        refetchInterval: 60_000,
        queryFn: async () => {
            const sdk = await loadSafeSdk()
            const kit = sdk.safeApiKit(API_BASE_URL, net!.chainId)
            const queues = await Promise.all(listing.data!.map(async ({ address }) => {
                const { nonce } = await kit.getSafeInfo(address)
                const { results } = await kit.getPendingTransactions(address, { currentNonce: Number(nonce), limit: 50 })
                return { address, pending: results }
            }))
            return countSafeAwaiting(queues, me)
        },
    })
    if (!pending.data) return NONE
    const shared = [...pending.data.values()].reduce((a, b) => a + b, 0)
    return { counts: pending.data, mine: 0, shared }
}

/**
 * Multisig reads for Memba OS, on the classic backend calls (MultisigHub,
 * MultisigView) under their own query keys (trap: never share a classic key
 * with a different data shape), and the chain's own word on an address.
 *
 * @module os/multisig/useOsMultisig
 */
import { useQuery } from "@tanstack/react-query"
import { api } from "../../lib/api"
import { ENABLE_NATIVE_GNO_MULTISIG, GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"
import { abciQueryText, ChainAnswerError } from "../../lib/dao/packageStatus"
import { awaitingText, countAwaiting, sharedAwaitingText } from "../../lib/multisigAwaiting"
import { NATIVE_MULTISIG_TYPE } from "../../lib/nativeMultisig"
import { getRpcUrlsInOrder } from "../../lib/rpcFallback"
import { ExecutionState, type Multisig, type Transaction } from "../../gen/memba/v1/memba_pb"
import type { LayoutContext } from "../../types/layout"

type Auth = LayoutContext["auth"]

export function useMyMultisigs(auth: Auth) {
    const token = auth.token
    return useQuery({
        // Scoped to the active chain, like MultisigHub: the details below are
        // read on GNO_CHAIN_ID, so another chain's entry could not be opened.
        queryKey: ["multisig", "os-list", GNO_CHAIN_ID, token?.userAddress ?? ""],
        enabled: !!token && auth.isAuthenticated,
        queryFn: async (): Promise<Multisig[]> =>
            (await api.multisigs({ authToken: token!, chainId: GNO_CHAIN_ID, limit: 50 })).multisigs,
    })
}

export interface MultisigDetail {
    multisig: Multisig | null
    pending: Transaction[]
    executed: Transaction[]
    pendingError: boolean
    executedError: boolean
}

export function useMultisigDetail(auth: Auth, address: string) {
    const token = auth.token
    return useQuery({
        queryKey: ["multisig", "os-detail", address, token?.userAddress ?? ""],
        enabled: !!token && auth.isAuthenticated,
        queryFn: async (): Promise<MultisigDetail> => {
            const [info, pending, executed] = await Promise.allSettled([
                api.multisigInfo({ authToken: token!, multisigAddress: address, chainId: GNO_CHAIN_ID }),
                api.transactions({ authToken: token!, multisigAddress: address, chainId: GNO_CHAIN_ID, executionState: ExecutionState.PENDING, limit: 50 }),
                api.transactions({ authToken: token!, multisigAddress: address, chainId: GNO_CHAIN_ID, executionState: ExecutionState.EXECUTED, limit: 50 }),
            ])
            if (info.status === "rejected") throw info.reason
            return {
                multisig: info.value.multisig ?? null,
                pending: pending.status === "fulfilled" ? pending.value.transactions : [],
                executed: executed.status === "fulfilled" ? executed.value.transactions : [],
                pendingError: pending.status === "rejected",
                executedError: executed.status === "rejected",
            }
        },
    })
}

/** What the chain says an address is: a multisig key, a single key, or no key yet (an account that never signed). */
export type ChainAccountKind = "multisig" | "single" | "unused"

/** The chain's own word, from a node that serves this chain. Anyone may link any address: only this says it is a multisig. */
export function useChainAccountKind(address: string, enabled: boolean) {
    return useQuery({
        queryKey: ["multisig", "chain-kind", GNO_CHAIN_ID, address],
        enabled,
        retry: false,
        queryFn: async (): Promise<ChainAccountKind> => {
            let text: string
            try {
                text = await abciQueryText({ rpcUrl: GNO_RPC_URL, rpcUrls: getRpcUrlsInOrder(), chainId: GNO_CHAIN_ID }, `auth/accounts/${address}`, "")
            } catch (err) {
                // The chain answered and has no account there: nothing has signed from it yet.
                if (err instanceof ChainAnswerError) return "unused"
                throw err
            }
            // The same shapes the create form reads a member's key from.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const parsed: any = JSON.parse(text)
            const account = parsed?.BaseAccount || parsed?.value?.BaseAccount || parsed?.value || parsed
            const type = (account?.pub_key || account?.PubKey || account?.public_key)?.["@type"]
            return type === NATIVE_MULTISIG_TYPE ? "multisig" : type ? "single" : "unused"
        },
    })
}

export interface Awaiting {
    /** Per multisig address. */
    counts: Map<string, number>
    /** In accounts the member joined (or created). */
    mine: number
    /** In accounts shared with them and not joined, or whose join state is unknown: shown only as a count. */
    shared: number
}

const NONE: Awaiting = { counts: new Map(), mine: 0, shared: 0 }

/**
 * The proposals waiting for this member's signature (lib/multisigAwaiting),
 * split by whether they joined the account. Nothing for "" (no member), and
 * the key carries the member so a guest never reads a member's cached count.
 */
export function useAwaiting(auth: Auth, me: string): Awaiting {
    const token = auth.token
    const enabled = ENABLE_NATIVE_GNO_MULTISIG && !!token && auth.isAuthenticated && !!me
    const pending = useQuery({
        queryKey: ["multisig", "os-awaiting", GNO_CHAIN_ID, token?.userAddress ?? "", me],
        enabled,
        refetchInterval: 60_000,
        queryFn: async () => countAwaiting((await api.transactions({ authToken: token!, chainId: GNO_CHAIN_ID, executionState: ExecutionState.PENDING, limit: 50 })).transactions, me),
    })
    const list = useMyMultisigs(auth)
    if (!enabled || !pending.data) return NONE
    const joined = new Set((list.data ?? []).filter((m) => m.joined).map((m) => m.address))
    let mine = 0, shared = 0
    for (const [address, n] of pending.data) {
        if (joined.has(address)) mine += n
        else shared += n
    }
    return { counts: pending.data, mine, shared }
}

/** The bell's label: new signing notices, and proposals waiting for a signature. */
export function notificationsLabel(unread: number, awaiting: Pick<Awaiting, "mine" | "shared">): string {
    const parts = [unread ? `${unread} new` : "", awaiting.mine ? awaitingText(awaiting.mine) : "", awaiting.shared ? sharedAwaitingText(awaiting.shared) : ""].filter(Boolean)
    return parts.length ? `Notifications, ${parts.join(", ")}` : "Notifications"
}

/**
 * Multisig reads for Memba OS, on the classic backend calls (MultisigHub,
 * MultisigView) under their own query keys (trap: never share a classic key
 * with a different data shape), and the chain's own word on an address.
 *
 * @module os/multisig/useOsMultisig
 */
import { useQuery } from "@tanstack/react-query"
import { api } from "../../lib/api"
import { GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"
import { abciQueryText, ChainAnswerError } from "../../lib/dao/packageStatus"
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

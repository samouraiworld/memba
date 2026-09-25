/**
 * Multisig reads for Memba OS, on the classic backend calls (MultisigHub,
 * MultisigView) under their own query keys (trap: never share a classic key
 * with a different data shape).
 *
 * @module os/multisig/useOsMultisig
 */
import { useQuery } from "@tanstack/react-query"
import { api } from "../../lib/api"
import { GNO_CHAIN_ID } from "../../lib/config"
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

export interface MultisigDetail { multisig: Multisig | null; pending: Transaction[]; executed: Transaction[] }

export function useMultisigDetail(auth: Auth, address: string) {
    const token = auth.token
    return useQuery({
        queryKey: ["multisig", "os-detail", address, token?.userAddress ?? ""],
        enabled: !!token && auth.isAuthenticated,
        queryFn: async (): Promise<MultisigDetail> => {
            const [info, pending, executed] = await Promise.all([
                api.multisigInfo({ authToken: token!, multisigAddress: address, chainId: GNO_CHAIN_ID }),
                api.transactions({ authToken: token!, multisigAddress: address, chainId: GNO_CHAIN_ID, executionState: ExecutionState.PENDING, limit: 50 }),
                api.transactions({ authToken: token!, multisigAddress: address, chainId: GNO_CHAIN_ID, executionState: ExecutionState.EXECUTED, limit: 50 }),
            ])
            return { multisig: info.multisig ?? null, pending: pending.transactions, executed: executed.transactions }
        },
    })
}

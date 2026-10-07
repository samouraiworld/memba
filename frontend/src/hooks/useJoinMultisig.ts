/**
 * Joining a multisig: keeping it in the signed-in member's Memba accounts. A
 * member another member registered already reads and signs its transactions;
 * joining only lists it among their own accounts. Joining re-reads every
 * multisig view.
 *
 * @module hooks/useJoinMultisig
 */
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import type { Multisig, Token } from "../gen/memba/v1/memba_pb"
import { api } from "../lib/api"
import { GNO_BECH32_PREFIX, GNO_CHAIN_ID } from "../lib/config"
import { revealInvisibleFormatting } from "../lib/dao/v2Text"
import { logChainError } from "../lib/errorLog"

export function useJoinMultisig(token: Token | null | undefined) {
    const queryClient = useQueryClient()
    const [joining, setJoining] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const join = async (ms: Multisig) => {
        if (!token) return
        if (!ms.pubkeyJson) { setError(`Cannot join ${revealInvisibleFormatting(ms.name || ms.address)}: its public-key configuration is unavailable.`); return }
        setJoining(ms.address)
        setError(null)
        try {
            await api.createOrJoinMultisig({ authToken: token, chainId: ms.chainId || GNO_CHAIN_ID, multisigPubkeyJson: ms.pubkeyJson, expectedMultisigAddress: ms.address, name: ms.name || "", bech32Prefix: GNO_BECH32_PREFIX })
            await queryClient.invalidateQueries({ queryKey: ["multisig"] })
        } catch (err) {
            logChainError("multisig:join", err, "error", token.userAddress || undefined)
            setError(err instanceof Error ? err.message : "Couldn't join this multisig.")
        } finally {
            setJoining(null)
        }
    }
    return { join, joining, error, dismiss: () => setError(null) }
}

/**
 * The signed-in account's own Safe list and names (backend RegisterSafe /
 * Safes, #1520). Memba keeps only this: the chain says what a Safe is and who
 * owns it, and the server checks that on chain before adding a Safe to a list.
 * Everything here needs a Sign-In with Ethereum session for this account and
 * chain; without one, Safes are still browsable, just not kept or named.
 *
 * @module os/multisig/evm/useMySafes
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Code, ConnectError } from "@connectrpc/connect"
import { api } from "../../../lib/api"
import { EVM_ENABLED } from "../../../lib/chain/flag"
import type { SafeRecord, Token } from "../../../gen/memba/v1/memba_pb"
import { useAuth } from "../../../hooks/useAuth"
import { caip2, tokenFits } from "../../evm/sessionRules"
import type { OsSession } from "../../shell/useOsSession"
import type { SafeNetwork } from "./useSafes"

/** The session's Sign-In with Ethereum token, when it signs in exactly this account on this chain (session.address is "" until signed in). */
export function useSafeToken(session: OsSession): Token | null {
    const auth = useAuth()
    return tokenFits(auth.token, caip2(session.network.chainId), session.address.toLowerCase()) ? auth.token : null
}

const mineKey = (net: SafeNetwork, token: Token | null) => ["safe", "mine", net.chainId, token?.userAddress.toLowerCase() ?? ""]

/** The Safes the account keeps in its list, newest first, with their names. */
export function useMySafes(net: SafeNetwork, token: Token | null) {
    return useQuery({
        queryKey: mineKey(net, token),
        enabled: EVM_ENABLED && !!token,
        queryFn: async (): Promise<SafeRecord[]> => (await api.safes({ authToken: token!, chainId: caip2(String(net.chainId)) })).safes,
    })
}

/** The name an account sees for a Safe: its own, else the first namer's (said so), else none. */
export function safeLabel(record: SafeRecord | undefined): { name: string; namedBy: string } | null {
    if (!record) return null
    if (record.name) return { name: record.name, namedBy: "" }
    if (record.sharedName) return { name: record.sharedName, namedBy: record.namedBy }
    return null
}

/** Why the server refused to keep or name a Safe, for the member. */
export function registerErrorText(err: unknown): string {
    switch (ConnectError.from(err).code) {
        case Code.PermissionDenied: return "This account is not an owner of this Safe on chain, so Memba won't add it to your list."
        case Code.FailedPrecondition: return "This address is not a Safe Memba recognises on this network."
        case Code.Unavailable: return "Memba couldn't read the Safe on chain just now. Try again in a moment."
        case Code.Unauthenticated: return "Your sign-in has ended. Sign in again, then try again."
        case Code.Unimplemented: return "Keeping Safes in a list isn't available on this server yet."
        case Code.InvalidArgument: return "Memba couldn't use this name or address. Names are at most 256 bytes, without line breaks."
        case Code.ResourceExhausted: return "Too many changes in a minute. Wait a little, then try again."
        default: return "Couldn't save it. Try again."
    }
}

/** Adds, renames or leaves a Safe in the account's list (the server checks ownership on chain first). */
export function useRegisterSafe(net: SafeNetwork, token: Token | null) {
    const client = useQueryClient()
    return useMutation({
        mutationFn: async (v: { address: string; name: string; joined: boolean }): Promise<SafeRecord> => {
            const res = await api.registerSafe({ authToken: token!, chainId: caip2(String(net.chainId)), safeAddress: v.address, name: v.name, joined: v.joined })
            return res.safe!
        },
        onSuccess: () => client.invalidateQueries({ queryKey: mineKey(net, token) }),
    })
}

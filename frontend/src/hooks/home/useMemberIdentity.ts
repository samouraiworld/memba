/**
 * useMemberIdentity — resolves the connected member's on-chain @username
 * (r/sys/users) for the member-hero greeting.
 *
 * Honesty / never-blank contract: the wallet address is always available, so the
 * hook always returns a usable `displayName` (the truncated address) and
 * `initials` even before — or without — a username. When a username resolves it
 * upgrades to `@handle`; a failed/empty resolve degrades silently to the address.
 *
 * @module hooks/home/useMemberIdentity
 */
import { useQuery } from "@tanstack/react-query"
import { resolveOnChainUsername } from "../../lib/profile"
import { truncateAddr } from "../../lib/format"

export interface MemberIdentity {
    loading: boolean
    /** Resolved @username (without the @), or undefined when none/unresolved. */
    username?: string
    /** Always present: "@username" when resolved, else the truncated address. */
    displayName: string
    /** Two-char avatar initials, derived from the username or the address. */
    initials: string
}

/** Two uppercase initials from a username, else from the address (minus the g1/gno1
 *  prefix). Always returns two chars so the avatar is never blank. */
function deriveInitials(username: string | undefined, address: string): string {
    const source = username
        ? username
        : address.replace(/^g(no)?1/i, "")
    const chars = source.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase()
    return chars.length === 2 ? chars : (chars + "•").slice(0, 2)
}

export function useMemberIdentity(address: string | null): MemberIdentity {
    const query = useQuery({
        queryKey: ["useMemberIdentity", address],
        queryFn: () => resolveOnChainUsername(address as string),
        enabled: !!address,
        staleTime: 300_000,
        retry: false,
    })

    const addr = address ?? ""
    const username = query.data ? query.data : undefined
    const displayName = username ? `@${username}` : truncateAddr(addr)
    const initials = deriveInitials(username, addr)

    return { loading: query.isPending && !!address, username, displayName, initials }
}

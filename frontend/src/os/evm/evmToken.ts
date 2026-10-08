/**
 * The EVM session token, under its own storage key. One session per network
 * family: the gno.land session keeps `memba_auth_token` (hooks/useAuth.ts) and
 * never sees this one, and signing in on Base never touches the gno.land one.
 *
 * @module os/evm/evmToken
 */
import { useCallback, useEffect, useState } from "react"
import type { Token } from "../../gen/memba/v1/memba_pb"
import { EVM_TOKEN_KEY, onSessionInvalidated } from "../../lib/authSession"

export { EVM_TOKEN_KEY }

/** The stored token, unless missing, malformed or expired. */
export function loadEvmToken(): Token | null {
    try {
        const raw = localStorage.getItem(EVM_TOKEN_KEY)
        if (!raw) return null
        const t = JSON.parse(raw) as Token
        if (typeof t?.chainId !== "string" || typeof t.userAddress !== "string" || !(Date.parse(t.expiration) > Date.now())) {
            localStorage.removeItem(EVM_TOKEN_KEY)
            return null
        }
        return t
    } catch {
        return null
    }
}

function store(token: Token | null): void {
    try {
        if (token === null) localStorage.removeItem(EVM_TOKEN_KEY)
        // Every field the server signs over, so the token re-verifies when sent back.
        else localStorage.setItem(EVM_TOKEN_KEY, JSON.stringify({
            nonce: token.nonce, userAddress: token.userAddress, expiration: token.expiration, chainId: token.chainId, serverSignature: token.serverSignature,
        }))
    } catch { /* storage refused: the session lasts this visit only */ }
}

/** The EVM session token: kept, dropped, and dropped again when it expires. */
export function useEvmToken() {
    const [token, setToken] = useState<Token | null>(loadEvmToken)
    // The server rejected the EVM token (lib/api.ts authSelfHeal): this session ends, the gno.land one does not.
    useEffect(() => onSessionInvalidated(() => setToken(null), "evm"), [])
    useEffect(() => {
        if (!token) return
        const t = setInterval(() => { if (!loadEvmToken()) setToken(null) }, 60_000)
        return () => clearInterval(t)
    }, [token])
    const adopt = useCallback((t: Token) => { store(t); setToken(t) }, [])
    const clear = useCallback(() => { store(null); setToken(null) }, [])
    return { token, adopt, clear }
}

/**
 * The backend handlers that accept an EVM account's token (they authenticate through
 * `authenticateAccount`). Every other handler refuses it with a 401, and a 401 on a
 * request that carried the EVM token signs the EVM session out (lib/api.ts): an EVM
 * app must only send it to these. Add a handler here when the backend opts it in.
 */
export type EvmAccountHandler = "GetProfile" | "UpdateProfile" | "RegisterSafe" | "Safes"

/** The session's EVM token, for a call to `handler` (one of those that accept it); null as a guest. */
export function evmAuthToken(handler: EvmAccountHandler, session: { evm?: { token: Token | null } }): Token | null {
    void handler // the name is the check: TypeScript accepts only an opted-in handler
    return session.evm?.token ?? null
}

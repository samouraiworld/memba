import { useState, useCallback, useEffect } from "react";
import { api } from "../lib/api";
import type { Token } from "../gen/memba/v1/memba_pb";

const TOKEN_KEY = "memba_auth_token";

interface AuthState {
    token: Token | null;
    address: string;
    loading: boolean;
    error: string | null;
}

function saveToken(token: Token) {
    try {
        localStorage.setItem(TOKEN_KEY, JSON.stringify({
            nonce: token.nonce,
            userAddress: token.userAddress,
            expiration: token.expiration,
            serverSignature: token.serverSignature,
        }));
    } catch { /* localStorage unavailable */ }
}

function loadToken(): Token | null {
    try {
        const raw = localStorage.getItem(TOKEN_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);

        // F1: Validate expiry before rehydrating.
        // P2-D: Client-side validation only checks expiry, not server signature.
        // This is acceptable because the backend re-validates the full token
        // (including server signature) on every RPC call. A forged token in
        // localStorage will simply cause 401 errors on the first API call.
        if (data.expiration) {
            const exp = new Date(data.expiration);
            if (exp <= new Date()) {
                localStorage.removeItem(TOKEN_KEY);
                return null;
            }
        }
        return data as Token;
    } catch {
        return null;
    }
}

function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* no-op */ }
}

export function useAuth() {
    const [state, setState] = useState<AuthState>(() => {
        const saved = loadToken();
        return {
            token: saved,
            address: saved?.userAddress || "",
            loading: false,
            error: null,
        };
    });

    // Recheck token expiry periodically.
    useEffect(() => {
        if (!state.token) return;
        const checkExpiry = () => {
            if (state.token?.expiration) {
                const exp = new Date(state.token.expiration);
                if (exp <= new Date()) {
                    clearToken();
                    setState({ token: null, address: "", loading: false, error: "Session expired" });
                }
            }
        };
        const timer = setInterval(checkExpiry, 60_000);
        return () => clearInterval(timer);
    }, [state.token]);

    const getChallenge = useCallback(async (userPubkeyJson?: string) => {
        const res = await api.getChallenge({ userPubkeyJson: userPubkeyJson || "" });
        return res.challenge;
    }, []);

    const getToken = useCallback(
        async (infoJson: string, userSignature: string) => {
            setState((s) => ({ ...s, loading: true, error: null }));
            try {
                const res = await api.getToken({ infoJson, userSignature });
                const token = res.authToken;
                if (token) {
                    saveToken(token);
                    setState({
                        token,
                        address: token.userAddress,
                        loading: false,
                        error: null,
                    });
                }
                return token;
            } catch (err) {
                const message = err instanceof Error ? err.message : "Auth failed";
                setState((s) => ({ ...s, loading: false, error: message }));
                return null;
            }
        },
        []
    );

    const logout = useCallback(() => {
        clearToken();
        setState({ token: null, address: "", loading: false, error: null });
    }, []);

    return {
        ...state,
        isAuthenticated: !!state.token,
        getChallenge,
        getToken,
        logout,
    };
}

import { useState, useCallback } from "react";
import { api } from "../lib/api";
import type { Token } from "../gen/memba/v1/memba_pb";

interface AuthState {
    token: Token | null;
    address: string;
    loading: boolean;
    error: string | null;
}

export function useAuth() {
    const [state, setState] = useState<AuthState>({
        token: null,
        address: "",
        loading: false,
        error: null,
    });

    const getChallenge = useCallback(async () => {
        const res = await api.getChallenge({});
        return res.challenge;
    }, []);

    const getToken = useCallback(
        async (infoJson: string, userSignature: string) => {
            setState((s) => ({ ...s, loading: true, error: null }));
            try {
                const res = await api.getToken({ infoJson, userSignature });
                const token = res.authToken;
                if (token) {
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

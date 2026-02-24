import { useState, useCallback } from "react";
import { api } from "../lib/api";
import type { Token, Multisig as MultisigPb } from "../gen/memba/v1/memba_pb";

export function useMultisig(token: Token | null) {
    const [multisigs, setMultisigs] = useState<MultisigPb[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchMultisigs = useCallback(
        async (chainId?: string) => {
            if (!token) return;
            setLoading(true);
            setError(null);
            try {
                const res = await api.multisigs({ authToken: token, chainId, limit: 50 });
                setMultisigs(res.multisigs);
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to fetch");
            } finally {
                setLoading(false);
            }
        },
        [token]
    );

    const getMultisigInfo = useCallback(
        async (multisigAddress: string, chainId: string) => {
            if (!token) return null;
            try {
                const res = await api.multisigInfo({ authToken: token, multisigAddress, chainId });
                return res.multisig;
            } catch {
                return null;
            }
        },
        [token]
    );

    const createOrJoinMultisig = useCallback(
        async (chainId: string, multisigPubkeyJson: string, name: string, bech32Prefix: string) => {
            if (!token) return null;
            setLoading(true);
            setError(null);
            try {
                const res = await api.createOrJoinMultisig({
                    authToken: token,
                    chainId,
                    multisigPubkeyJson,
                    name,
                    bech32Prefix,
                });
                return res;
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to create multisig");
                return null;
            } finally {
                setLoading(false);
            }
        },
        [token]
    );

    return {
        multisigs,
        loading,
        error,
        fetchMultisigs,
        getMultisigInfo,
        createOrJoinMultisig,
    };
}

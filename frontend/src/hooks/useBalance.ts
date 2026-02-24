import { useState, useCallback, useEffect, useRef } from "react";

const GNO_RPC_URL =
    import.meta.env.VITE_GNO_RPC_URL || "https://rpc.test11.testnets.gno.land:443";

interface BalanceState {
    balance: string; // human-readable, e.g. "1.5 GNOT"
    rawUgnot: bigint;
    loading: boolean;
    error: string | null;
}

const UGNOT_PER_GNOT = 1_000_000n;

function formatGnot(ugnot: bigint): string {
    const whole = ugnot / UGNOT_PER_GNOT;
    const frac = ugnot % UGNOT_PER_GNOT;
    if (frac === 0n) return `${whole} GNOT`;
    const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
    return `${whole}.${fracStr} GNOT`;
}

export function useBalance(address: string | null, refreshInterval = 30000) {
    const [state, setState] = useState<BalanceState>({
        balance: "— GNOT",
        rawUgnot: 0n,
        loading: false,
        error: null,
    });
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchBalance = useCallback(async () => {
        if (!address) return;

        // S3: Validate address format to prevent ABCI URL injection.
        if (!/^g(no)?1[a-z0-9]{38,}$/.test(address)) {
            setState((s) => ({ ...s, loading: false, error: "Invalid address format" }));
            return;
        }

        setState((s) => ({ ...s, loading: true, error: null }));
        try {
            // Use Gno ABCI query for bank balance
            const url = `${GNO_RPC_URL}/abci_query?path=%22bank/balances/${address}%22`;
            const res = await fetch(url);
            const json = await res.json();

            // Response value is base64 encoded
            const rawValue = json?.result?.response?.ResponseBase?.Value;
            if (!rawValue) {
                setState({ balance: "0 GNOT", rawUgnot: 0n, loading: false, error: null });
                return;
            }

            const decoded = atob(rawValue);
            // Parse the balance string, format: "12345ugnot"
            const match = decoded.match(/(\d+)ugnot/);
            const ugnot = match ? BigInt(match[1]) : 0n;

            setState({
                balance: formatGnot(ugnot),
                rawUgnot: ugnot,
                loading: false,
                error: null,
            });
        } catch (err) {
            setState((s) => ({
                ...s,
                loading: false,
                error: err instanceof Error ? err.message : "Failed to fetch balance",
            }));
        }
    }, [address]);

    useEffect(() => {
        fetchBalance();
        if (address && refreshInterval > 0) {
            intervalRef.current = setInterval(fetchBalance, refreshInterval);
        }
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [address, refreshInterval, fetchBalance]);

    return { ...state, refetch: fetchBalance };
}

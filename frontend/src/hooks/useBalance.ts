import { useState, useCallback, useEffect, useRef } from "react";
import { GNO_RPC_URL } from "../lib/config";

interface BalanceState {
    balance: string; // human-readable full precision, e.g. "1.500001 GNOT"
    compactBalance: string; // compact for header, e.g. "1.5 GNOT"
    rawUgnot: bigint;
    loading: boolean;
    error: string | null;
}

const UGNOT_PER_GNOT = 1_000_000n;

export function formatGnot(ugnot: bigint): string {
    const whole = ugnot / UGNOT_PER_GNOT;
    const frac = ugnot % UGNOT_PER_GNOT;
    if (frac === 0n) return `${whole} GNOT`;
    const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
    return `${whole}.${fracStr} GNOT`;
}

/** Compact format for header: rounds down to 1 decimal (e.g. "19.3 GNOT"). */
export function formatGnotCompact(ugnot: bigint): string {
    const whole = ugnot / UGNOT_PER_GNOT;
    const frac = ugnot % UGNOT_PER_GNOT;
    if (frac === 0n) return `${whole} GNOT`;
    // Take first decimal digit (floor — no rounding up for safety)
    const firstDecimal = frac / 100_000n;
    if (firstDecimal === 0n) return `${whole} GNOT`;
    return `${whole}.${firstDecimal} GNOT`;
}

export function useBalance(address: string | null, refreshInterval = 30000) {
    const [state, setState] = useState<BalanceState>({
        balance: "— GNOT",
        compactBalance: "— GNOT",
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
            // Use JSON-RPC POST for reliability (same pattern as dao/shared.ts)
            const res = await fetch(GNO_RPC_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: "memba-balance",
                    method: "abci_query",
                    params: {
                        path: `bank/balances/${address}`,
                        data: "",
                    },
                }),
            });
            const json = await res.json();

            // Try ResponseBase.Value first, then Data (different RPC versions)
            const rawValue = json?.result?.response?.ResponseBase?.Value
                || json?.result?.response?.ResponseBase?.Data
                || json?.result?.response?.value;

            if (!rawValue) {
                setState({ balance: "0 GNOT", compactBalance: "0 GNOT", rawUgnot: 0n, loading: false, error: null });
                return;
            }

            const decoded = atob(rawValue);
            // Parse the balance string, format: "12345ugnot"
            const match = decoded.match(/(\d+)ugnot/);
            const ugnot = match ? BigInt(match[1]) : 0n;

            setState({
                balance: formatGnot(ugnot),
                compactBalance: formatGnotCompact(ugnot),
                rawUgnot: ugnot,
                loading: false,
                error: null,
            });
        } catch (err) {
            console.warn("[useBalance] Failed to fetch balance:", err);
            setState((s) => ({
                ...s,
                balance: "? GNOT",
                compactBalance: "? GNOT",
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

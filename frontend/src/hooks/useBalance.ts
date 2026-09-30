import { useState, useCallback, useEffect, useRef } from "react";
import { ugnotInCoinsJson } from "../lib/bankBalance";
import { resilientFetch } from "../lib/rpcFallback";

interface BalanceState {
    address: string | null;
    balance: string; // human-readable full precision, e.g. "1.500001 GNOT"
    compactBalance: string; // compact for header, e.g. "1.5 GNOT"
    rawUgnot?: bigint; // absent until this address has a trustworthy chain response
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
        address: null,
        balance: "— GNOT",
        compactBalance: "— GNOT",
        loading: false,
        error: null,
    });
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const requestSeq = useRef(0);

    const fetchBalance = useCallback(async () => {
        const request = ++requestSeq.current;
        // Start state changes after the effect's synchronous setup. An account
        // switch can invalidate this request before the microtask runs.
        await Promise.resolve();
        if (request !== requestSeq.current) return;
        if (!address) {
            setState({ address: null, balance: "— GNOT", compactBalance: "— GNOT", loading: false, error: null });
            return;
        }

        // S3: Validate address format to prevent ABCI URL injection.
        if (!/^g(no)?1[a-z0-9]{38,}$/.test(address)) {
            setState({ address, balance: "? GNOT", compactBalance: "? GNOT", loading: false, error: "Invalid address format" });
            return;
        }

        setState((s) => s.address === address
            ? { ...s, loading: true, error: null }
            : { address, balance: "— GNOT", compactBalance: "— GNOT", loading: true, error: null });
        try {
            // Use JSON-RPC POST with RPC failover for reliability
            const res = await resilientFetch((rpcUrl) => ({
                url: rpcUrl,
                init: {
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
                },
            }));
            const json = await res.json();

            // Try ResponseBase.Value first, then Data (different RPC versions)
            const response = json?.result?.response;
            if (response?.ResponseBase?.Error || response?.error) throw new Error("Balance query failed");
            const rawValue = response?.ResponseBase?.Value
                || response?.ResponseBase?.Data
                || response?.value;

            if (!rawValue) {
                throw new Error("Balance response was missing");
            }

            const ugnot = ugnotInCoinsJson(atob(rawValue));

            if (request === requestSeq.current) setState({
                address,
                balance: formatGnot(ugnot),
                compactBalance: formatGnotCompact(ugnot),
                rawUgnot: ugnot,
                loading: false,
                error: null,
            });
        } catch (err) {
            console.warn("[useBalance] Failed to fetch balance:", err);
            if (request === requestSeq.current) setState({
                address,
                balance: "? GNOT",
                compactBalance: "? GNOT",
                loading: false,
                error: err instanceof Error ? err.message : "Failed to fetch balance",
            });
        }
    }, [address]);

    useEffect(() => {
        const requests = requestSeq;
        let active = true;
        queueMicrotask(() => { if (active) void fetchBalance() });
        if (address && refreshInterval > 0) {
            // W4: skip the RPC round-trip while the tab is hidden — several
            // components mount this hook, so an unguarded 30s interval
            // multiplies into a real background drain.
            intervalRef.current = setInterval(() => {
                if (!document.hidden) fetchBalance();
            }, refreshInterval);
        }
        return () => {
            active = false;
            requests.current++;
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [address, refreshInterval, fetchBalance]);

    // An account switch must mask the previous account's balance on the very first render,
    // before the effect above has a chance to start the next request.
    return {
        ...(state.address === address ? state : { address, balance: "— GNOT", compactBalance: "— GNOT", rawUgnot: undefined, loading: !!address, error: null }),
        refetch: fetchBalance,
    };
}

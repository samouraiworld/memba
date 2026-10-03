import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { getActive, getGame } from "../../lib/connect4"

// Throw on a failed read so react-query keeps the last good data. Keep polling in a
// background tab: a hidden tab that misses its reveal/move window forfeits stake.
export const useActive = () => useQuery({
    queryKey: ["connect4", "active"],
    queryFn: async () => { const r = await getActive(0, 100); if (!r) throw new Error("unavailable"); return r },
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
})
export const useGame = (id: number) => useQuery({
    queryKey: ["connect4", "game", id],
    queryFn: async () => { const r = await getGame(id); if (!r) throw new Error("unavailable"); return r },
    refetchInterval: 3_000,
    refetchIntervalInBackground: true,
})

/** Chain seconds now: the last response's block time advanced by wall time since it arrived. */
export function useChainNow(now: number | undefined, fetchedAt: number): number {
    const [wall, setWall] = useState(() => Date.now())
    useEffect(() => { const t = setInterval(() => setWall(Date.now()), 1_000); return () => clearInterval(t) }, [])
    return now === undefined ? 0 : now + Math.max(0, Math.floor((wall - fetchedAt) / 1_000))
}

/** One tx at a time; refreshes every connect4 query after success. `walletFn` is the
 * same call routed through the wallet, offered via retryWithWallet if `fn` fails. */
export function useTx() {
    const client = useQueryClient()
    const [pending, setPending] = useState(false)
    const [err, setErr] = useState<{ message: string; name: string } | null>(null)
    const [walletFn, setWalletFn] = useState<(() => Promise<unknown>) | null>(null)
    const [failures, setFailures] = useState(0)
    const run = async (fn: () => Promise<unknown>, wfn?: () => Promise<unknown>) => {
        if (pending) return false
        setPending(true); setErr(null); setWalletFn(null)
        try { await fn(); await client.invalidateQueries({ queryKey: ["connect4"] }); void client.invalidateQueries({ queryKey: ["quickplay"] }); return true }
        catch (e) {
            setErr({ message: e instanceof Error ? e.message : String(e), name: e instanceof Error ? e.name : "" })
            setWalletFn(wfn ? () => wfn : null)
            setFailures((n) => n + 1)
            return false
        }
        finally { setPending(false) }
    }
    return {
        pending, run, failures,
        error: err?.message ?? null,
        errorName: err?.name ?? null,
        clearError: () => { setErr(null); setWalletFn(null) },
        retryWithWallet: walletFn ? () => void run(walletFn) : null,
    }
}

export const formatGnot = (ugnot: number) => `${ugnot / 1_000_000} GNOT`
export const fmtSeconds = (s: number) => (s <= 0 ? "0s" : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`)

export const shortAddr = (a: string) => (a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a)

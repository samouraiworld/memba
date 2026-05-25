/**
 * useGnoloveBackendHealth — GET /health probe with auto-degrade.
 *
 * Probe semantics:
 *   - First check on mount, then every PROBE_INTERVAL_MS.
 *   - Probes GET /health; only HTTP 200 counts as "up".
 *   - Backend is DOWN after FAIL_THRESHOLD consecutive failures
 *     inside FAIL_WINDOW_MS (the plan's "2× in 30s" rule).
 *   - After recovery, one successful probe clears the down state.
 *   - Pauses when the tab is hidden (visibilitychange) to avoid
 *     wasting 240 HEAD requests/hour on backgrounded tabs.
 *
 * @module hooks/gnolove/useGnoloveBackendHealth
 */

import { useEffect, useRef, useState } from "react"
import { GNOLOVE_API_URL } from "../../lib/config"

const PROBE_INTERVAL_MS = 15_000
const FAIL_THRESHOLD = 2
const FAIL_WINDOW_MS = 30_000
const PROBE_TIMEOUT_MS = 5_000

export type BackendHealth = "unknown" | "up" | "down"

interface UseGnoloveBackendHealthOptions {
    enabled?: boolean
    probeUrl?: string
}

export function useGnoloveBackendHealth(opts: UseGnoloveBackendHealthOptions = {}): BackendHealth {
    const { enabled = true, probeUrl = `${GNOLOVE_API_URL}/teams` } = opts
    const [status, setStatus] = useState<BackendHealth>("unknown")
    const failuresRef = useRef<number[]>([])
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        if (!enabled) return
        let cancelled = false

        async function probe() {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
            let ok = false
            try {
                const res = await fetch(probeUrl, { method: "GET", signal: controller.signal })
                ok = res.status === 200
            } catch {
                ok = false
            } finally {
                clearTimeout(timeout)
            }
            if (cancelled) return

            const now = Date.now()
            if (ok) {
                failuresRef.current = []
                setStatus("up")
            } else {
                failuresRef.current = [
                    ...failuresRef.current.filter(t => now - t < FAIL_WINDOW_MS),
                    now,
                ]
                if (failuresRef.current.length >= FAIL_THRESHOLD) {
                    setStatus("down")
                }
            }
        }

        function startPolling() {
            probe()
            intervalRef.current = setInterval(probe, PROBE_INTERVAL_MS)
        }

        function stopPolling() {
            if (intervalRef.current) {
                clearInterval(intervalRef.current)
                intervalRef.current = null
            }
        }

        function handleVisibility() {
            if (document.hidden) {
                stopPolling()
            } else {
                startPolling()
            }
        }

        startPolling()
        document.addEventListener("visibilitychange", handleVisibility)

        return () => {
            cancelled = true
            stopPolling()
            document.removeEventListener("visibilitychange", handleVisibility)
        }
    }, [enabled, probeUrl])

    return status
}

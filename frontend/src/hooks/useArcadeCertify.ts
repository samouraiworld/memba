/**
 * useArcadeCertify — the opt-in, wallet-gated "certify this run on-chain" flow,
 * shared by every arcade game (BARRICADE, Space Invaders). Game-agnostic by
 * construction: the caller supplies the full ArcadeSubmitBody and the backend
 * derives the game from the seed grammar.
 *
 * Play stays no-wallet; this hook is only exercised when the player taps Certify.
 * It runs the standard Memba login ceremony (same challenge/response as
 * BlockPartyGame / Layout) to obtain the REST bearer token, then POSTs the
 * re-simulated run to the certify endpoint. Auth is memoized by useAuth, so a
 * second certify in the same session skips the signature.
 */
import { useCallback, useRef, useState } from "react"
import { useAdena } from "./useAdena"
import { useAuth } from "./useAuth"
import { useNetwork } from "./useNetwork"
import { signInWithWallet } from "../os/shell/walletLogin"
import { submitRun, type ArcadeSubmitBody, type ArcadeSubmitResult } from "../lib/arcade"

function readStoredToken(): string {
    try {
        return localStorage.getItem("memba_auth_token") || ""
    } catch {
        return ""
    }
}

export type CertifyStatus = "idle" | "certifying" | "certified" | "error"

export function useArcadeCertify() {
    const adena = useAdena()
    const auth = useAuth()
    const network = useNetwork()
    const [status, setStatus] = useState<CertifyStatus>("idle")
    const [error, setError] = useState<string | null>(null)
    const [result, setResult] = useState<ArcadeSubmitResult | null>(null)
    const busy = useRef(false)

    // Ensure a valid session and return the stored bearer token, running the
    // login ceremony if needed. Mirrors BlockPartyGame.authenticate.
    const ensureToken = useCallback(async (): Promise<string> => {
        if (!adena.connected) {
            const ok = await adena.connect()
            if (!ok) throw new Error("Connect your wallet to certify.")
        }
        if (!auth.isAuthenticated) await signInWithWallet(adena, auth, network.chainId)
        const stored = readStoredToken()
        if (!stored) throw new Error("Sign in with your wallet to certify.")
        return stored
    }, [adena, auth, network.chainId])

    const certify = useCallback(
        async (body: ArcadeSubmitBody) => {
            if (busy.current) return
            busy.current = true
            setStatus("certifying")
            setError(null)
            try {
                const token = await ensureToken()
                const res = await submitRun(body, token)
                setResult(res)
                setStatus("certified")
            } catch (e) {
                setError(e instanceof Error ? e.message : "Certify failed")
                setStatus("error")
            } finally {
                busy.current = false
            }
        },
        [ensureToken],
    )

    return { certify, status, error, result }
}

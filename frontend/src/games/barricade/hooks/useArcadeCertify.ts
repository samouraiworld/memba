/**
 * useArcadeCertify — the opt-in, wallet-gated "certify this run on-chain" flow.
 *
 * Play stays no-wallet; this hook is only exercised when the player taps Certify.
 * It runs the standard Memba login ceremony (same challenge/response as
 * BlockPartyGame / Layout) to obtain the REST bearer token, then POSTs the
 * re-simulated run to the certify endpoint. Auth is memoized by useAuth, so a
 * second certify in the same session skips the signature.
 */
import { useCallback, useRef, useState } from "react"
import { useAdena } from "../../../hooks/useAdena"
import { useAuth } from "../../../hooks/useAuth"
import { useNetwork } from "../../../hooks/useNetwork"
import { buildTokenRequestInfo } from "../../../lib/loginChallenge"
import { submitRun, type ArcadeSubmitBody, type ArcadeSubmitResult } from "../../../lib/arcade"

function bytesToBase64(bytes: Uint8Array): string {
    let binary = ""
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
}

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
        if (!auth.isAuthenticated) {
            const challengeRes = await auth.getChallenge(adena.pubkeyJSON || undefined, network.chainId)
            if (!challengeRes) throw new Error("Couldn't start sign-in — try again.")
            const nonceB64 = bytesToBase64(challengeRes.nonce)
            const signed = await adena.signLoginChallenge(network.chainId, nonceB64)
            let signature = ""
            let pubkey = adena.pubkeyJSON || ""
            if (signed) {
                signature = signed.signature
                if (signed.pubKey) pubkey = signed.pubKey
            }
            if (!pubkey && !adena.address) {
                throw new Error("Wallet address unavailable — reconnect your wallet.")
            }
            const info = buildTokenRequestInfo({
                nonceB64,
                expiration: challengeRes.expiration,
                serverSignatureB64: bytesToBase64(challengeRes.serverSignature),
                boundPubkeyHash: challengeRes.boundPubkeyHash || "",
                chainId: challengeRes.chainId || network.chainId,
                ...(pubkey ? { userPubkeyJson: pubkey } : { userAddress: adena.address }),
            })
            const token = await auth.getToken(JSON.stringify(info), signature)
            if (!token) throw new Error("Sign-in failed — please try again.")
        }
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

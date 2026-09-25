/**
 * GitHub OAuth callback page.
 * Handles the redirect from GitHub OAuth with ?code=X.
 * Sends the code to the backend with the wallet session token; the backend
 * checks the CSRF state, confirms the account with GitHub and stores the
 * GitHub link on that wallet's profile itself. The client never writes the
 * link, so a displayed GitHub link is always one the wallet proved.
 */
import { useNetworkNav } from "../hooks/useNetworkNav"
import { useState, useEffect, useRef } from "react"
import { useOutletContext, useSearchParams } from "react-router-dom"
import { API_BASE_URL } from "../lib/config"
import { GitHubIcon } from "../components/ui/GitHubIcon"
import { walletBearer } from "../lib/walletBearer"
import type { LayoutContext } from "../types/layout"

/** GitHub user info returned from backend exchange. */
interface GitHubUserInfo {
    login: string
    avatar_url: string
    name: string
}

export function GithubCallback() {
    const navigate = useNetworkNav()
    const [searchParams] = useSearchParams()
    const { auth, adena, isLoggingIn } = useOutletContext<LayoutContext>()

    const code = searchParams.get("code")
    const oauthState = searchParams.get("state")

    // A missing code is known synchronously at mount — start in the error
    // state instead of flipping to it from the effect.
    const [step, setStep] = useState<"exchanging" | "success" | "error">(code ? "exchanging" : "error")
    const [ghUser, setGhUser] = useState<GitHubUserInfo | null>(null)
    const [error, setError] = useState<string | null>(code ? null : "No OAuth code received from GitHub")
    // The code and CSRF state are single-use: exchange at most once per visit,
    // even if the wallet/auth context re-renders the effect.
    const exchangeStarted = useRef(false)

    // The link is written for the signed-in wallet, so the exchange waits for
    // a session token. If the wallet disconnected during the redirect, the page
    // stays here and continues once the user reconnects.
    const awaitingWallet = step === "exchanging" && !auth.token && !isLoggingIn

    useEffect(() => {
        if (!code || !auth.token || exchangeStarted.current) return
        exchangeStarted.current = true
        const token = auth.token

        const exchange = async () => {
            try {
                const stateParam = oauthState ? `&state=${encodeURIComponent(oauthState)}` : ""
                const res = await fetch(`${API_BASE_URL}/github/oauth/exchange?code=${encodeURIComponent(code)}${stateParam}`, {
                    headers: { Authorization: walletBearer(token) },
                })
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}))
                    throw new Error(data.error || `Exchange failed (${res.status})`)
                }
                const data: GitHubUserInfo = await res.json()
                if (!data.login) throw new Error("No GitHub login returned")
                setGhUser(data)
                setStep("success")
                // Guard: wallet may have disconnected during OAuth redirect
                if (adena.address) {
                    sessionStorage.removeItem("returnToProfile")
                    setTimeout(() => navigate(`/profile/${adena.address}`), 2500)
                } else {
                    const savedAddr = sessionStorage.getItem("returnToProfile")
                    sessionStorage.removeItem("returnToProfile")
                    setTimeout(() => navigate(savedAddr ? `/profile/${savedAddr}` : "/dashboard"), 2500)
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to link GitHub")
                setStep("error")
            }
        }

        exchange()
    }, [code, oauthState, auth.token, adena.address, navigate])

    return (
        <div className="animate-fade-in" style={{
            maxWidth: 480, margin: "80px auto", padding: 32,
            fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
        }}>
            <div className="k-card" style={{ padding: 32, textAlign: "center" }}>
                <GitHubIcon size={48} color="var(--color-accent-blue-link)" style={{ margin: "0 auto 16px" }} />

                {step === "exchanging" && !awaitingWallet && (
                    <>
                        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", marginBottom: 8 }}>
                            Connecting to GitHub...
                        </h2>
                        <p style={{ fontSize: "var(--pro-small, 12px)", color: "var(--color-text-secondary)" }}>
                            Verifying your GitHub account and linking it to your wallet.
                        </p>
                        <div style={{ margin: "20px auto", width: 24, height: 24, border: "2px solid var(--color-text-dim)", borderTop: "2px solid var(--color-brand)", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                    </>
                )}

                {awaitingWallet && (
                    <>
                        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", marginBottom: 8 }}>
                            Connect your wallet
                        </h2>
                        <p style={{ fontSize: "var(--pro-small, 12px)", color: "var(--color-warning)" }}>
                            Sign in with your wallet to finish linking your GitHub account. This page continues automatically once you're signed in (within 10 minutes of leaving GitHub).
                        </p>
                    </>
                )}

                {step === "success" && (
                    <>
                        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-success)", marginBottom: 8 }}>
                            ✓ GitHub Linked!
                        </h2>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", margin: "16px 0" }}>
                            {ghUser?.avatar_url && (
                                <img src={ghUser.avatar_url} alt="GitHub avatar" referrerPolicy="no-referrer" style={{ width: 48, height: 48, borderRadius: "50%", border: "2px solid rgba(76,175,80,0.3)" }} />
                            )}
                            <div style={{ textAlign: "left" }}>
                                <div style={{ fontSize: "var(--pro-body, 14px)", fontWeight: 600, color: "var(--color-text)" }}>{ghUser?.name || ghUser?.login}</div>
                                <div style={{ fontSize: "var(--pro-caption, 11px)", color: "var(--color-success)" }}>@{ghUser?.login} linked ✓</div>
                            </div>
                        </div>
                        <p style={{ fontSize: "var(--pro-small, 12px)", color: "var(--color-text-secondary)" }}>
                            Redirecting to your profile...
                        </p>
                    </>
                )}

                {step === "error" && (
                    <>
                        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-danger)", marginBottom: 8 }}>
                            Linking Failed
                        </h2>
                        <p style={{ fontSize: "var(--pro-small, 12px)", color: "var(--color-danger)", marginBottom: 16 }}>
                            {error}
                        </p>
                        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                            <button
                                className="k-btn-secondary"
                                onClick={() => navigate(-1)}
                                style={{ padding: "8px 16px", fontSize: "var(--pro-small, 12px)" }}
                            >
                                ← Go back
                            </button>
                            {adena.address && (
                                <button
                                    className="k-btn-primary"
                                    onClick={() => navigate(`/profile/${adena.address}`)}
                                    style={{ padding: "8px 16px", fontSize: "var(--pro-small, 12px)" }}
                                >
                                    Go to profile
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

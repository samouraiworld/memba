/**
 * GitHub OAuth callback page.
 * Handles the redirect from GitHub OAuth with ?code=X.
 * Exchanges the code for a GitHub user via the backend, then prompts
 * the user to sign an on-chain ghverify transaction via Adena.
 */
import { useState, useEffect } from "react"
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom"
import { API_BASE_URL, GNO_RPC_URL } from "../lib/config"
import { doContractBroadcast } from "../lib/grc20"
import { GitHubIcon } from "../components/ui/GitHubIcon"
import type { LayoutContext } from "../types/layout"

/** GitHub user info returned from backend exchange. */
interface GitHubUserInfo {
    login: string
    avatar_url: string
    name: string
    token: string
}

/** ghverify realm path — the official on-chain GitHub verification realm. */
const GHVERIFY_REALM_PATH = "gno.land/r/demo/ghverify"

export function GithubCallback() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const { auth, adena } = useOutletContext<LayoutContext>()

    const [step, setStep] = useState<"exchanging" | "verify" | "signing" | "success" | "error">("exchanging")
    const [ghUser, setGhUser] = useState<GitHubUserInfo | null>(null)
    const [error, setError] = useState<string | null>(null)

    const code = searchParams.get("code")

    // Step 1: Exchange OAuth code for GitHub user info
    useEffect(() => {
        if (!code) {
            setError("No OAuth code received from GitHub")
            setStep("error")
            return
        }

        const exchange = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/github/oauth/exchange?code=${encodeURIComponent(code)}`)
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}))
                    throw new Error(data.error || `Exchange failed (${res.status})`)
                }
                const data: GitHubUserInfo = await res.json()
                if (!data.login) throw new Error("No GitHub login returned")
                setGhUser(data)
                setStep("verify")
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to exchange OAuth code")
                setStep("error")
            }
        }

        exchange()
    }, [code])

    // Step 2: User clicks "Verify on-chain" → sign MsgCall via Adena
    const handleVerify = async () => {
        if (!ghUser || !adena.address) return
        setStep("signing")
        setError(null)

        try {
            const msg = {
                type: "vm/MsgCall",
                value: {
                    caller: adena.address,
                    send: "",
                    pkg_path: GHVERIFY_REALM_PATH,
                    func: "RequestVerification",
                    args: [ghUser.login],
                },
            }
            await doContractBroadcast([msg], `Verify GitHub @${ghUser.login}`)
            setStep("success")
            // Navigate to profile after 3 seconds
            setTimeout(() => navigate(`/profile/${adena.address}`), 3000)
        } catch (err) {
            const raw = err instanceof Error ? err.message : "Verification failed"
            setError(raw)
            setStep("error")
        }
    }

    return (
        <div className="animate-fade-in" style={{
            maxWidth: 480, margin: "80px auto", padding: 32,
            fontFamily: "JetBrains Mono, monospace",
        }}>
            <div className="k-card" style={{ padding: 32, textAlign: "center" }}>
                <GitHubIcon size={48} color="#58a6ff" style={{ margin: "0 auto 16px" }} />

                {step === "exchanging" && (
                    <>
                        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f0f0f0", marginBottom: 8 }}>
                            Connecting to GitHub...
                        </h2>
                        <p style={{ fontSize: 12, color: "#888" }}>
                            Exchanging OAuth code for your GitHub identity.
                        </p>
                        <div style={{ margin: "20px auto", width: 24, height: 24, border: "2px solid #333", borderTop: "2px solid #00d4aa", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                    </>
                )}

                {step === "verify" && ghUser && (
                    <>
                        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f0f0f0", marginBottom: 8 }}>
                            Verify @{ghUser.login}
                        </h2>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", margin: "16px 0" }}>
                            {ghUser.avatar_url && (
                                <img src={ghUser.avatar_url} alt="GitHub avatar" style={{ width: 48, height: 48, borderRadius: "50%", border: "2px solid rgba(88,166,255,0.3)" }} />
                            )}
                            <div style={{ textAlign: "left" }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0" }}>{ghUser.name || ghUser.login}</div>
                                <div style={{ fontSize: 11, color: "#888" }}>@{ghUser.login}</div>
                            </div>
                        </div>
                        <p style={{ fontSize: 11, color: "#888", marginBottom: 20 }}>
                            Sign a transaction to verify this GitHub account is yours.
                            This calls the <code>ghverify</code> realm on Gno.land.
                        </p>
                        {!adena.address ? (
                            <p style={{ fontSize: 11, color: "#f44336" }}>
                                Connect your wallet first to verify.
                            </p>
                        ) : (
                            <button
                                className="k-btn-primary"
                                onClick={handleVerify}
                                style={{ padding: "10px 24px", fontSize: 13, fontWeight: 600 }}
                            >
                                ✅ Verify on-chain
                            </button>
                        )}
                    </>
                )}

                {step === "signing" && (
                    <>
                        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f0f0f0", marginBottom: 8 }}>
                            Signing transaction...
                        </h2>
                        <p style={{ fontSize: 12, color: "#888" }}>
                            Please confirm the transaction in your Adena wallet.
                        </p>
                        <div style={{ margin: "20px auto", width: 24, height: 24, border: "2px solid #333", borderTop: "2px solid #00d4aa", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                    </>
                )}

                {step === "success" && (
                    <>
                        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#4caf50", marginBottom: 8 }}>
                            ✓ GitHub Verified!
                        </h2>
                        <p style={{ fontSize: 12, color: "#888" }}>
                            @{ghUser?.login} is now linked to your wallet. Redirecting to your profile...
                        </p>
                    </>
                )}

                {step === "error" && (
                    <>
                        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f44336", marginBottom: 8 }}>
                            Verification Failed
                        </h2>
                        <p style={{ fontSize: 12, color: "#f44336", marginBottom: 16 }}>
                            {error}
                        </p>
                        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                            <button
                                className="k-btn-secondary"
                                onClick={() => navigate(-1)}
                                style={{ padding: "8px 16px", fontSize: 12 }}
                            >
                                ← Go back
                            </button>
                            {ghUser && adena.address && (
                                <button
                                    className="k-btn-primary"
                                    onClick={handleVerify}
                                    style={{ padding: "8px 16px", fontSize: 12 }}
                                >
                                    Retry verification
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

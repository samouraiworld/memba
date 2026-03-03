/**
 * GitHub OAuth callback page.
 * Handles the redirect from GitHub OAuth with ?code=X.
 * Exchanges the code for a GitHub user via the backend,
 * then saves the GitHub login to the user's backend profile.
 *
 * NOTE: The ghverify realm does not exist on test11, so we
 * save the GitHub handle via the Memba backend profile API
 * rather than an on-chain MsgCall.
 */
import { useState, useEffect } from "react"
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom"
import { API_BASE_URL } from "../lib/config"
import { updateBackendProfile } from "../lib/profile"
import { GitHubIcon } from "../components/ui/GitHubIcon"
import type { LayoutContext } from "../types/layout"

/** GitHub user info returned from backend exchange. */
interface GitHubUserInfo {
    login: string
    avatar_url: string
    name: string
    token: string
}

export function GithubCallback() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const { auth, adena } = useOutletContext<LayoutContext>()

    const [step, setStep] = useState<"exchanging" | "saving" | "success" | "deferred" | "error">("exchanging")
    const [ghUser, setGhUser] = useState<GitHubUserInfo | null>(null)
    const [error, setError] = useState<string | null>(null)

    const code = searchParams.get("code")
    const oauthState = searchParams.get("state")

    // Step 1: Exchange OAuth code for GitHub user info
    useEffect(() => {
        if (!code) {
            setError("No OAuth code received from GitHub")
            setStep("error")
            return
        }

        const exchange = async () => {
            try {
                const stateParam = oauthState ? `&state=${encodeURIComponent(oauthState)}` : ""
                const res = await fetch(`${API_BASE_URL}/github/oauth/exchange?code=${encodeURIComponent(code)}${stateParam}`)
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}))
                    throw new Error(data.error || `Exchange failed (${res.status})`)
                }
                const data: GitHubUserInfo = await res.json()
                if (!data.login) throw new Error("No GitHub login returned")
                setGhUser(data)

                // Step 2: Save GitHub login — or defer if wallet disconnected
                if (auth.isAuthenticated && auth.token) {
                    setStep("saving")
                    await updateBackendProfile(auth.token, { github: data.login })
                    setStep("success")
                    // Guard: wallet may have disconnected during OAuth redirect
                    if (adena.address) {
                        setTimeout(() => navigate(`/profile/${adena.address}`), 2500)
                    } else {
                        setTimeout(() => navigate("/"), 2500)
                    }
                } else {
                    // Wallet disconnected during OAuth redirect — store for later
                    localStorage.setItem("pendingGithubLink", JSON.stringify({
                        login: data.login, avatar: data.avatar_url, name: data.name, ts: Date.now()
                    }))
                    setStep("deferred")
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to link GitHub")
                setStep("error")
            }
        }

        exchange()
    }, [code, oauthState, auth.isAuthenticated, auth.token, adena.address, navigate])

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

                {step === "saving" && (
                    <>
                        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f0f0f0", marginBottom: 8 }}>
                            Linking @{ghUser?.login}...
                        </h2>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", margin: "16px 0" }}>
                            {ghUser?.avatar_url && (
                                <img src={ghUser.avatar_url} alt="GitHub avatar" referrerPolicy="no-referrer" style={{ width: 48, height: 48, borderRadius: "50%", border: "2px solid rgba(88,166,255,0.3)" }} />
                            )}
                            <div style={{ textAlign: "left" }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0" }}>{ghUser?.name || ghUser?.login}</div>
                                <div style={{ fontSize: 11, color: "#888" }}>@{ghUser?.login}</div>
                            </div>
                        </div>
                        <p style={{ fontSize: 11, color: "#888" }}>Saving to your Memba profile...</p>
                        <div style={{ margin: "20px auto", width: 24, height: 24, border: "2px solid #333", borderTop: "2px solid #00d4aa", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                    </>
                )}

                {step === "success" && (
                    <>
                        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#4caf50", marginBottom: 8 }}>
                            ✓ GitHub Linked!
                        </h2>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", margin: "16px 0" }}>
                            {ghUser?.avatar_url && (
                                <img src={ghUser.avatar_url} alt="GitHub avatar" referrerPolicy="no-referrer" style={{ width: 48, height: 48, borderRadius: "50%", border: "2px solid rgba(76,175,80,0.3)" }} />
                            )}
                            <div style={{ textAlign: "left" }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0" }}>{ghUser?.name || ghUser?.login}</div>
                                <div style={{ fontSize: 11, color: "#4caf50" }}>@{ghUser?.login} linked ✓</div>
                            </div>
                        </div>
                        <p style={{ fontSize: 12, color: "#888" }}>
                            Redirecting to your profile...
                        </p>
                    </>
                )}

                {step === "deferred" && (
                    <>
                        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#4caf50", marginBottom: 8 }}>
                            ✓ GitHub Verified!
                        </h2>
                        {ghUser?.avatar_url && (
                            <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", margin: "16px 0" }}>
                                <img src={ghUser.avatar_url} alt="GitHub avatar" referrerPolicy="no-referrer" style={{ width: 48, height: 48, borderRadius: "50%", border: "2px solid rgba(76,175,80,0.3)" }} />
                                <div style={{ textAlign: "left" }}>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0" }}>{ghUser.name || ghUser.login}</div>
                                    <div style={{ fontSize: 11, color: "#4caf50" }}>@{ghUser.login} verified ✓</div>
                                </div>
                            </div>
                        )}
                        <p style={{ fontSize: 12, color: "#f5a623", marginBottom: 16 }}>
                            Your wallet disconnected during the redirect. Reconnect your wallet and visit your profile — we’ll link your GitHub automatically.
                        </p>
                        <button
                            className="k-btn-primary"
                            onClick={() => navigate("/")}
                            style={{ padding: "8px 16px", fontSize: 12 }}
                        >
                            Go to Dashboard
                        </button>
                    </>
                )}

                {step === "error" && (
                    <>
                        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f44336", marginBottom: 8 }}>
                            Linking Failed
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
                            {adena.address && (
                                <button
                                    className="k-btn-primary"
                                    onClick={() => navigate(`/profile/${adena.address}`)}
                                    style={{ padding: "8px 16px", fontSize: 12 }}
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

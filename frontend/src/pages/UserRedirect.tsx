/**
 * Resolves a gno.land username to a wallet address and redirects
 * to /profile/:address. Handles the /u/:username route.
 */
import { useNetworkNav } from "../hooks/useNetworkNav"
import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { MagnifyingGlass } from "@phosphor-icons/react"
import { resolveUsernameToAddress } from "../lib/dao/shared"

export function UserRedirect() {
    const { username } = useParams<{ username: string }>()
    const navigate = useNetworkNav()
    // "missing": not a registered name; "unavailable": the registry could not be read.
    const [error, setError] = useState<"missing" | "unavailable" | null>(null)

    useEffect(() => {
        if (!username) {
            // Defer state update to avoid synchronous setState in effect
            const t = setTimeout(() => setError("missing"), 0)
            return () => clearTimeout(t)
        }

        let isMounted = true

        const resolve = async () => {
            const address = await resolveUsernameToAddress(username)
            if (!isMounted) return
            if (address) {
                navigate(`/profile/${address}`, { replace: true })
            } else {
                setError(address === null ? "unavailable" : "missing")
            }
        }

        resolve()

        return () => {
            isMounted = false
        }
    }, [username, navigate])

    if (error) {
        return (
            <div className="animate-fade-in" style={{
                maxWidth: 480, margin: "80px auto", padding: 32,
                fontFamily: "var(--font-ui, JetBrains Mono, monospace)", textAlign: "center",
            }}>
                <div className="k-card" style={{ padding: 32 }}>
                    <div style={{ fontSize: 40, marginBottom: 16, display: 'flex', justifyContent: 'center' }}><MagnifyingGlass size={40} /></div>
                    <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", marginBottom: 8 }}>
                        {error === "unavailable" ? "Couldn't look up this user" : "User not found"}
                    </h2>
                    <p style={{ fontSize: "var(--pro-small, 12px)", color: "var(--color-text-secondary)", marginBottom: 20 }}>
                        {error === "unavailable"
                            ? <>The gno.land user registry could not be reached to resolve @{username}. Try again in a moment.</>
                            : <>@{username} is not a registered gno.land username.</>}
                    </p>
                    <button
                        className="k-btn-secondary"
                        onClick={() => navigate("/")}
                        style={{ padding: "8px 16px", fontSize: "var(--pro-small, 12px)" }}
                    >
                        ← Go home
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="animate-fade-in" style={{
            maxWidth: 480, margin: "80px auto", padding: 32,
            fontFamily: "var(--font-ui, JetBrains Mono, monospace)", textAlign: "center",
        }}>
            <p style={{ fontSize: "var(--pro-small, 12px)", color: "var(--color-text-secondary)" }}>
                Resolving @{username}...
            </p>
            <div style={{ margin: "20px auto", width: 24, height: 24, border: "2px solid var(--color-text-dim)", borderTop: "2px solid var(--color-brand)", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
        </div>
    )
}

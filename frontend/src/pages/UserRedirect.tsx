/**
 * Resolves a gno.land username to a wallet address and redirects
 * to /profile/:address. Handles the /u/:username route.
 */
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { GNO_RPC_URL, getUserRegistryPath } from "../lib/config"

/**
 * Resolve a gno.land username to a wallet address
 * via the users/v1 realm ABCI render query.
 *
 * The render path `gno.land/r/gnoland/users/v1:username` returns
 * a markdown page containing `# User - \`username\`` and the address.
 */
async function resolveUsernameToAddress(username: string): Promise<string | null> {
    try {
        const registryPath = getUserRegistryPath()
        const b64Data = btoa(`${registryPath}:${username}`)
        const res = await fetch(GNO_RPC_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "resolve-user",
                method: "abci_query",
                params: { path: "vm/qrender", data: b64Data },
            }),
        })
        const json = await res.json()
        const value = json?.result?.response?.ResponseBase?.Data
        if (!value) return null
        const binaryStr = atob(value)
        const bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0))
        const data = new TextDecoder().decode(bytes)
        // The render contains the address in a markdown link like [g1abc...xyz](/r/.../g1abc...xyz)
        // or just the raw address string. Try multiple patterns:
        const addrMatch = data.match(/(g1[a-z0-9]{38})/i)
        return addrMatch ? addrMatch[1] : null
    } catch {
        return null
    }
}

export function UserRedirect() {
    const { username } = useParams<{ username: string }>()
    const navigate = useNavigate()
    const [error, setError] = useState(false)

    useEffect(() => {
        if (!username) {
            // Defer state update to avoid synchronous setState in effect
            const t = setTimeout(() => setError(true), 0)
            return () => clearTimeout(t)
        }

        let isMounted = true

        const resolve = async () => {
            const address = await resolveUsernameToAddress(username)
            if (!isMounted) return
            if (address) {
                navigate(`/profile/${address}`, { replace: true })
            } else {
                setError(true)
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
                fontFamily: "JetBrains Mono, monospace", textAlign: "center",
            }}>
                <div className="k-card" style={{ padding: 32 }}>
                    <div style={{ fontSize: 40, marginBottom: 16 }}>🔍</div>
                    <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f0f0f0", marginBottom: 8 }}>
                        User not found
                    </h2>
                    <p style={{ fontSize: 12, color: "#888", marginBottom: 20 }}>
                        @{username} is not a registered gno.land username.
                    </p>
                    <button
                        className="k-btn-secondary"
                        onClick={() => navigate("/")}
                        style={{ padding: "8px 16px", fontSize: 12 }}
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
            fontFamily: "JetBrains Mono, monospace", textAlign: "center",
        }}>
            <p style={{ fontSize: 12, color: "#888" }}>
                Resolving @{username}...
            </p>
            <div style={{ margin: "20px auto", width: 24, height: 24, border: "2px solid #333", borderTop: "2px solid #00d4aa", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
        </div>
    )
}

/**
 * RegisterUsernameForm — on-chain username registration via gno.land users/v1.
 *
 * Self-contained component with own state + Adena broadcast.
 * Extracted in v1.5.0 from ProfilePage.tsx.
 */
import { useState } from "react"
import { doContractBroadcast } from "../../lib/grc20"
import { getUserRegistryPath } from "../../lib/config"

export function RegisterUsernameForm({ address, onRegistered }: { address: string; onRegistered: () => void }) {
    const [regInput, setRegInput] = useState("")
    const [regLoading, setRegLoading] = useState(false)
    const [regError, setRegError] = useState<string | null>(null)
    const [regSuccess, setRegSuccess] = useState(false)
    const isValid = /^[a-z][a-z0-9_]{5,16}$/.test(regInput)

    const handleRegister = async () => {
        if (!isValid) return
        setRegLoading(true)
        setRegError(null)
        try {
            const msg = {
                type: "vm/MsgCall",
                value: {
                    caller: address,
                    send: "200000ugnot",
                    pkg_path: getUserRegistryPath(),
                    func: "Register",
                    args: [regInput],
                },
            }
            await doContractBroadcast([msg], `Register @${regInput}`)
            setRegSuccess(true)
            setTimeout(onRegistered, 2000)
        } catch (err) {
            const raw = err instanceof Error ? err.message : "Registration failed"
            if (raw.toLowerCase().includes("already")) {
                setRegError("Username already taken. Try a different one.")
            } else if (raw.toLowerCase().includes("insufficient") || raw.toLowerCase().includes("coins") || raw.toLowerCase().includes("std.coins")) {
                setRegError("Insufficient GNOT to register. Get test tokens from the faucet first.")
            } else {
                setRegError(raw)
            }
        } finally {
            setRegLoading(false)
        }
    }

    return (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {regSuccess ? (
                <span style={{ fontSize: 11, color: "var(--color-success)", fontFamily: "JetBrains Mono, monospace" }}>
                    ✓ Username @{regInput} registered!
                </span>
            ) : (
                <>
                    <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                        <span style={{
                            fontSize: 12, fontFamily: "JetBrains Mono, monospace",
                            color: "var(--color-primary)", padding: "5px 0 5px 10px",
                            background: "rgba(0,212,170,0.06)", border: "1px solid rgba(0,212,170,0.2)",
                            borderRight: "none", borderRadius: "6px 0 0 6px",
                        }}>@</span>
                        <input
                            type="text"
                            value={regInput}
                            onChange={(e) => { setRegInput(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "")); setRegError(null) }}
                            placeholder="myname123"
                            maxLength={20}
                            style={{
                                width: 130, padding: "5px 8px", fontSize: 12,
                                fontFamily: "JetBrains Mono, monospace",
                                background: "rgba(0,212,170,0.06)", border: "1px solid rgba(0,212,170,0.2)",
                                borderLeft: "none", borderRadius: "0 6px 6px 0",
                                color: "var(--color-text)", outline: "none",
                            }}
                            onKeyDown={(e) => e.key === "Enter" && isValid && handleRegister()}
                            disabled={regLoading}
                        />
                    </div>
                    <button
                        onClick={handleRegister}
                        disabled={!isValid || regLoading}
                        style={{
                            padding: "5px 12px", borderRadius: 6, fontSize: 11,
                            fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                            background: isValid ? "rgba(0,212,170,0.1)" : "transparent",
                            border: `1px solid ${isValid ? "rgba(0,212,170,0.3)" : "#222"}`,
                            color: isValid ? "#00d4aa" : "#555", cursor: isValid ? "pointer" : "default",
                            transition: "all 0.15s", opacity: regLoading ? 0.5 : 1,
                        }}
                    >
                        {regLoading ? "Registering..." : "Register"}
                    </button>
                    {regError && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <span style={{ fontSize: 10, color: "var(--color-danger)", fontFamily: "JetBrains Mono, monospace" }}>
                                ✕ {regError}
                            </span>
                            {regError.includes("faucet") && (
                                <a
                                    href="https://faucet.gno.land/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ fontSize: 10, color: "var(--color-primary)", fontFamily: "JetBrains Mono, monospace", textDecoration: "none" }}
                                >
                                    → Get test tokens at faucet.gno.land
                                </a>
                            )}
                        </div>
                    )}
                    {regInput && !isValid && (
                        <span style={{ fontSize: 10, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace" }}>
                            6-17 chars: letters, digits, underscores (e.g. zooma_dev)
                        </span>
                    )}
                    {!regInput && !regError && (
                        <a
                            href="https://faucet.gno.land/"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "JetBrains Mono, monospace", textDecoration: "none", transition: "color 0.15s" }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = "#00d4aa")}
                            onMouseLeave={(e) => (e.currentTarget.style.color = "#555")}
                        >
                            Need test tokens? → faucet.gno.land
                        </a>
                    )}
                </>
            )}
        </div>
    )
}

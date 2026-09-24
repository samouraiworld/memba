/**
 * RegisterUsernameForm — on-chain @username registration through the active
 * network's public registrar (`r/sys/namereg/v0` on gno.land mainnet; see
 * lib/usernameRegistration for its rules). Renders nothing on a network with
 * no verified registrar.
 *
 * Self-contained component with own state + Adena broadcast.
 * Extracted in v1.5.0 from ProfilePage.tsx.
 */
import { useState } from "react"
import { doContractBroadcast } from "../../lib/grc20"
import { getUsernameRegistrarPath } from "../../lib/config"
import { forgetRegisteredUsername } from "../../lib/dao/shared"
import {
    buildRegisterUsernameMsg,
    fetchRegisterPrice,
    nymNameProblem,
    registrationErrorMessage,
} from "../../lib/usernameRegistration"

export function RegisterUsernameForm({ address, onRegistered }: { address: string; onRegistered: () => void }) {
    const [regInput, setRegInput] = useState("")
    const [regLoading, setRegLoading] = useState(false)
    const [regError, setRegError] = useState<string | null>(null)
    const [regSuccess, setRegSuccess] = useState(false)
    const registrar = getUsernameRegistrarPath()
    const problem = nymNameProblem(regInput)
    const isValid = problem === null

    if (!registrar) return null

    const handleRegister = async () => {
        if (!isValid) return
        setRegLoading(true)
        setRegError(null)
        try {
            // The registrar requires the EXACT current price — read it, never assume it.
            const price = await fetchRegisterPrice(registrar)
            if (price === null) {
                setRegError("Couldn't read the registration price. Try again in a moment.")
                return
            }
            await doContractBroadcast([buildRegisterUsernameMsg(address, registrar, regInput, price)], `Register @${regInput}`)
            setRegSuccess(true)
            // The profile would otherwise keep serving the cached "no username".
            forgetRegisteredUsername(address)
            setTimeout(onRegistered, 2000)
        } catch (err) {
            setRegError(registrationErrorMessage(err instanceof Error ? err.message : "Registration failed"))
        } finally {
            setRegLoading(false)
        }
    }

    return (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {regSuccess ? (
                <span style={{ fontSize: "var(--pro-caption, 11px)", color: "var(--color-success)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)" }}>
                    ✓ Username @{regInput} registered!
                </span>
            ) : (
                <>
                    <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                        <span style={{
                            fontSize: "var(--pro-small, 12px)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
                            color: "var(--color-primary)", padding: "5px 0 5px 10px",
                            background: "rgba(0,212,170,0.06)", border: "1px solid rgba(0,212,170,0.2)",
                            borderRight: "none", borderRadius: "6px 0 0 6px",
                        }}>@</span>
                        <input
                            type="text"
                            value={regInput}
                            onChange={(e) => { setRegInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")); setRegError(null) }}
                            placeholder="nym-builder042"
                            aria-label="Username to register"
                            maxLength={20}
                            style={{
                                width: 160, padding: "5px 8px", fontSize: "var(--pro-small, 12px)",
                                fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
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
                            padding: "5px 12px", borderRadius: 6, fontSize: "var(--pro-caption, 11px)",
                            fontFamily: "var(--font-ui, JetBrains Mono, monospace)", fontWeight: 600,
                            background: isValid ? "rgba(0,212,170,0.1)" : "transparent",
                            border: `1px solid ${isValid ? "rgba(0,212,170,0.3)" : "var(--color-surface-raised)"}`,
                            color: isValid ? "var(--color-brand)" : "var(--color-text-muted)", cursor: isValid ? "pointer" : "default",
                            transition: "all 0.15s", opacity: regLoading ? 0.5 : 1,
                        }}
                    >
                        {regLoading ? "Registering..." : "Register"}
                    </button>
                    {regError && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <span style={{ fontSize: "var(--pro-caption, 10px)", color: "var(--color-danger)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)" }}>
                                ✕ {regError}
                            </span>
                        </div>
                    )}
                    {regInput && !isValid && (
                        <span style={{ fontSize: "var(--pro-caption, 10px)", color: "var(--color-text-secondary)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)" }}>
                            {problem}
                        </span>
                    )}
                </>
            )}
        </div>
    )
}

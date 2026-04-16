import { useState, useCallback } from "react"
import { useOutletContext } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { api } from "../lib/api"
import { ErrorToast } from "../components/ui/ErrorToast"
import { DeploymentPipeline, type DeployStep, type DeploymentResult } from "../components/ui/DeploymentPipeline"
import { GNO_CHAIN_ID, GNO_RPC_URL, GNO_BECH32_PREFIX } from "../lib/config"
import type { LayoutContext } from "../types/layout"
import "./createmultisig.css"

interface MemberEntry {
    address: string
    pubkeyValue: string    // base64 secp256k1 pubkey
    manualPubkey: boolean  // if true, user pasted it manually
    fetchError: string     // error from on-chain fetch
    fetching: boolean
    showManualInput: boolean // show manual pubkey paste input
}

export function CreateMultisig() {
    const navigate = useNetworkNav()
    const { auth } = useOutletContext<LayoutContext>()
    const [name, setName] = useState("")
    const [threshold, setThreshold] = useState(2)
    const [members, setMembers] = useState<MemberEntry[]>([
        emptyMember(), emptyMember(), emptyMember(),
    ])
    const [loading, setLoading] = useState(false)
    const [deployStep, setDeployStep] = useState<DeployStep>("idle")
    const [deployResult, setDeployResult] = useState<DeploymentResult | undefined>()
    const [error, setError] = useState<string | null>(null)

    const addMember = () => setMembers([...members, emptyMember()])
    const removeMember = (i: number) => {
        if (members.length <= 2) return
        const next = members.filter((_, idx) => idx !== i)
        setMembers(next)
        if (threshold > next.length) setThreshold(next.length)
    }
    const updateAddress = (i: number, val: string) => {
        const copy = [...members]
        copy[i] = { ...copy[i], address: val, pubkeyValue: "", fetchError: "", manualPubkey: false, showManualInput: false }
        setMembers(copy)
    }
    const updatePubkey = (i: number, val: string) => {
        const copy = [...members]
        copy[i] = { ...copy[i], pubkeyValue: val.trim(), manualPubkey: true, fetchError: "" }
        setMembers(copy)
    }

    // Fetch pubkey from chain for a single member
    const fetchPubkey = useCallback(async (i: number, currentMembers: MemberEntry[]) => {
        const m = currentMembers[i]
        if (!m.address.trim()) return

        const addr = m.address.trim()
        if (!/^g(no)?1[a-z0-9]{38,}$/.test(addr)) {
            setMembers(prev => { const c = [...prev]; c[i] = { ...c[i], fetchError: "Invalid address format" }; return c })
            return
        }

        setMembers(prev => { const c = [...prev]; c[i] = { ...c[i], fetching: true, fetchError: "" }; return c })

        try {
            const url = `${GNO_RPC_URL}/abci_query?path=%22auth/accounts/${addr}%22`
            const res = await fetch(url)
            const json = await res.json()

            const rawValue = json?.result?.response?.ResponseBase?.Value
            if (!rawValue) {
                setMembers(prev => { const c = [...prev]; c[i] = { ...c[i], fetching: false, fetchError: "Account not found on chain" }; return c })
                return
            }

            const decoded = atob(rawValue)
            const data = JSON.parse(decoded)
            const account = data?.value || data
            const pubkey = account?.pub_key || account?.PubKey || account?.public_key

            if (!pubkey || !pubkey.value) {
                setMembers(prev => { const c = [...prev]; c[i] = { ...c[i], fetching: false, fetchError: "No public key found — this account hasn't made any transaction yet. Ask the member to send any TX (e.g., use the faucet) to activate their key, or paste their pubkey below.", showManualInput: true }; return c })
                return
            }

            setMembers(prev => { const c = [...prev]; c[i] = { ...c[i], pubkeyValue: pubkey.value, fetching: false, fetchError: "", manualPubkey: false }; return c })
        } catch {
            setMembers(prev => { const c = [...prev]; c[i] = { ...c[i], fetching: false, fetchError: "Failed to fetch from chain" }; return c })
        }
    }, [])

    const handleCreate = async () => {
        if (!auth.isAuthenticated || !auth.token) {
            setError("Connect your wallet first")
            return
        }
        if (!name.trim()) {
            setError("Enter a wallet name")
            return
        }

        // Validate all members have pubkeys
        const missing = members.filter(m => !m.pubkeyValue)
        if (missing.length > 0) {
            setError(`${missing.length} member(s) missing pubkey — fetch from chain or paste manually`)
            return
        }

        // Check for duplicate addresses
        const addrs = members.map(m => m.address.trim())
        if (new Set(addrs).size !== addrs.length) {
            setError("Duplicate member addresses found")
            return
        }

        setLoading(true)
        setDeployStep("preparing")
        setError(null)

        try {
            // Build Amino multisig pubkey JSON
            const pubkeys = members.map(m => ({
                type: "tendermint/PubKeySecp256k1",
                value: m.pubkeyValue,
            }))

            const multisigPubkeyJson = JSON.stringify({
                type: "tendermint/PubKeyMultisigThreshold",
                value: {
                    threshold: String(threshold),
                    pubkeys,
                },
            })

            setDeployStep("signing")

            const res = await api.createOrJoinMultisig({
                authToken: auth.token,
                chainId: GNO_CHAIN_ID,
                multisigPubkeyJson,
                name: name.trim(),
                bech32Prefix: GNO_BECH32_PREFIX,
            })

            setDeployStep("broadcasting")

            setDeployResult({
                entityPath: `/multisig/${res.multisigAddress}`,
                entityLabel: "Multisig",
                entityName: name.trim(),
            })
            setDeployStep("complete")
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create multisig")
            setDeployStep("error")
        } finally {
            setLoading(false)
        }
    }

    const allHavePubkeys = members.every(m => !!m.pubkeyValue)
    const canSubmit = auth.isAuthenticated && name.trim() && allHavePubkeys && !loading

    return (
        <div className="animate-fade-in cms-page">
            <div>
                <button onClick={() => navigate("/")} className="cms-back-btn">
                    ← Back to Dashboard
                </button>
                <h2 className="cms-title">Create Multisig</h2>
                <p className="cms-subtitle">
                    Set up a new multisig wallet with your team
                </p>
            </div>

            {!auth.isAuthenticated && (
                <div className="k-dashed cms-connect-prompt">
                    <p>
                        Connect your wallet to create a multisig
                    </p>
                </div>
            )}

            {/* Name */}
            <div className="k-card">
                <label className="k-label cms-label">Wallet Name</label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. our-super-cool-dao"
                    maxLength={256}
                    className="cms-input"
                />
            </div>

            {/* Members */}
            <div className="k-card">
                <div className="cms-members-header">
                    <label className="k-label">Members ({members.length})</label>
                    <button onClick={addMember} className="cms-add-member-btn">
                        + Add Member
                    </button>
                </div>
                <div className="cms-members-list">
                    {members.map((m, i) => (
                        <div key={i} className="cms-member-row">
                            <div className="cms-member-inputs">
                                <input
                                    type="text"
                                    value={m.address}
                                    onChange={(e) => updateAddress(i, e.target.value)}
                                    placeholder={`g1member${i + 1}...`}
                                    className="cms-input--sm"
                                    style={{ flex: 1 }}
                                />
                                <button
                                    onClick={() => fetchPubkey(i, members)}
                                    disabled={m.fetching || !m.address.trim()}
                                    className={`cms-fetch-btn${m.pubkeyValue && !m.manualPubkey ? " cms-fetch-btn--ok" : ""}`}
                                    style={{ opacity: m.fetching ? 0.5 : 1 }}
                                >
                                    {m.fetching ? "..." : m.pubkeyValue && !m.manualPubkey ? "✓ Key" : "Fetch Key"}
                                </button>
                                {members.length > 2 && (
                                    <button onClick={() => removeMember(i)} className="cms-remove-btn">
                                        ×
                                    </button>
                                )}
                            </div>
                            {/* Error or manual paste */}
                            {m.fetchError && (
                                <div className="cms-member-error">
                                    ⚠ {m.fetchError}
                                    {m.showManualInput && (
                                        <input
                                            type="text"
                                            value={m.manualPubkey ? m.pubkeyValue : ""}
                                            onChange={(e) => updatePubkey(i, e.target.value)}
                                            placeholder="Paste base64 secp256k1 pubkey..."
                                            className="cms-input cms-input--xs"
                                            style={{ display: "block" }}
                                        />
                                    )}
                                </div>
                            )}
                            {/* Show pubkey if fetched or pasted */}
                            {m.pubkeyValue && !m.fetchError && (
                                <span className="cms-member-pubkey">
                                    🔑 {m.pubkeyValue.slice(0, 16)}…{m.manualPubkey ? " (manual)" : ""}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Threshold */}
            <div className="k-card">
                <label className="k-label cms-label">
                    Threshold — {threshold} of {members.length}
                </label>
                <input
                    type="range"
                    min={1}
                    max={members.length}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    className="cms-threshold-slider"
                />
                <p className="cms-threshold-hint">
                    {threshold} signature{threshold > 1 ? "s" : ""} required to execute a transaction
                </p>
            </div>

            {/* Submit */}
            <div className="cms-submit-row">
                <button
                    className="k-btn-primary"
                    onClick={handleCreate}
                    disabled={!canSubmit}
                    style={{ opacity: canSubmit ? 1 : 0.5 }}
                >
                    {loading ? "Creating..." : "Create Multisig"}
                </button>
                <button className="k-btn-secondary" onClick={() => navigate("/")}>
                    Cancel
                </button>
            </div>

            {/* P1: Validation hint — explain why submit is disabled */}
            {!canSubmit && name.trim() && auth.isAuthenticated && !allHavePubkeys && !loading && (
                <div className="cms-validation-hint">
                    ⚠ Each member needs a <strong>public key</strong> to build the multisig.
                    Click &quot;Fetch Key&quot; next to each member address to retrieve their key from the chain.
                    If a member hasn&apos;t made any on-chain transaction yet, paste their base64 secp256k1 public key manually.
                </div>
            )}

            {/* Deployment Pipeline */}
            <DeploymentPipeline
                active={deployStep !== "idle"}
                currentStep={deployStep}
                result={deployResult}
                error={error ?? undefined}
                onNavigate={() => deployResult?.entityPath && navigate(deployResult.entityPath)}
                onRetry={() => { setDeployStep("idle"); setError(null) }}
                onClose={() => { setDeployStep("idle"); setError(null) }}
            />

            <ErrorToast message={deployStep === "idle" ? error : null} onDismiss={() => setError(null)} />
        </div>
    )
}

function emptyMember(): MemberEntry {
    return { address: "", pubkeyValue: "", manualPubkey: false, fetchError: "", fetching: false, showManualInput: false }
}

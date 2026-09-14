import { useState, useCallback } from "react"
import { useOutletContext } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { api } from "../lib/api"
import { ErrorToast } from "../components/ui/ErrorToast"
import { GNO_CHAIN_ID, GNO_RPC_URL, GNO_BECH32_PREFIX, ENABLE_NATIVE_GNO_MULTISIG } from "../lib/config"
import { createNativeMultisig, memberAddress, nativeAddress } from "../lib/nativeMultisig"
import type { LayoutContext } from "../types/layout"
import "./createmultisig.css"

interface MemberEntry {
    id: string
    revision: number
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
    const [registeredAddress, setRegisteredAddress] = useState("")
    const [error, setError] = useState<string | null>(null)

    const addMember = () => { if (members.length < 7) setMembers([...members, emptyMember()]) }
    const removeMember = (i: number) => {
        if (members.length <= 2) return
        const next = members.filter((_, idx) => idx !== i)
        setMembers(next)
        if (threshold > next.length) setThreshold(next.length)
    }
    const updateAddress = (i: number, val: string) => {
        const copy = [...members]
        copy[i] = { ...copy[i], revision: copy[i].revision + 1, fetching: false, address: val, pubkeyValue: "", fetchError: "", manualPubkey: false, showManualInput: false }
        setMembers(copy)
    }
    const updatePubkey = (i: number, val: string) => {
        const copy = [...members]
        copy[i] = { ...copy[i], revision: copy[i].revision + 1, fetching: false, pubkeyValue: val.trim(), manualPubkey: true, fetchError: "" }
        setMembers(copy)
    }

    // Fetch pubkey from chain for a single member
    const fetchPubkey = useCallback(async (i: number, currentMembers: MemberEntry[]) => {
        const m = currentMembers[i]
        if (!m.address.trim()) return
        const update = (patch: Partial<MemberEntry>) => setMembers(prev => prev.map(row => row.id === m.id && row.revision === m.revision ? { ...row, ...patch } : row))

        const addr = m.address.trim()
        if (!/^g(no)?1[a-z0-9]{38,}$/.test(addr)) {
            update({ fetchError: "Invalid address format" })
            return
        }

        update({ fetching: true, fetchError: "" })

        try {
            const url = `${GNO_RPC_URL}/abci_query?path=%22auth/accounts/${addr}%22`
            const res = await fetch(url)
            const json = await res.json()

            const rawValue = json?.result?.response?.ResponseBase?.Data || json?.result?.response?.ResponseBase?.Value || json?.result?.response?.Value
            if (!res.ok || json?.error || json?.result?.response?.ResponseBase?.Error) throw new Error("Account query failed")
            if (!rawValue) {
                update({ fetching: false, fetchError: "Account not found on chain — paste the member's public key; no activation transaction is needed.", showManualInput: true })
                return
            }

            const decoded = atob(rawValue)
            const data = JSON.parse(decoded)
            const account = data?.BaseAccount || data?.value?.BaseAccount || data?.value || data
            const pubkey = account?.pub_key || account?.PubKey || account?.public_key

            if (!pubkey || !pubkey.value) {
                update({ fetching: false, fetchError: "No public key published. Ask the member for their public key and verify possession offline. Do not send an activation transaction.", showManualInput: true })
                return
            }

            if (memberAddress(pubkey.value) !== addr) throw new Error("Public key mismatch")
            update({ pubkeyValue: pubkey.value, fetching: false, fetchError: "", manualPubkey: false })
        } catch {
            update({ fetching: false, fetchError: "Failed to fetch a matching public key from chain" })
        }
    }, [])

    const handleCreate = async () => {
        if (!ENABLE_NATIVE_GNO_MULTISIG || loading) return
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
        setError(null)

        try {
            const identity = createNativeMultisig(members, threshold)
            const expectedAddress = nativeAddress(identity)
            const multisigPubkeyJson = JSON.stringify(identity)

            const res = await api.createOrJoinMultisig({
                authToken: auth.token,
                chainId: GNO_CHAIN_ID,
                multisigPubkeyJson,
                name: name.trim(),
                bech32Prefix: GNO_BECH32_PREFIX,
                expectedMultisigAddress: expectedAddress,
                nativeCreate: true,
            })
            if (res.multisigAddress !== expectedAddress) throw new Error("Server returned a different wallet identity; stop and review")
            setRegisteredAddress(expectedAddress)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create multisig")
        } finally {
            setLoading(false)
        }
    }

    const allHavePubkeys = members.every(m => !!m.pubkeyValue)
    let preview = ""
    let previewError = ""
    if (allHavePubkeys) {
        try { preview = nativeAddress(createNativeMultisig(members, threshold)) }
        catch (e) { previewError = e instanceof Error ? e.message : "Invalid member configuration" }
    }
    const canSubmit = ENABLE_NATIVE_GNO_MULTISIG && auth.isAuthenticated && name.trim() && !!preview && !loading

    return (
        <div className="animate-fade-in cms-page">
            <div>
                <button onClick={() => navigate("/")} className="cms-back-btn">
                    ← Back to Dashboard
                </button>
                <h2 className="cms-title">Create Multisig</h2>
                <p className="cms-subtitle">
                    Register a native-Gno wallet configuration. This does not sign, fund, or deploy anything on-chain.
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
                    disabled={loading}
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
                    <button onClick={addMember} disabled={loading || members.length >= 7} className="cms-add-member-btn">
                        + Add Member
                    </button>
                </div>
                <div className="cms-members-list">
                    {members.map((m, i) => (
                        <div key={m.id} className="cms-member-row">
                            <div className="cms-member-inputs">
                                <input
                                    type="text"
                                    value={m.address}
                                    disabled={loading}
                                    onChange={(e) => updateAddress(i, e.target.value)}
                                    placeholder={`g1member${i + 1}...`}
                                    className="cms-input--sm"
                                    style={{ flex: 1 }}
                                />
                                <button
                                    onClick={() => fetchPubkey(i, members)}
                                    disabled={loading || m.fetching || !m.address.trim()}
                                    className={`cms-fetch-btn${m.pubkeyValue && !m.manualPubkey ? " cms-fetch-btn--ok" : ""}`}
                                    style={{ opacity: m.fetching ? 0.5 : 1 }}
                                >
                                    {m.fetching ? "..." : m.pubkeyValue && !m.manualPubkey ? "✓ Key" : "Fetch Key"}
                                </button>
                                <button disabled={loading} className="k-btn-secondary" onClick={() => setMembers(prev => prev.map(row => row.id === m.id ? { ...row, showManualInput: true, revision: row.revision + 1, fetching: false } : row))}>Paste public key</button>
                                {members.length > 2 && (
                                    <button disabled={loading} onClick={() => removeMember(i)} className="cms-remove-btn">
                                        ×
                                    </button>
                                )}
                            </div>
                            {/* Error or manual paste */}
                            {m.fetchError && (
                                <div className="cms-member-error">
                                    ⚠ {m.fetchError}
                                </div>
                            )}
                            {m.showManualInput && <label>
                                Member {i + 1} public key
                                <input type="text" value={m.pubkeyValue} disabled={loading} onChange={e => updatePubkey(i, e.target.value)} placeholder="Paste base64 secp256k1 pubkey..." className="cms-input cms-input--xs" />
                            </label>}
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
                    disabled={loading}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    className="cms-threshold-slider"
                />
                <p className="cms-threshold-hint">
                    {threshold} signature{threshold > 1 ? "s" : ""} required to execute a transaction
                </p>
            </div>

            {/* Submit */}
            {!ENABLE_NATIVE_GNO_MULTISIG && <p role="status">Native multisig registration is on hold pending release approval.</p>}
            {preview && <p>Native address (gnokey default member ordering): <code>{preview}</code>. Review all member keys before registering.</p>}
            {previewError && <p role="alert">{previewError}</p>}
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

            {registeredAddress && <p role="status">Configuration registered; nothing was broadcast. <button onClick={() => navigate(`/multisig/${registeredAddress}`)}>Open wallet</button></p>}
            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

function emptyMember(): MemberEntry {
    return { id: crypto.randomUUID(), revision: 0, address: "", pubkeyValue: "", manualPubkey: false, fetchError: "", fetching: false, showManualInput: false }
}

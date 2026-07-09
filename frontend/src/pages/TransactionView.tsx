import { useEffect, useState, useCallback } from "react"
import { useParams, useOutletContext } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { MagnifyingGlass } from "@phosphor-icons/react"
import { api } from "../lib/api"
import { parseMsgs, parseFee } from "../lib/parseMsgs"
import { StatusBadge } from "../components/ui/StatusBadge"
import { getTxStatus } from "../components/ui/txStatus"
import { SkeletonCard, SkeletonRow } from "../components/ui/LoadingSkeleton"
import { ErrorToast } from "../components/ui/ErrorToast"
import { ProgressBar } from "../components/multisig/ProgressBar"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import type { Transaction } from "../gen/memba/v1/memba_pb"
import { GNO_RPC_URL, GNO_BECH32_HRP, GNO_CHAIN_ID } from "../lib/config"
import { assertWalletBroadcastSafe } from "../lib/grc20"
import { pubkeyToAddress } from "../lib/dao/realmAddress"
import { completeQuest } from "../lib/quests"
import type { LayoutContext } from "../types/layout"
import "./txview.css"

/** Build deterministic Amino sign doc from transaction data. */
function buildSignDoc(tx: Transaction): Record<string, unknown> {
    return {
        account_number: String(tx.accountNumber),
        chain_id: tx.chainId,
        fee: JSON.parse(tx.feeJson),
        memo: tx.memo || "",
        msgs: JSON.parse(tx.msgsJson),
        sequence: String(tx.sequence),
    }
}

export function TransactionView() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNetworkNav()
    const { adena, auth } = useOutletContext<LayoutContext>()
    const token = auth.token

    const [tx, setTx] = useState<Transaction | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [actionLoading, setActionLoading] = useState(false)
    const [manualSig, setManualSig] = useState("")
    const [showManualSig, setShowManualSig] = useState(false)
    const [linkCopied, setLinkCopied] = useState(false)
    // W2.4 (multisig confirmation rigor): sign/broadcast are two-step — the
    // button opens a review card (full recipients, fee, network match,
    // irreversibility warning); only its Confirm runs the action.
    const [pendingAction, setPendingAction] = useState<"sign" | "broadcast" | null>(null)

    const fetchTx = useCallback(async () => {
        if (!token || !id) return
        setLoading(true)
        setError(null)
        try {
            const res = await api.getTransaction({
                authToken: token,
                transactionId: Number(id),
            })
            if (res.transaction) {
                setTx(res.transaction)
            } else {
                setError("Transaction not found")
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load transaction")
        } finally {
            setLoading(false)
        }
    }, [token, id])

    useEffect(() => { fetchTx() }, [fetchTx])

    const handleSign = async () => {
        if (!token || !tx || actionLoading) return
        setActionLoading(true)
        setError(null)
        try {
            const signDoc = JSON.stringify(buildSignDoc(tx))
            const signDocBytes = new TextEncoder().encode(signDoc)

            const signature = await adena.signArbitrary(signDoc)
            if (!signature) {
                setError("Signature rejected")
                setActionLoading(false)
                return
            }

            await api.signTransaction({
                authToken: token,
                transactionId: tx.id,
                signature,
                bodyBytes: signDocBytes,
            })

            await fetchTx()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to sign")
        } finally {
            setActionLoading(false)
        }
    }

    const handleBroadcast = async () => {
        if (!token || !tx || actionLoading) return
        setActionLoading(true)
        setError(null)
        try {
            // Try Adena's BroadcastMultisigTransaction first (handles Amino encoding)
            let hash = await tryAdenaBroadcast(tx)

            // Fallback: broadcast via RPC POST (Amino JSON)
            if (!hash) {
                const broadcastTx = await buildBroadcastTx(tx)
                const res = await fetch(`${GNO_RPC_URL}/broadcast_tx_commit`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        jsonrpc: "2.0",
                        method: "broadcast_tx_commit",
                        params: { tx: `0x${broadcastTx}` },
                        id: 1,
                    }),
                })
                const json = await res.json()

                hash = json?.result?.hash
                if (!hash) {
                    const errMsg = json?.result?.deliver_tx?.log || json?.error?.message || "Broadcast failed — try using gnokey CLI: gnokey broadcast <tx-file> --remote <rpc-url> (see docs.gno.land for details)"
                    setError(errMsg)
                    return
                }
            }

            await api.completeTransaction({
                authToken: token,
                transactionId: tx.id,
                finalHash: hash,
            })

            await fetchTx()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Broadcast failed")
        } finally {
            setActionLoading(false)
        }
    }

    const formatDate = (dateStr: string) => {
        try {
            return new Date(dateStr).toLocaleDateString("en-US", {
                year: "numeric", month: "short", day: "numeric",
                hour: "2-digit", minute: "2-digit",
            })
        } catch { return dateStr }
    }

    // ── Loading state ─────────────────────────────────────────
    if (loading) {
        return (
            <div className="animate-fade-in k-txview">
                <button className="k-txview__back" onClick={() => navigate(-1)}>← Back</button>
                <SkeletonCard />
                <SkeletonCard />
                <div className="k-card k-txview__table-card">
                    <SkeletonRow />
                    <SkeletonRow />
                    <SkeletonRow />
                </div>
            </div>
        )
    }

    // ── Error state ───────────────────────────────────────────
    if (!tx) {
        return (
            <div className="animate-fade-in k-txview">
                <button className="k-txview__back" onClick={() => navigate(-1)}>← Back</button>
                <div className="k-dashed k-txview__not-found">
                    <span className="k-txview__not-found-icon"><MagnifyingGlass size={32} /></span>
                    <h3 className="k-txview__not-found-title">Transaction not found</h3>
                    <p className="k-txview__not-found-desc">
                        {auth.isAuthenticated ? `TX #${id} not found or you're not a member of its multisig.` : "Connect your wallet to view transaction details."}
                    </p>
                </div>
                <ErrorToast message={error} onDismiss={() => setError(null)} />
            </div>
        )
    }

    // ── Parse data ────────────────────────────────────────────
    const status = getTxStatus(tx.finalHash, tx.signatures.length, tx.threshold)
    const parsedMsgs = parseMsgs(tx.msgsJson)
    const fee = parseFee(tx.feeJson)

    return (
        <div className="animate-fade-in k-txview">
            {/* ── Header ───────────────────────────────────────── */}
            <div>
                <button className="k-txview__back" onClick={() => navigate(-1)}>← Back</button>
                <div className="k-txview__header-row">
                    <div className="k-txview__title-row">
                        <h2 className="k-txview__title">TX #{id}</h2>
                        <StatusBadge status={status} sigCount={tx.signatures.length} threshold={tx.threshold} />
                        <button
                            className={`k-txview__share-btn ${linkCopied ? "k-txview__share-btn--copied" : ""}`}
                            onClick={() => {
                                navigator.clipboard.writeText(window.location.href)
                                completeQuest("share-link")
                                setLinkCopied(true)
                                setTimeout(() => setLinkCopied(false), 2000)
                            }}
                        >
                            {linkCopied ? "✓ Link Copied" : "Share"}
                        </button>
                    </div>
                    <p className="k-txview__meta">
                        {(tx.type || "send").toUpperCase()} • Created by <CopyableAddress address={tx.creatorAddress} full={false} fontSize={12} /> • {formatDate(tx.createdAt)}
                    </p>
                </div>
            </div>

            {/* ── Transaction Content ──────────────────────────── */}
            {parsedMsgs.map((msg, i) => (
                <div key={i} className="k-card k-txview__msg-card">
                    <div className="k-txview__msg-header">
                        <span className="k-txview__msg-type">{msg.type}</span>
                        <span className="k-txview__msg-label">{msg.label}</span>
                    </div>
                    {msg.fields.map((field, j) => (
                        <div key={j} className="k-txview__field-row">
                            <span className="k-label k-txview__field-key">{field.key}</span>
                            <span className={[
                                "k-txview__field-value",
                                field.accent ? "k-txview__field-value--accent" : "",
                                field.key === "Raw" ? "k-txview__field-value--raw" : "",
                            ].filter(Boolean).join(" ")}>
                                {field.value}
                            </span>
                        </div>
                    ))}
                </div>
            ))}

            {/* ── Details card ─────────────────────────────────── */}
            <div className="k-card k-txview__detail-card">
                <DetailRow label="Multisig" value={<CopyableAddress address={tx.multisigAddress} fontSize={13} />} />
                <DetailRow label="Chain" value={tx.chainId} />
                <DetailRow label="Memo" value={tx.memo || "—"} />
                <DetailRow label="Fee" value={fee.amount !== "—" ? `${fee.amount} (gas: ${fee.gas})` : `Gas: ${fee.gas}`} />
                <DetailRow label="Account #" value={String(tx.accountNumber)} />
                <DetailRow label="Sequence" value={String(tx.sequence)} />
            </div>

            {/* ── Signature Progress ──────────────────────────── */}
            <div>
                <h3 className="k-txview__section-title">Signature Progress</h3>
                <ProgressBar
                    current={tx.signatures.length}
                    verified={tx.signatures.filter(s => s.verified).length}
                    threshold={tx.threshold}
                    total={tx.membersCount}
                />
            </div>

            {/* ── Signers ─────────────────────────────────────── */}
            <div>
                <h3 className="k-txview__section-title">Signers</h3>
                <div className="k-card k-txview__table-card">
                    <div className="k-txview__table-header">
                        <span>Address</span>
                        <span>Status</span>
                    </div>
                    {tx.signatures.length === 0 ? (
                        <div className="k-txview__empty">
                            <p className="k-txview__empty-text">No signatures yet</p>
                        </div>
                    ) : (
                        tx.signatures.map((sig, i) => (
                            <div key={i} className="k-txview__signer-row">
                                <CopyableAddress address={sig.userAddress} fontSize={12} />
                                <span
                                    className={sig.verified
                                        ? "k-txview__signed-badge"
                                        : "k-txview__signed-badge k-txview__signed-badge--unverified"}
                                    title={sig.verified
                                        ? "The server re-derived this signature from the stored transaction and it checked out."
                                        : "Stored but not cryptographically verified — this signature either predates server-side verification (older transactions can never be re-checked) or did not match. Expected for legacy transactions; verification is advisory until enforcement is switched on."}
                                >
                                    {sig.verified ? "Verified" : "Unverified"}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* ── Actions ─────────────────────────────────────── */}
            {!tx.finalHash && auth.isAuthenticated && (
                <div className="k-txview__actions">
                    <button
                        className="k-btn-primary"
                        disabled={actionLoading || tx.signatures.some(s => s.userAddress === adena.address)}
                        onClick={() => setPendingAction("sign")}
                        style={{ opacity: actionLoading ? 0.5 : 1 }}
                    >
                        {actionLoading ? "Signing..." : tx.signatures.some(s => s.userAddress === adena.address) ? "Already Signed" : "Sign Transaction"}
                    </button>
                    {tx.signatures.length >= tx.threshold && (
                        <button
                            className="k-btn-primary"
                            style={{ background: "var(--color-k-accent-hover)", opacity: actionLoading ? 0.5 : 1 }}
                            disabled={actionLoading}
                            onClick={() => setPendingAction("broadcast")}
                        >
                            {actionLoading ? "Broadcasting..." : "Broadcast to Chain"}
                        </button>
                    )}
                    <button
                        className="k-btn-secondary"
                        onClick={() => {
                            const json = JSON.stringify(buildSignDoc(tx), null, 2)
                            const blob = new Blob([json], { type: "application/json" })
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement("a")
                            a.href = url
                            a.download = `memba-tx-${tx.id}-unsigned.json`
                            a.click()
                            URL.revokeObjectURL(url)
                        }}
                    >
                        Export Unsigned TX
                    </button>
                    <button
                        className="k-btn-secondary"
                        onClick={() => setShowManualSig(!showManualSig)}
                    >
                        {showManualSig ? "Hide" : "Paste gnokey Sig"}
                    </button>
                </div>
            )}

            {/* ── W2.4: Review card — confirm before sign/broadcast ── */}
            {pendingAction && !tx.finalHash && (
                <div className="k-card k-txview__confirm-card" role="alertdialog" aria-label="Review transaction" style={{
                    border: "1px solid var(--color-k-amber-border)",
                    display: "flex", flexDirection: "column", gap: 12, padding: 18,
                }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
                        Review before you {pendingAction === "sign" ? "sign" : "broadcast"}
                    </h3>
                    {parseMsgs(tx.msgsJson, { full: true }).map((msg, i) => (
                        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>{msg.label}</span>
                            {msg.fields.map((field, j) => (
                                <div key={j} style={{ display: "flex", gap: 8, fontSize: 12 }}>
                                    <span className="k-label" style={{ minWidth: 90 }}>{field.key}</span>
                                    <span style={{ fontFamily: "JetBrains Mono, monospace", wordBreak: "break-all" }}>{field.value}</span>
                                </div>
                            ))}
                        </div>
                    ))}
                    <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
                        <span className="k-label" style={{ minWidth: 90 }}>Fee</span>
                        <span>{fee.amount !== "—" ? `${fee.amount} (gas: ${fee.gas})` : `Gas: ${fee.gas}`}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, fontSize: 12, alignItems: "center" }}>
                        <span className="k-label" style={{ minWidth: 90 }}>Network</span>
                        {tx.chainId === GNO_CHAIN_ID ? (
                            <span style={{ color: "var(--color-success, #2fbf71)" }}>✓ {tx.chainId} — matches this app's network</span>
                        ) : (
                            <span style={{ color: "var(--color-danger)" }}>
                                ⚠ {tx.chainId} — DIFFERENT from this app's network ({GNO_CHAIN_ID})
                            </span>
                        )}
                    </div>
                    <p style={{ fontSize: 11, color: "var(--color-text-secondary)", margin: 0 }}>
                        {pendingAction === "sign"
                            ? "Your signature authorizes this exact transaction. Verify the full recipient address character by character."
                            : "Broadcasting is an on-chain action that costs gas and cannot be undone."}
                    </p>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button className="k-btn-secondary" onClick={() => setPendingAction(null)}>Cancel</button>
                        <button
                            className="k-btn-primary"
                            disabled={actionLoading}
                            onClick={() => {
                                const action = pendingAction
                                setPendingAction(null)
                                if (action === "sign") void handleSign()
                                else void handleBroadcast()
                            }}
                        >
                            Confirm {pendingAction === "sign" ? "& Sign" : "& Broadcast"}
                        </button>
                    </div>
                </div>
            )}

            {/* ── Manual Signature Paste (air-gapped flow) ────── */}
            {showManualSig && !tx.finalHash && auth.isAuthenticated && (
                <div className="k-card k-txview__manual-form">
                    <p className="k-label">Paste gnokey Signature</p>
                    <p className="k-txview__manual-desc">
                        Export the unsigned TX above, sign with gnokey offline, then paste the base64 signature here.
                    </p>
                    <input
                        className="k-txview__manual-input"
                        type="text"
                        value={manualSig}
                        onChange={(e) => setManualSig(e.target.value)}
                        placeholder="Paste base64 signature from gnokey..."
                    />
                    <button
                        className="k-btn-primary"
                        disabled={!manualSig.trim() || actionLoading}
                        style={{ opacity: manualSig.trim() && !actionLoading ? 1 : 0.5, alignSelf: "flex-start" }}
                        onClick={async () => {
                            if (!token || !tx || !manualSig.trim()) return
                            setActionLoading(true)
                            setError(null)
                            try {
                                const signDoc = JSON.stringify(buildSignDoc(tx))
                                await api.signTransaction({
                                    authToken: token,
                                    transactionId: tx.id,
                                    signature: manualSig.trim(),
                                    bodyBytes: new TextEncoder().encode(signDoc),
                                })
                                setManualSig("")
                                setShowManualSig(false)
                                await fetchTx()
                            } catch (err) {
                                setError(err instanceof Error ? err.message : "Failed to submit signature")
                            } finally {
                                setActionLoading(false)
                            }
                        }}
                    >
                        {actionLoading ? "Submitting..." : "Submit Signature"}
                    </button>
                </div>
            )}

            {/* ── Final Hash ──────────────────────────────────── */}
            {tx.finalHash && (
                <div className="k-card k-txview__hash-card">
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <p className="k-label k-txview__hash-label" style={{ margin: 0 }}>Transaction Hash</p>
                        {/* W2.4: surface the backend's chain reconcile (W2.3) —
                            verified means the hash was FOUND on-chain at
                            completion; unconfirmed means it's a client claim. */}
                        {tx.verified ? (
                            <span style={{
                                fontSize: 10, padding: "2px 8px", borderRadius: 4,
                                background: "rgba(47,191,113,0.12)", color: "var(--color-success, #2fbf71)",
                                fontFamily: "JetBrains Mono, monospace",
                            }}>✓ VERIFIED ON-CHAIN</span>
                        ) : (
                            <span style={{
                                fontSize: 10, padding: "2px 8px", borderRadius: 4,
                                background: "var(--color-k-amber-subtle, rgba(255,193,7,0.12))", color: "var(--color-k-warning, #ffc107)",
                                fontFamily: "JetBrains Mono, monospace",
                            }} title="The backend could not confirm this hash on-chain at completion time — it is a client-reported value.">⏳ UNCONFIRMED</span>
                        )}
                    </div>
                    <p className="k-txview__hash-value">
                        {tx.finalHash}
                    </p>
                </div>
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="k-txview__detail-row">
            <span className="k-label">{label}</span>
            <span className="k-txview__detail-value">{value}</span>
        </div>
    )
}

/**
 * Build the Amino-JSON broadcast document for a multisig transaction.
 *
 * Gno multisig broadcast requires:
 * 1. A single Signature entry with the multisig pubkey
 * 2. The signature field containing an Amino-encoded Multisignature struct
 *    with a CompactBitArray indicating which pubkey positions signed
 *    and the raw signatures in positional order.
 *
 * Since we cannot produce Amino binary encoding in JS, we use Adena's
 * BroadcastMultisigTransaction when available, or fall back to the
 * Amino JSON broadcast endpoint.
 *
 * v5 fix: Replaces broken comma-joined signature format.
 */
async function buildMultisigSignatureData(tx: Transaction): Promise<{
    pubkey: Record<string, unknown>;
    sigs: string[];
    bitArray: string;
} | null> {
    let multisigPubkey: {
        type?: string;
        "@type"?: string;
        value?: { threshold: string; pubkeys: { type?: string; "@type"?: string; value: string }[] };
        threshold?: string;
        pubkeys?: { type?: string; "@type"?: string; value: string }[];
    } | null = null

    try {
        multisigPubkey = JSON.parse(tx.multisigPubkeyJson)
    } catch {
        return null
    }

    if (!multisigPubkey) return null

    // Normalize pubkey format — handle both nested and flat structures
    const pubkeys = multisigPubkey.value?.pubkeys || multisigPubkey.pubkeys || []
    if (pubkeys.length === 0) return null

    // Derive the bech32 address for each pubkey in the multisig so we can
    // map each signature to its correct positional index.
    const pubkeyAddresses = await Promise.all(
        pubkeys.map(pk => pubkeyToAddress(pk.value, GNO_BECH32_HRP))
    )

    // Build a lookup: signer address → pubkey index
    const addressToIndex = new Map<string, number>()
    for (let i = 0; i < pubkeyAddresses.length; i++) {
        addressToIndex.set(pubkeyAddresses[i], i)
    }

    // Build CompactBitArray: "x" for signed positions, "_" for unsigned.
    // Signatures must be ordered by their pubkey index (ascending).
    const signerCount = pubkeys.length
    const bits: string[] = new Array(signerCount).fill("_")
    const indexedSigs: { index: number; value: string }[] = []

    for (const sig of tx.signatures) {
        const idx = addressToIndex.get(sig.userAddress)
        if (idx !== undefined && bits[idx] === "_") {
            bits[idx] = "x"
            indexedSigs.push({ index: idx, value: sig.value })
        }
    }

    // Sort by pubkey index so signatures are in positional order
    indexedSigs.sort((a, b) => a.index - b.index)

    return {
        pubkey: multisigPubkey,
        sigs: indexedSigs.map(s => s.value),
        bitArray: bits.join(""),
    }
}

/**
 * Build a hex-encoded Amino JSON broadcast TX from multi-sig data.
 * Uses the proper Multisignature structure with CompactBitArray.
 */
async function buildBroadcastTx(tx: Transaction): Promise<string> {
    const sigData = await buildMultisigSignatureData(tx)
    if (!sigData) {
        throw new Error("Failed to build multisig signature data — check multisig pubkey JSON")
    }

    // Build the Amino JSON StdTx with proper multisig signature format.
    // The signature field for a multisig TX contains the Amino-JSON-encoded
    // Multisignature struct. Gno nodes accept Amino JSON via broadcast endpoints.
    const broadcastDoc = {
        type: "auth/StdTx",
        value: {
            msg: JSON.parse(tx.msgsJson),
            fee: JSON.parse(tx.feeJson),
            signatures: [{
                pub_key: sigData.pubkey,
                signature: {
                    "@type": "/tm.MultiSignature",
                    bit_array: sigData.bitArray,
                    sigs: sigData.sigs,
                },
            }],
            memo: tx.memo || "",
        },
    }

    const jsonStr = JSON.stringify(broadcastDoc)
    return Array.from(new TextEncoder().encode(jsonStr))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("")
}

/**
 * Attempt to broadcast via Adena's BroadcastMultisigTransaction.
 * Returns the TX hash on success, or null if Adena doesn't support it.
 *
 * W2.1: the wallet path applies the same RPC-trust + wrong-chain guards as
 * doContractBroadcast (assertWalletBroadcastSafe). A guard failure returns
 * null → the caller falls back to Memba's OWN configured RPC, which targets
 * the correct chain by construction (the tx was signed for it), so the
 * fallback is chain-safe while the wallet's network state is not.
 */
async function tryAdenaBroadcast(tx: Transaction): Promise<string | null> {
    const adena = (window as unknown as Record<string, unknown>).adena as Record<string, unknown> | undefined
    if (!adena || typeof adena.BroadcastMultisigTransaction !== "function") {
        return null
    }

    try {
        assertWalletBroadcastSafe()
    } catch (guardErr) {
        console.warn("[Memba] Adena broadcast blocked by wallet guard, using app RPC fallback:", guardErr)
        return null
    }

    try {
        const sigData = await buildMultisigSignatureData(tx)
        if (!sigData) return null

        const result = await (adena.BroadcastMultisigTransaction as (arg: unknown) => Promise<{
            status: string;
            data?: { hash?: string };
        }>)({
            msgs: JSON.parse(tx.msgsJson),
            fee: JSON.parse(tx.feeJson),
            signatures: sigData.sigs,
            pubkey: sigData.pubkey,
            memo: tx.memo || "",
        })

        if (result.status !== "failure" && result.data?.hash) {
            return result.data.hash
        }
    } catch (err) {
        console.warn("[Memba] Adena BroadcastMultisigTransaction not available or failed:", err)
    }
    return null
}

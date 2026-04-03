/**
 * FreelanceServices — Milestone-based escrow contracts on gno.land.
 *
 * Browse active contracts, create new contracts with milestones,
 * fund/complete/release/dispute milestones — all on-chain via Adena.
 *
 * @module pages/FreelanceServices
 */

import { useState, useEffect, useCallback } from "react"
import { useOutletContext } from "react-router-dom"
import { Plus } from "@phosphor-icons/react"
import { queryRender } from "../lib/dao/shared"
import { doContractBroadcast } from "../lib/grc20"
import { GNO_RPC_URL, API_BASE_URL, MEMBA_DAO } from "../lib/config"
import {
    buildCreateContractMsg,
    buildFundMilestoneMsg,
    buildCompleteMilestoneMsg,
    buildReleaseFundsMsg,
    buildRaiseDisputeMsg,
    buildCancelContractMsg,
    buildClaimRefundMsg,
    buildClaimDisputeTimeoutMsg,
} from "../lib/marketplace/builders"
import { ComingSoonGate } from "../components/ui/ComingSoonGate"
import { ErrorToast } from "../components/ui/ErrorToast"
import type { LayoutContext } from "../types/layout"
import "./freelance.css"

const SERVICES_ENABLED = import.meta.env.VITE_ENABLE_SERVICES === "true"
const ESCROW_PATH = MEMBA_DAO.escrowPath

// ── Types ────────────────────────────────────────────────────

interface EscrowContract {
    id: string
    title: string
    client: string
    freelancer: string
    status: string
    total: number
}

interface ContractDetail {
    id: string
    title: string
    description: string
    client: string
    freelancer: string
    status: string
    createdAt: string
    totalValue: number
    milestones: MilestoneInfo[]
}

interface MilestoneInfo {
    title: string
    amount: number
    status: string
    fundedAt?: string
    completedAt?: string
    disputedAt?: string
}

// ── Parsers ─────────────────────────────────────────────────

function parseContractTable(raw: string): EscrowContract[] {
    const contracts: EscrowContract[] = []
    for (const line of raw.split("\n")) {
        if (!line.startsWith("|") || line.startsWith("| ID") || line.startsWith("| ---")) continue
        const cols = line.split("|").map(c => c.trim()).filter(Boolean)
        if (cols.length < 6) continue
        const nameMatch = cols[1].match(/\[(.+?)\]/)
        const totalMatch = cols[5].match(/(\d+)/)
        contracts.push({
            id: cols[0],
            title: nameMatch ? nameMatch[1] : cols[1],
            client: cols[2],
            freelancer: cols[3],
            status: cols[4],
            total: totalMatch ? parseInt(totalMatch[1]) : 0,
        })
    }
    return contracts
}

function parseContractDetail(raw: string): ContractDetail | null {
    if (!raw || raw.includes("# 404")) return null
    const lines = raw.split("\n")
    const detail: ContractDetail = {
        id: "", title: "", description: "", client: "", freelancer: "",
        status: "", createdAt: "", totalValue: 0, milestones: [],
    }

    let inMilestones = false
    for (const line of lines) {
        if (line.startsWith("# ") && !line.startsWith("## ")) {
            detail.title = line.slice(2).trim()
            continue
        }
        if (line.startsWith("**ID:**")) { detail.id = extractField(line); continue }
        if (line.startsWith("**Client:**")) { detail.client = extractField(line); continue }
        if (line.startsWith("**Freelancer:**")) { detail.freelancer = extractField(line); continue }
        if (line.startsWith("**Status:**")) { detail.status = extractField(line); continue }
        if (line.startsWith("**Created:**")) { detail.createdAt = extractField(line); continue }
        if (line.startsWith("**Total Value:**")) {
            const m = line.match(/(\d+)/)
            detail.totalValue = m ? parseInt(m[1]) : 0
            continue
        }
        if (line === "## Milestones") { inMilestones = true; continue }
        if (inMilestones && line.startsWith("- **")) {
            const msMatch = line.match(/- \*\*(.+?)\*\* — (\d+) ugnot \[(.+?)\]/)
            if (msMatch) {
                const ms: MilestoneInfo = {
                    title: msMatch[1],
                    amount: parseInt(msMatch[2]),
                    status: msMatch[3],
                }
                const fundedMatch = line.match(/\(funded block (\d+)\)/)
                if (fundedMatch) ms.fundedAt = fundedMatch[1]
                const completedMatch = line.match(/\(completed block (\d+)\)/)
                if (completedMatch) ms.completedAt = completedMatch[1]
                const disputedMatch = line.match(/\(disputed block (\d+)\)/)
                if (disputedMatch) ms.disputedAt = disputedMatch[1]
                detail.milestones.push(ms)
            }
        }
        // Description lines (between title and first ** field)
        if (!inMilestones && !line.startsWith("**") && !line.startsWith("#") && line.trim() && !detail.client) {
            detail.description += (detail.description ? "\n" : "") + line
        }
    }
    return detail
}

function extractField(line: string): string {
    const idx = line.indexOf(":**")
    if (idx === -1) return ""
    return line.slice(idx + 3).trim()
}

// ── Data Fetching ───────────────────────────────────────────

async function fetchContracts(): Promise<EscrowContract[]> {
    try {
        const backendUrl = API_BASE_URL || ""
        const resp = await fetch(`${backendUrl}/api/marketplace/escrow`)
        if (resp.ok) {
            const raw = await resp.text()
            return parseContractTable(raw)
        }
    } catch { /* fallback */ }
    try {
        const raw = await queryRender(GNO_RPC_URL, ESCROW_PATH, "")
        return raw ? parseContractTable(raw) : []
    } catch { return [] }
}

async function fetchContractDetail(id: string): Promise<ContractDetail | null> {
    try {
        const backendUrl = API_BASE_URL || ""
        const resp = await fetch(`${backendUrl}/api/marketplace/escrow?id=${encodeURIComponent(id)}`)
        if (resp.ok) return parseContractDetail(await resp.text())
    } catch { /* fallback */ }
    try {
        const raw = await queryRender(GNO_RPC_URL, ESCROW_PATH, `contract/${id}`)
        return raw ? parseContractDetail(raw) : null
    } catch { return null }
}

// ── Main Component ──────────────────────────────────────────

export default function FreelanceServices() {
    if (!SERVICES_ENABLED) {
        return (
            <ComingSoonGate
                title="Freelance Services"
                icon="💼"
                description="Hire experts with milestone-based escrow contracts on gno.land."
                features={[
                    "On-chain escrow contracts for freelance work",
                    "Milestone-based payment releases",
                    "Auto-refund timeouts prevent fund locking",
                    "Dispute resolution via admin arbitration",
                ]}
            />
        )
    }
    return <FreelanceContent />
}

function FreelanceContent() {
    const { adena } = useOutletContext<LayoutContext>()

    const [contracts, setContracts] = useState<EscrowContract[]>([])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [detail, setDetail] = useState<ContractDetail | null>(null)
    const [showCreate, setShowCreate] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        document.title = "Escrow Contracts — Memba"
        fetchContracts().then(setContracts).finally(() => setLoading(false))
    }, [])

    const handleSelectContract = useCallback(async (id: string) => {
        setSelectedId(id)
        setDetail(null)
        const d = await fetchContractDetail(id)
        setDetail(d)
    }, [])

    const reload = useCallback(async () => {
        const cs = await fetchContracts()
        setContracts(cs)
        if (selectedId) {
            const d = await fetchContractDetail(selectedId)
            setDetail(d)
        }
    }, [selectedId])

    const handleCreated = useCallback(async () => {
        setShowCreate(false)
        setLoading(true)
        await reload()
        setLoading(false)
    }, [reload])

    // ── Contract Detail ─────────────────────────────────────
    if (selectedId && detail) {
        return (
            <ContractDetailView
                detail={detail}
                adena={adena}
                error={error}
                onError={setError}
                onBack={() => { setSelectedId(null); setDetail(null) }}
                onReload={reload}
            />
        )
    }

    // ── Contracts List ──────────────────────────────────────
    return (
        <div className="fl-page animate-fade-in">
            <ErrorToast message={error} onDismiss={() => setError(null)} />

            <div className="fl-header">
                <div>
                    <h1>💼 Escrow Contracts</h1>
                    <p>Milestone-based escrow for freelance services on gno.land</p>
                </div>
                {adena.connected && (
                    <button className="fl-create-btn" onClick={() => setShowCreate(true)}>
                        <Plus size={16} /> New Contract
                    </button>
                )}
            </div>

            {showCreate && (
                <CreateContractForm
                    address={adena.address}
                    onClose={() => setShowCreate(false)}
                    onCreated={handleCreated}
                    onError={setError}
                />
            )}

            <div className="fl-count">
                {loading ? "Loading contracts..." : `${contracts.length} contract${contracts.length !== 1 ? "s" : ""}`}
            </div>

            {!loading && contracts.length === 0 ? (
                <div className="fl-empty">
                    <span className="fl-empty__icon">💼</span>
                    <p>No contracts yet.{adena.connected ? " Create one to get started." : " Connect wallet to create one."}</p>
                </div>
            ) : (
                <div className="fl-grid">
                    {contracts.map(c => (
                        <button key={c.id} className="fl-card" onClick={() => handleSelectContract(c.id)}>
                            <div className="fl-card__top">
                                <div className="fl-card__header">
                                    <div className="fl-card__title">{c.title}</div>
                                    <div className="fl-card__seller">
                                        {c.client.slice(0, 10)}... → {c.freelancer.slice(0, 10)}...
                                    </div>
                                </div>
                            </div>
                            <div className="fl-card__footer">
                                <span className={`fl-status fl-status--${c.status}`}>{c.status}</span>
                                <span className="fl-card__price">{(c.total / 1_000_000).toFixed(2)} GNOT</span>
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

// ── Contract Detail View ────────────────────────────────────

function ContractDetailView({ detail, adena, error, onError, onBack, onReload }: {
    detail: ContractDetail
    adena: LayoutContext["adena"]
    error: string | null
    onError: (msg: string) => void
    onBack: () => void
    onReload: () => Promise<void>
}) {
    const [acting, setActing] = useState(false)
    const isClient = adena.connected && adena.address === detail.client
    const isFreelancer = adena.connected && adena.address === detail.freelancer

    const act = async (label: string, msgBuilder: () => ReturnType<typeof buildFundMilestoneMsg>) => {
        if (acting) return
        setActing(true)
        try {
            await doContractBroadcast([msgBuilder()], label)
            await onReload()
        } catch (e) {
            onError(e instanceof Error ? e.message : `${label} failed`)
        } finally {
            setActing(false)
        }
    }

    return (
        <div className="fl-page animate-fade-in">
            <ErrorToast message={error} onDismiss={() => onError("")} />
            <button className="fl-back" onClick={onBack}>← Back to Contracts</button>

            <div className="fl-detail">
                <h1 className="fl-detail__title">{detail.title}</h1>
                <div className="fl-detail__meta">
                    <span className={`fl-status fl-status--${detail.status}`}>{detail.status}</span>
                    <span>Client: {detail.client.slice(0, 13)}...</span>
                    <span>Freelancer: {detail.freelancer.slice(0, 13)}...</span>
                </div>

                {detail.description && <p className="fl-detail__desc">{detail.description}</p>}

                <div className="fl-price-card">
                    <div className="fl-price-card__amount">{(detail.totalValue / 1_000_000).toFixed(2)} GNOT</div>
                    <div className="fl-price-card__ugnot">({detail.totalValue.toLocaleString()} ugnot)</div>
                </div>

                <h3>Milestones</h3>
                <div className="fl-milestones">
                    {detail.milestones.map((ms, idx) => (
                        <div key={idx} className="fl-milestone">
                            <div className="fl-milestone__header">
                                <span className="fl-milestone__title">{ms.title}</span>
                                <span className={`fl-status fl-status--${ms.status}`}>{ms.status}</span>
                                <span className="fl-milestone__amount">{(ms.amount / 1_000_000).toFixed(2)} GNOT</span>
                            </div>
                            <div className="fl-milestone__actions">
                                {isClient && ms.status === "pending" && (
                                    <button className="fl-btn fl-btn--fund" disabled={acting} onClick={() =>
                                        act("Fund Milestone", () => buildFundMilestoneMsg(adena.address, ESCROW_PATH, detail.id, idx, ms.amount))
                                    }>Fund</button>
                                )}
                                {isFreelancer && ms.status === "funded" && (
                                    <button className="fl-btn fl-btn--complete" disabled={acting} onClick={() =>
                                        act("Complete Milestone", () => buildCompleteMilestoneMsg(adena.address, ESCROW_PATH, detail.id, idx))
                                    }>Mark Complete</button>
                                )}
                                {isClient && ms.status === "completed" && (
                                    <button className="fl-btn fl-btn--release" disabled={acting} onClick={() =>
                                        act("Release Funds", () => buildReleaseFundsMsg(adena.address, ESCROW_PATH, detail.id, idx))
                                    }>Release Funds</button>
                                )}
                                {(isClient || isFreelancer) && (ms.status === "funded" || ms.status === "completed") && (
                                    <button className="fl-btn fl-btn--dispute" disabled={acting} onClick={() =>
                                        act("Raise Dispute", () => buildRaiseDisputeMsg(adena.address, ESCROW_PATH, detail.id, idx))
                                    }>Dispute</button>
                                )}
                                {/* Timeout actions — permissionless */}
                                {adena.connected && ms.status === "funded" && ms.fundedAt && (
                                    <button className="fl-btn fl-btn--cancel" disabled={acting} onClick={() =>
                                        act("Claim Refund", () => buildClaimRefundMsg(adena.address, ESCROW_PATH, detail.id, idx))
                                    }>Claim Refund (timeout)</button>
                                )}
                                {adena.connected && ms.status === "disputed" && ms.disputedAt && (
                                    <button className="fl-btn fl-btn--release" disabled={acting} onClick={() =>
                                        act("Claim Dispute Timeout", () => buildClaimDisputeTimeoutMsg(adena.address, ESCROW_PATH, detail.id, idx))
                                    }>Auto-resolve (timeout)</button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {isClient && detail.status === "active" && (
                    <button className="fl-btn fl-btn--cancel" disabled={acting} onClick={() =>
                        act("Cancel Contract", () => buildCancelContractMsg(adena.address, ESCROW_PATH, detail.id))
                    }>Cancel Contract</button>
                )}
            </div>
        </div>
    )
}

// ── Create Contract Form ────────────────────────────────────

function CreateContractForm({ address, onClose, onCreated, onError }: {
    address: string
    onClose: () => void
    onCreated: () => void
    onError: (msg: string) => void
}) {
    const [submitting, setSubmitting] = useState(false)
    const [freelancer, setFreelancer] = useState("")
    const [title, setTitle] = useState("")
    const [description, setDescription] = useState("")
    const [milestones, setMilestones] = useState([{ title: "", amount: "" }])

    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
        document.addEventListener("keydown", handleKey)
        return () => document.removeEventListener("keydown", handleKey)
    }, [onClose])

    const addMilestone = () => {
        if (milestones.length >= 20) return
        setMilestones(prev => [...prev, { title: "", amount: "" }])
    }

    const removeMilestone = (idx: number) => {
        if (milestones.length <= 1) return
        setMilestones(prev => prev.filter((_, i) => i !== idx))
    }

    const updateMilestone = (idx: number, field: "title" | "amount", value: string) => {
        // Sanitize title: strip : and , to prevent milestone parsing issues on-chain
        if (field === "title") value = value.replace(/[,:]/g, "")
        setMilestones(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m))
    }

    const milestonesStr = milestones
        .filter(m => m.title.trim() && m.amount)
        .map(m => `${m.title.trim()}:${m.amount}`)
        .join(",")

    const totalUgnot = milestones.reduce((sum, m) => sum + (parseInt(m.amount) || 0), 0)
    const canSubmit = freelancer.trim() && title.trim() && milestonesStr.length > 0

    const handleSubmit = async () => {
        if (!canSubmit) return
        setSubmitting(true)
        try {
            const msg = buildCreateContractMsg(
                address, ESCROW_PATH, freelancer.trim(),
                title.trim(), description.trim(), milestonesStr,
            )
            await doContractBroadcast([msg], "Create Escrow Contract")
            onCreated()
        } catch (e) {
            onError(e instanceof Error ? e.message : "Contract creation failed")
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="fl-modal-overlay" onClick={onClose}>
            <div className="fl-modal" onClick={e => e.stopPropagation()}>
                <div className="fl-modal__header">
                    <h2>New Escrow Contract</h2>
                    <button className="fl-modal__close" onClick={onClose}>×</button>
                </div>

                <div className="fl-modal__body">
                    <label className="fl-field">
                        <span>Freelancer Address *</span>
                        <input type="text" value={freelancer} onChange={e => setFreelancer(e.target.value)}
                            placeholder="g1..." maxLength={42} />
                    </label>

                    <label className="fl-field">
                        <span>Title *</span>
                        <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                            placeholder="Project title" maxLength={200} />
                    </label>

                    <label className="fl-field">
                        <span>Description</span>
                        <textarea value={description} onChange={e => setDescription(e.target.value)}
                            placeholder="Describe the work..." maxLength={5000} rows={3} />
                    </label>

                    <div className="fl-field">
                        <span>Milestones *</span>
                        {milestones.map((ms, idx) => (
                            <div key={idx} className="fl-milestone-input">
                                <input type="text" value={ms.title} onChange={e => updateMilestone(idx, "title", e.target.value)}
                                    placeholder="Milestone title" />
                                <input type="number" value={ms.amount} onChange={e => updateMilestone(idx, "amount", e.target.value)}
                                    placeholder="ugnot" min={1} />
                                {milestones.length > 1 && (
                                    <button className="fl-milestone-remove" onClick={() => removeMilestone(idx)}>×</button>
                                )}
                            </div>
                        ))}
                        <button className="fl-milestone-add" onClick={addMilestone} disabled={milestones.length >= 20}>
                            + Add Milestone
                        </button>
                        {totalUgnot > 0 && (
                            <div className="fl-milestone-total">
                                Total: {(totalUgnot / 1_000_000).toFixed(2)} GNOT ({totalUgnot.toLocaleString()} ugnot)
                            </div>
                        )}
                    </div>

                    <div className="fl-modal__actions">
                        <button className="fl-btn fl-btn--cancel" onClick={onClose} disabled={submitting}>Cancel</button>
                        <button className="fl-btn fl-btn--create" onClick={handleSubmit} disabled={!canSubmit || submitting}>
                            {submitting ? "Creating..." : "Create Contract"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

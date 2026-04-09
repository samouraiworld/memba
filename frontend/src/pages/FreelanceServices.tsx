/**
 * FreelanceServices — Browse services, hire freelancers, manage escrow contracts.
 *
 * Two tabs:
 * - "Browse Services" — Freelancers post offerings, clients discover and hire
 * - "My Contracts" — Active escrow contracts for the connected wallet
 *
 * @module pages/FreelanceServices
 */

import { useState, useEffect, useMemo, useDeferredValue, useCallback } from "react"
import { useOutletContext } from "react-router-dom"
import { Plus, Briefcase, FileText } from "@phosphor-icons/react"
import { api } from "../lib/api"
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
import type { ServiceListing } from "../gen/memba/v1/memba_pb"
import "./freelance.css"

const SERVICES_ENABLED = import.meta.env.VITE_ENABLE_SERVICES === "true"
const ESCROW_PATH = MEMBA_DAO.escrowPath

const SERVICE_CATEGORIES = [
    { key: "development", label: "Development", icon: "💻" },
    { key: "design", label: "Design", icon: "🎨" },
    { key: "writing", label: "Writing", icon: "✍️" },
    { key: "consulting", label: "Consulting", icon: "🧠" },
    { key: "marketing", label: "Marketing", icon: "📣" },
    { key: "other", label: "Other", icon: "🔧" },
]

// ── Types ────────────────────────────────────────────────────

interface EscrowContract {
    id: string; title: string; client: string; freelancer: string
    status: string; total: number
}

interface ContractDetail {
    id: string; title: string; description: string; client: string
    freelancer: string; status: string; createdAt: string
    totalValue: number; milestones: MilestoneInfo[]
}

interface MilestoneInfo {
    title: string; amount: number; status: string
    fundedAt?: string; completedAt?: string; disputedAt?: string
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
            id: cols[0], title: nameMatch ? nameMatch[1] : cols[1],
            client: cols[2], freelancer: cols[3], status: cols[4],
            total: totalMatch ? parseInt(totalMatch[1]) : 0,
        })
    }
    return contracts
}

function parseContractDetail(raw: string): ContractDetail | null {
    if (!raw || raw.includes("# 404")) return null
    const lines = raw.split("\n")
    const d: ContractDetail = {
        id: "", title: "", description: "", client: "", freelancer: "",
        status: "", createdAt: "", totalValue: 0, milestones: [],
    }
    let inMs = false
    for (const line of lines) {
        if (line.startsWith("# ") && !line.startsWith("## ")) { d.title = line.slice(2).trim(); continue }
        if (line.startsWith("**ID:**")) { d.id = extractField(line); continue }
        if (line.startsWith("**Client:**")) { d.client = extractField(line); continue }
        if (line.startsWith("**Freelancer:**")) { d.freelancer = extractField(line); continue }
        if (line.startsWith("**Status:**")) { d.status = extractField(line); continue }
        if (line.startsWith("**Created:**")) { d.createdAt = extractField(line); continue }
        if (line.startsWith("**Total Value:**")) { const m = line.match(/(\d+)/); d.totalValue = m ? parseInt(m[1]) : 0; continue }
        if (line === "## Milestones") { inMs = true; continue }
        if (inMs && line.startsWith("- **")) {
            const m = line.match(/- \*\*(.+?)\*\* — (\d+) ugnot \[(.+?)\]/)
            if (m) {
                const ms: MilestoneInfo = { title: m[1], amount: parseInt(m[2]), status: m[3] }
                const f = line.match(/\(funded block (\d+)\)/); if (f) ms.fundedAt = f[1]
                const c = line.match(/\(completed block (\d+)\)/); if (c) ms.completedAt = c[1]
                const dd = line.match(/\(disputed block (\d+)\)/); if (dd) ms.disputedAt = dd[1]
                d.milestones.push(ms)
            }
        }
    }
    return d
}

function extractField(line: string): string {
    const i = line.indexOf(":**"); return i === -1 ? "" : line.slice(i + 3).trim()
}

// ── Data Fetching ───────────────────────────────────────────

async function fetchContracts(): Promise<EscrowContract[]> {
    try {
        const resp = await fetch(`${API_BASE_URL || ""}/api/marketplace/escrow`)
        if (resp.ok) return parseContractTable(await resp.text())
    } catch { /* fallback */ }
    try {
        const raw = await queryRender(GNO_RPC_URL, ESCROW_PATH, "")
        return raw ? parseContractTable(raw) : []
    } catch { return [] }
}

async function fetchContractDetail(id: string): Promise<ContractDetail | null> {
    try {
        const resp = await fetch(`${API_BASE_URL || ""}/api/marketplace/escrow?id=${encodeURIComponent(id)}`)
        if (resp.ok) return parseContractDetail(await resp.text())
    } catch { /* fallback */ }
    try {
        const raw = await queryRender(GNO_RPC_URL, ESCROW_PATH, `contract/${id}`)
        return raw ? parseContractDetail(raw) : null
    } catch { return null }
}

async function fetchServiceListings(category?: string): Promise<ServiceListing[]> {
    try {
        const res = await api.getServiceListings({ category: category || "", limit: 50, startAfter: "" })
        return res.listings || []
    } catch { return [] }
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
                    "Post your skills as a freelancer",
                    "Browse and hire experts for your project",
                    "Milestone-based payment releases via on-chain escrow",
                    "Auto-refund timeouts prevent fund locking",
                ]}
            />
        )
    }
    return <FreelanceContent />
}

function FreelanceContent() {
    const { adena, auth } = useOutletContext<LayoutContext>()
    const [tab, setTab] = useState<"services" | "contracts">("services")
    const [error, setError] = useState<string | null>(null)

    return (
        <div className="fl-page animate-fade-in">
            <ErrorToast message={error} onDismiss={() => setError(null)} />

            <div className="fl-header">
                <div>
                    <h1>💼 Freelance Services</h1>
                    <p>Hire experts or offer your skills — powered by on-chain escrow</p>
                </div>
            </div>

            <div className="fl-tabs">
                <button className={`fl-tab${tab === "services" ? " active" : ""}`} onClick={() => setTab("services")}>
                    <Briefcase size={14} /> Browse Services
                </button>
                <button className={`fl-tab${tab === "contracts" ? " active" : ""}`} onClick={() => setTab("contracts")}>
                    <FileText size={14} /> My Contracts
                </button>
            </div>

            {tab === "services" && (
                <BrowseServicesTab adena={adena} auth={auth} onError={setError} />
            )}
            {tab === "contracts" && (
                <MyContractsTab adena={adena} onError={setError} />
            )}
        </div>
    )
}

// ── Browse Services Tab ─────────────────────────────────────

function BrowseServicesTab({ adena, auth, onError }: {
    adena: LayoutContext["adena"]
    auth: LayoutContext["auth"]
    onError: (msg: string) => void
}) {
    const [listings, setListings] = useState<ServiceListing[]>([])
    const [isDemo, setIsDemo] = useState(false)
    const [search, setSearch] = useState("")
    const deferredSearch = useDeferredValue(search)
    const [category, setCategory] = useState<string>("all")
    const [loading, setLoading] = useState(true)
    const [showPost, setShowPost] = useState(false)
    const [hireTarget, setHireTarget] = useState<ServiceListing | null>(null)

    useEffect(() => {
        document.title = "Freelance Services — Memba"
        fetchServiceListings(category === "all" ? "" : category)
            .then(real => {
                setListings(real)
                setIsDemo(real.length === 0)
            })
            .finally(() => setLoading(false))
    }, [category])

    const filtered = useMemo(() => {
        if (!deferredSearch) return listings
        const q = deferredSearch.toLowerCase()
        return listings.filter(l =>
            l.title.toLowerCase().includes(q) ||
            l.description.toLowerCase().includes(q) ||
            l.tags.toLowerCase().includes(q),
        )
    }, [listings, deferredSearch])

    const handlePosted = useCallback(() => {
        setShowPost(false)
        setLoading(true)
        fetchServiceListings(category === "all" ? "" : category)
            .then(setListings)
            .finally(() => setLoading(false))
    }, [category])

    // Hire flow
    if (hireTarget) {
        return (
            <HireFromListing
                listing={hireTarget}
                address={adena.address}
                onClose={() => setHireTarget(null)}
                onCreated={() => setHireTarget(null)}
                onError={onError}
            />
        )
    }

    return (
        <>
            <div className="fl-toolbar">
                <input type="text" placeholder="Search services..." value={search}
                    onChange={e => setSearch(e.target.value)} className="fl-search" aria-label="Search" />
                {adena.connected && (
                    <button className="fl-create-btn" onClick={() => setShowPost(true)}>
                        <Plus size={14} /> Post a Service
                    </button>
                )}
            </div>

            <div className="fl-categories">
                <button className="fl-cat-pill" data-active={category === "all"} onClick={() => setCategory("all")}>All</button>
                {SERVICE_CATEGORIES.map(c => (
                    <button key={c.key} className="fl-cat-pill" data-active={category === c.key} onClick={() => setCategory(c.key)}>
                        {c.icon} {c.label}
                    </button>
                ))}
            </div>

            <div className="fl-count">
                {loading ? "Loading..." : `${filtered.length} service${filtered.length !== 1 ? "s" : ""}`}
            </div>

            {showPost && auth.token && (
                <PostServiceForm token={auth.token} onClose={() => setShowPost(false)} onPosted={handlePosted} onError={onError} />
            )}

            {!loading && filtered.length === 0 ? (
                <div className="fl-empty">
                    <span className="fl-empty__icon">💼</span>
                    <p>No services yet.{adena.connected ? " Be the first to post one!" : " Connect wallet to post."}</p>
                </div>
            ) : (
                <div className="fl-grid">
                    {filtered.map(listing => (
                        <div key={listing.id} className="fl-card">
                            <div className="fl-card__top">
                                <span className="fl-card__icon">
                                    {SERVICE_CATEGORIES.find(c => c.key === listing.category)?.icon || "💼"}
                                </span>
                                <div className="fl-card__header">
                                    <div className="fl-card__title">
                                        {listing.title}
                                        {isDemo && <span className="fl-demo-badge">demo</span>}
                                    </div>
                                    <div className="fl-card__seller">by {listing.address.slice(0, 13)}...</div>
                                </div>
                            </div>
                            <p className="fl-card__desc">{listing.description || "No description"}</p>
                            <div className="fl-card__footer">
                                <span className="fl-card__price">{(Number(listing.price) / 1_000_000).toFixed(1)} GNOT</span>
                                <span className="fl-card__delivery">~{listing.deliveryDays}d</span>
                                {listing.tags && <span className="fl-card__tags">{listing.tags.split(",").slice(0, 2).join(", ")}</span>}
                            </div>
                            {!isDemo && adena.connected && adena.address !== listing.address && (
                                <button className="fl-btn fl-btn--hire" onClick={() => setHireTarget(listing)}>
                                    Hire →
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </>
    )
}

// ── Post Service Form ───────────────────────────────────────

function PostServiceForm({ token, onClose, onPosted, onError }: {
    token: NonNullable<LayoutContext["auth"]["token"]>
    onClose: () => void
    onPosted: () => void
    onError: (msg: string) => void
}) {
    const [submitting, setSubmitting] = useState(false)
    const [title, setTitle] = useState("")
    const [description, setDescription] = useState("")
    const [category, setCategory] = useState("development")
    const [price, setPrice] = useState("")
    const [deliveryDays, setDeliveryDays] = useState("7")
    const [tags, setTags] = useState("")

    useEffect(() => {
        const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
        document.addEventListener("keydown", h)
        return () => document.removeEventListener("keydown", h)
    }, [onClose])

    const canSubmit = title.trim() && parseInt(price) > 0

    const handleSubmit = async () => {
        if (!canSubmit) return
        setSubmitting(true)
        try {
            await api.createServiceListing({
                authToken: token,
                title: title.trim(),
                description: description.trim(),
                category,
                price: BigInt(price),
                deliveryDays: parseInt(deliveryDays) || 7,
                tags: tags.trim(),
            })
            onPosted()
        } catch (e) {
            onError(e instanceof Error ? e.message : "Failed to post service")
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="fl-modal-overlay" onClick={onClose}>
            <div className="fl-modal" onClick={e => e.stopPropagation()}>
                <div className="fl-modal__header">
                    <h2>Post a Service</h2>
                    <button className="fl-modal__close" onClick={onClose}>×</button>
                </div>
                <div className="fl-modal__body">
                    <label className="fl-field">
                        <span>Title *</span>
                        <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="What do you offer?" maxLength={200} />
                    </label>
                    <label className="fl-field">
                        <span>Description</span>
                        <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe your service..." maxLength={2000} rows={3} />
                    </label>
                    <label className="fl-field">
                        <span>Category</span>
                        <select value={category} onChange={e => setCategory(e.target.value)}>
                            {SERVICE_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
                        </select>
                    </label>
                    <div className="fl-field-row">
                        <label className="fl-field">
                            <span>Price (ugnot) *</span>
                            <input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="1000000" min={1} />
                            {parseInt(price) > 0 && <span className="fl-field__hint">{(parseInt(price) / 1_000_000).toFixed(2)} GNOT</span>}
                        </label>
                        <label className="fl-field">
                            <span>Delivery (days)</span>
                            <input type="number" value={deliveryDays} onChange={e => setDeliveryDays(e.target.value)} min={1} max={365} />
                        </label>
                    </div>
                    <label className="fl-field">
                        <span>Tags (comma-separated)</span>
                        <input type="text" value={tags} onChange={e => setTags(e.target.value)} placeholder="gno, realm, audit" />
                    </label>
                    <div className="fl-modal__actions">
                        <button className="fl-btn fl-btn--cancel" onClick={onClose} disabled={submitting}>Cancel</button>
                        <button className="fl-btn fl-btn--create" onClick={handleSubmit} disabled={!canSubmit || submitting}>
                            {submitting ? "Posting..." : "Post Service"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ── Hire from Listing ───────────────────────────────────────

function HireFromListing({ listing, address, onClose, onCreated, onError }: {
    listing: ServiceListing
    address: string
    onClose: () => void
    onCreated: () => void
    onError: (msg: string) => void
}) {
    const [submitting, setSubmitting] = useState(false)
    const [title, setTitle] = useState(`Contract: ${listing.title}`)
    const [description, setDescription] = useState("")
    const [milestones, setMilestones] = useState([
        { title: listing.title, amount: String(listing.price) },
    ])

    const addMilestone = () => {
        if (milestones.length >= 20) return
        setMilestones(prev => [...prev, { title: "", amount: "" }])
    }
    const removeMilestone = (idx: number) => {
        if (milestones.length <= 1) return
        setMilestones(prev => prev.filter((_, i) => i !== idx))
    }
    const updateMilestone = (idx: number, field: "title" | "amount", value: string) => {
        if (field === "title") value = value.replace(/[,:]/g, "")
        setMilestones(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m))
    }

    const milestonesStr = milestones.filter(m => m.title.trim() && m.amount).map(m => `${m.title.trim()}:${m.amount}`).join(",")
    const totalUgnot = milestones.reduce((sum, m) => sum + (parseInt(m.amount) || 0), 0)
    const canSubmit = title.trim() && milestonesStr.length > 0

    const handleSubmit = async () => {
        if (!canSubmit) return
        setSubmitting(true)
        try {
            await doContractBroadcast(
                [buildCreateContractMsg(address, ESCROW_PATH, listing.address, title.trim(), description.trim(), milestonesStr)],
                "Create Escrow Contract",
            )
            onCreated()
        } catch (e) {
            onError(e instanceof Error ? e.message : "Contract creation failed")
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="fl-hire-view">
            <button className="fl-back" onClick={onClose}>← Back to Services</button>
            <h2>Hire: {listing.title}</h2>
            <p className="fl-hire-meta">
                Freelancer: {listing.address.slice(0, 13)}... · Suggested price: {(Number(listing.price) / 1_000_000).toFixed(1)} GNOT
            </p>

            <label className="fl-field">
                <span>Contract Title</span>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)} maxLength={200} />
            </label>
            <label className="fl-field">
                <span>Description</span>
                <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe what you need..." maxLength={5000} rows={3} />
            </label>

            <div className="fl-field">
                <span>Milestones</span>
                {milestones.map((ms, idx) => (
                    <div key={idx} className="fl-milestone-input">
                        <input type="text" value={ms.title} onChange={e => updateMilestone(idx, "title", e.target.value)} placeholder="Milestone title" />
                        <input type="number" value={ms.amount} onChange={e => updateMilestone(idx, "amount", e.target.value)} placeholder="ugnot" min={1} />
                        {milestones.length > 1 && <button className="fl-milestone-remove" onClick={() => removeMilestone(idx)}>×</button>}
                    </div>
                ))}
                <button className="fl-milestone-add" onClick={addMilestone} disabled={milestones.length >= 20}>+ Add Milestone</button>
                {totalUgnot > 0 && <div className="fl-milestone-total">Total: {(totalUgnot / 1_000_000).toFixed(2)} GNOT</div>}
            </div>

            <div className="fl-modal__actions">
                <button className="fl-btn fl-btn--cancel" onClick={onClose} disabled={submitting}>Cancel</button>
                <button className="fl-btn fl-btn--create" onClick={handleSubmit} disabled={!canSubmit || submitting}>
                    {submitting ? "Creating..." : "Create Escrow Contract"}
                </button>
            </div>
        </div>
    )
}

// ── My Contracts Tab ────────────────────────────────────────

function MyContractsTab({ adena, onError }: {
    adena: LayoutContext["adena"]
    onError: (msg: string) => void
}) {
    const [contracts, setContracts] = useState<EscrowContract[]>([])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [detail, setDetail] = useState<ContractDetail | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchContracts().then(setContracts).finally(() => setLoading(false))
    }, [])

    const myContracts = useMemo(() => {
        if (!adena.connected) return contracts
        return contracts.filter(c => c.client === adena.address || c.freelancer === adena.address)
    }, [contracts, adena.connected, adena.address])

    const handleSelect = useCallback(async (id: string) => {
        setSelectedId(id)
        setDetail(null)
        setDetail(await fetchContractDetail(id))
    }, [])

    const reload = useCallback(async () => {
        const cs = await fetchContracts()
        setContracts(cs)
        if (selectedId) setDetail(await fetchContractDetail(selectedId))
    }, [selectedId])

    if (selectedId && detail) {
        return (
            <ContractDetailView
                detail={detail} adena={adena} onError={onError}
                onBack={() => { setSelectedId(null); setDetail(null) }}
                onReload={reload}
            />
        )
    }

    if (!adena.connected) {
        return (
            <div className="fl-empty">
                <span className="fl-empty__icon">🔒</span>
                <p>Connect your wallet to see your contracts.</p>
            </div>
        )
    }

    return (
        <>
            <div className="fl-count">
                {loading ? "Loading..." : `${myContracts.length} contract${myContracts.length !== 1 ? "s" : ""}`}
            </div>
            {!loading && myContracts.length === 0 ? (
                <div className="fl-empty">
                    <span className="fl-empty__icon">📋</span>
                    <p>No contracts yet. Hire a freelancer from the Services tab to get started.</p>
                </div>
            ) : (
                <div className="fl-grid">
                    {myContracts.map(c => (
                        <button key={c.id} className="fl-card" onClick={() => handleSelect(c.id)}>
                            <div className="fl-card__top">
                                <div className="fl-card__header">
                                    <div className="fl-card__title">{c.title}</div>
                                    <div className="fl-card__seller">
                                        {c.client === adena.address ? "You hired" : "You're freelancing"} · {c.client === adena.address ? c.freelancer.slice(0, 10) : c.client.slice(0, 10)}...
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
        </>
    )
}

// ── Contract Detail View ────────────────────────────────────

function ContractDetailView({ detail, adena, onError, onBack, onReload }: {
    detail: ContractDetail
    adena: LayoutContext["adena"]
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
        <>
            <button className="fl-back" onClick={onBack}>← Back to My Contracts</button>
            <div className="fl-detail">
                <h2 className="fl-detail__title">{detail.title}</h2>
                <div className="fl-detail__meta">
                    <span className={`fl-status fl-status--${detail.status}`}>{detail.status}</span>
                    <span>{isClient ? "You're the client" : isFreelancer ? "You're the freelancer" : "Observer"}</span>
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
                                        act("Fund", () => buildFundMilestoneMsg(adena.address, ESCROW_PATH, detail.id, idx, ms.amount))
                                    }>Fund</button>
                                )}
                                {isFreelancer && ms.status === "funded" && (
                                    <button className="fl-btn fl-btn--complete" disabled={acting} onClick={() =>
                                        act("Complete", () => buildCompleteMilestoneMsg(adena.address, ESCROW_PATH, detail.id, idx))
                                    }>Mark Complete</button>
                                )}
                                {isClient && ms.status === "completed" && (
                                    <button className="fl-btn fl-btn--release" disabled={acting} onClick={() =>
                                        act("Release", () => buildReleaseFundsMsg(adena.address, ESCROW_PATH, detail.id, idx))
                                    }>Release Funds</button>
                                )}
                                {(isClient || isFreelancer) && (ms.status === "funded" || ms.status === "completed") && (
                                    <button className="fl-btn fl-btn--dispute" disabled={acting} onClick={() =>
                                        act("Dispute", () => buildRaiseDisputeMsg(adena.address, ESCROW_PATH, detail.id, idx))
                                    }>Dispute</button>
                                )}
                                {adena.connected && ms.status === "funded" && ms.fundedAt && (
                                    <button className="fl-btn fl-btn--cancel" disabled={acting} onClick={() =>
                                        act("Refund", () => buildClaimRefundMsg(adena.address, ESCROW_PATH, detail.id, idx))
                                    }>Claim Refund</button>
                                )}
                                {adena.connected && ms.status === "disputed" && ms.disputedAt && (
                                    <button className="fl-btn fl-btn--release" disabled={acting} onClick={() =>
                                        act("Auto-resolve", () => buildClaimDisputeTimeoutMsg(adena.address, ESCROW_PATH, detail.id, idx))
                                    }>Auto-resolve</button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                {isClient && detail.status === "active" && (
                    <button className="fl-btn fl-btn--cancel" disabled={acting} onClick={() =>
                        act("Cancel", () => buildCancelContractMsg(adena.address, ESCROW_PATH, detail.id))
                    }>Cancel Contract</button>
                )}
            </div>
        </>
    )
}

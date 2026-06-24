/** ValoperDetail — in-app profile for one registered valoper, at
 *  /:network/validators/valoper/:operatorAddress. In-app (not a gnoweb bounce)
 *  so it can't regress to a wrong external host; gnoweb is a secondary link. */
import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useLocation, useParams } from "react-router-dom"
import { Copy, CheckCircle } from "@phosphor-icons/react"
import { GNO_RPC_URL, GNO_CHAIN_ID } from "../lib/config"
import { queryRender } from "../lib/dao/shared"
import {
    VALOPERS_REALM,
    parseValoperDetail,
    computeValoperStatus,
    valoperGnowebBase,
    type ValoperWithStatus,
} from "../lib/valopers"
import { getValidators } from "../lib/validators"
import { useNetworkPath } from "../hooks/useNetworkNav"
import "./validator-detail.css"
import "./valoper-detail.css"

const SERVER_TYPE_LABEL: Record<string, string> = {
    "cloud": "Cloud",
    "on-prem": "On-prem",
    "data-center": "Data center",
}

function CopyBtn({ text }: { text: string }) {
    const [copied, setCopied] = useState(false)
    return (
        <button
            className="vd-copy"
            title="Copy to clipboard"
            aria-label="Copy"
            onClick={() => {
                navigator.clipboard.writeText(text).catch(() => {})
                setCopied(true)
                setTimeout(() => setCopied(false), 1400)
            }}
        >
            {copied ? <CheckCircle size={13} weight="fill" /> : <Copy size={13} />}
        </button>
    )
}

function AddrRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
    if (!value) return null
    return (
        <div className="vd-row">
            <span className="vd-row__label">
                {label}
                {hint && <span className="vp-row__hint"> · {hint}</span>}
            </span>
            <span className="vd-row__value vd-mono">
                {value}
                <CopyBtn text={value} />
            </span>
        </div>
    )
}

export default function ValoperDetail() {
    const { operatorAddress } = useParams<{ operatorAddress: string }>()
    const location = useLocation()
    const np = useNetworkPath()
    const preset = (location.state as { valoper?: ValoperWithStatus } | null)?.valoper ?? null

    const [valoper, setValoper] = useState<ValoperWithStatus | null>(preset)
    const [loading, setLoading] = useState(!preset)
    const [notFound, setNotFound] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const abortRef = useRef<AbortController | null>(null)

    const load = useCallback(async () => {
        if (!operatorAddress) return
        abortRef.current?.abort()
        const ctrl = new AbortController()
        abortRef.current = ctrl
        try {
            const raw = await queryRender(GNO_RPC_URL, VALOPERS_REALM, operatorAddress)
            if (ctrl.signal.aborted) return
            const detail = raw ? parseValoperDetail(raw) : null
            if (!detail) {
                setNotFound(true)
                setLoading(false)
                return
            }
            const vals = await getValidators(GNO_RPC_URL)
            if (ctrl.signal.aborted) return
            const active = new Set(vals.map(v => v.gnoAddr))
            setValoper({ ...detail, status: computeValoperStatus(detail.signingAddress, active) })
            setLoading(false)
        } catch (e) {
            if (!ctrl.signal.aborted) {
                setError(e instanceof Error ? e.message : "Failed to load valoper")
                setLoading(false)
            }
        }
    }, [operatorAddress])

    useEffect(() => {
        // load() only sets state after an await (async fetch), not synchronously — this
        // is a fetch-on-mount, so the rule's "synchronous setState" warning is a false
        // positive here (it flags the transitive setState inside load).
        // eslint-disable-next-line react-hooks/set-state-in-effect
        load()
        return () => abortRef.current?.abort()
    }, [load])

    useEffect(() => {
        document.title = valoper?.moniker ? `${valoper.moniker} — Valoper — Memba` : "Valoper — Memba"
        return () => { document.title = "Memba" }
    }, [valoper?.moniker])

    const gnowebUrl = operatorAddress ? `${valoperGnowebBase()}/r/gnops/valopers:${operatorAddress}` : "#"

    // ── loading ──
    if (loading) {
        return (
            <div className="vd-page">
                <div className="vd-nav">
                    <Link to={np("validators")} className="vd-back">← Validators</Link>
                </div>
                <div className="vd-loading">
                    <span className="hk-pulse" />
                    <span>Loading valoper…</span>
                </div>
            </div>
        )
    }

    // ── error ──
    if (error && !valoper) {
        return (
            <div className="vd-page">
                <div className="vd-nav">
                    <Link to={np("validators")} className="vd-back">← Validators</Link>
                </div>
                <div className="vd-notfound">
                    <span className="vd-notfound__icon">⚠</span>
                    <h2>Failed to load valoper</h2>
                    <p className="vd-mono">{error}</p>
                    <button
                        onClick={() => { setError(null); setLoading(true); void load() }}
                        className="vd-btn-back"
                        style={{ marginTop: 12 }}
                    >
                        Retry
                    </button>
                </div>
            </div>
        )
    }

    // ── not found ──
    if (notFound || !valoper) {
        return (
            <div className="vd-page">
                <div className="vd-nav">
                    <Link to={np("validators")} className="vd-back">← Validators</Link>
                </div>
                <div className="vd-notfound">
                    <span className="vd-notfound__icon">⚠</span>
                    <h2>Valoper not found</h2>
                    <p className="vd-mono">{operatorAddress}</p>
                    <p>No valoper is registered at this operator address on <strong>{GNO_CHAIN_ID}</strong>.</p>
                    <Link to={np("validators")} className="vd-btn-back">← Back to Validators</Link>
                </div>
            </div>
        )
    }

    // ── detail ──
    return (
        <div className="vd-page" data-testid="valoper-detail-page">
            <div className="vd-nav">
                <Link to={np("validators")} className="vd-back">← Validators</Link>
                <span className="vd-nav__sep">/</span>
                <span className="vd-nav__current">{valoper.moniker}</span>
                <span className="vd-nav__chain">{GNO_CHAIN_ID}</span>
            </div>

            <div className="vd-header-card">
                <div className="vd-header-card__left">
                    <div className="vd-header-card__info">
                        <h1 className="vd-moniker">{valoper.moniker}</h1>
                        {valoper.serverType && (
                            <span className="vp-server">{SERVER_TYPE_LABEL[valoper.serverType] ?? valoper.serverType}</span>
                        )}
                    </div>
                </div>
                <div className="vd-header-card__right">
                    <span className={`vd-badge val-valoper-status--${valoper.status}`}>
                        {valoper.status === "active" ? "● Active" : "○ Candidate"}
                    </span>
                </div>
            </div>

            {valoper.description && (
                <div className="vd-card">
                    <p className="vp-desc">{valoper.description}</p>
                </div>
            )}

            <div className="vd-card">
                <div className="vd-card__title">🪪 Identity</div>
                <AddrRow label="Operator address" value={valoper.operatorAddress} hint="stable identity" />
                <AddrRow label="Signing address" value={valoper.signingAddress} hint="rotatable consensus key" />
                <AddrRow label="Signing pubkey" value={valoper.signingPubKey} />
                <p className="vp-identity-note">
                    The <strong>operator address</strong> is the valoper's permanent identity; the{" "}
                    <strong>signing address</strong> is the consensus key it currently validates with, and can rotate
                    without changing identity.
                </p>
            </div>

            <div className="vd-card vd-links">
                <div className="vd-card__title">🔗 Links</div>
                <a href={gnowebUrl} target="_blank" rel="noopener noreferrer" className="vd-ext-link">
                    <span>🌐 View on gnoweb (r/gnops/valopers)</span>
                    <span className="vd-ext-link__arrow">↗</span>
                </a>
                <Link to={np("validators")} className="vd-ext-link">
                    <span>← All Validators</span>
                    <span className="vd-ext-link__arrow">→</span>
                </Link>
            </div>
        </div>
    )
}

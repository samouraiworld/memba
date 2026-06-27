/**
 * CreateCollectionLaunchpad — Phase 2, Model A launchpad.
 *
 * Registers a new collection INTO the shared `memba_collections` registry
 * (centrally tradable). One CreateCollection MsgCall (pays the 1 GNOT create fee);
 * mint-phase config + minting happen afterward on the created collection.
 *
 * AAA rework (Phase A2): a sectioned form (Identity / Royalty / Supply) beside a live
 * preview card that updates as you type, plain-language validation, and honest
 * "permanent" framing — replacing the flat, off-brand single-column form.
 *
 * Route: /nft/create
 *
 * @module pages/CreateCollectionLaunchpad
 */

import { useState, useMemo, useEffect, useCallback } from "react"
import { useOutletContext, Link } from "react-router-dom"
import { useNetworkPath } from "../hooks/useNetworkNav"
import { ComingSoonGate } from "../components/ui/ComingSoonGate"
import { NFTMedia } from "../components/nft/NFTMedia"
import { isNftEnabled, isNftLaunchpadValid } from "../lib/config"
import { NFT_COLLECTIONS_PATH, PLATFORM_FEE_BPS_V3 } from "../lib/nftConfig"
import {
    buildCreateCollectionMsg,
    isValidSlug,
    deriveCollectionID,
    CREATE_FEE_UGNOT,
    DEFAULT_ROYALTY_BPS,
    MAX_ROYALTY_BPS,
    ROYALTY_SENTINEL,
} from "../lib/launchpad"
import type { LayoutContext } from "../types/layout"
import "./create-collection.css"

const FEE_GNOT = CREATE_FEE_UGNOT / 1_000_000

export function CreateCollectionLaunchpad() {
    if (!isNftEnabled()) {
        return (
            <ComingSoonGate
                title="Launch a collection"
                icon="🖼️"
                description="Launch an NFT collection on Memba — instantly tradable on the marketplace, with enforced creator royalties."
                features={[
                    "Open, permissionless collection launch",
                    "Public + allowlist mint phases",
                    "Enforced on-chain royalties on every sale",
                    "Centrally tradable — no separate realm to deploy",
                ]}
            />
        )
    }
    return <CreateCollectionContent />
}

function CreateCollectionContent() {
    const { adena } = useOutletContext<LayoutContext>()
    const np = useNetworkPath()
    const connectedAddress = adena?.address || ""

    const [slug, setSlug] = useState("")
    const [name, setName] = useState("")
    const [symbol, setSymbol] = useState("")
    const [useDefaultRoyalty, setUseDefaultRoyalty] = useState(true)
    const [royaltyPct, setRoyaltyPct] = useState("5")
    const [royaltyRecip, setRoyaltyRecip] = useState("")
    const [mintCustody, setMintCustody] = useState("")
    const [maxSupply, setMaxSupply] = useState("0")
    const [maxPerWallet, setMaxPerWallet] = useState("0")

    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [createdId, setCreatedId] = useState<string | null>(null)

    useEffect(() => {
        document.title = "Launch a collection — Memba"
    }, [])

    // Realm not deployed on this network yet → don't let users sign a doomed tx.
    const launchpadLive = isNftLaunchpadValid()

    const royaltyBps = useMemo(() => {
        if (useDefaultRoyalty) return ROYALTY_SENTINEL
        const pct = parseFloat(royaltyPct)
        if (Number.isNaN(pct) || pct < 0) return 0
        return Math.min(Math.round(pct * 100), MAX_ROYALTY_BPS)
    }, [useDefaultRoyalty, royaltyPct])

    const slugOk = isValidSlug(slug)
    const collectionID = connectedAddress && slugOk ? deriveCollectionID(connectedAddress, slug) : ""
    const formValid = slugOk && name.trim() !== "" && symbol.trim() !== "" && connectedAddress !== ""

    // Plain-language royalty for the preview + sample (the on-chain value uses the sentinel).
    const royaltyDisplayPct = useDefaultRoyalty
        ? DEFAULT_ROYALTY_BPS / 100
        : Math.min(Math.max(parseFloat(royaltyPct) || 0, 0), MAX_ROYALTY_BPS / 100)

    const disabledReason = !connectedAddress
        ? "Connect your wallet to launch."
        : !name.trim()
          ? "Add a collection name."
          : !slugOk
            ? "Add a valid URL slug."
            : !symbol.trim()
              ? "Add a symbol."
              : !launchpadLive
                ? "The launchpad isn't live on this network yet."
                : ""

    const onSubmit = useCallback(async () => {
        setError(null)
        if (!formValid) {
            setError("Fill in a valid slug, name, and symbol, and connect your wallet.")
            return
        }
        setSubmitting(true)
        try {
            const msg = buildCreateCollectionMsg(connectedAddress, NFT_COLLECTIONS_PATH, {
                slug,
                name: name.trim(),
                symbol: symbol.trim(),
                royaltyBPS: royaltyBps,
                royaltyRecip: royaltyRecip.trim(),
                mintCustody: mintCustody.trim(),
                maxSupply: Math.max(0, parseInt(maxSupply, 10) || 0),
                maxPerWallet: Math.max(0, parseInt(maxPerWallet, 10) || 0),
            })
            const { doContractBroadcast } = await import("../lib/grc20")
            await doContractBroadcast([msg], `Launch collection: ${slug}`)
            setCreatedId(deriveCollectionID(connectedAddress, slug))
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to launch collection")
        } finally {
            setSubmitting(false)
        }
    }, [formValid, connectedAddress, slug, name, symbol, royaltyBps, royaltyRecip, mintCustody, maxSupply, maxPerWallet])

    // ── Success ──────────────────────────────────────────────────────────
    if (createdId) {
        return (
            <div className="lp">
                <div className="lp-success">
                    <div className="lp-success__cover">
                        <NFTMedia uri="" alt={name || createdId} seed={createdId} />
                    </div>
                    <h1 className="lp-title">Collection launched</h1>
                    <p className="lp-subtitle">
                        <code>{createdId}</code> is live in the Memba registry. Set its mint phase and price next, then
                        mint or open it to the public.
                    </p>
                    <div className="lp-success__actions">
                        <Link className="lp-cta" to={np(`nft/studio/${createdId}`)}>
                            Set up minting
                        </Link>
                        <Link className="lp-cta lp-cta--ghost" to={np(`nft/collection/${createdId}`)}>
                            View collection
                        </Link>
                    </div>
                </div>
            </div>
        )
    }

    // ── Form ─────────────────────────────────────────────────────────────
    return (
        <div className="lp">
            <header className="lp-header">
                <h1 className="lp-title">Launch a collection</h1>
                <p className="lp-subtitle">
                    Register a collection into the Memba registry — instantly tradable, with enforced creator
                    royalties. Launch fee <strong>{FEE_GNOT} GNOT</strong>.
                </p>
            </header>

            {!launchpadLive && (
                <div className="lp-warning" role="status">
                    The launchpad registry isn't live on this network yet. You can prepare your collection below;
                    submission unlocks once <code>memba_collections</code> is deployed.
                </div>
            )}

            <div className="lp-grid">
                {/* ── Form ── */}
                <div className="lp-form">
                    <section className="lp-section">
                        <p className="lp-section__title">Identity</p>
                        <div className="lp-field">
                            <label htmlFor="lp-name">Name</label>
                            <input id="lp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Memba Genesis" />
                        </div>
                        <div className="lp-row">
                            <div className="lp-field" style={{ flex: 1 }}>
                                <label htmlFor="lp-slug">URL slug</label>
                                <input
                                    id="lp-slug"
                                    value={slug}
                                    onChange={(e) => setSlug(e.target.value.toLowerCase())}
                                    placeholder="memba-genesis"
                                    maxLength={64}
                                />
                            </div>
                            <div className="lp-field" style={{ width: 120 }}>
                                <label htmlFor="lp-symbol">Symbol</label>
                                <input id="lp-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="MGEN" maxLength={16} />
                            </div>
                        </div>
                        {slug !== "" && !slugOk && (
                            <small className="lp-error">Use lowercase letters, numbers, and hyphens only.</small>
                        )}
                        {collectionID && (
                            <small className="lp-hint">Collection ID <code>{collectionID}</code> · permanent</small>
                        )}
                    </section>

                    <section className="lp-section">
                        <p className="lp-section__title">Royalty</p>
                        <label className="lp-check">
                            <input type="checkbox" checked={useDefaultRoyalty} onChange={(e) => setUseDefaultRoyalty(e.target.checked)} />
                            Use the Memba default ({DEFAULT_ROYALTY_BPS / 100}%)
                        </label>
                        {!useDefaultRoyalty && (
                            <div className="lp-field">
                                <label htmlFor="lp-royalty">Creator royalty (%)</label>
                                <input
                                    id="lp-royalty"
                                    type="number"
                                    min="0"
                                    max={MAX_ROYALTY_BPS / 100}
                                    step="0.25"
                                    value={royaltyPct}
                                    onChange={(e) => setRoyaltyPct(e.target.value)}
                                />
                            </div>
                        )}
                        <small className="lp-hint">
                            On a 100 GNOT sale you earn <strong>{royaltyDisplayPct} GNOT</strong> · enforced atomically on
                            every secondary sale (max {MAX_ROYALTY_BPS / 100}%).
                        </small>
                    </section>

                    <section className="lp-section">
                        <p className="lp-section__title">Supply</p>
                        <div className="lp-row">
                            <div className="lp-field" style={{ flex: 1 }}>
                                <label htmlFor="lp-max">Max supply</label>
                                <input id="lp-max" type="number" min="0" value={maxSupply} onChange={(e) => setMaxSupply(e.target.value)} />
                            </div>
                            <div className="lp-field" style={{ flex: 1 }}>
                                <label htmlFor="lp-perwallet">Max per wallet</label>
                                <input id="lp-perwallet" type="number" min="0" value={maxPerWallet} onChange={(e) => setMaxPerWallet(e.target.value)} />
                            </div>
                        </div>
                        <small className="lp-hint">0 = unlimited.</small>

                        <details className="lp-advanced">
                            <summary>Advanced — custody</summary>
                            <div className="lp-field">
                                <label htmlFor="lp-recip">Royalty recipient (blank = you)</label>
                                <input id="lp-recip" value={royaltyRecip} onChange={(e) => setRoyaltyRecip(e.target.value)} placeholder={connectedAddress || "g1…"} />
                            </div>
                            <div className="lp-field">
                                <label htmlFor="lp-custody">Mint-proceeds custody (blank = you)</label>
                                <input id="lp-custody" value={mintCustody} onChange={(e) => setMintCustody(e.target.value)} placeholder={connectedAddress || "g1…"} />
                            </div>
                        </details>
                    </section>

                    {error && <div className="lp-error" role="alert">{error}</div>}

                    <button className="lp-cta lp-cta--block" disabled={!formValid || submitting || !launchpadLive} onClick={onSubmit}>
                        {submitting ? "Launching…" : `Launch collection · ${FEE_GNOT} GNOT`}
                    </button>
                    {disabledReason && <small className="lp-hint lp-hint--center">{disabledReason}</small>}
                    <p className="lp-fineprint">Slug, symbol, and royalty are permanent once launched.</p>
                </div>

                {/* ── Live preview ── */}
                <aside className="lp-aside">
                    <p className="lp-section__title">Live preview</p>
                    <div className="lp-preview" data-testid="create-preview">
                        <div className="lp-preview__cover">
                            <NFTMedia uri="" alt={name || "collection preview"} seed={collectionID || slug || name} />
                        </div>
                        <div className="lp-preview__body">
                            <div className="lp-preview__name">{name || "Untitled collection"}</div>
                            <div className="lp-preview__sym">{symbol || "—"}</div>
                            <div className="lp-preview__row"><span>Royalty</span><span>{royaltyDisplayPct}%</span></div>
                            <div className="lp-preview__row"><span>Max supply</span><span>{Number(maxSupply) > 0 ? maxSupply : "Unlimited"}</span></div>
                            <div className="lp-preview__row"><span>DAO fee</span><span>{(PLATFORM_FEE_BPS_V3 / 100).toFixed(1)}%</span></div>
                        </div>
                    </div>
                    <p className="lp-hint">Auto-generated cover until you upload art. Updates as you type.</p>
                </aside>
            </div>
        </div>
    )
}

export default CreateCollectionLaunchpad

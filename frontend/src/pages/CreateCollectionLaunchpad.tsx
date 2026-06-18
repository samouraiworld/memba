/**
 * CreateCollectionLaunchpad — Phase 2, Model A launchpad.
 *
 * Registers a new collection INTO the shared `memba_collections` registry
 * (centrally tradable), as opposed to the legacy code-gen wizard that emits a
 * standalone realm. One CreateCollection MsgCall (pays the 1 GNOT create fee);
 * mint-phase config + minting happen afterward on the created collection.
 *
 * Route: /nft/create (replaces the legacy NFTLaunchpad wizard).
 *
 * @module pages/CreateCollectionLaunchpad
 */

import { useState, useMemo, useEffect, useCallback } from "react"
import { useOutletContext } from "react-router-dom"
import { ComingSoonGate } from "../components/ui/ComingSoonGate"
import { isNftLaunchpadValid } from "../lib/config"
import { NFT_COLLECTIONS_PATH } from "../lib/nftConfig"
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
import "./nft-launchpad.css"

const NFT_ENABLED = import.meta.env.VITE_ENABLE_NFT === "true"

export function CreateCollectionLaunchpad() {
    if (!NFT_ENABLED) {
        return (
            <ComingSoonGate
                title="Launch a Collection"
                icon="🚀"
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
        document.title = "Launch a Collection — Memba"
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

    if (createdId) {
        return (
            <div className="launchpad-page">
                <h1>🎉 Collection launched</h1>
                <p>
                    Your collection <code>{createdId}</code> is live in the Memba registry. Next, configure its mint
                    phase and price, then mint or open it to the public.
                </p>
                <a href={`#/nft/collection/${encodeURIComponent(createdId)}`}>Open collection →</a>
            </div>
        )
    }

    return (
        <div className="launchpad-page">
            <h1>🚀 Launch a Collection</h1>
            <p className="launchpad-subtitle">
                Register a collection into the Memba registry — instantly tradable on the marketplace, with enforced
                creator royalties. Launch fee: <strong>{CREATE_FEE_UGNOT / 1_000_000} GNOT</strong>.
            </p>

            {!launchpadLive && (
                <div className="launchpad-warning" role="status">
                    ⏳ The launchpad registry is not live on this network yet. You can prepare your collection below;
                    submission unlocks once <code>memba_collections</code> is deployed.
                </div>
            )}

            <label className="form-group">
                <span>Slug (permanent identity — lowercase, digits, hyphens)</span>
                <input
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase())}
                    placeholder="my-collection"
                    maxLength={64}
                />
                {slug !== "" && !slugOk && <small className="form-error">Must match ^[a-z0-9-]{"{1,64}"}$</small>}
                {collectionID && <small className="form-hint">Collection ID: <code>{collectionID}</code></small>}
            </label>

            <label className="form-group">
                <span>Name (display)</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Collection" />
            </label>

            <label className="form-group">
                <span>Symbol</span>
                <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="MYC" maxLength={16} />
            </label>

            <fieldset className="form-group">
                <legend>Creator royalty</legend>
                <label>
                    <input
                        type="checkbox"
                        checked={useDefaultRoyalty}
                        onChange={(e) => setUseDefaultRoyalty(e.target.checked)}
                    />
                    Use Memba default ({DEFAULT_ROYALTY_BPS / 100}%)
                </label>
                {!useDefaultRoyalty && (
                    <input
                        type="number"
                        min="0"
                        max={MAX_ROYALTY_BPS / 100}
                        step="0.25"
                        value={royaltyPct}
                        onChange={(e) => setRoyaltyPct(e.target.value)}
                    />
                )}
                <small className="form-hint">
                    Applied on every secondary sale (max {MAX_ROYALTY_BPS / 100}%). Enforced atomically by the market.
                </small>
            </fieldset>

            <details>
                <summary>Advanced</summary>
                <label className="form-group">
                    <span>Royalty recipient (blank = you)</span>
                    <input value={royaltyRecip} onChange={(e) => setRoyaltyRecip(e.target.value)} placeholder={connectedAddress || "g1…"} />
                </label>
                <label className="form-group">
                    <span>Mint-proceeds custody (blank = you)</span>
                    <input value={mintCustody} onChange={(e) => setMintCustody(e.target.value)} placeholder={connectedAddress || "g1…"} />
                </label>
                <label className="form-group">
                    <span>Max supply (0 = unlimited)</span>
                    <input type="number" min="0" value={maxSupply} onChange={(e) => setMaxSupply(e.target.value)} />
                </label>
                <label className="form-group">
                    <span>Max per wallet (0 = unlimited)</span>
                    <input type="number" min="0" value={maxPerWallet} onChange={(e) => setMaxPerWallet(e.target.value)} />
                </label>
            </details>

            {error && <div className="form-error" role="alert">{error}</div>}

            <button
                className="btn-primary"
                disabled={!formValid || submitting || !launchpadLive}
                onClick={onSubmit}
            >
                {submitting ? "Launching…" : `Launch (${CREATE_FEE_UGNOT / 1_000_000} GNOT)`}
            </button>
            {!connectedAddress && <small className="form-hint">Connect your wallet to launch.</small>}
        </div>
    )
}

export default CreateCollectionLaunchpad

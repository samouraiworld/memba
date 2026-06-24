/**
 * LegacyCollectionView — Read-only viewer for legacy v1 NFT collections.
 *
 * Renders the collection header (name/symbol/supply) and the sanitized
 * on-chain Render output. All mint, trade, list, offer, and approval
 * interactions are intentionally absent — v1 collections are read-only.
 *
 * Route: /nft/:realmPath (legacy catch-all, replacing NFTCollectionView)
 *
 * @module pages/LegacyCollectionView
 */

import { useState, useEffect } from "react"
import { useParams } from "react-router-dom"
import { getCollectionInfo, type NFTCollection } from "../lib/grc721"
import { queryRender } from "../lib/dao/shared"
import { GNO_RPC_URL, getExplorerBaseUrl } from "../lib/config"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import DOMPurify from "dompurify"
import "./marketplace-v2.css"
import "./nft-gallery.css"

// ── Component ─────────────────────────────────────────────────────────

export function LegacyCollectionView() {
    const { realmPath: encodedPath } = useParams<{ realmPath: string }>()
    const realmPath = encodedPath ? decodeURIComponent(encodedPath) : ""

    const [collection, setCollection] = useState<NFTCollection | null>(null)
    const [renderOutput, setRenderOutput] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!realmPath) return
        let cancelled = false
        const load = async () => {
            try {
                const [info, raw] = await Promise.all([
                    getCollectionInfo(realmPath),
                    queryRender(GNO_RPC_URL, realmPath, ""),
                ])
                if (!cancelled) {
                    setCollection(info)
                    setRenderOutput(raw)
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : "Failed to load collection.")
                }
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }
        load()
        return () => { cancelled = true }
    }, [realmPath])

    useEffect(() => {
        if (collection) document.title = `${collection.name} — NFT Gallery — Memba`
    }, [collection])

    if (!realmPath) {
        return <div className="nft-page animate-fade-in"><p>No collection path provided.</p></div>
    }

    if (loading) {
        return (
            <div className="nft-page animate-fade-in" data-testid="lcv-loading">
                <SkeletonCard /><SkeletonCard />
            </div>
        )
    }

    if (error) {
        return (
            <div className="nft-page animate-fade-in">
                <p className="mhub-error" role="alert">{error}</p>
            </div>
        )
    }

    const collectionName = collection?.name ?? realmPath.split("/").pop() ?? realmPath

    return (
        <div className="nft-page animate-fade-in">
            {/* Legacy read-only banner */}
            <div className="lcv-banner" role="status" aria-label="Legacy collection — read only">
                Legacy collection — read only
            </div>

            {/* Collection header */}
            <div className="nft-detail-header">
                <div>
                    <h1 className="nft-detail-name">{collectionName}</h1>
                    <div className="nft-detail-meta">
                        <span>{collection?.symbol ?? "NFT"}</span>
                        <span>{collection?.totalSupply ?? 0} items</span>
                        {collection?.royaltyPercent ? <span>{collection.royaltyPercent}% royalty</span> : null}
                        {collection?.creator && <span>by {collection.creator.slice(0, 10)}...</span>}
                    </div>
                </div>
                <a
                    href={`${getExplorerBaseUrl()}/${realmPath.replace("gno.land/", "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="nft-explorer-link"
                >
                    View on Explorer →
                </a>
            </div>

            {collection?.description && (
                <p className="nft-detail-desc">{collection.description}</p>
            )}

            {/* Render output (gallery) — sanitized exactly as NFTCollectionView did */}
            {renderOutput && (
                <div className="nft-render-section">
                    <h3 className="nft-section-title">On-Chain Gallery</h3>
                    {/* v6 SEC-05: DOMPurify runs AFTER markdown→HTML conversion.
                        Previously ran before, meaning regex replacements could
                        reintroduce HTML from DOMPurify's escaped output. */}
                    <div
                        className="nft-render-output"
                        dangerouslySetInnerHTML={{
                            __html: DOMPurify.sanitize(
                                renderOutput
                                    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
                                    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
                                    .replace(/^\*\*(.+?)\*\*$/gm, '<strong>$1</strong>')
                                    .replace(/\n/g, '<br/>'),
                            ),
                        }}
                    />
                </div>
            )}
        </div>
    )
}

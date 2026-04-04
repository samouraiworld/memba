/**
 * NFTGallery — NFT collection browser and minting interface.
 *
 * Phase 4b: Browse collections, view NFTs, mint new tokens.
 * Route: /nft (gallery) and /nft/:realmPath (collection detail)
 *
 * @module pages/NFTGallery
 */

import { useNetworkNav } from "../hooks/useNetworkNav"
import { useState, useEffect, useCallback } from "react"
import { useParams, useOutletContext } from "react-router-dom"
import { ArrowRight, Storefront, Clock } from "@phosphor-icons/react"
import {
    getCollectionInfo,
    type NFTCollection,
} from "../lib/grc721"
import { parseMarketplaceRender, type NFTListing } from "../lib/nftMarketplace"
import { NFT_NFT_MARKETPLACE_PATH } from "../lib/nftConfig"
import { queryRender } from "../lib/dao/shared"
import { GNO_RPC_URL, getExplorerBaseUrl } from "../lib/config"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { ComingSoonGate } from "../components/ui/ComingSoonGate"
import { NFTListingCard } from "../components/nft/NFTListingCard"
import { BuyNFTModal } from "../components/nft/BuyNFTModal"
import { MakeOfferModal } from "../components/nft/MakeOfferModal"
import { NFTActivityFeed } from "../components/nft/NFTActivityFeed"
import type { LayoutContext } from "../types/layout"
import "./nft-gallery.css"

// ── Seed Collections (well-known NFT realms) ─────────────────

const SEED_COLLECTIONS = [
    "gno.land/r/demo/art/grc721",
    "gno.land/r/demo/nft",
]

const NFT_ENABLED = import.meta.env.VITE_ENABLE_NFT === "true"

export function NFTGallery() {
    if (!NFT_ENABLED) {
        return (
            <ComingSoonGate
                title="NFT Gallery"
                icon="🎨"
                description="Browse, mint, and trade GRC721 NFTs on gno.land."
                features={[
                    "Browse GRC721 NFT collections on gno.land",
                    "Mint new NFTs with IPFS metadata",
                    "Collection-level statistics and royalty tracking",
                    "Cross-collection search and discovery",
                ]}
            />
        )
    }

    return <NFTGalleryContent />
}

type NFTTab = "gallery" | "marketplace" | "activity"

function NFTGalleryContent() {
    const navigate = useNetworkNav()
    const { auth, adena } = useOutletContext<LayoutContext>()
    const [tab, setTab] = useState<NFTTab>("gallery")
    const [collections, setCollections] = useState<NFTCollection[]>([])
    const [loading, setLoading] = useState(true)
    const [customPath, setCustomPath] = useState("")

    // Marketplace state
    const [listings, setListings] = useState<NFTListing[]>([])
    const [listingsLoading, setListingsLoading] = useState(false)
    const [buyModal, setBuyModal] = useState<NFTListing | null>(null)
    const [offerModal, setOfferModal] = useState<NFTListing | null>(null)

    useEffect(() => { document.title = "NFT Gallery — Memba" }, [])

    // Load collections for gallery tab
    useEffect(() => {
        let cancelled = false
        const load = async () => {
            const results: NFTCollection[] = []
            for (const path of SEED_COLLECTIONS) {
                const info = await getCollectionInfo(path)
                if (info && !cancelled) results.push(info)
            }
            if (!cancelled) {
                setCollections(results)
                setLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
    }, [])

    // Load marketplace listings when marketplace tab is selected
    useEffect(() => {
        if (tab !== "marketplace") return
        let cancelled = false
        setListingsLoading(true)
        const load = async () => {
            try {
                const raw = await queryRender(GNO_RPC_URL, NFT_MARKETPLACE_PATH, "")
                if (!cancelled && raw) {
                    const { listings: parsed } = parseMarketplaceRender(raw)
                    setListings(parsed)
                }
            } catch {
                // Marketplace realm may not be deployed yet
            } finally {
                if (!cancelled) setListingsLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
    }, [tab])

    const handleExplore = useCallback(async () => {
        if (!customPath.trim()) return
        const path = customPath.trim()
        navigate(`/nft/${encodeURIComponent(path)}`)
    }, [customPath, navigate])

    const refreshListings = async () => {
        try {
            const raw = await queryRender(GNO_RPC_URL, NFT_MARKETPLACE_PATH, "")
            if (raw) {
                const { listings: parsed } = parseMarketplaceRender(raw)
                setListings(parsed)
            }
        } catch { /* ignore */ }
        setBuyModal(null)
        setOfferModal(null)
    }

    return (
        <div className="nft-page animate-fade-in">
            <div className="nft-header">
                <div>
                    <h1>🎨 NFT Gallery</h1>
                    <p>Browse, mint, and trade GRC721 NFTs on gno.land</p>
                </div>
                {auth.isAuthenticated && (
                    <button className="nft-header__create" onClick={() => navigate("/nft/create")}>
                        + Create Collection
                    </button>
                )}
            </div>

            {/* Tabs */}
            <div className="nft-tabs">
                <button className={`nft-tab${tab === "gallery" ? " active" : ""}`} onClick={() => setTab("gallery")}>
                    🖼️ Gallery
                </button>
                <button className={`nft-tab${tab === "marketplace" ? " active" : ""}`} onClick={() => setTab("marketplace")}>
                    <Storefront size={14} /> Marketplace
                </button>
                <button className={`nft-tab${tab === "activity" ? " active" : ""}`} onClick={() => setTab("activity")}>
                    <Clock size={14} /> Activity
                </button>
            </div>

            {/* Gallery Tab */}
            {tab === "gallery" && (
                <>
                    <div className="nft-explore">
                        <input
                            type="text"
                            placeholder="Enter a realm path (e.g., gno.land/r/user/my_nft)..."
                            value={customPath}
                            onChange={e => setCustomPath(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && handleExplore()}
                            className="nft-explore__input"
                            aria-label="Explore NFT collection by realm path"
                        />
                        <button
                            className="nft-explore__btn"
                            onClick={handleExplore}
                            disabled={!customPath.trim()}
                        >
                            Explore →
                        </button>
                    </div>

                    <h2 className="nft-section-title">Collections</h2>

                    {loading ? (
                        <div className="nft-grid">
                            <SkeletonCard /><SkeletonCard /><SkeletonCard />
                        </div>
                    ) : collections.length === 0 ? (
                        <div className="nft-empty">
                            <span className="nft-empty__icon">🎨</span>
                            <p>No NFT collections found on this network.</p>
                            <p className="nft-empty__hint">Enter a realm path above to explore, or deploy your own collection.</p>
                        </div>
                    ) : (
                        <div className="nft-grid">
                            {collections.map(c => (
                                <button
                                    key={c.realmPath}
                                    className="nft-collection-card"
                                    onClick={() => navigate(`/nft/${encodeURIComponent(c.realmPath)}`)}
                                >
                                    <div className="nft-collection-card__icon">🖼️</div>
                                    <div className="nft-collection-card__body">
                                        <div className="nft-collection-card__name">{c.name}</div>
                                        <div className="nft-collection-card__symbol">{c.symbol}</div>
                                        <div className="nft-collection-card__stats">
                                            <span>{c.totalSupply} items</span>
                                            {c.royaltyPercent > 0 && <span>{c.royaltyPercent}% royalty</span>}
                                        </div>
                                    </div>
                                    <ArrowRight size={14} className="nft-collection-card__arrow" />
                                </button>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* Marketplace Tab */}
            {tab === "marketplace" && (
                <>
                    <h2 className="nft-section-title">Active Listings</h2>

                    {listingsLoading ? (
                        <div className="nft-grid">
                            <SkeletonCard /><SkeletonCard /><SkeletonCard />
                        </div>
                    ) : listings.length === 0 ? (
                        <div className="nft-empty">
                            <span className="nft-empty__icon">🏪</span>
                            <p>No active listings.</p>
                            <p className="nft-empty__hint">List your NFTs for sale or wait for sellers to post.</p>
                        </div>
                    ) : (
                        <div className="nft-grid">
                            {listings.map(l => (
                                <NFTListingCard
                                    key={`${l.nftRealm}:${l.tokenId}`}
                                    listing={l}
                                    connected={auth.isAuthenticated}
                                    currentAddress={adena.address}
                                    onBuy={setBuyModal}
                                    onMakeOffer={setOfferModal}
                                />
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* Activity Tab */}
            {tab === "activity" && (
                <>
                    <h2 className="nft-section-title">Recent Activity</h2>
                    <NFTActivityFeed />
                </>
            )}

            {/* Modals */}
            {buyModal && adena.address && (
                <BuyNFTModal
                    listing={buyModal}
                    callerAddress={adena.address}
                    onClose={() => setBuyModal(null)}
                    onSuccess={refreshListings}
                />
            )}
            {offerModal && adena.address && (
                <MakeOfferModal
                    listing={offerModal}
                    callerAddress={adena.address}
                    onClose={() => setOfferModal(null)}
                    onSuccess={refreshListings}
                />
            )}
        </div>
    )
}

// ── Collection Detail View ───────────────────────────────────

export function NFTCollectionView() {
    const { realmPath: encodedPath } = useParams<{ realmPath: string }>()
    const navigate = useNetworkNav()
    const { auth, adena } = useOutletContext<LayoutContext>()
    const realmPath = encodedPath ? decodeURIComponent(encodedPath) : ""

    const [collection, setCollection] = useState<NFTCollection | null>(null)
    const [renderOutput, setRenderOutput] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [mintForm, setMintForm] = useState({ tokenId: "", name: "", uri: "" })
    const [minting, setMinting] = useState(false)
    const [mintError, setMintError] = useState<string | null>(null)

    useEffect(() => {
        if (!realmPath) return
        let cancelled = false
        const load = async () => {
            const [info, raw] = await Promise.all([
                getCollectionInfo(realmPath),
                queryRender(GNO_RPC_URL, realmPath, ""),
            ])
            if (!cancelled) {
                setCollection(info)
                setRenderOutput(raw)
                setLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
    }, [realmPath])

    useEffect(() => {
        if (collection) document.title = `${collection.name} — NFT Gallery — Memba`
    }, [collection])

    const handleMint = async () => {
        if (!auth.isAuthenticated || !adena.address) return
        if (!mintForm.tokenId.trim() || !mintForm.name.trim()) return
        setMinting(true)
        setMintError(null)
        try {
            const { buildMintMsg } = await import("../lib/grc721")
            const { doContractBroadcast } = await import("../lib/grc20")
            const msg = buildMintMsg(adena.address, realmPath, adena.address, mintForm.tokenId.trim(), mintForm.uri.trim())
            await doContractBroadcast([msg], `Mint NFT: ${mintForm.name}`)
            setMintForm({ tokenId: "", name: "", uri: "" })
            // Refresh
            const raw = await queryRender(GNO_RPC_URL, realmPath, "")
            if (raw) setRenderOutput(raw)
            const info = await getCollectionInfo(realmPath)
            if (info) setCollection(info)
        } catch (err) {
            setMintError(err instanceof Error ? err.message : "Mint failed")
        } finally {
            setMinting(false)
        }
    }

    if (!realmPath) {
        return <div className="nft-page animate-fade-in"><p>No collection path provided.</p></div>
    }

    if (loading) {
        return (
            <div className="nft-page animate-fade-in">
                <SkeletonCard /><SkeletonCard />
            </div>
        )
    }

    return (
        <div className="nft-page animate-fade-in">
            <button className="nft-back" onClick={() => navigate("/nft")}>
                ← Back to Gallery
            </button>

            {/* Collection header */}
            <div className="nft-detail-header">
                <div>
                    <h1 className="nft-detail-name">{collection?.name || realmPath.split("/").pop()}</h1>
                    <div className="nft-detail-meta">
                        <span>{collection?.symbol || "NFT"}</span>
                        <span>{collection?.totalSupply || 0} items</span>
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

            {/* Mint form (when connected) */}
            {auth.isAuthenticated && (
                <div className="nft-mint-section">
                    <h3 className="nft-section-title">Mint NFT</h3>
                    <div className="nft-mint-form">
                        <input
                            type="text"
                            placeholder="Token ID (unique)"
                            value={mintForm.tokenId}
                            onChange={e => setMintForm(f => ({ ...f, tokenId: e.target.value }))}
                            className="nft-mint-input"
                        />
                        <input
                            type="text"
                            placeholder="Name"
                            value={mintForm.name}
                            onChange={e => setMintForm(f => ({ ...f, name: e.target.value }))}
                            className="nft-mint-input"
                        />
                        <input
                            type="text"
                            placeholder="Token URI (IPFS or HTTP)"
                            value={mintForm.uri}
                            onChange={e => setMintForm(f => ({ ...f, uri: e.target.value }))}
                            className="nft-mint-input"
                        />
                        <button
                            className="nft-mint-btn"
                            onClick={handleMint}
                            disabled={minting || !mintForm.tokenId.trim() || !mintForm.name.trim()}
                        >
                            {minting ? "Minting..." : "Mint"}
                        </button>
                    </div>
                    {mintError && (
                        <p className="nft-mint-error" role="alert">{mintError}</p>
                    )}
                </div>
            )}

            {/* Render output (gallery) */}
            {renderOutput && (
                <div className="nft-render-section">
                    <h3 className="nft-section-title">On-Chain Gallery</h3>
                    <pre className="nft-render-output">{renderOutput}</pre>
                </div>
            )}
        </div>
    )
}

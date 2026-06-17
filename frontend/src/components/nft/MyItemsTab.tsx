/**
 * MyItemsTab — Owned NFTs, active listings, offers sent/received.
 *
 * Data: primarily from GetNFTPortfolio (backend); falls back to scanning
 * listCollectionTokens for owned tokens when the endpoint is unavailable.
 *
 * Mobile: grid + modals are responsive via existing nft-gallery.css.
 */

import { useState, useEffect, useCallback } from "react"
import { fetchNFTPortfolio, type NFTPortfolioToken } from "../../lib/nftApi"
import { listCollectionTokens } from "../../lib/grc721"
import { NFT_COLLECTION_PATH, NFT_MARKETPLACE_PATH, DEFAULT_COLLECTION_ID } from "../../lib/nftConfig"
import { buildDelistMsg } from "../../lib/nftMarketplace"
import { NFTImage } from "./NFTImage"
import { formatGnot } from "../../lib/format"
import type { NFTTxState } from "./NFTTxToast"

interface Props {
    address: string
    onListForSale: (nftRealm: string, tokenId: string) => void
    onTxStart: (state: NFTTxState) => void
}

type MyTab = "owned" | "listings" | "offers-sent" | "offers-received"

export function MyItemsTab({ address, onListForSale, onTxStart }: Props) {
    const [subTab, setSubTab] = useState<MyTab>("owned")
    const [owned, setOwned] = useState<NFTPortfolioToken[]>([])
    const [loading, setLoading] = useState(true)

    const loadOwned = useCallback(async () => {
        setLoading(true)
        // Try backend first
        const portfolio = await fetchNFTPortfolio(address)
        if (portfolio.length > 0) {
            setOwned(portfolio)
            setLoading(false)
            return
        }
        // Fallback: scan on-chain tokens
        try {
            const tokens = await listCollectionTokens(NFT_COLLECTION_PATH, DEFAULT_COLLECTION_ID)
            setOwned(tokens
                .filter(t => t.owner === address)
                .map(t => ({
                    collectionId: DEFAULT_COLLECTION_ID,
                    tokenId: t.tokenId,
                    owner: t.owner,
                    uri: t.tokenURI ?? "",
                    listed: false,
                    priceUgnot: BigInt(0),
                })))
        } catch { /* ignore */ }
        setLoading(false)
    }, [address])

    useEffect(() => { loadOwned() }, [loadOwned])

    const ownedTokens = owned.filter(t => !t.listed)
    const myListings = owned.filter(t => t.listed)

    const handleDelist = async (tokenId: string) => {
        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            onTxStart({ status: "pending" })
            const msg = buildDelistMsg(address, NFT_MARKETPLACE_PATH, DEFAULT_COLLECTION_ID, tokenId)
            await doContractBroadcast([msg], `Delist: ${tokenId}`)
            onTxStart({ status: "success", message: "Delisted successfully" })
            loadOwned()
        } catch (err) {
            onTxStart({ status: "error", message: err instanceof Error ? err.message : "Delist failed" })
        }
    }

    const subTabLabels: Record<MyTab, string> = {
        "owned": "Owned",
        "listings": "My Listings",
        "offers-sent": "Offers Sent",
        "offers-received": "Offers Received",
    }

    return (
        <div className="nft-my-items">
            <div className="nft-my-tabs">
                {(["owned", "listings", "offers-sent", "offers-received"] as MyTab[]).map(t => (
                    <button
                        key={t}
                        className={`nft-my-tab${subTab === t ? " active" : ""}`}
                        onClick={() => setSubTab(t)}
                    >
                        {subTabLabels[t]}
                    </button>
                ))}
            </div>

            {loading && <p className="nft-activity__loading">Loading your NFTs…</p>}

            {!loading && subTab === "owned" && (
                ownedTokens.length === 0 ? (
                    <div className="nft-empty">
                        <span className="nft-empty__icon">🎨</span>
                        <p>No NFTs owned in the Genesis collection.</p>
                    </div>
                ) : (
                    <div className="nft-grid">
                        {ownedTokens.map(t => (
                            <div key={t.tokenId} className="nft-token-card">
                                <div className="nft-token-card__image-wrap">
                                    <NFTImage uri={t.uri} alt={`Token #${t.tokenId}`} className="nft-token-card__image" />
                                </div>
                                <div className="nft-token-card__body">
                                    <div className="nft-token-card__name">Token #{t.tokenId}</div>
                                </div>
                                <div className="nft-token-card__actions">
                                    <button
                                        className="nft-listing-card__buy"
                                        style={{ fontSize: 11 }}
                                        onClick={() => onListForSale(NFT_COLLECTION_PATH, t.tokenId)}
                                    >
                                        List for Sale
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )
            )}

            {!loading && subTab === "listings" && (
                myListings.length === 0 ? (
                    <div className="nft-empty">
                        <span className="nft-empty__icon">🏷️</span>
                        <p>No active listings.</p>
                    </div>
                ) : (
                    <div className="nft-grid">
                        {myListings.map(t => (
                            <div key={t.tokenId} className="nft-token-card">
                                <div className="nft-token-card__image-wrap">
                                    <NFTImage uri={t.uri} alt={`Token #${t.tokenId}`} className="nft-token-card__image" />
                                </div>
                                <div className="nft-token-card__body">
                                    <div className="nft-token-card__name">Token #{t.tokenId}</div>
                                    <div className="nft-token-card__price">{formatGnot(t.priceUgnot)}</div>
                                </div>
                                <div className="nft-token-card__actions">
                                    <button className="nft-listing-card__delist" onClick={() => handleDelist(t.tokenId)}>
                                        Delist
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )
            )}

            {!loading && (subTab === "offers-sent" || subTab === "offers-received") && (
                <div className="nft-empty">
                    <span className="nft-empty__icon">📋</span>
                    <p>Offer history requires the indexer endpoint.</p>
                    <p className="nft-empty__hint">This will populate once the backend is deployed.</p>
                </div>
            )}
        </div>
    )
}

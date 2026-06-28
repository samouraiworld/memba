/**
 * TokenDetail — the deep-linkable single-token page.
 *
 * Route: /nft/token/:creator/:slug/:tokenId  (collection id = "creator/slug").
 * Gives a token a shareable URL with large art, identity, owner, listing/offer state,
 * and every trade action (buy / list / delist / offer / cancel / accept) in one place —
 * the table-stakes surface the collection grid couldn't be.
 *
 * Reuses useCollectionPublic (already fetches the collection's tokens/listings/offers)
 * and picks out the one token, so there's no new data layer.
 *
 * @module pages/TokenDetail
 */

import { useState } from "react"
import { useParams, useOutletContext, Link } from "react-router-dom"
import { useNetworkPath } from "../hooks/useNetworkNav"
import { useCollectionPublic } from "./useCollectionPublic"
import { NFTMedia } from "../components/nft/NFTMedia"
import { TradeModal } from "../components/nft/TradeModal"
import { VerifiedBadge } from "../components/nft/VerifiedBadge"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import { EmptyState } from "../components/ui/EmptyState"
import { ComingSoonGate } from "../components/ui/ComingSoonGate"
import { formatGnotCompact } from "../lib/formatGnot"
import { listingKey } from "../lib/v3TokenGrid"
import { isNftEnabled, isNftMarketV3Valid } from "../lib/config"
import type { LayoutContext } from "../types/layout"
import "./marketplace-v2.css"
import "./token-detail.css"

interface ModalState {
    action: "buy" | "list" | "offer" | "accept" | "cancel" | "delist"
    priceUgnot?: number
    seller?: string
    buyerAddr?: string
}

function bestOffer(offers: { buyer: string; amountUgnot: number }[]) {
    return offers.reduce<{ buyer: string; amountUgnot: number } | null>(
        (best, o) => (best === null || o.amountUgnot > best.amountUgnot ? o : best),
        null,
    )
}

export function TokenDetail() {
    if (!isNftEnabled() || !isNftMarketV3Valid()) {
        return (
            <ComingSoonGate
                title="NFT Marketplace"
                icon="🖼️"
                description="Discover, buy, and sell GRC721 NFTs on gno.land — with enforced creator royalties."
                features={["Buy and list in one unified flow", "Enforced on-chain royalties", "Live floor + volume"]}
            />
        )
    }
    return <TokenDetailContent />
}

function TokenDetailContent() {
    const { creator, slug, tokenId } = useParams<{ creator: string; slug: string; tokenId: string }>()
    const id = creator && slug ? `${creator}/${slug}` : ""
    const tid = tokenId || ""
    const { adena } = useOutletContext<LayoutContext>()
    const me = adena?.address || ""
    const np = useNetworkPath()

    const { detail, tokens, listings, offers, verified, loading, error, reload } = useCollectionPublic(id, me)
    const [modal, setModal] = useState<ModalState | null>(null)

    if (loading) {
        return <div className="tkd"><p className="mhub-loading">Loading…</p></div>
    }
    if (error || !detail) {
        return <div className="tkd"><div className="mhub-error" role="alert">{error ?? "Collection not found."}</div></div>
    }

    const token = tokens.find((t) => t.tokenId === tid)
    if (!token) {
        return (
            <div className="tkd">
                <Link className="tkd-back" to={np(`nft/collection/${id}`)}>← {detail.name}</Link>
                <EmptyState icon="ti-help-circle" title="Token not found" body={`No token #${tid} in this collection.`} />
            </div>
        )
    }

    const listing = listings.get(listingKey(id, tid))
    const isOwner = me !== "" && token.owner === me
    const isListed = listing !== undefined
    const tokenOffers = offers.get(tid) ?? []
    const best = bestOffer(tokenOffers)
    const myOffer = me === "" ? undefined : tokenOffers.find((o) => o.buyer === me)

    const close = () => setModal(null)
    const onSuccess = () => {
        setModal(null)
        reload()
    }

    return (
        <div className="tkd">
            <Link className="tkd-back" to={np(`nft/collection/${id}`)}>← {detail.name}</Link>

            <div className="tkd-grid">
                <div className="tkd-art">
                    <NFTMedia uri={token.uri} alt={`${detail.name} #${tid}`} seed={`${id}/${tid}`} />
                </div>

                <div className="tkd-body">
                    <div className="tkd-title-row">
                        <h1 className="tkd-title">{detail.name} #{tid}</h1>
                        <VerifiedBadge verified={verified} />
                    </div>
                    <p className="tkd-owner">
                        Owned by{" "}
                        {isOwner ? <span className="tkd-you">you</span> : <CopyableAddress address={token.owner} compact fontSize={13} />}
                    </p>

                    <div className="tkd-price-card">
                        {isListed ? (
                            <>
                                <span className="tkd-price-label">Listed for</span>
                                <span className="tkd-price">{formatGnotCompact(listing!.priceUgnot)}</span>
                            </>
                        ) : (
                            <span className="tkd-price-label">Not listed</span>
                        )}
                        {best && (
                            <span className="tkd-bestoffer">
                                Best offer {formatGnotCompact(best.amountUgnot)}
                                {myOffer && best.buyer === me ? " · yours" : ""}
                            </span>
                        )}
                    </div>

                    {detail.royaltyBps > 0 && (
                        <p className="tkd-royalty">⬡ {detail.royaltyBps / 100}% creator royalty enforced on-chain</p>
                    )}

                    <div className="tkd-actions">
                        {me === "" ? (
                            <span className="cpub-wallet-hint">Connect wallet to trade</span>
                        ) : isOwner ? (
                            <>
                                {!isListed && <button className="tkd-btn" onClick={() => setModal({ action: "list" })}>List for sale</button>}
                                {isListed && <button className="tkd-btn tkd-btn--ghost" onClick={() => setModal({ action: "delist", priceUgnot: listing!.priceUgnot })}>Delist</button>}
                                {best && (
                                    <button className="tkd-btn tkd-btn--accept" onClick={() => setModal({ action: "accept", buyerAddr: best.buyer })}>
                                        Accept {formatGnotCompact(best.amountUgnot)}
                                    </button>
                                )}
                            </>
                        ) : (
                            <>
                                {isListed && (
                                    <button className="tkd-btn" onClick={() => setModal({ action: "buy", priceUgnot: listing!.priceUgnot, seller: listing!.seller })}>
                                        Buy for {formatGnotCompact(listing!.priceUgnot)}
                                    </button>
                                )}
                                {myOffer ? (
                                    <button className="tkd-btn tkd-btn--ghost" onClick={() => setModal({ action: "cancel", priceUgnot: myOffer.amountUgnot })}>
                                        Cancel offer ({formatGnotCompact(myOffer.amountUgnot)})
                                    </button>
                                ) : (
                                    !isListed && <button className="tkd-btn" onClick={() => setModal({ action: "offer" })}>Make offer</button>
                                )}
                            </>
                        )}
                    </div>

                    <dl className="tkd-meta">
                        <div><dt>Token ID</dt><dd className="tkd-mono">#{tid}</dd></div>
                        <div><dt>Collection</dt><dd><Link to={np(`nft/collection/${id}`)}>{detail.name}</Link></dd></div>
                        <div><dt>Creator</dt><dd><CopyableAddress address={detail.creator} /></dd></div>
                    </dl>
                </div>
            </div>

            {modal && me !== "" && (
                <TradeModal
                    action={modal.action}
                    source="v3"
                    collectionID={id}
                    tokenId={tid}
                    priceUgnot={modal.priceUgnot}
                    seller={modal.seller}
                    buyerAddr={modal.buyerAddr}
                    royaltyBps={detail.royaltyBps}
                    callerAddress={me}
                    onClose={close}
                    onSuccess={onSuccess}
                />
            )}
        </div>
    )
}

export default TokenDetail

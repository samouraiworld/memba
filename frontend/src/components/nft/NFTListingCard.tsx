/**
 * NFTListingCard — Card for a single marketplace listing.
 *
 * v2: reliable image via NFTImage proxy, formatted GNOT, truncated seller,
 * and an "enforced on-chain" royalty badge when the collection's royaltyBps
 * is known.
 *
 * @module components/nft/NFTListingCard
 */

import { NFTImage } from "./NFTImage"
import { formatGnot, truncateAddr } from "../../lib/format"
import type { NFTListing } from "../../lib/nftMarketplace"

interface Props {
    listing: NFTListing
    connected: boolean
    currentAddress?: string
    royaltyBps?: number
    onBuy: (listing: NFTListing) => void
    onMakeOffer: (listing: NFTListing) => void
    onDelist?: (listing: NFTListing) => void
    onCancelOffer?: (listing: NFTListing) => void
}

export function NFTListingCard({ listing, connected, currentAddress, royaltyBps, onBuy, onMakeOffer, onDelist, onCancelOffer }: Props) {
    const isOwnListing = currentAddress && listing.seller.startsWith(currentAddress.slice(0, 10))
    const royaltyPct = royaltyBps != null && royaltyBps > 0
        ? (royaltyBps / 100).toFixed(2).replace(/\.?0+$/, "")
        : null
    // NFTListing has no tokenURI; degrade gracefully to a placeholder image.
    const tokenURI = (listing as NFTListing & { tokenURI?: string }).tokenURI ?? ""

    return (
        <div className="nft-listing-card">
            <div className="nft-listing-card__image-wrap">
                <NFTImage
                    uri={tokenURI}
                    alt={`Token ${listing.tokenId}`}
                    className="nft-listing-card__image"
                />
                {royaltyPct && (
                    <div
                        className="nft-royalty-badge"
                        title={`${royaltyPct}% goes to the creator on every sale — enforced atomically in the gno.land realm; no marketplace can bypass it.`}
                    >
                        {royaltyPct}% royalty enforced
                    </div>
                )}
            </div>
            <div className="nft-listing-card__body">
                <div className="nft-listing-card__collection">{listing.nftRealm}</div>
                <div className="nft-listing-card__token">Token #{listing.tokenId}</div>
                <div className="nft-listing-card__price">{formatGnot(listing.priceUgnot)}</div>
                <div className="nft-listing-card__seller" title={listing.seller}>
                    Seller: {truncateAddr(listing.seller)}
                </div>
            </div>
            {connected && !isOwnListing && (
                <div className="nft-listing-card__actions">
                    <button className="nft-listing-card__buy" onClick={() => onBuy(listing)}>
                        Buy Now
                    </button>
                    <button className="nft-listing-card__offer" onClick={() => onMakeOffer(listing)}>
                        Make Offer
                    </button>
                </div>
            )}
            {connected && isOwnListing && (
                <div className="nft-listing-card__actions">
                    <div className="nft-listing-card__badge">Your Listing</div>
                    {onDelist && (
                        <button className="nft-listing-card__delist" onClick={() => onDelist(listing)}>
                            Delist
                        </button>
                    )}
                </div>
            )}
            {connected && !isOwnListing && onCancelOffer && (
                <button className="nft-listing-card__cancel-offer" onClick={() => onCancelOffer(listing)}>
                    Cancel Offer
                </button>
            )}
        </div>
    )
}

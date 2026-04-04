/**
 * NFTListingCard — Card for a single marketplace listing.
 *
 * Shows collection name, token ID, price in GNOT, seller address.
 * Includes Buy and Make Offer actions when connected.
 *
 * @module components/nft/NFTListingCard
 */

import type { NFTListing } from "../../lib/nftMarketplace"

interface Props {
    listing: NFTListing
    connected: boolean
    currentAddress?: string
    onBuy: (listing: NFTListing) => void
    onMakeOffer: (listing: NFTListing) => void
}

export function NFTListingCard({ listing, connected, currentAddress, onBuy, onMakeOffer }: Props) {
    const priceGnot = (listing.priceUgnot / 1_000_000).toFixed(2)
    const isOwnListing = currentAddress && listing.seller.startsWith(currentAddress.slice(0, 10))

    return (
        <div className="nft-listing-card">
            <div className="nft-listing-card__icon">🖼️</div>
            <div className="nft-listing-card__body">
                <div className="nft-listing-card__collection">{listing.nftRealm}</div>
                <div className="nft-listing-card__token">Token: {listing.tokenId}</div>
                <div className="nft-listing-card__price">{priceGnot} GNOT</div>
                <div className="nft-listing-card__seller">Seller: {listing.seller}</div>
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
            {isOwnListing && (
                <div className="nft-listing-card__badge">Your Listing</div>
            )}
        </div>
    )
}

/**
 * MyListingsView — the connected wallet's own active marketplace listings
 * (NFT v3.1 + Token OTC), each with a cancel/delist action. Read-only
 * aggregation over the existing per-lane readers (lib/myListings), cancel via
 * the existing builders + ordinary Adena broadcast. No new realm, no new flag.
 *
 * @module components/marketplace/MyListingsView
 */

import { useCallback, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useAdena } from "../../hooks/useAdena"
import { EmptyState } from "../ui/EmptyState"
import { ConnectingLoader } from "../ui/ConnectingLoader"
import { formatGnotCompact } from "../../lib/formatGnot"
import { fetchMyListings, cancelListing, anyListingLaneLive, type MyListing } from "../../lib/myListings"

export default function MyListingsView() {
    const { connected, address, connect } = useAdena()

    const query = useQuery({
        queryKey: ["my-listings", address ?? ""],
        queryFn: () => fetchMyListings(address as string),
        enabled: connected && !!address,
        staleTime: 15_000,
        retry: false,
    })

    // Track which listings the user just cancelled so they disappear
    // immediately (optimistic), plus a per-item busy/error state.
    const [cancelled, setCancelled] = useState<Set<string>>(new Set())
    const [busyKey, setBusyKey] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const onCancel = useCallback(
        async (listing: MyListing) => {
            if (!address) return
            setBusyKey(listing.key)
            setError(null)
            try {
                await cancelListing(listing, address)
                setCancelled(prev => new Set(prev).add(listing.key))
                // Reconcile against the chain once the indexer/reader catches up.
                setTimeout(() => void query.refetch(), 2_500)
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e)
                if (!/reject|cancel|denied/i.test(msg)) {
                    setError("Could not cancel the listing. Please try again.")
                }
            } finally {
                setBusyKey(null)
            }
        },
        [address, query],
    )

    if (!anyListingLaneLive()) {
        return (
            <EmptyState
                icon="ti-tag"
                title="No marketplace lanes are live"
                body="Listing management is available once a trading lane is enabled on this network."
            />
        )
    }

    if (!connected || !address) {
        return (
            <div className="um-mylistings" data-testid="my-listings-view">
                <EmptyState
                    icon="ti-wallet"
                    title="Connect your wallet"
                    body="Connect to see and manage the listings you've created."
                    action={{ label: "Connect wallet", onClick: () => void connect() }}
                />
            </div>
        )
    }

    if (query.isLoading) {
        return <ConnectingLoader minHeight="40vh" />
    }

    const listings = (query.data ?? []).filter(l => !cancelled.has(l.key))

    return (
        <div className="um-mylistings" data-testid="my-listings-view">
            {error && (
                <p className="um-mylistings-error" role="alert">
                    {error}
                </p>
            )}

            {listings.length === 0 ? (
                <EmptyState
                    icon="ti-tag"
                    title="No active listings"
                    body="Listings you create in the marketplace will appear here for you to manage."
                />
            ) : (
                <ul className="um-mylistings-list">
                    {listings.map(listing => (
                        <ListingRow
                            key={listing.key}
                            listing={listing}
                            busy={busyKey === listing.key}
                            onCancel={() => onCancel(listing)}
                        />
                    ))}
                </ul>
            )}
        </div>
    )
}

function ListingRow({
    listing,
    busy,
    onCancel,
}: {
    listing: MyListing
    busy: boolean
    onCancel: () => void
}) {
    const isNft = listing.kind === "nft"
    return (
        <li className="um-mylistings-row" data-testid={`listing-card-${listing.key}`}>
            <span className="um-mylistings-icon" aria-hidden="true">
                {isNft ? "🖼️" : "🪙"}
            </span>
            <div className="um-mylistings-info">
                {isNft ? (
                    <>
                        <span className="um-mylistings-title">
                            {listing.collectionID} <span className="um-mylistings-dim">#{listing.tokenId}</span>
                        </span>
                        <span className="um-mylistings-price">{formatGnotCompact(listing.priceUgnot)}</span>
                    </>
                ) : (
                    <>
                        <span className="um-mylistings-title">
                            {listing.amount.toString()} {listing.symbol}
                        </span>
                        <span className="um-mylistings-price">
                            {formatGnotCompact(listing.unitPriceUgnot)} / unit
                        </span>
                    </>
                )}
            </div>
            <button
                type="button"
                className="um-mylistings-cancel"
                disabled={busy}
                onClick={onCancel}
                data-testid={`cancel-btn-${listing.key}`}
            >
                {busy ? "Cancelling…" : isNft ? "Delist" : "Cancel"}
            </button>
        </li>
    )
}

/**
 * NFTImage — Reliable image rendering for NFT token URIs.
 * Routes through the backend proxy (nftImageUrl) for caching + IPFS reliability.
 * Shows a skeleton while loading; a placeholder box on error.
 */

import { useState } from "react"
import { nftImageUrl } from "../../lib/nftApi"

interface Props {
    uri: string
    alt: string
    className?: string
}

export function NFTImage({ uri, alt, className }: Props) {
    const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")
    const src = uri ? nftImageUrl(uri) : ""

    if (!uri) {
        return <div className={`nft-img-placeholder ${className ?? ""}`} aria-label={alt} />
    }

    return (
        <>
            {status === "loading" && (
                <div className={`nft-img-skeleton ${className ?? ""}`} aria-label="Loading image" />
            )}
            <img
                src={src}
                alt={alt}
                loading="lazy"
                className={`${className ?? ""} ${status !== "loaded" ? "nft-img-hidden" : ""}`}
                onLoad={() => setStatus("loaded")}
                onError={() => setStatus("error")}
            />
            {status === "error" && (
                <div className={`nft-img-placeholder ${className ?? ""}`} aria-label={alt}>
                    <span className="nft-img-placeholder__icon">🖼️</span>
                </div>
            )}
        </>
    )
}

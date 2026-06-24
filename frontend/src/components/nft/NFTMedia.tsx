/**
 * NFTMedia — Hardened media renderer for NFT token URIs.
 *
 * Supersedes NFTImage. Key improvements:
 * - Empty uri → styled placeholder immediately (no <img>)
 * - Non-empty uri → <img loading="lazy" src={nftImageUrl(uri)}>
 * - On load error → clean SVG placeholder tile (no emoji)
 * - Self-contained styling via co-located NFTMedia.css
 */

import { useState } from "react"
import { nftImageUrl } from "../../lib/nftApi"
import "./NFTMedia.css"

interface Props {
    uri: string
    alt: string
    className?: string
}

/** Tabler-style "image broken" SVG icon used in the placeholder tile. */
function PlaceholderIcon() {
    return (
        <svg
            className="nft-media-placeholder__icon"
            xmlns="http://www.w3.org/2000/svg"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {/* Frame */}
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            {/* Mountain/landscape suggestion */}
            <polyline points="3 17 8 12 11 15 14 12 21 19" />
            {/* Sun dot */}
            <circle cx="8.5" cy="8.5" r="1.5" />
        </svg>
    )
}

function Placeholder({ alt }: { alt: string }) {
    return (
        <div
            className="nft-media-placeholder"
            aria-label={alt}
            data-testid="nft-media-placeholder"
        >
            <PlaceholderIcon />
        </div>
    )
}

export function NFTMedia({ uri, alt, className }: Props) {
    const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")

    const rootClass = ["nft-media-root", className].filter(Boolean).join(" ")

    // Empty URI → placeholder immediately, never render an <img>
    if (!uri) {
        return (
            <div className={rootClass}>
                <Placeholder alt={alt} />
            </div>
        )
    }

    const src = nftImageUrl(uri)

    // Error state → swap to placeholder
    if (status === "error") {
        return (
            <div className={rootClass}>
                <Placeholder alt={alt} />
            </div>
        )
    }

    return (
        <div className={rootClass}>
            {status === "loading" && (
                <div
                    className="nft-media-skeleton"
                    aria-label="Loading image"
                    data-testid="nft-media-skeleton"
                />
            )}
            <img
                src={src}
                alt={alt}
                loading="lazy"
                className={`nft-media-img${status !== "loaded" ? " nft-media-img--hidden" : ""}`}
                onLoad={() => setStatus("loaded")}
                onError={() => setStatus("error")}
            />
        </div>
    )
}

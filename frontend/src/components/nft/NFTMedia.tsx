/**
 * NFTMedia — Hardened media renderer for NFT token URIs.
 *
 * Supersedes NFTImage. Key improvements:
 * - Empty uri → deterministic generated fallback art immediately (no <img> load)
 * - Non-empty uri → <img loading="lazy" src={nftImageUrl(uri)}>
 * - On load error → swap to the same generated fallback (no broken-image flash)
 * - Self-contained styling via co-located NFTMedia.css
 *
 * The fallback is a teal/black blockie seeded by `seed` (or `alt` when no seed
 * is given) so every item gets a distinct, stable, non-empty tile with zero
 * backend work — see lib/nftFallbackArt.
 */

import { useMemo, useState } from "react"
import { nftImageUrl } from "../../lib/nftApi"
import { nftFallbackUri } from "../../lib/nftFallbackArt"
import "./NFTMedia.css"

interface Props {
    uri: string
    alt: string
    /** Identity used to seed the generated fallback. Defaults to `alt`. */
    seed?: string
    className?: string
}

/** Deterministic generated artwork shown when there is no usable image. */
function Fallback({ alt, seed }: { alt: string; seed: string }) {
    const src = useMemo(() => nftFallbackUri(seed), [seed])
    return (
        <img
            src={src}
            alt={alt}
            className="nft-media-img nft-media-fallback"
            data-testid="nft-media-fallback"
        />
    )
}

export function NFTMedia({ uri, alt, seed, className }: Props) {
    const fallbackSeed = seed || alt
    const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")

    const rootClass = ["nft-media-root", className].filter(Boolean).join(" ")

    // Empty URI → generated fallback immediately, never attempt a network <img>
    if (!uri) {
        return (
            <div className={rootClass}>
                <Fallback alt={alt} seed={fallbackSeed} />
            </div>
        )
    }

    const src = nftImageUrl(uri)

    // Error state → swap to the generated fallback
    if (status === "error") {
        return (
            <div className={rootClass}>
                <Fallback alt={alt} seed={fallbackSeed} />
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

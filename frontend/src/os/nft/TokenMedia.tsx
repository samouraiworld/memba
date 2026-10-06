/**
 * A collection's or a token's image, in a box whose shape is fixed before the
 * file arrives, so nothing around it moves. A URI this client does not render,
 * or an image that fails to load, shows the art generated from `seed` instead
 * of a broken picture. Only images served through IPFS are loaded: one on a
 * creator's own host gets the generated art and says why. Whatever a creator
 * wrote reaches the page as an attribute only (`src`, `alt`), never as markup.
 *
 * @module os/nft/TokenMedia
 */
import { useState } from "react"
import { mediaUrl, webUrl } from "../../lib/nft/metadata"
import { nftFallbackUri } from "../../lib/nftFallbackArt"
import "./nft.css"

interface TokenMediaProps {
    /** What the ledger or the token's metadata points at; null or "" when there is none. */
    uri: string | null
    /** What the generated art is drawn from: a collection ID, or `<collection>/<number>`. */
    seed: string
    alt: string
    shape?: "square" | "banner"
}

export function TokenMedia({ uri, seed, alt, shape = "square" }: TokenMediaProps) {
    const url = uri === null ? null : mediaUrl(uri)
    const outside = uri !== null && url === null && webUrl(uri) !== null
    // Remembered by URL, so another image shown in the same place gets its own try.
    const [failed, setFailed] = useState<string | null>(null)
    const image = (
        <img
            className={`os-nft-media os-nft-${shape}`}
            src={url !== null && url !== failed ? url : nftFallbackUri(seed)}
            alt={alt}
            loading="lazy"
            decoding="async"
            // A creator's own host learns nothing about the page that asked.
            referrerPolicy="no-referrer"
            onError={() => setFailed(url)}
        />
    )
    if (!outside) return image
    return (
        <span className="os-nft-outside">
            {image}
            <span className="os-nft-outside-note">Image hosted outside IPFS, not loaded for your privacy.</span>
        </span>
    )
}

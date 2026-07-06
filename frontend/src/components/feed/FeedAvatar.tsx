/**
 * FeedAvatar — a deterministic identity tile for a feed author. A rounded
 * square (terminal aesthetic, not a web2 circle) tinted by a hash of the
 * address, with the first two glyphs. Theme-safe: a mid-tone saturated tile
 * with light text reads on both light and dark surfaces.
 *
 * @module components/feed/FeedAvatar
 */
import { avatarHue, avatarLabel } from "../../lib/feedAvatar"

export function FeedAvatar({ address, size = 36 }: { address: string; size?: number }) {
    const hue = avatarHue(address)
    return (
        <span
            className="feed-avatar"
            aria-hidden="true"
            style={{
                width: size,
                height: size,
                fontSize: Math.round(size * 0.36),
                // Mid-tone, fixed S/L so every tile sits in the same visual family
                // and stays legible with light text on either theme.
                background: `hsl(${hue}, 42%, 42%)`,
            }}
        >
            {avatarLabel(address)}
        </span>
    )
}

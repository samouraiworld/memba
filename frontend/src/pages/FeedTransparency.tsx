import FeedModAuditLog from "../components/feed/FeedModAuditLog"
import "./feed.css"
import "./feed-mod.css"

/**
 * Public feed-moderation transparency page (feed v2 Wave C.5), at
 * /:network/feed/transparency behind VITE_ENABLE_FEED. No auth — it discloses
 * that moderation happens (the public, body-free log) alongside the policy, so
 * moderation reads as disclosed-labeling, not silent deletion. Flaggers are
 * masked (hideFlagger); moderator actions stay accountable.
 */
export default function FeedTransparency() {
    return (
        <main className="feed-mod">
            <h1>Feed moderation — transparency</h1>

            <p>
                Memba’s feed is open-write and on-chain: every post’s body is permanent. Moderation
                can’t delete anything from the chain — it only changes what the app serves. Our
                commitment is <strong>disclosed labeling, not silent deletion</strong>: every flag,
                auto-hide, and moderator action is recorded on-chain and mirrored into the public log
                below.
            </p>

            <ul className="feed-mod__policy">
                <li>
                    <strong>Community flags are a label, not a verdict</strong> — enough flags auto-hide
                    a post from discovery pending review; a wrongful brigade is reversible with one
                    operator action, not an expensive takedown.
                </li>
                <li>
                    <strong>Illegal content is blocklisted first</strong> — hard-suppressed on every
                    surface, never quarantined or restored.
                </li>
                <li>
                    <strong>Nothing is silently deleted</strong> — every on-chain flag, auto-hide, and
                    moderator action appears in the log below.
                </li>
                <li>
                    <strong>Flaggers aren’t doxxed here</strong> — the log shows <em>that</em> a post was
                    community-flagged, not <em>who</em> flagged it. Moderator actions show the acting
                    address.
                </li>
            </ul>

            <p>
                Full policy:{" "}
                <a
                    href="https://github.com/samouraiworld/memba/blob/main/docs/MODERATION_POLICY.md"
                    target="_blank"
                    rel="noreferrer noopener"
                >
                    MODERATION_POLICY.md
                </a>
                .
            </p>

            <section aria-label="Public moderation log">
                <h2>Moderation log</h2>
                <FeedModAuditLog hideFlagger />
            </section>
        </main>
    )
}

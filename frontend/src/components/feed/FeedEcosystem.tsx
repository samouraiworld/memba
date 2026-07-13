/**
 * FeedEcosystem — the "Ecosystem" tab of the feed.
 *
 * The feed's own posts are only one slice of what's happening on-chain. This
 * tab reuses the Home {@link ActivityFeed} — the same tx-indexer-backed "live
 * across gno.land" stream (proposals, tokens, validators, mints, and feed posts
 * themselves, with per-kind filter chips) — so the feed feels alive even when
 * the post timeline is quiet. Pure reuse: no new data path, no realm change.
 *
 * @module components/feed/FeedEcosystem
 */

import { ActivityFeed } from "../home/ActivityFeed"
import { ACTIVE_NETWORK_KEY } from "../../lib/config"

export function FeedEcosystem() {
    return (
        <div className="feed-ecosystem" data-testid="feed-ecosystem">
            <p className="feed-ecosystem__intro">
                Live across gno.land — proposals, tokens, validators, mints, and posts as they happen.
            </p>
            <ActivityFeed networkKey={ACTIVE_NETWORK_KEY} />
        </div>
    )
}

/**
 * @mention notification matching for channel replies.
 *
 * @module plugins/board/mentions
 */

import { isFullGnoAddress, sameFullAddress } from "../../lib/addressMatch"
import { parseMentions } from "./parserV1"
import type { BoardReply } from "./types"

/**
 * Should this reply raise an @mention notification for `userAddress`?
 *
 * Mentions are full `@g1…` addresses (see parseMentions), so a reply mentions
 * the user only when one of them equals the user's full address
 * (case-insensitive). The user's own reply is skipped only when its author is
 * that exact full address; the channels realm renders reply authors truncated
 * (first 10 characters + "..."), and a truncated author cannot be told apart
 * from another account sharing the prefix, so it is never treated as the user.
 */
export function replyMentionsUser(
    reply: Pick<BoardReply, "author" | "body">,
    userAddress: string,
): boolean {
    if (!isFullGnoAddress(userAddress)) return false
    if (sameFullAddress(reply.author, userAddress)) return false
    return parseMentions(reply.body).some(m => sameFullAddress(m, userAddress))
}
